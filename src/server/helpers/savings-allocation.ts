/**
 * The only path that resolves a savings goal's effective
 * allocationPercent/monthlyContribution for a given budget profile. Every
 * active (goal, profile) pair has a mandatory row in
 * savings_goal_profile_allocations — funding is entirely per-profile, no
 * shared default a profile falls back to (goal *identity* stays on
 * savingsGoals and IS shared; only funding is per-profile — see that
 * table's comment in schema-pg.ts). A missing row (shouldn't happen once a
 * pair is seeded at goal/profile creation) resolves to $0/no-percent rather
 * than throwing, since a genuinely defensive fallback beats a 500 here.
 *
 * recalculateAllocation/lockInAllocationPercent always write through
 * upsertGoalProfileAllocation.
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
}

interface GoalAllocationFields {
  id: number;
}

/** Batched — one query for all rows in the profile, not N+1 per goal. */
export async function getResolvedGoalAllocations(
  db: DbType,
  goals: GoalAllocationFields[],
  profileId: number | null,
): Promise<Map<number, ResolvedGoalAllocation>> {
  const rowsByGoal = new Map<
    number,
    { allocationPercent: string | null; monthlyContribution: string }
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
    for (const r of rows) rowsByGoal.set(r.goalId, r);
  }

  const result = new Map<number, ResolvedGoalAllocation>();
  for (const g of goals) {
    const row = rowsByGoal.get(g.id);
    result.set(g.id, {
      goalId: g.id,
      allocationPercent:
        row?.allocationPercent != null ? toNumber(row.allocationPercent) : null,
      monthlyContribution: row ? toNumber(row.monthlyContribution) : 0,
    });
  }
  return result;
}

/** Upsert a single (goal, profile) row. Replaces both fields as a unit. */
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

/** Set every active goal's funding to $0/no-percent for one profile — the
 *  "reset all to zero" bulk action. One statement per goal inside a
 *  transaction (caller passes a tx db handle) rather than delete+reseed,
 *  since every pair must keep an explicit row. */
export async function resetProfileAllocationsToZero(
  db: DbType,
  goalIds: number[],
  profileId: number,
): Promise<void> {
  for (const goalId of goalIds) {
    await upsertGoalProfileAllocation(db, goalId, profileId, {
      allocationPercent: null,
      monthlyContribution: 0,
    });
  }
}
