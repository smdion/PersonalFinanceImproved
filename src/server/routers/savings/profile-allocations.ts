import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  savingsProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  computeMaxMonthlyFunding,
  deriveBudgetMonthlyTotal,
  resolveEffectiveMonthlyContribution,
  type CapacityPerson,
} from "@/lib/pure/savings/savings-capacity";
import { computePaycheckSummary } from "@/server/services/paycheck/summary";
import { computeBudgetActiveSummary } from "@/server/services/budget/active-summary";
import {
  getResolvedGoalAllocations,
  upsertGoalProfileAllocation,
  resetProfileAllocationsToZero,
} from "@/server/services/savings/savings-allocation";
import { resolveTargetBudgetProfile } from "@/server/data/budget-profiles";
import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import {
  payProfileSelectionSchema,
  type PayProfileSelection,
} from "@/lib/pure/household/profile-selection.schema";

/**
 * Live savings-capacity pool ((take-home - budgeted) across earners) from the paycheck and
 * budget summaries, for the only two mutations that move a percentage goal's amounts.
 * `profileId` targets a budget profile (default: active). Not computeSavingsSummary's pool.
 */
async function computeLiveMaxMonthlyFunding(
  ctx: { db: Db; scope: RequestScope },
  profileId?: number,
  /** The page's Contribution/Salary Profile ids for the paycheck side, and
   *  its budget summary's selection for the budget side, so the pool
   *  matches its preview. */
  income?: {
    contributionProfileId?: number;
    salaryProfileId?: number;
    selection?: PayProfileSelection;
  },
): Promise<number | null> {
  const paycheckInput = {
    ...(income?.contributionProfileId != null
      ? { contributionProfileId: income.contributionProfileId }
      : {}),
    ...(income?.salaryProfileId != null
      ? { salaryProfileId: income.salaryProfileId }
      : {}),
  };
  const [paycheckData, budgetSummary] = await Promise.all([
    computePaycheckSummary(
      ctx,
      Object.keys(paycheckInput).length > 0 ? paycheckInput : undefined,
    ),
    computeBudgetActiveSummary(ctx, {
      ...(profileId ? { profileId } : {}),
      ...(income?.selection ? { selection: income.selection } : {}),
    }),
  ]);
  const budgetMonthlyTotal = deriveBudgetMonthlyTotal(budgetSummary);
  return budgetMonthlyTotal !== null
    ? computeMaxMonthlyFunding(
        paycheckData.people as CapacityPerson[],
        budgetMonthlyTotal,
      )
    : null;
}

