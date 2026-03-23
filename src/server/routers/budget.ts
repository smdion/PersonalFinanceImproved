/** Budget router for multi-profile budget management including category items, column tiers, contribution profile linking, and budget API integration. */
import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure, budgetProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  columnLabelsSchema,
  columnMonthsSchema,
  columnContributionProfileIdsSchema,
  budgetAmountsSchema,
} from "@/lib/db/json-schemas";
import { calculateBudget } from "@/lib/calculators/budget";
import type { BudgetInput } from "@/lib/calculators/types";
import {
  computeBudgetAnnualTotal,
  num,
  getPeriodsPerYear,
  getEffectiveIncome,
  getCurrentSalary,
  computeAnnualContribution,
  loadAndApplyContribProfile,
} from "@/server/helpers";
import { accountDisplayName } from "@/lib/utils/format";
import {
  getActiveBudgetApi,
  getClientForService,
  cacheGet,
} from "@/lib/budget-api";
import type { BudgetCategoryGroup, BudgetMonthDetail } from "@/lib/budget-api";
import { YNAB_INTERNAL_GROUPS } from "@/lib/budget-api";

export const budgetRouter = createTRPCRouter({
  /** List all budget profiles with summary totals (for profile sidebar). */
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
    const allItems = await ctx.db.select().from(schema.budgetItems);
    return profiles.map((p) => {
      const items = allItems.filter((i) => i.profileId === p.id);
      const labels = (p.columnLabels as string[]) ?? [];
      const months = (p.columnMonths as number[] | null) ?? null;
      const colTotals = labels.map((_: string, ci: number) =>
        items.reduce(
          (sum, item) => sum + ((item.amounts as number[])[ci] ?? 0),
          0,
        ),
      );
      // Annual: weighted if months set, otherwise column 0 * 12
      const annualTotal = months
        ? colTotals.reduce((sum, t, i) => sum + t * (months[i] ?? 0), 0)
        : (colTotals[0] ?? 0) * 12;
      return { ...p, annualTotal, columnCount: labels.length };
    });
  }),

  /** Create a new budget profile, pre-populated with standard template categories. */
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

      return profile;
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
      if (profile.isActive) throw new Error("Cannot delete the active profile");

      // Delete associated items first
      await ctx.db
        .delete(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, input.id));
      await ctx.db
        .delete(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.id, input.id));
      return { ok: true };
    }),

  /** Set a profile as the active one (deactivate all others). */
  setActiveProfile: budgetProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      // Deactivate all
      await ctx.db.update(schema.budgetProfiles).set({ isActive: false });
      // Activate the selected one
      await ctx.db
        .update(schema.budgetProfiles)
        .set({ isActive: true })
        .where(eq(schema.budgetProfiles.id, input.id));
      return { ok: true };
    }),

  /** Returns the active budget profile's calculator result for a given column. */
  getActiveSummary: protectedProcedure
    .input(
      z
        .object({
          selectedColumn: z.number().optional(),
          profileId: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      let activeProfile;
      if (input?.profileId) {
        const rows = await ctx.db
          .select()
          .from(schema.budgetProfiles)
          .where(eq(schema.budgetProfiles.id, input.profileId));
        activeProfile = rows[0];
      } else {
        const rows = await ctx.db
          .select()
          .from(schema.budgetProfiles)
          .where(eq(schema.budgetProfiles.isActive, true));
        activeProfile = rows[0];
      }
      if (!activeProfile) {
        return { profile: null, result: null, columnLabels: [] as string[] };
      }

      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, activeProfile.id))
        .orderBy(asc(schema.budgetItems.sortOrder));

      const columnLabels = activeProfile.columnLabels;
      const selectedColumn = Math.min(
        input?.selectedColumn ?? 0,
        columnLabels.length - 1,
      );

      // ── Contribution-linked budget amounts ──
      // Budget items linked to a contribution account (via contributionAccountId)
      // use the contribution's monthly amount directly — no fill-in heuristics.
      // Respects the active contribution profile (column-specific or global).

      const rawContribs = await ctx.db
        .select()
        .from(schema.contributionAccounts)
        .where(eq(schema.contributionAccounts.isActive, true));
      const allJobs = await ctx.db.select().from(schema.jobs);

      // Determine contribution profile for the selected column
      const columnContribProfileIds =
        activeProfile.columnContributionProfileIds as (number | null)[] | null;
      const contribProfileId =
        columnContribProfileIds?.[selectedColumn] ?? null;

      // Apply contribution profile overrides (salary + contribution values)
      const profileResult = await loadAndApplyContribProfile(
        ctx.db,
        contribProfileId,
        rawContribs,
        allJobs,
        new Map(),
      );
      const activeContribs = profileResult.contribs;
      const effectiveJobs = profileResult.jobs;

      // Compute monthly amount for each linked contribution account
      const contribMonthlyById = new Map<number, number>();
      const linkedContribIds = new Set(
        items
          .filter((i) => i.contributionAccountId)
          .map((i) => i.contributionAccountId!),
      );

      if (linkedContribIds.size > 0) {
        const activeJobs = effectiveJobs.filter((j) => !j.endDate);
        const defaultPeriodsPerYear =
          activeJobs.length > 0
            ? getPeriodsPerYear(activeJobs[0]!.payPeriod)
            : 26;

        const salaryByJobId = new Map<number, number>();
        for (const j of activeJobs) {
          const overrideSalary = profileResult.salaryMap.get(j.personId);
          const salary =
            overrideSalary ??
            (await getCurrentSalary(ctx.db, j.id, j.annualSalary, new Date()));
          salaryByJobId.set(j.id, getEffectiveIncome(j, salary));
        }

        for (const c of activeContribs) {
          if (!linkedContribIds.has(c.id)) continue;
          const val = num(c.contributionValue);
          const jobPeriodsPerYear = c.jobId
            ? getPeriodsPerYear(
                activeJobs.find((j) => j.id === c.jobId)?.payPeriod ??
                  "biweekly",
              )
            : defaultPeriodsPerYear;
          const salary = c.jobId ? (salaryByJobId.get(c.jobId) ?? 0) : 0;
          const annual = computeAnnualContribution(
            c.contributionMethod,
            val,
            salary,
            jobPeriodsPerYear,
          );
          contribMonthlyById.set(c.id, annual / 12);
        }
      }

      // For linked items, the contribution's monthly amount replaces the DB amounts.
      // For unlinked items, use DB amounts as-is.
      const budgetItems = items.map((i) => {
        const dbAmounts = i.amounts as number[];
        if (!i.contributionAccountId)
          return {
            ...i,
            amounts: dbAmounts,
            contribAmount: null as number | null,
          };
        const monthly = contribMonthlyById.get(i.contributionAccountId) ?? 0;
        return {
          ...i,
          amounts: dbAmounts.map(() => monthly),
          contribAmount: monthly,
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
          isEssential: i.isEssential,
          apiCategoryId: i.apiCategoryId,
          apiCategoryName: i.apiCategoryName,
          apiSyncDirection: i.apiSyncDirection,
          contributionAccountId: i.contributionAccountId,
        };
      });

      const columnMonths = activeProfile.columnMonths ?? null;
      const weightedAnnualTotal = computeBudgetAnnualTotal(
        budgetItems.map((i) => ({ amounts: i.amounts })),
        selectedColumn,
        columnMonths,
      );

      return {
        profile: activeProfile,
        result,
        columnLabels,
        allColumnResults,
        rawItems,
        columnMonths,
        weightedAnnualTotal,
      };
    }),

  /** Update a single amount cell for a budget item. */
  updateItemAmount: budgetProcedure
    .input(
      z.object({
        id: z.number().int(),
        colIndex: z.number().int(),
        amount: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.id))
        .then((r) => r[0]);
      if (!item) throw new Error("Item not found");
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

  /** Add a new column (budget mode) to the active profile. */
  addColumn: budgetProcedure
    .input(z.object({ label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      const profile = profiles[0];
      if (!profile) throw new Error("No active profile");

      const newLabels = columnLabelsSchema.parse([...profile.columnLabels, input.label]);
      const newMonths = profile.columnMonths
        ? columnMonthsSchema.parse([...(profile.columnMonths as number[]), 0])
        : null;
      const newContribIds = profile.columnContributionProfileIds
        ? columnContributionProfileIdsSchema.parse([...(profile.columnContributionProfileIds as (number | null)[]), null])
        : null;
      await ctx.db
        .update(schema.budgetProfiles)
        .set({
          columnLabels: newLabels,
          columnMonths: newMonths,
          columnContributionProfileIds: newContribIds,
        })
        .where(eq(schema.budgetProfiles.id, profile.id));

      // Add a 0 to each item's amounts array
      const items = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      for (const item of items) {
        const amounts = budgetAmountsSchema.parse([...(item.amounts as number[]), 0]);
        await ctx.db
          .update(schema.budgetItems)
          .set({ amounts })
          .where(eq(schema.budgetItems.id, item.id));
      }
      return { ok: true };
    }),

  /** Remove a column (budget mode) from the active profile. */
  removeColumn: budgetProcedure
    .input(z.object({ colIndex: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      const profile = profiles[0];
      if (!profile) throw new Error("No active profile");
      if (profile.columnLabels.length <= 1)
        throw new Error("Cannot remove the last column");
      if (input.colIndex >= profile.columnLabels.length)
        throw new Error("Invalid column index");

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
      await ctx.db
        .update(schema.budgetProfiles)
        .set({
          columnLabels: newLabels,
          columnMonths: newMonths,
          columnContributionProfileIds: newContribIds,
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      const profile = profiles[0];
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      const profile = profiles[0];
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      const profile = profiles[0];
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
    .input(z.object({ columnMonths: columnMonthsSchema }))
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      const profile = profiles[0];
      if (!profile) throw new Error("No active profile");

      if (input.columnMonths) {
        if (input.columnMonths.length !== profile.columnLabels.length) {
          throw new Error("columnMonths length must match columnLabels length");
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      const profile = profiles[0];
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
      // Only show owner name for individual accounts, not joint
      const ownerName =
        c.ownership === "individual" ? personMap.get(c.personId) : undefined;
      const label = accountDisplayName(
        {
          accountType: c.accountType,
          subType: c.subType,
          label: c.label,
          displayName: perf?.displayName,
          accountLabel: perf?.accountLabel,
          institution: perf?.institution,
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

      return { pushed };
    }),

  /** Get API actuals for linked budget items (activity + balance from cached month data). */
  listApiActuals: protectedProcedure.query(async ({ ctx }) => {
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

    const profiles = await ctx.db
      .select()
      .from(schema.budgetProfiles)
      .where(eq(schema.budgetProfiles.isActive, true));
    const profile = profiles[0];
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
