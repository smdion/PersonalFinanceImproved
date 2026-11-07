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
 * Live savings-capacity pool ((take-home - budgeted) across earners), via
 * the paycheck and budget summaries — not a re-derived shortcut. Shared by
 * recalculateAllocation and lockInAllocationPercent, the only two mutations
 * allowed to move a percentage-based goal's dollar/percent (see
 * recalculateAllocation's doc comment for why display/push never do this
 * live automatically).
 *
 * `profileId` lets a caller target a specific budget profile instead of
 * whichever one is currently active; omitting it preserves the
 * active-profile default. This is deliberately a *separate* computation
 * from computeSavingsSummary's totalMonthlyPool (which sums each goal's stored
 * monthlyContribution snapshot, not a live paycheck/budget derivation) —
 * they aren't two paths to the same number today. The budget-monthly-total
 * derivation itself goes through deriveBudgetMonthlyTotal — the single
 * computation path for that step, shared with savings/page.tsx's own two
 * capacity computations.
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
  // How much a goal is funded, and how (percent vs. flat dollar), is owned
  // entirely per budget profile — no shared default a profile falls back
  // to (e.g. "Car fund gets 12% under my current budget, $0 under a
  // relocation what-if" — both are just that profile's own row). Edited
  // from the budget page, scoped to whichever profile is being viewed
  // there — see getResolvedGoalAllocations for the single resolution path
  // this and every other reader/writer goes through.
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
    /** Per-profile summary (total funded monthly + how many goals have a
     *  nonzero allocation) for every budget profile at once — for the
     *  profile-picker sidebar. Routes through the same resolver as `list`
     *  above (one call per profile) rather than re-deriving totals
     *  independently. */
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
    /** Manual edit — sets (goalId, profileId)'s funding directly, independent
     *  of the live pool (contrast with recalculateAllocation/
     *  lockInAllocationPercent, which also write here but derive the value
     *  from the live pool instead of taking it directly from the caller). */
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
   * Recompute a percentage-based savings goal's monthly_contribution from
   * the CURRENT live pool ((allocationPercent/100) * maxMonthlyFunding) and
   * persist it as a savings_goal_profile_allocations override for the
   * target profile (profileId, or the active profile if omitted) — never
   * the raw savings_goals columns; see getResolvedGoalAllocations for why
   * those columns aren't read/written anywhere except goal creation. This
   * is the only path that lets a percentage-based goal's dollar amount
   * move — display and push both read the resolved override directly (see
   * pushContributionsToApi), so a salary/budget change never silently
   * changes what's shown or sent to the budget API until the user
   * explicitly asks for it here.
   * Omitting goalId recalculates every active percentage-based goal (for
   * the target profile) from one shared live-pool snapshot (a single fetch
   * applied to all rows, so a batch recalc can't see the pool shift
   * mid-batch the way N separate live reads could).
   */
  recalculateAllocation: savingsProcedure
    .input(
      z
        .object({
          goalId: z.number().int().optional(),
          profileId: z.number().int().optional(),
          // See computeLiveMaxMonthlyFunding's `income` param docblock — the
          // caller's already-resolved Contribution/Salary Profile
          // selection, so the live pool this mutation recomputes against
          // can't silently diverge from what its own preview showed.
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

      // Resolve against the target profile's own overrides — a goal that's
      // only percentage-based under this profile (not globally) must still
      // be picked up, and one that's been overridden to flat-dollar under
      // this profile must be excluded even if its global default is a %.
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
   * Inverse of recalculateAllocation: holds monthly_contribution (the
   * dollar amount) fixed and recomputes allocation_percent to match what
   * share of the CURRENT live pool that dollar amount represents. Use this
   * after a raise when you want to keep sending the same dollar amount to
   * a goal (not sweep the raise into it) while keeping the stored percent
   * an accurate description of "what % of current income this is" rather
   * than a stale figure computed against a smaller pool.
   * allocation_percent is decimal(6,3) — rounded to 3 decimals, which at
   * typical pool sizes is sub-dollar precision (accepted trade-off; see
   * recalculateAllocation for the shared live-pool computation this reuses).
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
