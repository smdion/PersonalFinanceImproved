/**
 * The only path that resolves a savings goal's effective
 * allocationPercent/monthlyContribution for a given budget profile. A row in
 * savings_goal_profile_allocations for (goalId, profileId) shadows the
 * goal's global savings_goals.allocationPercent/monthlyContribution columns
 * when present; absent means "inherits the global default" (same
 * override-shadows-default shape savings_allocation_overrides already uses
 * for per-month overrides).
 *
 * recalculateAllocation/lockInAllocationPercent always write through
 * upsertGoalProfileAllocation, never the raw savings_goals columns — those
 * columns are only ever set at goal creation, so this is the single place
 * that can produce a stale-vs-displayed mismatch, and it can't, because
 * nothing else writes allocation state.
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { toNumber } from "./transforms";
import type { Context } from "../trpc";

type DbType =
  Context["db"] | Parameters<Parameters<Context["db"]["transaction"]>[0]>[0];

export interface ResolvedGoalAllocation {
  goalId: number;
  allocationPercent: number | null;
  monthlyContribution: number;
  isOverride: boolean;
}

interface GoalAllocationFields {
  id: number;
  allocationPercent: string | null;
  monthlyContribution: string | null;
}

/** Batched — one query for all override rows in the profile, not N+1 per goal. */
export async function getResolvedGoalAllocations(
  db: DbType,
  goals: GoalAllocationFields[],
  profileId: number | null,
): Promise<Map<number, ResolvedGoalAllocation>> {
  const overridesByGoal = new Map<
    number,
    { allocationPercent: string | null; monthlyContribution: string | null }
  >();
  if (profileId != null && goals.length > 0) {
    const rows = await db
      .select()
      .from(schema.savingsGoalProfileAllocations)
      .where(
        and(
          eq(schema.savingsGoalProfileAllocations.budgetProfileId, profileId),
          inArray(
            schema.savingsGoalProfileAllocations.goalId,
            goals.map((g) => g.id),
          ),
        ),
      );
    for (const r of rows) overridesByGoal.set(r.goalId, r);
  }

  // A present override row is a full replacement of both fields (same
  // null-means-dollar-only semantics as savings_goals itself) — not a
  // per-field merge with the global default.
  const result = new Map<number, ResolvedGoalAllocation>();
  for (const g of goals) {
    const override = overridesByGoal.get(g.id);
    const source = override ?? g;
    result.set(g.id, {
      goalId: g.id,
      allocationPercent:
        source.allocationPercent != null
          ? toNumber(source.allocationPercent)
          : null,
      monthlyContribution: toNumber(source.monthlyContribution),
      isOverride: override !== undefined,
    });
  }
  return result;
}

/** Upsert a single (goal, profile) override. Replaces both fields as a
 *  unit — to fully revert to the global default, use
 *  deleteGoalProfileAllocation instead of upserting nulls. */
export async function upsertGoalProfileAllocation(
  db: DbType,
  goalId: number,
  profileId: number,
  values: { allocationPercent: number | null; monthlyContribution: number },
): Promise<void> {
  const existing = await db
    .select({ id: schema.savingsGoalProfileAllocations.id })
    .from(schema.savingsGoalProfileAllocations)
    .where(
      and(
        eq(schema.savingsGoalProfileAllocations.goalId, goalId),
        eq(schema.savingsGoalProfileAllocations.budgetProfileId, profileId),
      ),
    );

  const row = {
    allocationPercent:
      values.allocationPercent !== null
        ? values.allocationPercent.toFixed(3)
        : null,
    monthlyContribution: values.monthlyContribution.toFixed(2),
  };

  if (existing[0]) {
    await db
      .update(schema.savingsGoalProfileAllocations)
      .set(row)
      .where(eq(schema.savingsGoalProfileAllocations.id, existing[0].id));
  } else {
    await db.insert(schema.savingsGoalProfileAllocations).values({
      goalId,
      budgetProfileId: profileId,
      ...row,
    });
  }
}

/** Delete a (goal, profile) override, reverting that goal to the global
 *  default for that profile. */
export async function deleteGoalProfileAllocation(
  db: DbType,
  goalId: number,
  profileId: number,
): Promise<void> {
  await db
    .delete(schema.savingsGoalProfileAllocations)
    .where(
      and(
        eq(schema.savingsGoalProfileAllocations.goalId, goalId),
        eq(schema.savingsGoalProfileAllocations.budgetProfileId, profileId),
      ),
    );
}
