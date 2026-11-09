/**
 * The only resolver of a savings goal's allocationPercent/monthlyContribution per budget
 * profile: one savings_goal_profile_allocations row per active (goal, profile), no shared
 * default; a missing row resolves to $0/no-percent. Writes go via upsertGoalProfileAllocation.
 */
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { toNumber, toNumberOrNull } from "@/lib/utils/numbers";
import type { DbOrTx } from "@/lib/db";

interface ResolvedGoalAllocation {
  goalId: number;
  allocationPercent: number | null;
  monthlyContribution: number;
}

interface GoalAllocationFields {
  id: number;
}

/** Batched — one query for all rows in the profile, not N+1 per goal. */
export async function getResolvedGoalAllocations(
  db: DbOrTx,
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
      allocationPercent: toNumberOrNull(row?.allocationPercent),
      monthlyContribution: row ? toNumber(row.monthlyContribution) : 0,
    });
  }
  return result;
}

/** Upsert a single (goal, profile) row. Replaces both fields as a unit. */
export async function upsertGoalProfileAllocation(
  db: DbOrTx,
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

/** Set every active goal's funding to $0/no-percent for one profile, one
 *  statement per goal (caller passes a tx), since every pair keeps a row. */
export async function resetProfileAllocationsToZero(
  db: DbOrTx,
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
