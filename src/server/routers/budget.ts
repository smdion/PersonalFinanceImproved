/** Budget router for multi-profile budget management including category items, column tiers, contribution profile linking, and budget API integration. */
import { eq, asc, inArray } from "drizzle-orm";
import { log } from "@/lib/logger";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  budgetProcedure,
  createCallerFactory,
} from "../trpc";
import { paycheckRouter } from "./paycheck";
import {
  zSandboxSalaryEntries,
  zItemAmountActiveFields,
  toItemAmountActiveMap,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
  toSalaryActiveMap,
} from "./_shared";
import { applySandboxSalaryEntries } from "@/server/helpers/salary";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import * as schema from "@/lib/db/schema";
import {
  canDeleteBudgetProfile,
  canRemoveColumn,
  filterActiveJobs,
} from "@/lib/pure/profiles";
import {
  columnLabelsSchema,
  columnMonthsSchema,
  columnContributionProfileIdsSchema,
  columnSalaryProfileIdsSchema,
  budgetAmountsSchema,
} from "@/lib/db/json-schemas";
import { calculateBudget } from "@/lib/calculators/budget";
import {
  resolveContributionProfileId,
  resolveContributionProfileIdsForAllColumns,
  resolveSalaryProfileIdsForAllColumns,
} from "@/lib/calculators/contribution-profile-resolution";
import type { BudgetInput } from "@/lib/calculators/types";
import {
  computeBudgetAnnualTotal,
  getEffectiveIncome,
  resolveCompensation,
  applyActiveSalary,
  applyActiveBonusTerms,
  computeAnnualContribution,
  loadAndApplyContribProfile,
  loadEffectiveSalaryProfile,
  resolveJoblessPeriodsPerYear,
  resolveContribPeriods,
  applyContributionAccountEdit,
  resolveTargetBudgetProfile,
  getResolvedGoalAllocations,
  applyContribActiveFields,
  resolveLinkedBudgetItemAmounts,
} from "@/server/helpers";
import { accountDisplayName } from "@/lib/utils/format";
import {
  getActiveBudgetApi,
  getClientForService,
  cacheGet,
  refreshCategoryCache,
} from "@/lib/budget-api";
import type { BudgetCategoryGroup, BudgetMonthDetail } from "@/lib/budget-api";
import { YNAB_INTERNAL_GROUPS } from "@/lib/budget-api";

type BudgetItemRow = typeof schema.budgetItems.$inferSelect;

/**
 * Group a profile's budget items (already sort_order-ordered) into ordered
 * category blocks, preserving both the categories' relative order and each
 * category's internal item order. Mirrors the client-side grouping in
 * useBudgetDerivedData's categoryMap (use-budget-derived-data.ts) — same
 * logic, server-side, used by the reorder mutations below.
 */
function groupItemsByCategory(
  items: BudgetItemRow[],
): { category: string; items: BudgetItemRow[] }[] {
  const map = new Map<string, BudgetItemRow[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries()).map(([category, categoryItems]) => ({
    category,
    items: categoryItems,
  }));
}

/**
 * Flatten ordered category blocks back into a single item list and write a
 * clean, gapless 0..N-1 sort_order sequence. Used after every reorder so
 * any pre-existing sort_order gaps/duplicates get cleaned up as a side
 * effect (self-healing) instead of accumulating drift over time.
 */
async function renumberItems(
  db: typeof import("@/lib/db").db,
  blocks: { category: string; items: BudgetItemRow[] }[],
): Promise<void> {
  let sortOrder = 0;
  for (const block of blocks) {
    for (const item of block.items) {
      await db
        .update(schema.budgetItems)
        .set({ sortOrder })
        .where(eq(schema.budgetItems.id, item.id));
      sortOrder++;
    }
  }
}

/**
 * The non-column tiers of docs/RULES.md's profile precedence, as supplied by
 * the caller. The per-column tier comes from the budget profile row itself
 * and is never sent over the wire. All three fields are required (nullable)
 * so a caller can't silently omit one and get the old, wrong fallback.
 */
const profileResolutionTiersSchema = z.object({
  /** The active Plan's pin for this axis, already validated client-side. */
  planPinId: z.number().int().nullable(),
  /** The calling page's own local selection / preview pick, if it has one. */
  localSelectionId: z.number().int().nullable(),
  /** The globally-active profile id for this axis. */
  globalDefaultId: z.number().int().nullable(),
});

type ProfileResolutionTiers = z.infer<typeof profileResolutionTiersSchema>;

/**
 * Resolve which Contribution Profile a budget-linked item edit should write
 * into, for one specific item's column — same precedence
 * (resolveContributionProfileId) the rest of the page already resolves with,
 * so a linked item's edit lands in the exact profile the user is looking at.
 * Throws rather than silently writing nowhere: contributionValue/Method have
 * no account-level fallback anymore (see applyContribActiveFields), so an
 * edit with no resolvable profile has nowhere correct to go.
 */
async function resolveEffectiveContribProfileIdForItem(
  db: typeof import("@/lib/db").db,
  item: { profileId: number },
  colIndex: number,
  tiers: ProfileResolutionTiers,
): Promise<number> {
  const [budgetProfile] = await db
    .select({
      columnLabels: schema.budgetProfiles.columnLabels,
      columnContributionProfileIds:
        schema.budgetProfiles.columnContributionProfileIds,
    })
    .from(schema.budgetProfiles)
    .where(eq(schema.budgetProfiles.id, item.profileId));
  const resolvedId = resolveContributionProfileId({
    ...tiers,
    columnPinIds: budgetProfile?.columnContributionProfileIds as
      (number | null)[] | null,
    numColumns: budgetProfile?.columnLabels.length ?? 0,
    column: colIndex,
  });
  if (resolvedId == null) {
    throw new Error(
      "No Contribution Profile is resolvable for this edit — activate a Contribution Profile before editing a linked amount",
    );
  }
  return resolvedId;
}

const NO_PROFILE_TIERS: ProfileResolutionTiers = {
  planPinId: null,
  localSelectionId: null,
  globalDefaultId: null,
};

