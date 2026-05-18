/**
 * Extra-paycheck materializer.
 *
 * Reads `jobs.extra_paycheck_routing` (rules + optional overrides) and writes
 * the resulting dollar amounts into `savings_planned_transactions` with
 * `source = 'rule'` for the next 24 months.
 *
 * Override priority: if an ExtraPaycheckOverride entry matches the month key,
 * its splits are used instead of the rule's splits.
 *
 * Call after: job create/update/delete, explicit rule/override save.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type {
  ExtraPaycheckRule,
  ExtraPaycheckOverride,
  ExtraPaycheckRoutingData,
  YearlyGrowthEntry,
} from "@/lib/db/schema-pg";
import { getExtraPaycheckMonthKeys } from "@/lib/calculators/paycheck";
import type { Db } from "./transforms";

const HORIZON_MONTHS = 120; // covers the max 10-year projection window

/**
 * Project a base net-pay-per-check forward to a target year, applying stored
 * growth entries. Each entry modifies the running total (pct = percentage of
 * current total; dollar = flat bump carried forward as the new base).
 * Years with no entry default to 0% growth.
 */
function projectedNetPay(
  base: number,
  targetYear: number,
  baseYear: number,
  yearlyGrowth: Record<string, YearlyGrowthEntry>,
): number {
  let pay = base;
  for (let y = baseYear + 1; y <= targetYear; y++) {
    const e = yearlyGrowth[String(y)];
    if (!e || e.value === 0) continue;
    pay = e.type === "pct" ? pay * (1 + e.value / 100) : pay + e.value;
  }
  return pay;
}

// Serializes concurrent materializer calls within the same Node.js process.
// Prevents the delete→insert race when two mutations (e.g. two auto-upgrades)
// fire simultaneously and each runs a full materialize cycle.
let materializerLock: Promise<void> = Promise.resolve();

export async function materializeExtraPaycheckOverrides(db: Db): Promise<void> {
  const prev = materializerLock;
  let unlock!: () => void;
  materializerLock = new Promise<void>((r) => {
    unlock = r;
  });
  await prev;

  try {
    await _materialize(db);
  } finally {
    unlock();
  }
}

async function _materialize(db: Db): Promise<void> {
  const now = new Date();

  // Load all active jobs with routing data
  const allJobs = await db
    .select({
      id: schema.jobs.id,
      anchorPayDate: schema.jobs.anchorPayDate,
      payPeriod: schema.jobs.payPeriod,
      extraPaycheckRouting: schema.jobs.extraPaycheckRouting,
      personId: schema.jobs.personId,
    })
    .from(schema.jobs);

  const jobsWithRules = (
    allJobs as {
      id: number;
      anchorPayDate: string | null;
      payPeriod: string;
      extraPaycheckRouting: ExtraPaycheckRoutingData | null;
      personId: number;
    }[]
  ).filter((j) => j.extraPaycheckRouting?.rules?.length && j.anchorPayDate);

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
    const routing = job.extraPaycheckRouting!;
    const rules = routing.rules;
    const overrides = routing.overrides ?? [];
    const yearlyGrowth = routing.yearlyGrowth ?? {};
    const baseNetPay = routing.baseNetPayPerCheck;
    const baseYear = routing.baseYear ?? nowYear;
    const personName = personNameMap.get(job.personId) ?? "Unknown";

    const anchor = new Date(job.anchorPayDate! + "T00:00:00Z");
    const monthDates = getExtraPaycheckMonthKeys(
      anchor,
      job.payPeriod,
      now,
      HORIZON_MONTHS,
    );

    for (const transactionDate of monthDates) {
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

  // Delete all rule-sourced rows then insert fresh ones inside a transaction
  // so the replacement is atomic at the DB level.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.savingsPlannedTransactions)
      .where(eq(schema.savingsPlannedTransactions.source, "rule"));

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

export type { ExtraPaycheckOverride };
