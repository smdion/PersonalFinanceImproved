/**
 * Writes Savings-mode extra-paycheck routing (active Salary Profile rules; a matching
 * override's splits win) into `savings_planned_transactions` as `source = 'rule'`.
 * Call after job create/update/delete and explicit rule/override saves.
 */

import { eq, and, gte, notInArray, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ExtraPaycheckRule } from "@/lib/db/schema-pg";
import { currentMonthKey } from "@/lib/utils/date-keys";
import { projectedNetPay } from "@/lib/pure/paycheck/net-pay-growth";
import { loadExtraPaycheckJobs } from "./extra-paycheck-months";
import type { Db } from "@/lib/db";

// Serializes concurrent materializer calls within the same Node.js process.
// Prevents the delete→insert race when two mutations (e.g. two auto-upgrades)
// fire simultaneously and each runs a full materialize cycle.
let materializerLock: Promise<void> = Promise.resolve();

export async function materializeExtraPaycheckSavings(
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
  const jobsWithRules = await loadExtraPaycheckJobs(db, now, "savings");

  // Load active goal ids
  const activeGoals = await db
    .select({ id: schema.savingsGoals.id })
    .from(schema.savingsGoals)
    .where(eq(schema.savingsGoals.isActive, true));
  const activeGoalIds = new Set<number>(
    (activeGoals as { id: number }[]).map((g) => g.id),
  );

  // Build desired planned transaction rows: { goalId, transactionDate, amount, description }
  type TxRow = {
    goalId: number;
    transactionDate: string;
    amount: string;
    description: string;
  };
  const desired = new Map<string, TxRow>(); // key = "goalId:YYYY-MM-01"

  // Load person names for descriptions
  const people = await db
    .select({ id: schema.people.id, name: schema.people.name })
    .from(schema.people);
  const personNameMap = new Map(
    (people as { id: number; name: string }[]).map((p) => [p.id, p.name]),
  );

  const nowYear = now.getFullYear();

  for (const job of jobsWithRules) {
    const routing = job.routing!;
    const rules = routing.rules;
    const overrides = routing.overrides ?? [];
    const yearlyGrowth = routing.yearlyGrowth ?? {};
    const baseNetPay = routing.baseNetPayPerCheck;
    const baseYear = routing.baseYear ?? nowYear;
    const personName = personNameMap.get(job.personId) ?? "Unknown";

    for (const transactionDate of job.monthDates) {
      const monthKey = transactionDate.slice(0, 7); // "YYYY-MM"

      // Override takes priority over rule for splits
      const override = overrides.find((o) => o.month === monthKey);
      const rule = findActiveRule(rules, monthKey);
      if (!rule) continue;

      const splits = override?.splits ?? rule.splits;

      // Compute net pay: prefer routing-level base + growth projection;
      // fall back to per-rule netPaySnapshot for legacy records.
      const targetYear = parseInt(monthKey.slice(0, 4));
      const netPay =
        baseNetPay !== undefined
          ? projectedNetPay(baseNetPay, targetYear, baseYear, yearlyGrowth)
          : (rule.netPaySnapshot ?? 0);

      for (const split of splits) {
        if (!activeGoalIds.has(split.goalId)) continue;
        const amount = (netPay * split.pct) / 100;
        const key = `${split.goalId}:${transactionDate}`;
        const existing = desired.get(key);
        desired.set(key, {
          goalId: split.goalId,
          transactionDate,
          description: personName,
          amount: String(
            Math.round(
              ((existing ? Number(existing.amount) : 0) + amount) * 100,
            ) / 100,
          ),
        });
      }
    }
  }

  // Atomically replace rule rows from this month on (earlier months are never regenerated).
  // Rows with settlement history are kept: a new row id would orphan their settlements.
  const currentMonthStart = currentMonthKey(now);
  await db.transaction(async (tx) => {
    const settledRows = await tx
      .select({ plannedTxId: schema.savingsPlannedTxSettlements.plannedTxId })
      .from(schema.savingsPlannedTxSettlements);
    const preserveIds = [...new Set(settledRows.map((r) => r.plannedTxId))];

    let preservedRuleRows: { goalId: number; transactionDate: string }[] = [];
    if (preserveIds.length > 0) {
      preservedRuleRows = await tx
        .select({
          goalId: schema.savingsPlannedTransactions.goalId,
          transactionDate: schema.savingsPlannedTransactions.transactionDate,
        })
        .from(schema.savingsPlannedTransactions)
        .where(
          and(
            eq(schema.savingsPlannedTransactions.source, "rule"),
            inArray(schema.savingsPlannedTransactions.id, preserveIds),
          ),
        );
    }
    // A preserved (settled) row already occupies its goalId+month slot —
    // drop the freshly-recomputed entry for that same slot so regeneration
    // doesn't insert a duplicate alongside it.
    for (const row of preservedRuleRows) {
      desired.delete(`${row.goalId}:${row.transactionDate}`);
    }

    await tx
      .delete(schema.savingsPlannedTransactions)
      .where(
        preserveIds.length > 0
          ? and(
              eq(schema.savingsPlannedTransactions.source, "rule"),
              gte(
                schema.savingsPlannedTransactions.transactionDate,
                currentMonthStart,
              ),
              notInArray(schema.savingsPlannedTransactions.id, preserveIds),
            )
          : and(
              eq(schema.savingsPlannedTransactions.source, "rule"),
              gte(
                schema.savingsPlannedTransactions.transactionDate,
                currentMonthStart,
              ),
            ),
      );

    if (desired.size > 0) {
      await tx.insert(schema.savingsPlannedTransactions).values(
        Array.from(desired.values()).map((row) => ({
          ...row,
          isRecurring: false,
          recurrenceMonths: null,
          transferPairId: null,
          source: "rule" as const,
        })),
      );
    }
  });
}

function findActiveRule(
  rules: ExtraPaycheckRule[],
  monthKey: string,
): ExtraPaycheckRule | null {
  for (const rule of rules) {
    if (monthKey < rule.from) continue;
    if (rule.to !== null && monthKey > rule.to) continue;
    return rule;
  }
  return null;
}