export const budgetRouter = createTRPCRouter({
  /**
   * List all budget profiles with summary totals (for profile sidebar), plus
   * each profile's own "Unspent" figure — take-home pay under THAT profile's
   * own per-column Contribution/Salary Profile resolution, minus that
   * profile's spending, minus its savings allocations.
   *
   * Unspent is computed here rather than client-side because the panel that
   * shows it used to call `paycheck.computeSummary` with no input at all,
   * which server-side means *no* profile is applied — so the figure silently
   * ignored the active Contribution Profile, the active Salary Profile, any
   * Plan pin, and any Plan-level salary override. This procedure already
   * loops every profile and already resolves each profile's own savings
   * allocations and per-mode weighting, so resolving the pay side here too
   * keeps it to one round trip and one computation path.
   *
   * Plan pins are session/browser state, so the caller supplies them; the
   * globally-active ids are read from app_settings here.
   */
  listProfiles: protectedProcedure
    .input(
      z
        .object({
          /** The active Plan's pins, if a Plan is selected in the browser. */
          planContribProfileId: z.number().int().nullable().optional(),
          planSalaryProfileId: z.number().int().nullable().optional(),
          salaryActiveFields: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select({
          id: schema.budgetProfiles.id,
          name: schema.budgetProfiles.name,
          isActive: schema.budgetProfiles.isActive,
          columnLabels: schema.budgetProfiles.columnLabels,
          columnMonths: schema.budgetProfiles.columnMonths,
          columnContributionProfileIds:
            schema.budgetProfiles.columnContributionProfileIds,
          columnSalaryProfileIds: schema.budgetProfiles.columnSalaryProfileIds,
        })
        .from(schema.budgetProfiles)
        .orderBy(asc(schema.budgetProfiles.id));

      // Intentional batch load: fetch all items once and distribute across profiles
      // in memory. This is O(1) queries regardless of profile count, not N+1.
      const [allItems, activeGoals, settingRows] = await Promise.all([
        ctx.db.select().from(schema.budgetItems),
        ctx.db
          .select()
          .from(schema.savingsGoals)
          .where(eq(schema.savingsGoals.isActive, true)),
        ctx.db
          .select()
          .from(schema.appSettings)
          .where(
            inArray(schema.appSettings.key, [
              SK_ACTIVE_CONTRIB_PROFILE_ID,
              SK_ACTIVE_SALARY_PROFILE_ID,
            ]),
          ),
      ]);
      const settingValue = (key: string): number | null => {
        const raw = settingRows.find((r) => r.key === key)?.value ?? null;
        const num = Number(raw);
        return raw == null || Number.isNaN(num) ? null : num;
      };
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

      // ── Per-profile take-home pay ──
      // Each profile's columns resolve their own Contribution/Salary Profile
      // through the SAME resolver computeActiveSummary and the client's
      // per-column payroll breakdown use, so this figure can't disagree with
      // what the Budget tab shows for the same profile.
      const contribTiers: ProfileResolutionTiers = {
        planPinId: input?.planContribProfileId ?? null,
        localSelectionId: null,
        globalDefaultId: settingValue(SK_ACTIVE_CONTRIB_PROFILE_ID),
      };
      const salaryTiers: ProfileResolutionTiers = {
        planPinId: input?.planSalaryProfileId ?? null,
        localSelectionId: null,
        globalDefaultId: settingValue(SK_ACTIVE_SALARY_PROFILE_ID),
      };

      // One paycheck computation per DISTINCT (Contribution, Salary) pin pair
      // across every profile's every column — not one per column. Goes
      // through paycheck.computeSummary itself (same procedure the Paycheck
      // page calls) rather than a parallel re-derivation.
      const paycheckCaller = createCallerFactory(paycheckRouter)(ctx);
      const netMonthlyByPair = new Map<string, number | null>();
      const netMonthlyForPair = async (
        contribProfileId: number | null,
        salaryProfileId: number | null,
      ): Promise<number | null> => {
        const key = `${contribProfileId}:${salaryProfileId}`;
        const cached = netMonthlyByPair.get(key);
        if (cached !== undefined) return cached;
        const paycheckData = await paycheckCaller.computeSummary({
          ...(input?.salaryActiveFields && input.salaryActiveFields.length > 0
            ? { salaryActiveFields: input.salaryActiveFields }
            : {}),
          ...(contribProfileId != null
            ? { contributionProfileId: contribProfileId }
            : {}),
          ...(salaryProfileId != null ? { salaryProfileId } : {}),
        });
        // netPay is gross − pre-tax − withholding − FICA − post-tax, so
        // "sum netPay × budget periods per month" is the same monthly
        // take-home the client's buildPayrollBreakdown derives line by line.
        let net: number | null = null;
        for (const d of paycheckData.people) {
          const pc = d.paycheck;
          if (!pc || !d.job) continue;
          const perMonth =
            ("budgetPerMonth" in d ? d.budgetPerMonth : null) ??
            pc.periodsPerYear / 12;
          net = (net ?? 0) + pc.netPay * perMonth;
        }
        netMonthlyByPair.set(key, net);
        return net;
      };

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
        const labels = (p.columnLabels as string[]) ?? [];
        const months = (p.columnMonths as number[] | null) ?? null;
        const numColumns = labels.length;
        const contribIds = resolveContributionProfileIdsForAllColumns({
          ...contribTiers,
          columnPinIds: p.columnContributionProfileIds as
            (number | null)[] | null,
          numColumns,
        });
        const salaryIds = resolveSalaryProfileIdsForAllColumns({
          ...salaryTiers,
          columnPinIds: p.columnSalaryProfileIds as (number | null)[] | null,
          numColumns,
        });
        // Resolved through the same chain computeActiveSummary uses (see
        // resolveLinkedBudgetItemAmounts) — raw `amounts` silently dropped
        // every contribution-linked item from this sidebar's totals.
        const resolvedItems = await resolveLinkedBudgetItemAmounts(
          ctx.db,
          items,
          numColumns,
          contribIds,
          salaryIds,
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

        // A weighted profile has no single "the" contribution profile — its
        // take-home is blended across modes exactly the way its spending is,
        // using each mode's own months/year.
        let netMonthly: number | null = null;
        if (numColumns > 0) {
          const perColumnNet = await Promise.all(
            Array.from({ length: numColumns }, (_, col) =>
              netMonthlyForPair(
                contribIds[col] ?? null,
                salaryIds[col] ?? null,
              ),
            ),
          );
          if (perColumnNet.some((n) => n !== null)) {
            netMonthly = isWeighted
              ? perColumnNet.reduce<number>(
                  (sum, n, i) => sum + (n ?? 0) * (months![i] ?? 0),
                  0,
                ) / 12
              : (perColumnNet[0] ?? null);
          }
        }

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
          /** Take-home pay under this profile's own resolved pins, blended
           *  the same way its spending is. Null when nobody has an active
           *  job/paycheck to compute from. */
          netMonthly,
          /** netMonthly − this profile's spending − its savings allocations.
           *  Null whenever netMonthly is. */
          unspentMonthly:
            netMonthly === null ? null : netMonthly - spending - monthlySavings,
        });
      }

      return rows;
    }),

  /** Create a new budget profile, pre-populated with standard template
   *  categories. Optionally links every starting column to a Contribution
   *  Profile so the new profile's income/take-home math uses that
   *  Contribution Profile from the start, instead of defaulting to Live and
   *  requiring a separate trip to "Manage Modes" to link it. */
  createProfile: budgetProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        columnLabels: columnLabelsSchema.default(["Standard"]),
        contributionProfileId: z.number().int().nullable().optional(),
        salaryProfileId: z.number().int().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .insert(schema.budgetProfiles)
        .values({
          name: input.name,
          columnLabels: input.columnLabels,
          isActive: false,
          columnContributionProfileIds: input.contributionProfileId
            ? new Array(input.columnLabels.length).fill(
                input.contributionProfileId,
              )
            : null,
          columnSalaryProfileIds: input.salaryProfileId
            ? new Array(input.columnLabels.length).fill(input.salaryProfileId)
            : null,
        })
        .returning();
      const profile = rows[0]!;

      // Pre-populate with template categories (all amounts zeroed)
      const { BUDGET_TEMPLATE } = await import("@/lib/config/budget-template");
      const numCols = input.columnLabels.length;
      const zeroAmounts = new Array(numCols).fill(0) as number[];
      await ctx.db.insert(schema.budgetItems).values(
        BUDGET_TEMPLATE.map((t, i) => ({
          profileId: profile.id,
          category: t.category,
          subcategory: t.subcategory,
          amounts: zeroAmounts,
          isEssential: t.isEssential,
          sortOrder: i,
        })),
      );

      // Savings funding is per-profile with no shared default — every
      // existing active goal needs an explicit $0/no-percent row under this
      // new profile (see savings_goal_profile_allocations' table comment).
      const goals = await ctx.db
        .select({ id: schema.savingsGoals.id })
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.isActive, true));
      if (goals.length > 0) {
        await ctx.db.insert(schema.savingsGoalProfileAllocations).values(
          goals.map((g) => ({
            goalId: g.id,
            budgetProfileId: profile.id,
            allocationPercent: null,
            monthlyContribution: "0",
          })),
        );
      }

      return profile;
    }),

  /**
   * Clone a budget profile — its columns, its items, and its savings
   * allocations — under a new name. Field-by-field on purpose, not a blanket
   * row copy:
   *
   * - Copied: column labels/months, both sets of per-column profile pins
   *   (a duplicate should start life resolving exactly like its source), and
   *   each item's amounts/category/subcategory/essential flag/sort order.
   * - NOT copied: every API-linking field (`apiCategoryId`,
   *   `apiCategoryName`, `apiSyncDirection`, `apiLastSyncedAt`) and
   *   `contributionAccountId`. Two profiles both linked to push at the same
   *   external YNAB category (or write through to the same contribution
   *   account) is a live external-write hazard, and a copy is exactly how
   *   you'd create one by accident.
   * - Forced: `isActive: false`. Duplicating is not activating.
   *
   * Same `budget` permission gate as createProfile.
   */
  duplicateProfile: budgetProcedure
    .input(
      z.object({
        sourceProfileId: z.number().int(),
        name: z.string().trim().min(1),
        /** The What-If tab's hand-edited item amounts, keyed by the SOURCE
         *  profile's item ids — baked into the copy in the SAME transaction
         *  as the rest of the clone, so a mid-copy failure can't leave a
         *  half-edited profile behind (a copy-then-separate-batch-update
         *  would have exactly that window). */
        itemAmountActiveFields: zItemAmountActiveFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const itemActiveMap = toItemAmountActiveMap(input.itemAmountActiveFields);
      return ctx.db.transaction(async (tx) => {
        const source = await tx
          .select()
          .from(schema.budgetProfiles)
          .where(eq(schema.budgetProfiles.id, input.sourceProfileId))
          .then((r) => r[0]);
        if (!source) throw new Error("Source profile not found");

        const created = await tx
          .insert(schema.budgetProfiles)
          .values({
            name: input.name,
            description: source.description,
            columnLabels: source.columnLabels,
            columnMonths: source.columnMonths,
            columnContributionProfileIds: source.columnContributionProfileIds,
            columnSalaryProfileIds: source.columnSalaryProfileIds,
            isActive: false,
          })
          .returning()
          .then((r) => r[0]!);

        const items = await tx
          .select()
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, input.sourceProfileId))
          .orderBy(asc(schema.budgetItems.sortOrder));
        if (items.length > 0) {
          await tx.insert(schema.budgetItems).values(
            items.map((i) => {
              const rawAmounts = i.amounts as number[];
              const amounts =
                itemActiveMap.size === 0
                  ? rawAmounts
                  : rawAmounts.map(
                      (amt, col) => itemActiveMap.get(`${i.id}:${col}`) ?? amt,
                    );
              return {
                profileId: created.id,
                category: i.category,
                subcategory: i.subcategory,
                amounts,
                isEssential: i.isEssential,
                sortOrder: i.sortOrder,
                // API links and contribution links deliberately left unset.
              };
            }),
          );
        }

        // Savings funding is per-(goal, profile) with no shared default, so
        // the clone needs its own explicit row for every goal the source
        // funds.
        const allocations = await tx
          .select()
          .from(schema.savingsGoalProfileAllocations)
          .where(
            eq(
              schema.savingsGoalProfileAllocations.budgetProfileId,
              input.sourceProfileId,
            ),
          );
        if (allocations.length > 0) {
          await tx.insert(schema.savingsGoalProfileAllocations).values(
            allocations.map((a) => ({
              goalId: a.goalId,
              budgetProfileId: created.id,
              allocationPercent: a.allocationPercent,
              monthlyContribution: a.monthlyContribution,
            })),
          );
        }

        return created;
      });
    }),

  /** Rename a budget profile. */
  renameProfile: budgetProcedure
    .input(z.object({ id: z.number().int(), name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetProfiles)
        .set({ name: input.name })
        .where(eq(schema.budgetProfiles.id, input.id));
      return { ok: true };
    }),

  /** Delete a budget profile (cannot delete the active one). */
  deleteProfile: budgetProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.id, input.id));
      const profile = profiles[0];
      if (!profile) throw new Error("Profile not found");
      const deleteCheck = canDeleteBudgetProfile(profile);
      if (!deleteCheck.allowed) throw new Error(deleteCheck.reason);

      // Delete associated items first
      await ctx.db
        .delete(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, input.id));
      await ctx.db
        .delete(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.id, input.id));
      return { ok: true };
    }),

  /** Set a profile as the active one (deactivate all others). Transactional
   *  — an error between the deactivate-all and activate-one writes must
   *  not be able to leave zero active profiles (every downstream reader
   *  of getActiveBudgetProfile silently treats that as "no profile"). */
  setActiveProfile: budgetProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await tx.update(schema.budgetProfiles).set({ isActive: false });
        await tx
          .update(schema.budgetProfiles)
          .set({ isActive: true })
          .where(eq(schema.budgetProfiles.id, input.id));
      });
      return { ok: true };
    }),

  /** Returns the active budget profile's calculator result for a given column. */
  computeActiveSummary: protectedProcedure
    .input(
      z
        .object({
          selectedColumn: z.number().optional(),
          profileId: z.number().optional(),
          /**
           * The caller's non-column resolution tiers for each profile axis.
           * Named per-tier (rather than one pre-resolved "active" id) because
           * a pre-resolved id silently collapses the Plan pin into the lowest
           * tier, which is how a budget column's own pin ended up beating an
           * active Plan's pin — see contribution-profile-resolution.ts.
           */
          contributionProfile: profileResolutionTiersSchema.optional(),
          salaryProfile: profileResolutionTiersSchema.optional(),
          salaryActiveFields: z
            .array(z.object({ personId: z.number(), salary: z.number() }))
            .optional(),
          /** The What-If tab's hand-edited salary/bonus entries — see
           *  paycheckRouter.computeSummary's identical field. Threaded into
           *  every paycheck.computeSummary call this procedure makes
           *  (contribution-linked amounts AND netMonthlyIncome below), so
           *  they can't disagree about which income reality is in effect. */
          sandboxSalaryEntries: zSandboxSalaryEntries,
          /** The What-If tab's hand-edited budget item amounts — one more
           *  layer on top of the existing per-item resolution chain (see
           *  toItemAmountActiveMap's docblock). */
          itemAmountActiveFields: zItemAmountActiveFields,
          /** See paycheckRouter.computeSummary's identical fields — threaded
           *  into netMonthlyIncome's paycheck.computeSummary call below so a
           *  deduction edit/addition actually moves the income figure the
           *  budget step is checked against. */
          sandboxDeductionEdits: zSandboxDeductionEdits,
          sandboxDeductionAdditions: zSandboxDeductionAdditions,
          /** See paycheckRouter.computeSummary's identical field — applied
           *  both to linked-item resolution (below) and netMonthlyIncome's
           *  paycheck.computeSummary call, so a contribution edit moves
           *  both consistently. */
          sandboxContribActiveFields: zSandboxContribActiveFields,
          /** See paycheckRouter.computeSummary's identical field. */
          sandboxContribAdditions: zSandboxContribAdditions,
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const activeProfile = await resolveTargetBudgetProfile(
        ctx.db,
        input?.profileId,
      );
      if (!activeProfile) {
        return { profile: null, result: null, columnLabels: [] as string[] };
      }

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, activeProfile.id))
        .orderBy(asc(schema.budgetItems.sortOrder));

      const columnLabels = activeProfile.columnLabels;
      const numColumns = columnLabels.length;
      const selectedColumn = Math.min(
        input?.selectedColumn ?? 0,
        numColumns - 1,
      );

      // ── Contribution-linked budget amounts ──
      // Budget items linked to a contribution account (via contributionAccountId)
      // use the contribution's monthly amount directly — no fill-in heuristics.
      // Each column resolves its OWN Contribution/Salary Profile: a profile
      // whose columns pin different Contribution Profiles from each other is
      // the whole point of per-column pins, and computing one profile from
      // `selectedColumn` and broadcasting its monthly figure into every
      // column's amounts (what this used to do) made these server totals
      // disagree with the client's genuinely per-column payroll breakdown in
      // use-budget-derived-data.ts.

      const rawContribs = await ctx.db
        .select()
        .from(schema.contributionAccounts)
        .where(eq(schema.contributionAccounts.isActive, true));
      const allJobs = await ctx.db.select().from(schema.jobs);

      // Per-column profile resolution, using the documented precedence
      // (Plan pin > column pin > caller's local selection > globally-active).
      // Must match use-budget-derived-data.ts's resolution exactly, or budget
      // item $ amounts and the payroll breakdown shown on the same page
      // silently disagree about which contribution/salary reality is in
      // effect. The two axes are independent — resolved separately so a
      // column can pin one without the other.
      const contribTiers = input?.contributionProfile ?? NO_PROFILE_TIERS;
      const salaryTiers = input?.salaryProfile ?? NO_PROFILE_TIERS;
      const contribProfileIdByColumn =
        resolveContributionProfileIdsForAllColumns({
          ...contribTiers,
          columnPinIds: activeProfile.columnContributionProfileIds as
            (number | null)[] | null,
          numColumns,
        });
      const salaryProfileIdByColumn = resolveSalaryProfileIdsForAllColumns({
        ...salaryTiers,
        columnPinIds: activeProfile.columnSalaryProfileIds as
          (number | null)[] | null,
        numColumns,
      });
      // Plan-level salaryActiveFields are threaded through here so budget item
      // $ amounts for percent-of-salary contributions stay consistent with
      // what the Paycheck page shows under the same active Plan — previously
      // this always passed an empty map and silently ignored the Plan's
      // active salaries. Precedence: Plan active salary > Salary Profile > live.
      const planSalaryActiveMap = toSalaryActiveMap(input?.salaryActiveFields);

      const linkedContribIds = new Set(
        items
          .filter((i) => i.contributionAccountId)
          .map((i) => i.contributionAccountId!),
      );

      /**
       * Monthly $ for every linked contribution account under one
       * (Contribution Profile, Salary Profile) pair. Called once per DISTINCT
       * pair across the profile's columns, not once per column — columns that
       * share both pins share the result.
       */
      const computeContribMonthlyForPair = async (
        contribProfileId: number | null,
        salaryProfileId: number | null,
      ): Promise<{
        contribMonthlyById: Map<number, number>;
        incompleteIds: Set<number>;
      }> => {
        const contribMonthlyById = new Map<number, number>();
        const incompleteIds = new Set<number>();
        if (linkedContribIds.size === 0)
          return { contribMonthlyById, incompleteIds };

        const effectiveSalaryMap = applySandboxSalaryEntries(
          input?.sandboxSalaryEntries,
          planSalaryActiveMap,
        );
        // salaryProfileId is null both transiently (tier resolution hasn't
        // loaded a globalDefaultId yet) and permanently (a caller like the
        // Net Worth page's budget summary that supplies no tiers at all) —
        // loadAndApplySalaryProfile would silently return an empty map
        // (zero salary/bonus) in the latter case, unlike every sibling
        // procedure's null-id handling. Fall back to the globally-active
        // Salary Profile the same way they do.
        const salaryProfileActiveMap = await loadEffectiveSalaryProfile(
          ctx.db,
          salaryProfileId,
        );
        const profileResult = await loadAndApplyContribProfile(
          ctx.db,
          contribProfileId,
          rawContribs,
          allJobs,
          salaryProfileActiveMap,
        );
        // Sandbox edits apply here too — a budget item linked to a
        // contribution account must reflect the sandbox's edited value the
        // same way the paycheck/contribution routers do, or "edit the
        // contribution account" and "see it in the budget" disagree.
        const activeContribs = applyContribActiveFields(
          profileResult.contribs,
          input?.sandboxContribActiveFields ?? {},
          true,
        );
        const activeJobs = filterActiveJobs(profileResult.jobs);
        const {
          periodsPerYear: defaultPeriodsPerYear,
          incomplete: joblessIncomplete,
        } = resolveJoblessPeriodsPerYear(activeJobs);

        const salaryByJobId = new Map<number, number>();
        for (const j of activeJobs) {
          const comp = resolveCompensation(salaryProfileActiveMap, j.id);
          // The What-If sandbox can override salary and/or bonus terms
          // independently of the Salary Profile's own resolved values —
          // same per-field precedence used everywhere else this tier
          // applies. Reading j's raw fields here silently ignored a Salary
          // Profile entry for linked contribution items on the Budget tab.
          const sandboxEntry = effectiveSalaryMap.get(j.personId);
          const salary = applyActiveSalary(
            j.personId,
            comp.salary,
            effectiveSalaryMap,
          );
          const bonusTerms = applyActiveBonusTerms(sandboxEntry, comp.terms);
          salaryByJobId.set(j.id, getEffectiveIncome(j, salary, bonusTerms));
        }

        for (const c of activeContribs) {
          if (!linkedContribIds.has(c.id)) continue;
          const val = Number(c.contributionValue);
          const isFixedPerPeriod = c.contributionMethod === "fixed_per_period";
          let jobPeriodsPerYear: number;
          let incomplete: boolean;
          if (c.jobId) {
            const job = activeJobs.find((j) => j.id === c.jobId);
            const resolved = resolveContribPeriods(c.contributionMethod, job);
            jobPeriodsPerYear = resolved.periodsPerYear;
            incomplete = resolved.incomplete;
          } else {
            jobPeriodsPerYear = defaultPeriodsPerYear;
            incomplete = isFixedPerPeriod && joblessIncomplete;
          }
          if (incomplete) {
            incompleteIds.add(c.id);
            contribMonthlyById.set(c.id, 0);
            continue;
          }
          const salary = c.jobId ? (salaryByJobId.get(c.jobId) ?? 0) : 0;
          const annual = computeAnnualContribution(
            c.contributionMethod,
            val,
            salary,
            jobPeriodsPerYear,
          );
          contribMonthlyById.set(c.id, annual / 12);
        }
        return { contribMonthlyById, incompleteIds };
      };

      const contribMonthlyByPair = new Map<
        string,
        { contribMonthlyById: Map<number, number>; incompleteIds: Set<number> }
      >();
      const contribMonthlyByColumn: Map<number, number>[] = [];
      const incompleteContribAccountIds = new Set<number>();
      for (let col = 0; col < numColumns; col++) {
        const contribProfileId = contribProfileIdByColumn[col] ?? null;
        const salaryProfileId = salaryProfileIdByColumn[col] ?? null;
        const key = `${contribProfileId}:${salaryProfileId}`;
        let resolved = contribMonthlyByPair.get(key);
        if (!resolved) {
          resolved = await computeContribMonthlyForPair(
            contribProfileId,
            salaryProfileId,
          );
          contribMonthlyByPair.set(key, resolved);
        }
        contribMonthlyByColumn.push(resolved.contribMonthlyById);
        for (const id of resolved.incompleteIds)
          incompleteContribAccountIds.add(id);
      }

      // For linked items, each column's own contribution monthly amount
      // replaces that column's DB amount. For unlinked items, use DB amounts
      // as-is. The What-If tab's hand-edited amounts are ONE MORE LAYER on
      // top of that resolution chain — never a replacement for it, per
      // toItemAmountActiveMap's docblock — applied here so every
      // downstream total (result, allColumnResults, weightedAnnualTotal,
      // netMonthlyIncome's leftover) reflects the sandbox's edits through
      // the ONE resolution path instead of a second client-side computation.
      const itemActiveMap = toItemAmountActiveMap(
        input?.itemAmountActiveFields,
      );
      const applyItemActiveFields = (itemId: number, amounts: number[]) =>
        itemActiveMap.size === 0
          ? amounts
          : amounts.map(
              (amt, col) => itemActiveMap.get(`${itemId}:${col}`) ?? amt,
            );
      const budgetItems = items.map((i) => {
        const dbAmounts = i.amounts as number[];
        if (!i.contributionAccountId)
          return {
            ...i,
            amounts: applyItemActiveFields(i.id, dbAmounts),
            contribAmounts: null as number[] | null,
            contribAmount: null as number | null,
          };
        const accountId = i.contributionAccountId;
        const contribAmounts = Array.from(
          { length: numColumns },
          (_, col) => contribMonthlyByColumn[col]?.get(accountId) ?? 0,
        );
        return {
          ...i,
          amounts: applyItemActiveFields(i.id, contribAmounts),
          contribAmounts,
          // Kept for the display path that only knows about one figure; it is
          // the SELECTED column's amount, not a value valid for all columns.
          contribAmount: contribAmounts[selectedColumn] ?? 0,
        };
      });

      const budgetInput: BudgetInput = {
        items: budgetItems.map((i) => ({
          category: i.category,
          label: i.subcategory,
          amounts: i.amounts,
          isEssential: i.isEssential,
        })),
        columnLabels,
        selectedColumn,
        asOfDate: new Date(),
      };

      const result = calculateBudget(budgetInput);

      // Also compute all columns for side-by-side comparison
      const allColumnResults = columnLabels.map((_: string, colIdx: number) =>
        calculateBudget({ ...budgetInput, selectedColumn: colIdx }),
      );

      // Raw items: DB amounts for editing, contribution amounts for display on linked items.
      const rawItems = items.map((i) => {
        const dbAmounts = i.amounts as number[];
        const linked = budgetItems.find((b) => b.id === i.id);
        return {
          id: i.id,
          category: i.category,
          subcategory: i.subcategory,
          amounts: dbAmounts,
          contribAmount: linked?.contribAmount ?? null,
          /** Per-column contribution $ — column i uses column i's own
           *  resolved Contribution/Salary Profile. Null for unlinked items. */
          contribAmounts: linked?.contribAmounts ?? null,
          isEssential: i.isEssential,
          apiCategoryId: i.apiCategoryId,
          apiCategoryName: i.apiCategoryName,
          apiSyncDirection: i.apiSyncDirection,
          contributionAccountId: i.contributionAccountId,
          // Linked to a fixed_per_period contribution account with no
          // resolvable job/pay period — excluded from amounts above (0),
          // not a guessed pay period. See resolveContribPeriods.
          incomplete: i.contributionAccountId
            ? incompleteContribAccountIds.has(i.contributionAccountId)
            : false,
        };
      });

      const columnMonths = activeProfile.columnMonths ?? null;
      const weightedAnnualTotal = computeBudgetAnnualTotal(
        budgetItems.map((i) => ({ amounts: i.amounts })),
        selectedColumn,
        columnMonths,
      );

      // Monthly take-home under the SELECTED column's own resolved
      // (Contribution, Salary) profile pair, honoring sandboxSalaryEntries —
      // the same paycheck.computeSummary call and the same
      // budgetPerMonth-aware annualization listProfiles' netMonthlyForPair
      // uses (see this file, above), so the What-If tab's "available income"
      // figure can't disagree with what Savings' Unspent shows for the same
      // inputs. Not derived from WhatIfPaycheckSummary's client-side annual
      // total, which uses a naive periodsPerYear multiplication that ignores
      // job.budgetPeriodsPerMonth.
      let netMonthlyIncome: number | null = null;
      try {
        const paycheckCallerForIncome =
          createCallerFactory(paycheckRouter)(ctx);
        const incomePaycheckData = await paycheckCallerForIncome.computeSummary(
          {
            ...(input?.salaryActiveFields && input.salaryActiveFields.length > 0
              ? { salaryActiveFields: input.salaryActiveFields }
              : {}),
            ...(contribProfileIdByColumn[selectedColumn] != null
              ? {
                  contributionProfileId:
                    contribProfileIdByColumn[selectedColumn]!,
                }
              : {}),
            ...(salaryProfileIdByColumn[selectedColumn] != null
              ? { salaryProfileId: salaryProfileIdByColumn[selectedColumn]! }
              : {}),
            ...(input?.sandboxSalaryEntries
              ? { sandboxSalaryEntries: input.sandboxSalaryEntries }
              : {}),
            ...(input?.sandboxDeductionEdits
              ? { sandboxDeductionEdits: input.sandboxDeductionEdits }
              : {}),
            ...(input?.sandboxDeductionAdditions
              ? { sandboxDeductionAdditions: input.sandboxDeductionAdditions }
              : {}),
            ...(input?.sandboxContribActiveFields
              ? { sandboxContribActiveFields: input.sandboxContribActiveFields }
              : {}),
            ...(input?.sandboxContribAdditions
              ? { sandboxContribAdditions: input.sandboxContribAdditions }
              : {}),
          },
        );
        for (const d of incomePaycheckData.people) {
          const pc = d.paycheck;
          if (!pc || !d.job) continue;
          const perMonth =
            ("budgetPerMonth" in d ? d.budgetPerMonth : null) ??
            pc.periodsPerYear / 12;
          netMonthlyIncome = (netMonthlyIncome ?? 0) + pc.netPay * perMonth;
        }
      } catch (err) {
        // Supplementary figure for the What-If tab's income handoff — a
        // failure here (e.g. malformed contribution-account data elsewhere
        // in the household) must not take down the budget items themselves.
        log("warn", "computeActiveSummary.netMonthlyIncome_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return {
        profile: activeProfile,
        result,
        columnLabels,
        allColumnResults,
        rawItems,
        columnMonths,
        weightedAnnualTotal,
        /** Monthly take-home for the selected column's resolved profile
         *  pair — see the computation above for why this must be read
         *  instead of re-deriving income client-side. */
        netMonthlyIncome,
        /** What each column actually resolved to, per the documented
         *  precedence — surfaced so the UI can explain a column whose
         *  effective profile differs from the page's own picker. */
        contribProfileIdByColumn,
        salaryProfileIdByColumn,
      };
    }),

  /** Update a single amount cell for a budget item. */
  updateItemAmount: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        colIndex: z.number().int(),
        amount: z.number(),
        contributionProfile: profileResolutionTiersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.id))
        .then((r) => r[0]);
      if (!item) throw new Error("Item not found");

      // Linked items: the amount IS the budget amount from the user's
      // perspective, so budgetProcedure is intentionally allowed to write
      // through to the linked contribution account rather than the dead
      // budget_items.amounts field it would otherwise shadow. Writes into
      // whichever Contribution Profile is currently in effect for this
      // column — contributionValue/Method have no account-level fallback.
      if (item.contributionAccountId) {
        const contribProfileId = await resolveEffectiveContribProfileIdForItem(
          ctx.db,
          item,
          input.colIndex,
          input.contributionProfile ?? NO_PROFILE_TIERS,
        );
        await applyContributionAccountEdit(
          ctx.db,
          item.contributionAccountId,
          input.amount,
          contribProfileId,
        );
        return item;
      }

      const amounts = budgetAmountsSchema.parse(item.amounts);
      if (input.colIndex < 0 || input.colIndex >= amounts.length) {
        throw new Error("Column index out of bounds");
      }
      amounts[input.colIndex] = input.amount;
      return ctx.db
        .update(schema.budgetItems)
        .set({ amounts })
        .where(eq(schema.budgetItems.id, input.id))
        .returning()
        .then((r) => r[0]);
    }),

  /** Batch update multiple amount cells. */
  updateItemAmounts: budgetProcedure
    .input(
      z.object({
        updates: z.array(
          z.object({
            id: z.number().int(),
            colIndex: z.number().int(),
            amount: z.number(),
          }),
        ),
        contributionProfile: profileResolutionTiersSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const byId = new Map<number, { colIndex: number; amount: number }[]>();
      for (const u of input.updates) {
        const list = byId.get(u.id) ?? [];
        list.push({ colIndex: u.colIndex, amount: u.amount });
        byId.set(u.id, list);
      }
      for (const [id, changes] of Array.from(byId)) {
        const item = await ctx.db
          .select()
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.id, id))
          .then((r) => r[0]);
        if (!item) continue;

        // Linked items: write through to the contribution account instead
        // of the dead budget_items.amounts field (see updateItemAmount for
        // the permission-scope rationale). If a batch somehow carries more
        // than one distinct amount for the same linked item, last one wins.
        if (item.contributionAccountId) {
          const lastChange = changes[changes.length - 1]!;
          const contribProfileId =
            await resolveEffectiveContribProfileIdForItem(
              ctx.db,
              item,
              lastChange.colIndex,
              input.contributionProfile ?? NO_PROFILE_TIERS,
            );
          await applyContributionAccountEdit(
            ctx.db,
            item.contributionAccountId,
            lastChange.amount,
            contribProfileId,
          );
          continue;
        }

        const amounts = budgetAmountsSchema.parse(item.amounts);
        for (const c of changes) {
          if (c.colIndex >= 0 && c.colIndex < amounts.length) {
            amounts[c.colIndex] = c.amount;
          }
        }
        await ctx.db
          .update(schema.budgetItems)
          .set({ amounts })
          .where(eq(schema.budgetItems.id, id));
      }
      return { ok: true };
    }),

  /** Add a new column (budget mode) to the target profile (active if not given). */
  addColumn: budgetProcedure
    .input(
      z.object({ label: z.string().min(1), profileId: z.number().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");

      const newLabels = columnLabelsSchema.parse([
        ...profile.columnLabels,
        input.label,
      ]);
      const newMonths = profile.columnMonths
        ? columnMonthsSchema.parse([...(profile.columnMonths as number[]), 0])
        : null;
      const newContribIds = profile.columnContributionProfileIds
        ? columnContributionProfileIdsSchema.parse([
            ...(profile.columnContributionProfileIds as (number | null)[]),
            null,
          ])
        : null;
      const newSalaryIds = profile.columnSalaryProfileIds
        ? columnSalaryProfileIdsSchema.parse([
            ...(profile.columnSalaryProfileIds as (number | null)[]),
            null,
          ])
        : null;
      await ctx.db
        .update(schema.budgetProfiles)
        .set({
          columnLabels: newLabels,
          columnMonths: newMonths,
          columnContributionProfileIds: newContribIds,
          columnSalaryProfileIds: newSalaryIds,
        })
        .where(eq(schema.budgetProfiles.id, profile.id));

      // Add a 0 to each item's amounts array
      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      for (const item of items) {
        const amounts = budgetAmountsSchema.parse([
          ...(item.amounts as number[]),
          0,
        ]);
        await ctx.db
          .update(schema.budgetItems)
          .set({ amounts })
          .where(eq(schema.budgetItems.id, item.id));
      }
      return { ok: true };
    }),

  /** Remove a column (budget mode) from the target profile (active if not given). */
  removeColumn: budgetProcedure
    .input(
      z.object({
        colIndex: z.number().int().min(0),
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");
      const colCheck = canRemoveColumn(
        profile.columnLabels.length,
        input.colIndex,
      );
      if (!colCheck.allowed) throw new Error(colCheck.reason);

      const newLabels = columnLabelsSchema.parse(
        profile.columnLabels.filter(
          (_: string, i: number) => i !== input.colIndex,
        ),
      );
      const newMonths = profile.columnMonths
        ? columnMonthsSchema.parse(
            (profile.columnMonths as number[]).filter(
              (_: number, i: number) => i !== input.colIndex,
            ),
          )
        : null;
      const newContribIds = profile.columnContributionProfileIds
        ? columnContributionProfileIdsSchema.parse(
            (profile.columnContributionProfileIds as (number | null)[]).filter(
              (_: number | null, i: number) => i !== input.colIndex,
            ),
          )
        : null;
      const newSalaryIds = profile.columnSalaryProfileIds
        ? columnSalaryProfileIdsSchema.parse(
            (profile.columnSalaryProfileIds as (number | null)[]).filter(
              (_: number | null, i: number) => i !== input.colIndex,
            ),
          )
        : null;
      await ctx.db
        .update(schema.budgetProfiles)
        .set({
          columnLabels: newLabels,
          columnMonths: newMonths,
          columnContributionProfileIds: newContribIds,
          columnSalaryProfileIds: newSalaryIds,
        })
        .where(eq(schema.budgetProfiles.id, profile.id));

      // Remove the column from each item's amounts array
      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      for (const item of items) {
        const amounts = budgetAmountsSchema.parse(
          (item.amounts as number[]).filter(
            (_: number, i: number) => i !== input.colIndex,
          ),
        );
        await ctx.db
          .update(schema.budgetItems)
          .set({ amounts })
          .where(eq(schema.budgetItems.id, item.id));
      }
      return { ok: true };
    }),

  /** Create a new budget item. */
  createItem: budgetProcedure
    .input(
      z.object({
        category: z.string().trim().min(1),
        subcategory: z.string().trim().min(1),
        isEssential: z.boolean().default(true),
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");

      const numCols = profile.columnLabels.length;
      const amounts = new Array(numCols).fill(0) as number[];

      // Determine sort order: place at end of category
      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const sameCatItems = items.filter((i) => i.category === input.category);
      const maxSort =
        sameCatItems.length > 0
          ? Math.max(...sameCatItems.map((i) => i.sortOrder))
          : items.length > 0
            ? Math.max(...items.map((i) => i.sortOrder))
            : 0;

      return ctx.db
        .insert(schema.budgetItems)
        .values({
          profileId: profile.id,
          category: input.category,
          subcategory: input.subcategory,
          amounts,
          isEssential: input.isEssential,
          sortOrder: maxSort + 1,
        })
        .returning()
        .then((r) => r[0]);
    }),

  /** Delete a budget item. */
  deleteItem: budgetProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.id));
      return { ok: true };
    }),

  /** Move a budget item to a different category. */
  moveItem: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        newCategory: z.string().trim().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(schema.budgetItems)
        .set({ category: input.newCategory })
        .where(eq(schema.budgetItems.id, input.id))
        .returning()
        .then((r) => r[0]);
    }),

  /** Swap a category's whole block of items with an adjacent category's
   *  block. No-ops at the first/last category boundary. */
  reorderCategory: budgetProcedure
    .input(
      z.object({
        profileId: z.number().optional(),
        category: z.string(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id))
        .orderBy(asc(schema.budgetItems.sortOrder));

      const blocks = groupItemsByCategory(items);
      const idx = blocks.findIndex((b) => b.category === input.category);
      if (idx === -1) return { ok: true };

      const swapWith = input.direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= blocks.length) return { ok: true };

      [blocks[idx], blocks[swapWith]] = [blocks[swapWith]!, blocks[idx]!];
      await renumberItems(ctx.db, blocks);
      return { ok: true };
    }),

  /** Swap an item's position with an adjacent item within the same
   *  category. No-ops at the category's first/last item boundary — moving
   *  an item into a different category is the "Move..." dropdown's job
   *  (moveItem above), not this. */
  reorderItem: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.id));
      if (!target) throw new Error("Item not found");

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, target.profileId))
        .orderBy(asc(schema.budgetItems.sortOrder));

      const blocks = groupItemsByCategory(items);
      const block = blocks.find((b) => b.category === target.category);
      if (!block) return { ok: true };

      const idx = block.items.findIndex((i) => i.id === target.id);
      if (idx === -1) return { ok: true };

      const swapWith = input.direction === "up" ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= block.items.length) return { ok: true };

      [block.items[idx], block.items[swapWith]] = [
        block.items[swapWith]!,
        block.items[idx]!,
      ];
      await renumberItems(ctx.db, blocks);
      return { ok: true };
    }),

  /** Update a budget item's essential flag. */
  updateItemEssential: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        isEssential: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db
        .update(schema.budgetItems)
        .set({ isEssential: input.isEssential })
        .where(eq(schema.budgetItems.id, input.id))
        .returning()
        .then((r) => r[0]);
    }),

  /** Toggle isEssential for all items in a category. */
  updateCategoryEssential: budgetProcedure
    .input(
      z.object({
        category: z.string().trim().min(1),
        isEssential: z.boolean(),
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");

      const allItems = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));

      for (const item of allItems.filter(
        (i) => i.category === input.category,
      )) {
        await ctx.db
          .update(schema.budgetItems)
          .set({ isEssential: input.isEssential })
          .where(eq(schema.budgetItems.id, item.id));
      }
      return { ok: true };
    }),

  /** Rename a column (budget mode). */
  renameColumn: budgetProcedure
    .input(
      z.object({
        colIndex: z.number().int().min(0),
        label: z.string().trim().min(1),
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");
      if (input.colIndex >= profile.columnLabels.length)
        throw new Error("Invalid column index");

      const newLabels = [...profile.columnLabels];
      newLabels[input.colIndex] = input.label;
      await ctx.db
        .update(schema.budgetProfiles)
        .set({ columnLabels: columnLabelsSchema.parse(newLabels) })
        .where(eq(schema.budgetProfiles.id, profile.id));
      return { ok: true };
    }),

  /** Update column months for weighted budget profiles. */
  updateColumnMonths: budgetProcedure
    .input(
      z.object({
        columnMonths: columnMonthsSchema,
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");

      if (input.columnMonths) {
        if (input.columnMonths.length !== profile.columnLabels.length) {
          throw new Error("columnMonths length must match columnLabels length");
        }
        const sum = input.columnMonths.reduce((s, m) => s + m, 0);
        if (sum !== 12) {
          throw new Error(
            `columnMonths must sum to 12 (got ${sum}) — the weighted annual total assumes a full year is covered`,
          );
        }
      }

      await ctx.db
        .update(schema.budgetProfiles)
        .set({ columnMonths: input.columnMonths })
        .where(eq(schema.budgetProfiles.id, profile.id));
      return { ok: true };
    }),

  /** Update per-column contribution profile assignments. */
  updateColumnContributionProfileIds: budgetProcedure
    .input(
      z.object({
        columnContributionProfileIds: columnContributionProfileIdsSchema,
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");

      if (input.columnContributionProfileIds) {
        if (
          input.columnContributionProfileIds.length !==
          profile.columnLabels.length
        ) {
          throw new Error(
            "columnContributionProfileIds length must match columnLabels length",
          );
        }
      }

      // Store null if all entries are null (clean up to default behavior)
      const cleaned = input.columnContributionProfileIds?.every(
        (v) => v === null,
      )
        ? null
        : input.columnContributionProfileIds;

      await ctx.db
        .update(schema.budgetProfiles)
        .set({ columnContributionProfileIds: cleaned })
        .where(eq(schema.budgetProfiles.id, profile.id));
      return { ok: true };
    }),

  /** Update per-column salary profile assignments (independent of the
   *  contribution-profile assignments above). */
  updateColumnSalaryProfileIds: budgetProcedure
    .input(
      z.object({
        columnSalaryProfileIds: columnSalaryProfileIdsSchema,
        profileId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile) throw new Error("No active profile");

      if (
        input.columnSalaryProfileIds &&
        input.columnSalaryProfileIds.length !== profile.columnLabels.length
      ) {
        throw new Error(
          "columnSalaryProfileIds length must match columnLabels length",
        );
      }

      // Store null if all entries are null (clean up to default behavior)
      const cleaned = input.columnSalaryProfileIds?.every((v) => v === null)
        ? null
        : input.columnSalaryProfileIds;

      await ctx.db
        .update(schema.budgetProfiles)
        .set({ columnSalaryProfileIds: cleaned })
        .where(eq(schema.budgetProfiles.id, profile.id));
      return { ok: true };
    }),

  // ── Contribution Account Linking ──

  /** Link a budget item to a specific contribution account. */
  linkContributionAccount: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        contributionAccountId: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({ contributionAccountId: input.contributionAccountId })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** Remove contribution account link from a budget item. */
  unlinkContributionAccount: budgetProcedure
    .input(z.object({ budgetItemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({ contributionAccountId: null })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** List non-payroll contribution accounts for the linking UI.
   *  jobId === null means the contribution comes from take-home pay (IRA,
   *  taxable brokerage, etc.). Job-linked contributions (401k, HSA, ESPP)
   *  are payroll-deducted and already on the paycheck. */
  listContribAccountsForLinking: protectedProcedure.query(async ({ ctx }) => {
    const [contribs, people, perfAccounts] = await Promise.all([
      ctx.db
        .select()
        .from(schema.contributionAccounts)
        .where(eq(schema.contributionAccounts.isActive, true)),
      ctx.db.select().from(schema.people),
      ctx.db.select().from(schema.performanceAccounts),
    ]);

    const personMap = new Map(people.map((p) => [p.id, p.name]));
    const perfMap = new Map(perfAccounts.map((p) => [p.id, p]));

    // Non-payroll = no job link — these come from take-home pay
    const filtered = contribs.filter((c) => c.jobId === null);

    return filtered.map((c) => {
      const perf = c.performanceAccountId
        ? perfMap.get(c.performanceAccountId)
        : null;
      // Pass ownershipType so accountDisplayName applies "Joint" prefix for
      // joint accounts and the individual owner name for individual accounts.
      const ownerName =
        c.ownership === "individual" && c.personId != null
          ? personMap.get(c.personId)
          : undefined;
      const label = accountDisplayName(
        {
          accountType: c.accountType,
          subType: c.subType,
          label: c.label,
          displayName: perf?.displayName,
          accountLabel: perf?.accountLabel,
          institution: perf?.institution,
          ownershipType: perf?.ownershipType ?? c.ownership,
        },
        ownerName ?? undefined,
      );
      return {
        id: c.id,
        accountType: c.accountType,
        displayLabel: label,
      };
    });
  }),

  // ── Budget API Integration ──

  /** Get cached categories from the active (or specified) budget API for the category picker. */
  listApiCategories: protectedProcedure
    .input(
      z.object({ service: z.enum(["ynab", "actual"]).optional() }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      const service = input?.service ?? (active !== "none" ? active : null);
      if (!service) return { groups: [] };

      const cached = await cacheGet<BudgetCategoryGroup[]>(
        ctx.db,
        service,
        "categories",
      );
      if (!cached) return { groups: [] };

      // Flatten to group > category hierarchy, excluding hidden and YNAB internal groups
      return {
        groups: cached.data
          .filter((g) => !g.hidden && !YNAB_INTERNAL_GROUPS.has(g.name))
          .map((g) => ({
            id: g.id,
            name: g.name,
            categories: g.categories
              .filter((c) => !c.hidden)
              .map((c) => ({
                id: c.id,
                name: c.name,
                budgeted: c.budgeted,
                activity: c.activity,
                balance: c.balance,
              })),
          })),
      };
    }),

  /** Link a budget item to a budget API category. */
  linkToApi: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        apiCategoryId: z.string().min(1),
        apiCategoryName: z.string().min(1),
        syncDirection: z.enum(["pull", "push", "both"]).default("pull"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({
          apiCategoryId: input.apiCategoryId,
          apiCategoryName: input.apiCategoryName,
          apiSyncDirection: input.syncDirection,
          apiLastSyncedAt: null,
        })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** Remove API link from a budget item. */
  unlinkFromApi: budgetProcedure
    .input(z.object({ budgetItemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({
          apiCategoryId: null,
          apiCategoryName: null,
          apiSyncDirection: "pull",
          apiLastSyncedAt: null,
        })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** Change sync direction on a linked budget item. */
  setSyncDirection: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number(),
        syncDirection: z.enum(["pull", "push", "both"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.budgetItems)
        .set({ apiSyncDirection: input.syncDirection })
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      return { ok: true };
    }),

  /** Pull budgeted amounts from API for all linked items (API -> Ledgr). */
  syncBudgetFromApi: budgetProcedure
    .input(z.object({ selectedColumn: z.number().int().default(0) }))
    .mutation(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No budget API active",
        });
      }

      // Get current month detail from cache
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const monthCache = await cacheGet<BudgetMonthDetail>(
        ctx.db,
        active,
        `months/${currentMonth}`,
      );
      if (!monthCache) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No cached month data. Run Sync first.",
        });
      }

      const apiCategories = new Map(
        monthCache.data.categories.map((c) => [c.id, c]),
      );

      // Use linked profile from apiConnections (consistent with sync.ts orchestrator),
      // falling back to active profile if no linked profile is configured.
      const [conn] = await ctx.db
        .select({ linkedProfileId: schema.apiConnections.linkedProfileId })
        .from(schema.apiConnections)
        .where(eq(schema.apiConnections.service, active));
      const allProfiles = await ctx.db.select().from(schema.budgetProfiles);
      const profile = conn?.linkedProfileId
        ? allProfiles.find((p) => p.id === conn.linkedProfileId)
        : allProfiles.find((p) => p.isActive);
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No linked or active budget profile",
        });

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));

      let updated = 0;
      for (const item of items) {
        if (!item.apiCategoryId) continue;
        if (
          item.apiSyncDirection !== "pull" &&
          item.apiSyncDirection !== "both"
        )
          continue;

        const apiCat = apiCategories.get(item.apiCategoryId);
        if (!apiCat) continue;

        const amounts = budgetAmountsSchema.parse(item.amounts);
        const colIdx = Math.min(input.selectedColumn, amounts.length - 1);
        amounts[colIdx] = apiCat.goalTarget ?? 0;

        await ctx.db
          .update(schema.budgetItems)
          .set({ amounts, apiLastSyncedAt: new Date() })
          .where(eq(schema.budgetItems.id, item.id));
        updated++;
      }

      return { updated };
    }),

  /** Push budget amounts to API for all linked items (Ledgr -> API). */
  syncBudgetToApi: budgetProcedure
    .input(z.object({ selectedColumn: z.number().int().default(0) }))
    .mutation(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No budget API active",
        });
      }

      const client = await getClientForService(ctx.db, active);
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Budget API client not available",
        });
      }

      // Use linked profile from apiConnections (consistent with sync.ts orchestrator)
      const [conn] = await ctx.db
        .select({ linkedProfileId: schema.apiConnections.linkedProfileId })
        .from(schema.apiConnections)
        .where(eq(schema.apiConnections.service, active));
      const allProfiles = await ctx.db.select().from(schema.budgetProfiles);
      const profile = conn?.linkedProfileId
        ? allProfiles.find((p) => p.id === conn.linkedProfileId)
        : allProfiles.find((p) => p.isActive);
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No linked or active budget profile",
        });

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));

      let pushed = 0;
      for (const item of items) {
        if (!item.apiCategoryId) continue;
        if (
          item.apiSyncDirection !== "push" &&
          item.apiSyncDirection !== "both"
        )
          continue;

        const amounts = item.amounts as number[];
        const colIdx = Math.min(input.selectedColumn, amounts.length - 1);
        const amount = amounts[colIdx] ?? 0;

        // Push as YNAB goal target (plan-level, not month-specific)
        await client.updateCategoryGoalTarget(item.apiCategoryId, amount);
        await ctx.db
          .update(schema.budgetItems)
          .set({ apiLastSyncedAt: new Date() })
          .where(eq(schema.budgetItems.id, item.id));
        pushed++;
      }

      // Push writes directly to YNAB but doesn't touch budget_api_cache —
      // refresh it so the next preview/comparison reflects what was just
      // pushed instead of showing stale pre-push diffs until the next
      // manual Sync.
      if (pushed > 0) {
        try {
          await refreshCategoryCache(ctx.db, active, client);
        } catch (err) {
          // Pushes already succeeded remotely — a stale cache must not turn
          // a successful push into a client-visible failure.
          log("error", "post_push_cache_refresh_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { pushed };
    }),

  /** Get API actuals for linked budget items (activity + balance from cached month data). */
  listApiActuals: protectedProcedure
    .input(z.object({ profileId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const active = await getActiveBudgetApi(ctx.db);
      if (active === "none")
        return {
          actuals: [],
          service: null as string | null,
          month: null as string | null,
          linkedProfileId: null as number | null,
          linkedColumnIndex: 0,
        };

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const monthCache = await cacheGet<BudgetMonthDetail>(
        ctx.db,
        active,
        `months/${currentMonth}`,
      );
      if (!monthCache)
        return {
          actuals: [],
          service: active,
          month: null as string | null,
          linkedProfileId: null as number | null,
          linkedColumnIndex: 0,
        };

      const apiCategories = new Map(
        monthCache.data.categories.map((c) => [c.id, c]),
      );

      const profile = await resolveTargetBudgetProfile(
        ctx.db,
        input?.profileId,
      );
      if (!profile)
        return {
          actuals: [],
          service: active,
          month: null as string | null,
          linkedProfileId: null as number | null,
          linkedColumnIndex: 0,
        };

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));

      const actuals = items
        .filter((i) => i.apiCategoryId)
        .map((i) => {
          const cat = apiCategories.get(i.apiCategoryId!);
          return {
            budgetItemId: i.id,
            apiCategoryName: i.apiCategoryName,
            budgeted: cat?.budgeted ?? 0,
            activity: cat?.activity ?? 0,
            balance: cat?.balance ?? 0,
            goalTarget: cat?.goalTarget ?? 0,
          };
        });

      // Include linked profile/column info so UI can highlight which profile + mode syncs
      const conn = await ctx.db
        .select({
          linkedProfileId: schema.apiConnections.linkedProfileId,
          linkedColumnIndex: schema.apiConnections.linkedColumnIndex,
        })
        .from(schema.apiConnections)
        .where(eq(schema.apiConnections.service, active))
        .limit(1);

      return {
        actuals,
        month: currentMonth,
        service: active,
        linkedProfileId: conn[0]?.linkedProfileId ?? null,
        linkedColumnIndex: conn[0]?.linkedColumnIndex ?? 0,
      };
    }),
});
