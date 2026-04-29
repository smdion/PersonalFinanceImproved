/**
 * Extra-paycheck override materializer.
 *
 * Reads `jobs.extra_paycheck_routing` rules and writes the resulting dollar
 * amounts into `savings_allocation_overrides` with `source = 'rule'` for the
 * next 24 months. Manual overrides (source = 'manual') are never touched.
 *
 * Call after: job create/update/delete, or explicit rule save.
 */

import { eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ExtraPaycheckRule } from "@/lib/db/schema-pg";
import { getExtraPaycheckMonthKeys } from "@/lib/calculators/paycheck";
import type { Db } from "./transforms";

const HORIZON_MONTHS = 24;

/**
 * Materialize extra-paycheck overrides for all jobs that have routing rules.
 * Safe to call repeatedly — fully replaces existing rule-sourced overrides.
 */
export async function materializeExtraPaycheckOverrides(db: Db): Promise<void> {
  const now = new Date();

  // Load all jobs with routing rules and their people
  const jobsWithRules = await db
    .select({
      id: schema.jobs.id,
      anchorPayDate: schema.jobs.anchorPayDate,
      payPeriod: schema.jobs.payPeriod,
      extraPaycheckRouting: schema.jobs.extraPaycheckRouting,
      personId: schema.jobs.personId,
    })
    .from(schema.jobs)
    .then(
      (
        rows: {
          id: number;
          anchorPayDate: string | null;
          payPeriod: string;
          extraPaycheckRouting: ExtraPaycheckRule[] | null;
          personId: number;
        }[],
      ) =>
        rows.filter((j) => j.extraPaycheckRouting?.length && j.anchorPayDate),
    );

  if (jobsWithRules.length === 0) {
    // No rules — delete any stale rule-sourced overrides
    await db
      .delete(schema.savingsAllocationOverrides)
      .where(eq(schema.savingsAllocationOverrides.source, "rule"));
    return;
  }

  // Load all active goal ids so we can skip deleted goals
  const activeGoals = await db
    .select({ id: schema.savingsGoals.id })
    .from(schema.savingsGoals)
    .where(eq(schema.savingsGoals.isActive, true));
  const activeGoalIds = new Set<number>(
    (activeGoals as { id: number }[]).map((g) => g.id),
  );

  // Build the full set of desired rule overrides: { goalId, monthDate, amount }
  type OverrideRow = { goalId: number; monthDate: string; amount: string };
  const desired = new Map<string, OverrideRow>(); // key = "goalId:YYYY-MM-01"

  for (const job of jobsWithRules) {
    const anchor = new Date(job.anchorPayDate! + "T00:00:00Z");
    const monthKeys = getExtraPaycheckMonthKeys(
      anchor,
      job.payPeriod,
      now,
      HORIZON_MONTHS,
    );

    for (const monthDate of monthKeys) {
      // "YYYY-MM-01" → "YYYY-MM" for rule matching
      const monthKey = monthDate.slice(0, 7);
      const rule = findActiveRule(job.extraPaycheckRouting!, monthKey);
      if (!rule) continue;

      for (const split of rule.splits) {
        if (!activeGoalIds.has(split.goalId)) continue;
        const amount = (rule.netPaySnapshot * split.pct) / 100;
        const key = `${split.goalId}:${monthDate}`;
        const existing = desired.get(key);
        desired.set(key, {
          goalId: split.goalId,
          monthDate,
          // Multiple jobs can add to the same goal/month — sum them
          amount: String(
            Math.round(
              ((existing ? Number(existing.amount) : 0) + amount) * 100,
            ) / 100,
          ),
        });
      }
    }
  }

  // Load existing rule-sourced overrides
  const existingRuleOverrides = await db
    .select({
      id: schema.savingsAllocationOverrides.id,
      goalId: schema.savingsAllocationOverrides.goalId,
      monthDate: schema.savingsAllocationOverrides.monthDate,
      amount: schema.savingsAllocationOverrides.amount,
    })
    .from(schema.savingsAllocationOverrides)
    .where(eq(schema.savingsAllocationOverrides.source, "rule"));

  const existingMap = new Map<string, { id: number; amount: string }>();
  for (const row of existingRuleOverrides as {
    id: number;
    goalId: number;
    monthDate: string;
    amount: string;
  }[]) {
    existingMap.set(`${row.goalId}:${row.monthDate}`, {
      id: row.id,
      amount: row.amount,
    });
  }

  // Load existing manual overrides so we never overwrite them
  const manualOverrides = await db
    .select({
      goalId: schema.savingsAllocationOverrides.goalId,
      monthDate: schema.savingsAllocationOverrides.monthDate,
    })
    .from(schema.savingsAllocationOverrides)
    .where(eq(schema.savingsAllocationOverrides.source, "manual"));
  const manualKeys = new Set<string>(
    (manualOverrides as { goalId: number; monthDate: string }[]).map(
      (r) => `${r.goalId}:${r.monthDate}`,
    ),
  );

  // Compute inserts, updates, and deletes
  const toInsert: {
    goalId: number;
    monthDate: string;
    amount: string;
    source: string;
  }[] = [];
  const toUpdate: { id: number; amount: string }[] = [];
  const toDelete: number[] = [];

  for (const [key, row] of desired) {
    if (manualKeys.has(key)) continue; // manual wins
    const existing = existingMap.get(key);
    if (!existing) {
      toInsert.push({ ...row, source: "rule" });
    } else if (Math.abs(Number(existing.amount) - Number(row.amount)) >= 0.01) {
      toUpdate.push({ id: existing.id, amount: row.amount });
    }
  }
  for (const [key, { id }] of existingMap) {
    if (!desired.has(key)) toDelete.push(id);
  }

  // Apply changes
  if (toInsert.length > 0) {
    await db.insert(schema.savingsAllocationOverrides).values(toInsert);
  }
  for (const { id, amount } of toUpdate) {
    await db
      .update(schema.savingsAllocationOverrides)
      .set({ amount })
      .where(eq(schema.savingsAllocationOverrides.id, id));
  }
  if (toDelete.length > 0) {
    await db
      .delete(schema.savingsAllocationOverrides)
      .where(inArray(schema.savingsAllocationOverrides.id, toDelete));
  }
}

/** Find the active rule for a given "YYYY-MM" key. */
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