export const profileAllocationProcedures = {
  // ══ PER-PROFILE SAVINGS FUNDING ══
  // A goal's funding (percent vs. flat dollar) is owned per budget profile, with no shared
  // default; every reader/writer resolves through getResolvedGoalAllocations.
  goalProfileAllocations: createTRPCRouter({
    /** Every active goal's funding for a given profile. */
    list: protectedProcedure
      .input(z.object({ profileId: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const goals = await ctx.db
          .select()
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true))
          .orderBy(asc(schema.savingsGoals.priority));
        const resolved = await getResolvedGoalAllocations(
          ctx.db,
          goals,
          input.profileId,
        );
        return goals.map((g) => {
          const r = resolved.get(g.id)!;
          return {
            goalId: g.id,
            name: g.name,
            isEmergencyFund: g.isEmergencyFund,
            allocationPercent: r.allocationPercent,
            monthlyContribution: r.monthlyContribution,
          };
        });
      }),
    /** Per-profile summary (monthly total + count of funded goals) for every budget
     *  profile, for the profile picker; uses the same resolver as `list`. */
    listSummaries: protectedProcedure.query(async ({ ctx }) => {
      const [goals, profiles] = await Promise.all([
        ctx.db
          .select()
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true)),
        ctx.db
          .select({ id: schema.budgetProfiles.id })
          .from(schema.budgetProfiles),
      ]);
      return Promise.all(
        profiles.map(async (p) => {
          const resolved = await getResolvedGoalAllocations(
            ctx.db,
            goals,
            p.id,
          );
          let totalMonthlyAllocation = 0;
          let fundedGoalCount = 0;
          for (const r of resolved.values()) {
            totalMonthlyAllocation += r.monthlyContribution;
            if (r.monthlyContribution > 0 || (r.allocationPercent ?? 0) > 0)
              fundedGoalCount++;
          }
          return { profileId: p.id, totalMonthlyAllocation, fundedGoalCount };
        }),
      );
    }),
    /** Manual edit: sets (goalId, profileId)'s funding as given, unlike
     *  recalculateAllocation/lockInAllocationPercent, which derive it from the live pool. */
    upsert: savingsProcedure
      .input(
        z.object({
          goalId: z.number().int(),
          profileId: z.number().int(),
          allocationPercent: z.number().min(0).max(100).nullable(),
          monthlyContribution: z.number().min(0),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await upsertGoalProfileAllocation(
          ctx.db,
          input.goalId,
          input.profileId,
          {
            allocationPercent: input.allocationPercent,
            monthlyContribution: input.monthlyContribution,
          },
        );
        return { ok: true };
      }),
    /** Set every active goal's funding to $0/no-percent for one profile. */
    resetAllToZero: savingsProcedure
      .input(z.object({ profileId: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const goals = await ctx.db
          .select({ id: schema.savingsGoals.id })
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true));
        // All goals or none.
        await ctx.db.transaction((tx) =>
          resetProfileAllocationsToZero(
            tx,
            goals.map((g) => g.id),
            input.profileId,
          ),
        );
        return { ok: true };
      }),
  }),

  /**
   * The only path that moves a percentage goal's dollars: recomputes monthly_contribution
   * from the live pool and stores it as the target profile's allocation (default: active).
   * Omitting goalId recalculates every percentage goal from one pool snapshot.
   */
  recalculateAllocation: savingsProcedure
    .input(
      z
        .object({
          goalId: z.number().int().optional(),
          profileId: z.number().int().optional(),
          // The caller's resolved pay-profile selection, so the pool matches its preview.
          contributionProfileId: z.number().int().optional(),
          salaryProfileId: z.number().int().optional(),
          selection: payProfileSelectionSchema.optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const [goals, targetProfile] = await Promise.all([
        ctx.db.select().from(schema.savingsGoals),
        resolveTargetBudgetProfile(ctx.db, input?.profileId),
      ]);
      const targetProfileId = targetProfile?.id;
      if (targetProfileId === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active budget profile to recalculate against",
        });
      }

      // Resolve against the target profile's own allocations: percentage vs flat-dollar
      // is decided per profile.
      const resolvedByGoal = await getResolvedGoalAllocations(
        ctx.db,
        goals,
        targetProfileId,
      );
      const targets = goals.filter(
        (g) =>
          g.isActive &&
          resolvedByGoal.get(g.id)?.allocationPercent != null &&
          (input?.goalId === undefined || g.id === input.goalId),
      );
      if (targets.length === 0) return { updated: 0 };

      const maxMonthlyFunding = await computeLiveMaxMonthlyFunding(
        ctx,
        targetProfileId,
        {
          contributionProfileId: input?.contributionProfileId,
          salaryProfileId: input?.salaryProfileId,
          selection: input?.selection,
        },
      );
      if (maxMonthlyFunding === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No live paycheck/budget data available to recalculate from",
        });
      }
      if (maxMonthlyFunding <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Current income pool is zero or negative — can't recalculate allocations",
        });
      }

      await ctx.db.transaction(async (tx) => {
        for (const g of targets) {
          const resolved = resolvedByGoal.get(g.id)!;
          const newAmount = resolveEffectiveMonthlyContribution(
            resolved.allocationPercent,
            maxMonthlyFunding,
            resolved.monthlyContribution,
          );
          await upsertGoalProfileAllocation(tx, g.id, targetProfileId, {
            allocationPercent: resolved.allocationPercent,
            monthlyContribution: newAmount,
          });
        }
      });

      return { updated: targets.length };
    }),

  /**
   * Inverse of recalculateAllocation: keeps the dollar amount and recomputes
   * allocation_percent as its share of the live pool (decimal(6,3), rounded to 3 places).
   */
  lockInAllocationPercent: savingsProcedure
    .input(
      z
        .object({
          goalId: z.number().int().optional(),
          profileId: z.number().int().optional(),
          // See computeLiveMaxMonthlyFunding's `income` param docblock.
          contributionProfileId: z.number().int().optional(),
          salaryProfileId: z.number().int().optional(),
          selection: payProfileSelectionSchema.optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const [goals, targetProfile] = await Promise.all([
        ctx.db.select().from(schema.savingsGoals),
        resolveTargetBudgetProfile(ctx.db, input?.profileId),
      ]);
      const targetProfileId = targetProfile?.id;
      if (targetProfileId === undefined) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active budget profile to recalculate against",
        });
      }

      const resolvedByGoal = await getResolvedGoalAllocations(
        ctx.db,
        goals,
        targetProfileId,
      );
      const targets = goals.filter(
        (g) =>
          g.isActive &&
          resolvedByGoal.get(g.id)?.allocationPercent != null &&
          (input?.goalId === undefined || g.id === input.goalId),
      );
      if (targets.length === 0) return { updated: 0 };

      const maxMonthlyFunding = await computeLiveMaxMonthlyFunding(
        ctx,
        targetProfileId,
        {
          contributionProfileId: input?.contributionProfileId,
          salaryProfileId: input?.salaryProfileId,
          selection: input?.selection,
        },
      );
      if (maxMonthlyFunding === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No live paycheck/budget data available to recalculate from",
        });
      }
      if (maxMonthlyFunding <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Current income pool is zero or negative — can't compute a percent",
        });
      }

      // A fund taking more than the whole pool has no percent to lock in
      // (and would overflow the column).
      const over = targets.find(
        (g) =>
          resolvedByGoal.get(g.id)!.monthlyContribution > maxMonthlyFunding,
      );
      if (over)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${over.name} gets more than the whole income pool — lower it first`,
        });

      await ctx.db.transaction(async (tx) => {
        for (const g of targets) {
          const resolved = resolvedByGoal.get(g.id)!;
          const newPercent =
            Math.round(
              (resolved.monthlyContribution / maxMonthlyFunding) * 100_000,
            ) / 1000;
          await upsertGoalProfileAllocation(tx, g.id, targetProfileId, {
            allocationPercent: newPercent,
            monthlyContribution: resolved.monthlyContribution,
          });
        }
      });

      return { updated: targets.length };
    }),
};
