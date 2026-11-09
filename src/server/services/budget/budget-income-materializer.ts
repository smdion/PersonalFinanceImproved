/**
 * Writes Budget-mode extra-paycheck routing (active Salary Profile) into
 * `budget_income_adjustments` as `source = 'rule'`, one row per (job, month); the
 * complement of extra-paycheck-materializer.ts. Call wherever that one is called.
 */

import { eq, gte, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { currentMonthKey } from "@/lib/utils/date-keys";
import { projectedNetPay } from "@/lib/pure/paycheck/net-pay-growth";
import { loadExtraPaycheckJobs } from "./extra-paycheck-months";
import type { Db } from "@/lib/db";

// Serializes this materializer's delete→insert within the process; separate
// from extra-paycheck-materializer.ts's lock so neither blocks the other.
let materializerLock: Promise<void> = Promise.resolve();

export async function materializeBudgetIncomeAdjustments(
  db: Db,
  asOf: Date,
): Promise<void> {
  const prev = materializerLock;
  let unlock!: () => void;
  materializerLock = new Promise<void>((r) => {
    unlock = r;
  });
  await prev;

  try {
    await _materialize(db, asOf);
  } finally {
    unlock();
  }
}

async function _materialize(db: Db, now: Date): Promise<void> {
  const jobsInBudgetMode = await loadExtraPaycheckJobs(db, now, "budget");

  type Row = { jobId: number; monthDate: string; amount: string };
  const desired = new Map<string, Row>(); // key = "jobId:YYYY-MM-01"

  const nowYear = now.getFullYear();

  for (const job of jobsInBudgetMode) {
    const routing = job.routing;
    const baseNetPay = routing?.baseNetPayPerCheck;
    // No baseNetPayPerCheck snapshot means nothing to project — matches
    // ExtraPaycheckBudgetNote's own precondition (it only shows an amount
    // when this is set; with no amount there is nothing to materialize).
    if (baseNetPay === undefined) continue;

    const baseYear = routing?.baseYear ?? nowYear;
    const yearlyGrowth = routing?.yearlyGrowth ?? {};
    for (const monthDate of job.monthDates) {
      const targetYear = parseInt(monthDate.slice(0, 4));
      const amount = projectedNetPay(
        baseNetPay,
        targetYear,
        baseYear,
        yearlyGrowth,
      );
      desired.set(`${job.id}:${monthDate}`, {
        jobId: job.id,
        monthDate,
        amount: String(Math.round(amount * 100) / 100),
      });
    }
  }

  // Delete-and-reinsert 'rule' rows from this month on; nothing FK-references
  // budget_income_adjustments, so row ids needn't be preserved.
  const currentMonthStart = currentMonthKey(now);
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.budgetIncomeAdjustments)
      .where(
        and(
          eq(schema.budgetIncomeAdjustments.source, "rule"),
          gte(schema.budgetIncomeAdjustments.monthDate, currentMonthStart),
        ),
      );

    if (desired.size > 0) {
      await tx.insert(schema.budgetIncomeAdjustments).values(
        Array.from(desired.values()).map((row) => ({
          jobId: row.jobId,
          monthDate: row.monthDate,
          amount: row.amount,
          source: "rule" as const,
        })),
      );
    }
  });
}
