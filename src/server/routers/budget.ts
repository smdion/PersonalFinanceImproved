/** Budget router for multi-profile budget management including category items, column tiers, contribution profile linking, and budget API integration. */
import { assertWithinIrsLimits } from "@/server/helpers/contribution-caps";
import { assertNoPlanUses } from "@/server/helpers/plans";
import { eq, asc, inArray, and, gte, lt } from "drizzle-orm";
import { log } from "@/lib/logger";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  budgetProcedure,
  createCallerFactory,
  internalCtx,
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
} from "./_shared";
import * as schema from "@/lib/db/schema";
import { canDeleteBudgetProfile, canRemoveColumn } from "@/lib/pure/profiles";
import {
  columnLabelsSchema,
  columnMonthsSchema,
  budgetAmountsSchema,
} from "@/lib/db/json-schemas";
import { calculateBudget } from "@/lib/calculators/budget";
import type { BudgetInput } from "@/lib/calculators/types";
import {
  computeBudgetAnnualTotal,
  applyContributionAccountEdit,
  applyContributionAccountEditsBatch,
  resolveTargetBudgetProfile,
  getResolvedGoalAllocations,
  resolveLinkedBudgetItemAmounts,
  resolveActiveProfilePair,
  type ProfilePair,
  loadBudgetItemLinks,
  setBudgetItemLink,
  deleteBudgetItemLink,
} from "@/server/helpers";
import type { DbOrTx } from "@/server/helpers/transforms";
import { budgetApiServiceSchema } from "@/lib/config/enum-values";
import { portfolioAccountLabel } from "@/server/helpers/portfolio-labels";
import { TAX_TREATMENT_LABELS } from "@/lib/config/display-labels";
import {
  getActiveBudgetApi,
  getClientForService,
  cacheGet,
  refreshCategoryCache,
  BudgetApiError,
} from "@/lib/budget-api";
import type { BudgetCategoryGroup, BudgetMonthDetail } from "@/lib/budget-api";
import { YNAB_INTERNAL_GROUPS } from "@/lib/budget-api";
import { currentMonthKey } from "@/lib/pure/date-keys";

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
  db: DbOrTx,
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
 * docs/RULES.md's profile precedence as the caller supplies it: its own
 * local selection (What-If), else the active profile. Both fields are
 * required (nullable) so a caller can't silently omit one.
 */
export const profileResolutionTiersSchema = z.object({
  /** The calling page's own local selection / preview pick, if it has one. */
  localSelectionId: z.number().int().nullable(),
  /** The globally-active profile id for this axis. */
  globalDefaultId: z.number().int().nullable(),
});

export type ProfileResolutionTiers = z.infer<
  typeof profileResolutionTiersSchema
>;

/** The profile a page's tiers resolve to: its own local selection (What-If
 *  sandbox), else the active one. Without tiers, the active profile. */
async function profileFromTiers(
  db: DbOrTx,
  tiers: ProfileResolutionTiers | undefined,
  kind: "contribProfileId" | "salaryProfileId",
): Promise<number | null> {
  if (tiers) return tiers.localSelectionId ?? tiers.globalDefaultId;
  return (await resolveActiveProfilePair(db))[kind];
}

/**
 * Which Contribution Profile a budget-linked item edit writes into — the
 * one the page shows. Throws rather than silently writing nowhere:
 * contributionValue/Method have no account-level fallback (see
 * applyContribActiveFields), so an edit with no profile has nowhere
 * correct to go.
 */
async function resolveEffectiveContribProfileIdForItem(
  db: DbOrTx,
  tiers: ProfileResolutionTiers | undefined,
): Promise<number> {
  const resolvedId = await profileFromTiers(db, tiers, "contribProfileId");
  if (resolvedId == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "No Contribution Profile is resolvable for this edit — activate a Contribution Profile before editing a linked amount",
    });
  }
  return resolvedId;
}

/**
 * Household monthly take-home from paycheck.computeSummary: each job's net
 * pay × the paychecks per month the budget counts. netPay is gross −
 * pre-tax − withholding − FICA − post-tax, so this is the same take-home the
 * client's buildPayrollBreakdown derives line by line. Null when no one has
 * a paycheck.
 */
