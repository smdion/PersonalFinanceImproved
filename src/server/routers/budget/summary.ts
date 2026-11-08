import { eq, asc } from "drizzle-orm";
import { protectedProcedure } from "../../trpc";
import * as schema from "@/lib/db/schema";
import { getResolvedGoalAllocations } from "@/server/services/savings/savings-allocation";
import { resolveLinkedBudgetItemAmounts } from "@/server/services/budget/linked-items";
import {
  resolveProfileSelection,
  summaryProfileIdsInput,
} from "@/server/services/profile-selection";
import { computePaycheckSummary } from "@/server/services/paycheck/summary";
import {
  computeBudgetActiveSummary,
  netMonthlyTakeHome,
  zBudgetActiveSummaryInput,
} from "@/server/services/budget/active-summary";

export const summaryProcedures = {
  /**
   * List all budget profiles with summary totals (for profile sidebar), plus
   * each profile's own "Unspent" figure — take-home pay under the active
   * Contribution/Salary Profiles, minus that profile's spending, minus its
   * savings allocations.
   *
   * Unspent is computed here rather than client-side because the panel that
   * shows it used to call `paycheck.computeSummary` with no input at all,
   * which server-side means *no* profile is applied — so the figure silently
   * ignored the active Contribution and Salary Profiles. This procedure
   * already loops every profile and already resolves each profile's own
   * savings allocations and per-mode weighting, so resolving the pay side
   * here too keeps it to one round trip and one computation path. The
   * active ids are read from app_settings here.
   */
  listProfiles: protectedProcedure.query(async ({ ctx }) => {
    const profiles = await ctx.db
      .select({
        id: schema.budgetProfiles.id,
        name: schema.budgetProfiles.name,
        isActive: schema.budgetProfiles.isActive,
        columnLabels: schema.budgetProfiles.columnLabels,
        columnMonths: schema.budgetProfiles.columnMonths,
      })
      .from(schema.budgetProfiles)
      .orderBy(asc(schema.budgetProfiles.id));

    // Intentional batch load: fetch all items once and distribute across profiles
    // in memory. This is O(1) queries regardless of profile count, not N+1.
    const [allItems, activeGoals, activeProfiles] = await Promise.all([
      ctx.db.select().from(schema.budgetItems),
      ctx.db
        .select()
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.isActive, true)),
      resolveProfileSelection(ctx.scope),
    ]);
    // Savings funding is per-(goal, profile) — resolve once per profile and
    // fold the monthly total into annualTotal so it isn't silently excluded
    // (Budget spends what Contributions sets, Savings allocates what's
    // left — annualTotal should reflect all three stages, not just budget
    // items).
    const monthlySavingsByProfile = new Map<number, number>();
    if (activeGoals.length > 0) {
      await Promise.all(
        profiles.map(async (p) => {
          const resolved = await getResolvedGoalAllocations(
            ctx.db,
            activeGoals,
            p.id,
          );
          let total = 0;
          for (const r of resolved.values()) total += r.monthlyContribution;
          monthlySavingsByProfile.set(p.id, total);
        }),
      );
    }

    // ── Take-home pay ──
    // The active Contribution/Salary pair — the same for every budget
    // profile, since a budget column is a spending level, not a different
    // pay world. One computePaycheckSummary call (the summary the
    // Paycheck page shows), not a parallel re-derivation.
    const paycheckData = await computePaycheckSummary(
      ctx,
      summaryProfileIdsInput(activeProfiles),
    );
    const netMonthly = netMonthlyTakeHome(paycheckData);

    const rows: Array<
      (typeof profiles)[number] & {
        annualTotal: number;
        columnCount: number;
        monthlyTotal: number;
        weightedMonthlySpending: number;
        monthlySavings: number;
        netMonthly: number | null;
        unspentMonthly: number | null;
      }
    > = [];

    for (const p of profiles) {
      const items = allItems.filter((i) => i.profileId === p.id);
      const labels = p.columnLabels;
      const months = (p.columnMonths as number[] | null) ?? null;
      const numColumns = labels.length;
      // Resolved through the same chain computeActiveSummary uses (see
      // resolveLinkedBudgetItemAmounts) — raw `amounts` silently dropped
      // every contribution-linked item from this sidebar's totals.
      const resolvedItems = await resolveLinkedBudgetItemAmounts(
        ctx,
        items,
        numColumns,
        activeProfiles,
      );
      const colTotals = labels.map((_: string, ci: number) =>
        resolvedItems.reduce((sum, item) => sum + (item.amounts[ci] ?? 0), 0),
      );
      const monthlySavings = monthlySavingsByProfile.get(p.id) ?? 0;
      // Annual: weighted if months set, otherwise column 0 * 12, plus
      // savings (savings funding doesn't vary by mode — see
      // savings_goal_profile_allocations' table comment).
      const budgetAnnual = months
        ? colTotals.reduce((sum, t, i) => sum + t * (months[i] ?? 0), 0)
        : (colTotals[0] ?? 0) * 12;
      const annualTotal = budgetAnnual + monthlySavings * 12;
      const isWeighted = months !== null && months.length > 0;
      const spending = isWeighted ? budgetAnnual / 12 : (colTotals[0] ?? 0);

      rows.push({
        ...p,
        annualTotal,
        columnCount: labels.length,
        // Column 0's raw monthly spending — meaningful on its own only for
        // non-weighted profiles (a single mode IS the year). For weighted
        // profiles, use weightedMonthlySpending instead.
        monthlyTotal: colTotals[0] ?? 0,
        // Weighted spending, blended to a "typical month" (budgetAnnual/12)
        // — what a weighted profile's own monthlyTotal should have meant.
        weightedMonthlySpending: budgetAnnual / 12,
        monthlySavings,
        /** Take-home pay under the active profiles. Null when nobody has
         *  an active job/paycheck to compute from. */
        netMonthly,
        /** netMonthly − this profile's spending − its savings allocations.
         *  Null whenever netMonthly is. */
        unspentMonthly:
          netMonthly === null ? null : netMonthly - spending - monthlySavings,
      });
    }

    return rows;
  }),

  /** Returns the active budget profile's calculator result for a given column. */
  computeActiveSummary: protectedProcedure
    .input(zBudgetActiveSummaryInput)
    .query(({ ctx, input }) => computeBudgetActiveSummary(ctx, input)),
};
