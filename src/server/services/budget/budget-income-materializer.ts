/**
 * Budget-income materializer.
 *
 * Reads each job's `extraPaycheckRouting` field from its entry in the
 * globally-active Salary Profile and writes the resulting dollar amounts
 * into `budget_income_adjustments` with `source = 'rule'`, over the months
 * `extra-paycheck-months.ts` walks (the same 10 years as Savings mode).
 *
 * Complement of extra-paycheck-materializer.ts: that one covers jobs whose
 * routing is in Savings mode (real `rules`, `enabled` not false); this one
 * covers jobs in Budget mode (`isExtraPaycheckBudgetMode` — no rules, or
 * `enabled: false`). The two filters are mutually
 * exclusive per job, so together they cover every job exactly once under
 * its current mode. Budget mode has no split/goal concept, so this writes
 * ONE row per (job, month) rather than fanning out per split.
 *
 * Call after: job create/update/delete, explicit rule/override save — at
 * every call site that also calls materializeExtraPaycheckSavings.
 */

import { eq, gte, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { currentMonthKey } from "@/lib/utils/date-keys";
import { projectedNetPay } from "@/lib/pure/paycheck/net-pay-growth";
import { loadExtraPaycheckJobs } from "./extra-paycheck-months";
import type { Db } from "@/lib/db";

// Serializes concurrent materializer calls within the same Node.js process.
// Same delete→insert race concern as extra-paycheck-materializer.ts — kept
// as an independent lock so a slow Budget-mode cycle never blocks (or is
// blocked by) the Savings-mode materializer's own lock.
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

  // Delete-and-reinsert of 'rule' rows dated this month or later, same
  // semantics as the Savings materializer. Nothing else FK-references
  // budget_income_adjustments rows (no settlement/history table analogous
  // to savings_planned_tx_settlements exists for this table), so a plain
  // delete-all-future+reinsert is safe — no id-preservation concern.
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