function netMonthlyTakeHome(data: {
  people: readonly {
    job?: unknown;
    paycheck?: { netPay: number; periodsPerYear: number } | null;
    budgetPerMonth?: number | null;
  }[];
}): number | null {
  let total: number | null = null;
  for (const d of data.people) {
    const pc = d.paycheck;
    if (!pc || !d.job) continue;
    total =
      (total ?? 0) + pc.netPay * (d.budgetPerMonth ?? pc.periodsPerYear / 12);
  }
  return total;
}

export const budgetRouter = createTRPCRouter({
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
      resolveActiveProfilePair(ctx.db),
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
    // pay world. One paycheck.computeSummary call (the procedure the
    // Paycheck page uses), not a parallel re-derivation.
    const paycheckData = await createCallerFactory(paycheckRouter)(
      internalCtx(ctx),
    ).computeSummary({
      ...(activeProfiles.contribProfileId != null
        ? { contributionProfileId: activeProfiles.contribProfileId }
        : {}),
      ...(activeProfiles.salaryProfileId != null
        ? { salaryProfileId: activeProfiles.salaryProfileId }
        : {}),
    });
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
      const labels = (p.columnLabels as string[]) ?? [];
      const months = (p.columnMonths as number[] | null) ?? null;
      const numColumns = labels.length;
      // Resolved through the same chain computeActiveSummary uses (see
      // resolveLinkedBudgetItemAmounts) — raw `amounts` silently dropped
      // every contribution-linked item from this sidebar's totals.
      const resolvedItems = await resolveLinkedBudgetItemAmounts(
        ctx.db,
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

  /** Create a new budget profile, pre-populated with standard template
   *  categories. Its take-home math uses the active Contribution and Salary
   *  profiles, like every budget profile. */
  createProfile: budgetProcedure
    .input(
      z.object({
        name: z.string().trim().min(1),
        columnLabels: columnLabelsSchema.default(["Standard"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .insert(schema.budgetProfiles)
        .values({
          name: input.name,
          columnLabels: input.columnLabels,
          isActive: false,
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
   * - Copied: column labels/months and each item's amounts/category/subcategory/essential flag/sort order.
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
        if (!source)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Source profile not found",
          });

        const created = await tx
          .insert(schema.budgetProfiles)
          .values({
            name: input.name,
            description: source.description,
            columnLabels: source.columnLabels,
            columnMonths: source.columnMonths,
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
      if (!profile)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profile not found",
        });
      const deleteCheck = canDeleteBudgetProfile(profile);
      if (!deleteCheck.allowed)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: deleteCheck.reason,
        });

      await assertNoPlanUses(ctx.db, "budget", input.id);

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
           * The caller's resolution tiers for each profile axis (local
           * selection → active); omitted = the active profiles.
           */
          contributionProfile: profileResolutionTiersSchema.optional(),
          salaryProfile: profileResolutionTiersSchema.optional(),
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

      // Sum of budget_income_adjustments (Budget-mode extra-paycheck
      // materializer output) landing in the REAL current calendar month.
      // Computed unconditionally, before activeProfile is even checked —
      // deliberately NOT parameterized by selectedColumn/profileId, so it
      // can't be used to silently corrupt a What-If scenario comparison
      // (the advisor rejected folding this into netMonthlyIncome for
      // exactly that reason: netMonthlyIncome is per-selectedColumn and has
      // no "this is the live view" signal). Same value regardless of which
      // scenario column the caller asked for — see
      // tests/routers/budget-coverage.test.ts for the invariant test.
      const nowMonthStart = currentMonthKey(new Date());
      const nextMonthStart = currentMonthKey(
        new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
      );
      const budgetIncomeAdjustmentRows = await ctx.db
        .select({ amount: schema.budgetIncomeAdjustments.amount })
        .from(schema.budgetIncomeAdjustments)
        .where(
          and(
            gte(schema.budgetIncomeAdjustments.monthDate, nowMonthStart),
            lt(schema.budgetIncomeAdjustments.monthDate, nextMonthStart),
          ),
        );
      const budgetIncomeAdjustmentThisMonth = budgetIncomeAdjustmentRows.reduce(
        (sum, r) => sum + Number(r.amount),
        0,
      );

      if (!activeProfile) {
        return {
          profile: null,
          result: null,
          columnLabels: [] as string[],
          budgetIncomeAdjustmentThisMonth,
        };
      }

      const rawItemRows = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, activeProfile.id))
        .orderBy(asc(schema.budgetItems.sortOrder));

      // Read-only display path — resolve links for the currently active
      // service only (no cross-service ambiguity here; see
      // src/server/helpers/category-links.ts).
      const displayService = await getActiveBudgetApi(ctx.db);
      const displayItemLinks =
        displayService === "none"
          ? new Map()
          : await loadBudgetItemLinks(
              ctx.db,
              rawItemRows.map((i) => i.id),
              displayService,
            );
      const items = rawItemRows.map((i) => {
        const link = displayItemLinks.get(i.id);
        return {
          ...i,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
          apiLastSyncedAt: link?.lastSyncedAt ?? null,
          apiSyncDirection: link?.syncDirection ?? "pull",
        };
      });

      const columnLabels = activeProfile.columnLabels;
      const numColumns = columnLabels.length;
      const selectedColumn = Math.min(
        input?.selectedColumn ?? 0,
        numColumns - 1,
      );

      // ── Contribution-linked budget amounts ──
      // Budget items linked to a contribution account (via
      // contributionAccountId) use the contribution's monthly amount
      // directly — no fill-in heuristics — under the (Contribution, Salary)
      // pair the page shows: its own local selection (What-If), else the
      // active profiles. A budget column is a spending level, so the pair is
      // the same for every column (and matches use-budget-derived-data.ts).
      const profiles: ProfilePair = {
        contribProfileId: await profileFromTiers(
          ctx.db,
          input?.contributionProfile,
          "contribProfileId",
        ),
        salaryProfileId: await profileFromTiers(
          ctx.db,
          input?.salaryProfile,
          "salaryProfileId",
        ),
      };
      // Resolved through the SAME helper listProfiles uses above
      // (resolveLinkedBudgetItemAmounts) — this procedure used to maintain
      // its own independent copy of this exact resolution (the only
      // difference being What-If sandbox support), which the helper now
      // accepts directly, so a linked item's $ figure can never drift
      // between the two call sites.
      const resolvedItemsById = new Map(
        (
          await resolveLinkedBudgetItemAmounts(
            ctx.db,
            items,
            numColumns,
            profiles,
            {
              sandboxContribActiveFields: input?.sandboxContribActiveFields,
              sandboxSalaryEntries: input?.sandboxSalaryEntries,
            },
          )
        ).map((r) => [r.id, r]),
      );

      // For linked items, the contribution's monthly amount (the same in
      // every column) replaces the column's DB amount. For unlinked items, use DB amounts
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
        const resolved = resolvedItemsById.get(i.id)!;
        if (!i.contributionAccountId)
          return {
            ...i,
            amounts: applyItemActiveFields(i.id, resolved.amounts),
            contribAmounts: null as number[] | null,
            contribAmount: null as number | null,
          };
        const contribAmounts = resolved.amounts;
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
          /** Contribution $ per column — computed once from the active
           *  profiles, the same in every column. Null for unlinked items. */
          contribAmounts: linked?.contribAmounts ?? null,
          isEssential: i.isEssential,
          apiCategoryId: i.apiCategoryId,
          apiCategoryName: i.apiCategoryName,
          apiSyncDirection: i.apiSyncDirection,
          contributionAccountId: i.contributionAccountId,
          // Per-column reason a linked item's amount is $0 (one per column,
          // from the same active profiles). See classifyContribResolution.
          contribStatus: resolvedItemsById.get(i.id)?.contribStatus ?? null,
        };
      });

      const columnMonths = activeProfile.columnMonths ?? null;
      const weightedAnnualTotal = computeBudgetAnnualTotal(
        budgetItems.map((i) => ({ amounts: i.amounts })),
        selectedColumn,
        columnMonths,
      );

      // Monthly take-home under the (Contribution, Salary) pair in use,
      // honoring sandboxSalaryEntries — the same paycheck.computeSummary
      // call and the same netMonthlyTakeHome as listProfiles, so the What-If tab's "available income"
      // figure can't disagree with what Savings' Unspent shows for the same
      // inputs. Not derived from WhatIfPaycheckSummary's client-side annual
      // total, which uses a naive periodsPerYear multiplication that ignores
      // job.budgetPeriodsPerMonth.
      let netMonthlyIncome: number | null = null;
      try {
        const paycheckCallerForIncome = createCallerFactory(paycheckRouter)(
          internalCtx(ctx),
        );
        const incomePaycheckData = await paycheckCallerForIncome.computeSummary(
          {
            ...(profiles.contribProfileId != null
              ? {
                  contributionProfileId: profiles.contribProfileId,
                }
              : {}),
            ...(profiles.salaryProfileId != null
              ? { salaryProfileId: profiles.salaryProfileId }
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
        netMonthlyIncome = netMonthlyTakeHome(incomePaycheckData);
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
        /** Monthly take-home for the profile pair in use — see the
         *  computation above for why this must be read
         *  instead of re-deriving income client-side. */
        netMonthlyIncome,
        /** Sum of Budget-mode extra-paycheck adjustments landing in the
         *  REAL current calendar month — independent of selectedColumn, see
         *  computation above. A separate, additively-labeled figure; never
         *  folded into netMonthlyIncome or any What-If total. */
        budgetIncomeAdjustmentThisMonth,
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
      if (!item)
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

      // Linked items: the amount IS the budget amount from the user's
      // perspective, so budgetProcedure is intentionally allowed to write
      // through to the linked contribution account rather than the dead
      // budget_items.amounts field it would otherwise shadow. Writes into
      // whichever Contribution Profile is currently in effect for this
      // column — contributionValue/Method have no account-level fallback.
      if (item.contributionAccountId) {
        const accountId = item.contributionAccountId;
        // Read-resolve-write in one transaction (matches
        // patchProfileSubEntry's convention for the same class of
        // read-merge-write-a-JSON-blob operation) — a bare SELECT then
        // UPDATE with no transaction boundary at all, which this was
        // before, is strictly worse than that convention for no reason.
        await ctx.db.transaction(async (tx) => {
          const contribProfileId =
            await resolveEffectiveContribProfileIdForItem(
              tx,
              input.contributionProfile,
            );
          await applyContributionAccountEdit(
            tx,
            accountId,
            input.amount,
            contribProfileId,
            assertWithinIrsLimits,
          );
        });
        return item;
      }

      const amounts = budgetAmountsSchema.parse(item.amounts);
      if (input.colIndex < 0 || input.colIndex >= amounts.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Column index out of bounds",
        });
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
      if (byId.size === 0)
        return { ok: true, updated: 0, updatedItems: 0, skipped: [] };

      // One fetch, not one-per-item.
      const ids = Array.from(byId.keys());
      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(inArray(schema.budgetItems.id, ids));
      const itemById = new Map(items.map((it) => [it.id, it]));

      // Sort the batch into "apply" and "skip". A since-deleted item or an
      // out-of-range colIndex (stale client whose column count no longer
      // matches the server) is skipped, not fatal — but it's now reported
      // back in `skipped` instead of vanishing silently, so a caller can
      // surface "3 of 50 cells couldn't be saved". A non-finite amount is a
      // client bug, not stale state — belt-and-braces since `z.number()`
      // in the input schema already rejects NaN and plain JSON can't carry
      // Infinity, but kept for any direct server-side caller.
      type SkipReason = "deleted" | "column-out-of-range";
      const skipped: { id: number; colIndex: number; reason: SkipReason }[] =
        [];
      const toApply: {
        id: number;
        amounts: number[];
        changes: { colIndex: number; amount: number }[];
      }[] = [];
      for (const [id, changes] of byId) {
        const item = itemById.get(id);
        if (!item) {
          for (const c of changes)
            skipped.push({ id, colIndex: c.colIndex, reason: "deleted" });
          continue;
        }
        // `amounts` tracks the profile's column count for linked items too
        // (add/removeColumn rewrite every item's array), so it's a valid
        // bound for both — a linked item that escapes this check would
        // otherwise write a real amount into the globally-active
        // Contribution Profile via the tier fallback, unreported.
        const amounts = budgetAmountsSchema.parse(item.amounts);
        const valid = changes.filter((c) => {
          if (!Number.isFinite(c.amount)) {
            // Message is user-facing (surfaced by the global
            // MutationCache.onError toast) — no raw ids.
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One of the pasted amounts isn't a valid number.",
            });
          }
          if (c.colIndex < 0 || c.colIndex >= amounts.length) {
            skipped.push({
              id,
              colIndex: c.colIndex,
              reason: "column-out-of-range",
            });
            return false;
          }
          return true;
        });
        if (valid.length > 0) toApply.push({ id, amounts, changes: valid });
      }
      // Deterministic lock-acquisition order (by id) so two concurrent
      // pastes touching an overlapping set of items can't deadlock.
      toApply.sort((a, b) => a.id - b.id);

      // Apply atomically — either the whole applicable paste lands or none
      // of it does (a mid-loop failure must not leave half a paste saved).
      await ctx.db.transaction(async (tx) => {
        // Linked items are collected instead of applied inline so
        // applyContributionAccountEditsBatch can fold every edit landing
        // on the SAME contribution profile through one read-merge-write,
        // instead of running that cycle once per account.
        const contributionEdits: {
          contributionAccountId: number;
          monthlyAmount: number;
          contributionProfileId: number;
        }[] = [];

        for (const { id, amounts, changes } of toApply) {
          const item = itemById.get(id)!;

          // Linked items: write through to the contribution account instead
          // of the dead budget_items.amounts field (see updateItemAmount for
          // the permission-scope rationale). If a batch carries more than
          // one distinct amount for the same linked item, last one wins.
          if (item.contributionAccountId) {
            const lastChange = changes[changes.length - 1]!;
            const contribProfileId =
              await resolveEffectiveContribProfileIdForItem(
                tx,
                input.contributionProfile,
              );
            contributionEdits.push({
              contributionAccountId: item.contributionAccountId,
              monthlyAmount: lastChange.amount,
              contributionProfileId: contribProfileId,
            });
            continue;
          }

          for (const c of changes) amounts[c.colIndex] = c.amount;
          await tx
            .update(schema.budgetItems)
            .set({ amounts })
            .where(eq(schema.budgetItems.id, id));
        }

        await applyContributionAccountEditsBatch(
          tx,
          contributionEdits,
          assertWithinIrsLimits,
        );
      });
      const appliedCells = toApply.reduce((n, t) => n + t.changes.length, 0);
      return {
        ok: true,
        updated: appliedCells,
        updatedItems: toApply.length,
        skipped,
      };
    }),

  /** Add a new column (budget mode) to the target profile (active if not given). */
  addColumn: budgetProcedure
    .input(
      z.object({ label: z.string().min(1), profileId: z.number().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await resolveTargetBudgetProfile(ctx.db, input.profileId);
      if (!profile)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active profile",
        });

      const newLabels = columnLabelsSchema.parse([
        ...profile.columnLabels,
        input.label,
      ]);
      const newMonths = profile.columnMonths
        ? columnMonthsSchema.parse([...(profile.columnMonths as number[]), 0])
        : null;
      // Atomic: the new column must land on the profile AND on every item's
      // amounts array together, or the budget is left ragged.
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.budgetProfiles)
          .set({
            columnLabels: newLabels,
            columnMonths: newMonths,
          })
          .where(eq(schema.budgetProfiles.id, profile.id));

        // Add a 0 to each item's amounts array
        const items = await tx
          .select()
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, profile.id));
        for (const item of items) {
          const amounts = budgetAmountsSchema.parse([
            ...(item.amounts as number[]),
            0,
          ]);
          await tx
            .update(schema.budgetItems)
            .set({ amounts })
            .where(eq(schema.budgetItems.id, item.id));
        }
      });
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
      if (!profile)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active profile",
        });
      const colCheck = canRemoveColumn(
        profile.columnLabels.length,
        input.colIndex,
      );
      if (!colCheck.allowed)
        throw new TRPCError({ code: "BAD_REQUEST", message: colCheck.reason });

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
      // Atomic: drop the column from the profile AND from every item's
      // amounts array together (see addColumn).
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(schema.budgetProfiles)
          .set({
            columnLabels: newLabels,
            columnMonths: newMonths,
          })
          .where(eq(schema.budgetProfiles.id, profile.id));

        // Remove the column from each item's amounts array
        const items = await tx
          .select()
          .from(schema.budgetItems)
          .where(eq(schema.budgetItems.profileId, profile.id));
        for (const item of items) {
          const amounts = budgetAmountsSchema.parse(
            (item.amounts as number[]).filter(
              (_: number, i: number) => i !== input.colIndex,
            ),
          );
          await tx
            .update(schema.budgetItems)
            .set({ amounts })
            .where(eq(schema.budgetItems.id, item.id));
        }
      });
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
      if (!profile)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active profile",
        });

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
      if (!profile)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active profile",
        });

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
      await ctx.db.transaction((tx) => renumberItems(tx, blocks));
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
      if (!target)
        throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });

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
      await ctx.db.transaction((tx) => renumberItems(tx, blocks));
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
      if (!profile)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active profile",
        });

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
      if (!profile)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active profile",
        });
      if (input.colIndex >= profile.columnLabels.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid column index",
        });

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
      if (!profile)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No active profile",
        });

      if (input.columnMonths) {
        if (input.columnMonths.length !== profile.columnLabels.length) {
          log("warn", "budget_column_mismatch", {
            field: "columnMonths",
            expected: profile.columnLabels.length,
            got: input.columnMonths.length,
          });
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This budget's columns changed — reload and try again.",
          });
        }
        const sum = input.columnMonths.reduce((s, m) => s + m, 0);
        if (sum !== 12) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Column months must sum to 12 (got ${sum}) — the weighted annual total assumes a full year.`,
          });
        }
      }

      await ctx.db
        .update(schema.budgetProfiles)
        .set({ columnMonths: input.columnMonths })
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
      // This account's own ownership (individual + personId) must win over
      // the linked performance account's own ownershipType — a shared,
      // jointly-tracked master (e.g. one Vanguard IRA both spouses
      // contribute to separately) has ownershipType "joint", but each
      // contribution_accounts row under it has its own real owner. Letting
      // the master's "joint" win here made every such row render with the
      // identical generic "Joint ..." label, with no way to tell which
      // unlinked row belonged to which person when picking a budget item
      // to link it to. See portfolioAccountLabel's identical precedence
      // rule for the analogous portfolio-snapshot-row case.
      const ownerPersonId = c.ownership === "individual" ? c.personId : null;
      // Always pass a perf-shaped object, even with no linked performance
      // account — falling back to `undefined` here would drop this
      // account's own ownership (c.ownership) entirely, since
      // portfolioAccountLabel's internal fallback only ever consults
      // perf.ownershipType, never the caller's own row. A joint
      // contribution account with no performance account linked yet (the
      // normal pre-linking state) would silently lose its "Joint" prefix.
      const label = portfolioAccountLabel(
        {
          accountType: c.accountType,
          subType: c.subType,
          label: c.label,
          institution: perf?.institution ?? "",
        },
        perf
          ? {
              displayName: perf.displayName,
              accountLabel: perf.accountLabel,
              ownershipType: perf.ownershipType,
            }
          : {
              displayName: null,
              accountLabel: null,
              ownershipType: c.ownership,
            },
        ownerPersonId,
        personMap,
      );
      // Two of one person's own accounts (e.g. a Roth and a Traditional
      // IRA) commonly share the same owner + institution + account type,
      // so the label above alone doesn't distinguish them — always append
      // tax treatment here rather than only on a detected collision, since
      // a collision-only rule fails silently the moment a third account
      // shares the same three fields. Matches how the Portfolio page
      // always shows tax treatment as its own separate label, never
      // conditionally.
      const taxLabel = TAX_TREATMENT_LABELS[c.taxTreatment] ?? c.taxTreatment;
      return {
        id: c.id,
        accountType: c.accountType,
        displayLabel: `${label} — ${taxLabel}`,
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
        service: budgetApiServiceSchema,
        apiCategoryId: z.string().min(1),
        apiCategoryName: z.string().min(1),
        syncDirection: z.enum(["pull", "push", "both"]).default("pull"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setBudgetItemLink(ctx.db, {
        budgetItemId: input.budgetItemId,
        service: input.service,
        categoryId: input.apiCategoryId,
        categoryName: input.apiCategoryName,
        syncDirection: input.syncDirection,
        lastSyncedAt: null,
      });
      return { ok: true };
    }),

  /** Remove API link from a budget item. */
  unlinkFromApi: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        service: budgetApiServiceSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await deleteBudgetItemLink(ctx.db, {
        budgetItemId: input.budgetItemId,
        service: input.service,
      });
      return { ok: true };
    }),

  /** Change sync direction on a linked budget item. */
  setSyncDirection: budgetProcedure
    .input(
      z.object({
        budgetItemId: z.number(),
        service: budgetApiServiceSchema,
        syncDirection: z.enum(["pull", "push", "both"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const links = await loadBudgetItemLinks(
        ctx.db,
        [input.budgetItemId],
        input.service,
      );
      const existing = links.get(input.budgetItemId);
      if (!existing) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Budget item is not linked to this service",
        });
      }
      await setBudgetItemLink(ctx.db, {
        budgetItemId: input.budgetItemId,
        service: input.service,
        categoryId: existing.categoryId,
        categoryName: existing.categoryName,
        syncDirection: input.syncDirection,
        lastSyncedAt: existing.lastSyncedAt,
      });
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
      const currentMonth = currentMonthKey(now);
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

      const itemRows = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const itemLinks = await loadBudgetItemLinks(
        ctx.db,
        itemRows.map((i) => i.id),
        active,
      );
      const items = itemRows.map((i) => {
        const link = itemLinks.get(i.id);
        return {
          ...i,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
          apiSyncDirection: link?.syncDirection ?? "pull",
        };
      });

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
          .set({ amounts })
          .where(eq(schema.budgetItems.id, item.id));
        await setBudgetItemLink(ctx.db, {
          budgetItemId: item.id,
          service: active,
          categoryId: item.apiCategoryId,
          categoryName: item.apiCategoryName,
          syncDirection: item.apiSyncDirection,
          lastSyncedAt: new Date(),
        });
        updated++;
      }

      return { updated };
    }),

  /** Push budget amounts to API for all linked items (Ledgr -> API). */
  syncBudgetToApi: budgetProcedure
    .input(z.object({}).optional())
    .mutation(async ({ ctx }) => {
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
        .select({
          linkedProfileId: schema.apiConnections.linkedProfileId,
          linkedColumnIndex: schema.apiConnections.linkedColumnIndex,
        })
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
      // Same connection-configured column getPreview derives its
      // `ledgrAmount` from (src/server/routers/sync/core.ts) — pushing a
      // different, client-supplied column would push a number the preview
      // never showed the user.
      const colIdx = conn?.linkedColumnIndex ?? 0;

      const pushItemRows = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const pushItemLinks = await loadBudgetItemLinks(
        ctx.db,
        pushItemRows.map((i) => i.id),
        active,
      );
      const items = pushItemRows.map((i) => {
        const link = pushItemLinks.get(i.id);
        return {
          ...i,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
          apiSyncDirection: link?.syncDirection ?? "pull",
        };
      });

      const numColumns = (profile.columnLabels as string[]).length;
      const activeProfiles = await resolveActiveProfilePair(ctx.db);
      // Contribution-linked items freeze `amounts` on edit (see
      // resolveLinkedBudgetItemAmounts docblock) — pushing raw `amounts`
      // would push the stale value instead of the profile's live one.
      const resolvedItems = await resolveLinkedBudgetItemAmounts(
        ctx.db,
        items,
        numColumns,
        activeProfiles,
      );

      let pushed = 0;
      // Counted separately from a hard failure below — the provider
      // COULDN'T perform this specific write, either because it has no API
      // for the operation at all ("unsupported") or because the target
      // already has incompatible state that can't be safely merged into
      // ("conflict" — see ActualClient.updateCategoryGoalTarget /
      // actual-goal-notes.ts). Caught per-item (not left to abort the whole
      // loop) so one such item can't hide whether OTHER items pushed, and
      // so the caller can tell "nothing to push" apart from "this item
      // couldn't be pushed".
      let skippedUnsupported = 0;
      for (const item of resolvedItems) {
        if (!item.apiCategoryId) continue;
        if (
          item.apiSyncDirection !== "push" &&
          item.apiSyncDirection !== "both"
        )
          continue;

        const amount = item.amounts[Math.min(colIdx, numColumns - 1)] ?? 0;

        // Push as YNAB goal target (plan-level, not month-specific)
        try {
          await client.updateCategoryGoalTarget(item.apiCategoryId, amount);
        } catch (err) {
          if (
            err instanceof BudgetApiError &&
            (err.code === "unsupported" || err.code === "conflict")
          ) {
            skippedUnsupported++;
            continue;
          }
          throw err;
        }
        await setBudgetItemLink(ctx.db, {
          budgetItemId: item.id,
          service: active,
          categoryId: item.apiCategoryId,
          categoryName: item.apiCategoryName,
          syncDirection: item.apiSyncDirection,
          lastSyncedAt: new Date(),
        });
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

      return { pushed, skippedUnsupported, service: active };
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
      const currentMonth = currentMonthKey(now);
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

      const actualsItemRows = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const actualsItemLinks = await loadBudgetItemLinks(
        ctx.db,
        actualsItemRows.map((i) => i.id),
        active,
      );
      const items = actualsItemRows.map((i) => {
        const link = actualsItemLinks.get(i.id);
        return {
          ...i,
          apiCategoryId: link?.categoryId ?? null,
          apiCategoryName: link?.categoryName ?? null,
        };
      });

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
