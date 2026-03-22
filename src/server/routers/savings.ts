import { eq, asc, sql, lt } from "drizzle-orm";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  savingsProcedure,
} from "../trpc";
import * as schema from "@/lib/db/schema";
import { calculateSavings } from "@/lib/calculators/savings";
import { calculateEFund } from "@/lib/calculators/efund";
import { num, computeBudgetAnnualTotal } from "@/server/helpers";
import type { SavingsInput, EFundInput } from "@/lib/calculators/types";
import {
  getActiveBudgetApi,
  getBudgetAPIClient,
  cacheGet,
} from "@/lib/budget-api";
import type { BudgetCategoryGroup } from "@/lib/budget-api";

/** Sum essential budget items for a given tier/column, returning monthly. */
function getEssentialExpenses(
  budgetItems: { profileId: number; isEssential: boolean; amounts: number[] }[],
  profileId: number,
  tierIndex: number,
  columnMonths: number[] | null,
): number {
  const essentials = budgetItems.filter(
    (i) => i.profileId === profileId && i.isEssential,
  );
  const annualTotal = computeBudgetAnnualTotal(
    essentials,
    tierIndex,
    columnMonths,
  );
  return annualTotal / 12;
}

const plannedTransactionInput = z.object({
  goalId: z.number().int(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.string().refine((v) => !isNaN(Number(v)) && v.trim() !== "", {
    message: "Must be a valid number",
  }), // positive = deposit, negative = withdrawal
  description: z.string().min(1),
  isRecurring: z.boolean().default(false),
  recurrenceMonths: z.number().int().nullable().optional(),
});

export const savingsRouter = createTRPCRouter({
  getSummary: protectedProcedure
    .input(z.object({ budgetTierOverride: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const [
        goals,
        selfLoans,
        budgetProfiles,
        budgetItems,
        plannedTransactions,
        allocationOverrides,
        appSettings,
      ] = await Promise.all([
        ctx.db
          .select()
          .from(schema.savingsGoals)
          .orderBy(asc(schema.savingsGoals.priority)),
        ctx.db
          .select()
          .from(schema.selfLoans)
          .where(lt(schema.selfLoans.repaidAmount, schema.selfLoans.amount)),
        ctx.db
          .select()
          .from(schema.budgetProfiles)
          .where(eq(schema.budgetProfiles.isActive, true)),
        ctx.db.select().from(schema.budgetItems),
        ctx.db
          .select()
          .from(schema.savingsPlannedTransactions)
          .orderBy(asc(schema.savingsPlannedTransactions.transactionDate)),
        ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .orderBy(asc(schema.savingsAllocationOverrides.monthDate)),
        ctx.db.select().from(schema.appSettings),
      ]);

      // Get latest balance for each active goal from savings_monthly (single query)
      const activeGoals = goals.filter((g) => g.isActive);
      const activeGoalIds = activeGoals.map((g) => g.id);

      const balanceMap = new Map<number, number>();
      if (activeGoalIds.length > 0) {
        const { isPostgres } = await import("@/lib/db/dialect");
        const inList = sql.join(
          activeGoalIds.map((id) => sql`${id}`),
          sql`, `,
        );
        const latestBalances = isPostgres()
          ? await ctx.db.execute(sql`
              SELECT DISTINCT ON (goal_id) goal_id, balance
              FROM savings_monthly
              WHERE goal_id IN (${inList})
              ORDER BY goal_id, month_date DESC
            `)
          : await ctx.db.execute(sql`
              SELECT goal_id, balance FROM savings_monthly t1
              WHERE month_date = (
                SELECT MAX(t2.month_date) FROM savings_monthly t2
                WHERE t2.goal_id = t1.goal_id
              )
              AND goal_id IN (${inList})
            `);
        for (const row of latestBalances.rows) {
          balanceMap.set(row.goal_id as number, num(row.balance as string));
        }
      }

      // Budget profile info for tier selection
      const activeProfile = budgetProfiles[0];
      const budgetTierLabels = activeProfile?.columnLabels ?? [];

      // Read shared budget_active_column from app_settings
      const settingsMap = new Map(
        appSettings.map((s: { key: string; value: unknown }) => [
          s.key,
          s.value,
        ]),
      );
      const budgetActiveColumn =
        typeof settingsMap.get("budget_active_column") === "number"
          ? (settingsMap.get("budget_active_column") as number)
          : 0;

      // E-Fund uses its own budget tier setting; falls back to shared budget column
      const efundGoal = activeGoals.find((g) => g.isEmergencyFund);
      const efundSavedColumn =
        typeof settingsMap.get("efund_budget_column") === "number"
          ? (settingsMap.get("efund_budget_column") as number)
          : null;
      const efundTierIndex =
        input?.budgetTierOverride ?? efundSavedColumn ?? budgetActiveColumn;

      // Essential expenses for e-fund tier
      let essentialMonthlyExpenses = 0;
      if (activeProfile) {
        essentialMonthlyExpenses = getEssentialExpenses(
          budgetItems as {
            profileId: number;
            isEssential: boolean;
            amounts: number[];
          }[],
          activeProfile.id,
          efundTierIndex,
          activeProfile.columnMonths ?? null,
        );
      }

      // E-Fund calculator (compute before savings so e-fund target flows into projections)
      let efundResult = null;

      if (efundGoal) {
        const outstandingLoans = selfLoans
          .filter((l) => l.fromGoalId === efundGoal.id)
          .reduce((s, l) => s + (num(l.amount) - num(l.repaidAmount)), 0);

        const efundInput: EFundInput = {
          emergencyFundBalance: balanceMap.get(efundGoal.id) ?? 0,
          outstandingSelfLoans: outstandingLoans,
          essentialMonthlyExpenses,
          targetMonths: efundGoal.targetMonths ?? 4,
          asOfDate: new Date(),
        };
        efundResult = calculateEFund(efundInput);
      }

      // Calculate total monthly contributions for the pool
      const totalMonthlyPool = activeGoals.reduce(
        (s, g) => s + num(g.monthlyContribution),
        0,
      );

      const savingsInput: SavingsInput = {
        goals: activeGoals.map((g) => {
          const monthlyContrib = num(g.monthlyContribution);
          // E-fund target is derived from calculator (targetMonths × essential expenses)
          const targetBalance =
            g.isEmergencyFund && efundResult
              ? efundResult.targetAmount
              : num(g.targetAmount);
          return {
            id: g.id,
            name: g.name,
            currentBalance: balanceMap.get(g.id) ?? 0,
            targetBalance,
            allocationPercent:
              totalMonthlyPool > 0 ? monthlyContrib / totalMonthlyPool : 0,
            isEmergencyFund: g.isEmergencyFund,
            isActive: g.isActive,
          };
        }),
        monthlySavingsPool: totalMonthlyPool,
        essentialMonthlyExpenses,
        asOfDate: new Date(),
      };

      const savingsResult = calculateSavings(savingsInput);

      // Transform planned transactions for the client
      const plannedTx = plannedTransactions.map((t) => ({
        id: t.id,
        goalId: t.goalId,
        transactionDate: t.transactionDate,
        amount: num(t.amount),
        description: t.description,
        isRecurring: t.isRecurring,
        recurrenceMonths: t.recurrenceMonths,
        transferPairId: t.transferPairId,
      }));

      // Transform allocation overrides for the client
      const overrides = allocationOverrides.map((o) => ({
        id: o.id,
        goalId: o.goalId,
        monthDate: o.monthDate,
        amount: num(o.amount),
      }));

      return {
        savings: savingsResult,
        efund: efundResult,
        goals,
        budgetTierLabels,
        efundTierIndex,
        plannedTransactions: plannedTx,
        allocationOverrides: overrides,
      };
    }),

  // ══ PLANNED TRANSACTIONS ══
  plannedTransactions: createTRPCRouter({
    create: savingsProcedure
      .input(plannedTransactionInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.savingsPlannedTransactions)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: savingsProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(plannedTransactionInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.savingsPlannedTransactions)
          .set(data)
          .where(eq(schema.savingsPlannedTransactions.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: savingsProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.savingsPlannedTransactions)
          .where(eq(schema.savingsPlannedTransactions.id, input.id)),
      ),
  }),

  // ══ ALLOCATION OVERRIDES ══
  allocationOverrides: createTRPCRouter({
    upsert: savingsProcedure
      .input(
        z.object({
          goalId: z.number().int(),
          monthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          amount: z.number(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Upsert: insert or update on conflict
        const existing = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId))
          .then((rows) => rows.find((r) => r.monthDate === input.monthDate));

        if (existing) {
          return ctx.db
            .update(schema.savingsAllocationOverrides)
            .set({ amount: String(input.amount) })
            .where(eq(schema.savingsAllocationOverrides.id, existing.id))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.savingsAllocationOverrides)
          .values({
            goalId: input.goalId,
            monthDate: input.monthDate,
            amount: String(input.amount),
          })
          .returning()
          .then((r) => r[0]);
      }),
    delete: savingsProcedure
      .input(z.object({ goalId: z.number().int(), monthDate: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId));
        const target = rows.find((r) => r.monthDate === input.monthDate);
        if (target) {
          await ctx.db
            .delete(schema.savingsAllocationOverrides)
            .where(eq(schema.savingsAllocationOverrides.id, target.id));
        }
        return { ok: true };
      }),
    /** Delete all overrides for ALL goals in one or more months. */
    deleteMonth: savingsProcedure
      .input(
        z.object({
          monthDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (input.monthDates.length === 0) return { ok: true };
        const monthSet = new Set(input.monthDates);
        const allOverrides = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides);
        const toDelete = allOverrides.filter((r) => monthSet.has(r.monthDate));
        for (const row of toDelete) {
          await ctx.db
            .delete(schema.savingsAllocationOverrides)
            .where(eq(schema.savingsAllocationOverrides.id, row.id));
        }
        return { ok: true };
      }),

    /** Atomically upsert overrides for ALL goals in a single month (pool-constrained). */
    upsertMonth: savingsProcedure
      .input(
        z.object({
          monthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          allocations: z.array(
            z.object({
              goalId: z.number().int(),
              amount: z.number().min(0),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Delete all existing overrides for this month across all goals
        const existing = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .then((rows) => rows.filter((r) => r.monthDate === input.monthDate));

        for (const row of existing) {
          await ctx.db
            .delete(schema.savingsAllocationOverrides)
            .where(eq(schema.savingsAllocationOverrides.id, row.id));
        }

        // Insert new overrides (skip if amount matches default — caller handles that)
        for (const alloc of input.allocations) {
          await ctx.db.insert(schema.savingsAllocationOverrides).values({
            goalId: alloc.goalId,
            monthDate: input.monthDate,
            amount: String(alloc.amount),
          });
        }
        return { ok: true };
      }),

    /** Atomically upsert overrides for ALL goals across a month range (fill-forward). */
    upsertMonthRange: savingsProcedure
      .input(
        z.object({
          startMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          endMonth: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          monthDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
          allocations: z.array(
            z.object({
              goalId: z.number().int(),
              amount: z.number().min(0),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const targetMonths = input.monthDates.filter(
          (md) =>
            md >= input.startMonth &&
            (input.endMonth === null || md <= input.endMonth),
        );

        for (const monthDate of targetMonths) {
          // Delete existing overrides for this month
          const existing = await ctx.db
            .select()
            .from(schema.savingsAllocationOverrides)
            .then((rows) => rows.filter((r) => r.monthDate === monthDate));

          for (const row of existing) {
            await ctx.db
              .delete(schema.savingsAllocationOverrides)
              .where(eq(schema.savingsAllocationOverrides.id, row.id));
          }

          // Insert new overrides
          for (const alloc of input.allocations) {
            await ctx.db.insert(schema.savingsAllocationOverrides).values({
              goalId: alloc.goalId,
              monthDate,
              amount: String(alloc.amount),
            });
          }
        }
        return { ok: true };
      }),

    /** Batch upsert overrides for a single goal (fill-down, change-all-after). */
    batchUpsert: savingsProcedure
      .input(
        z.object({
          goalId: z.number().int(),
          overrides: z.array(
            z.object({
              monthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              amount: z.number(),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.savingsAllocationOverrides)
          .where(eq(schema.savingsAllocationOverrides.goalId, input.goalId));
        const existingByDate = new Map(existing.map((r) => [r.monthDate, r]));

        for (const o of input.overrides) {
          const row = existingByDate.get(o.monthDate);
          if (row) {
            await ctx.db
              .update(schema.savingsAllocationOverrides)
              .set({ amount: String(o.amount) })
              .where(eq(schema.savingsAllocationOverrides.id, row.id));
          } else {
            await ctx.db.insert(schema.savingsAllocationOverrides).values({
              goalId: input.goalId,
              monthDate: o.monthDate,
              amount: String(o.amount),
            });
          }
        }
        return { ok: true };
      }),
  }),

  // ══ API CATEGORY SYNC ══

  /** Link a savings goal to a budget API category. */
  linkGoalToApi: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        apiCategoryId: z.string().min(1),
        apiCategoryName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.savingsGoals)
        .set({
          apiCategoryId: input.apiCategoryId,
          apiCategoryName: input.apiCategoryName,
          apiSyncEnabled: true,
        })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true };
    }),

  /** Unlink a savings goal from a budget API category. */
  unlinkGoalFromApi: savingsProcedure
    .input(z.object({ goalId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.savingsGoals)
        .set({
          apiCategoryId: null,
          apiCategoryName: null,
          apiSyncEnabled: false,
        })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true };
    }),

  // ══ CONVERSION: BUDGET ITEM ↔ SAVINGS GOAL ══

  /** Convert a budget item into a savings goal, transferring the API category link. */
  convertBudgetItemToGoal: savingsProcedure
    .input(
      z.object({
        budgetItemId: z.number().int(),
        goalName: z.string().min(1),
        monthlyContribution: z.string().default("0"),
        targetAmount: z.string().nullable().optional(),
        targetMode: z.enum(["fixed", "ongoing"]).default("ongoing"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch the budget item
      const [item] = await ctx.db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));
      if (!item)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Budget item not found",
        });

      // Create the savings goal with the API link transferred
      const [goal] = await ctx.db
        .insert(schema.savingsGoals)
        .values({
          name: input.goalName,
          monthlyContribution: input.monthlyContribution,
          targetAmount: input.targetAmount ?? null,
          targetMode: input.targetMode,
          apiCategoryId: item.apiCategoryId,
          apiCategoryName: item.apiCategoryName,
          apiSyncEnabled: !!item.apiCategoryId,
        })
        .returning();

      // Delete the budget item
      await ctx.db
        .delete(schema.budgetItems)
        .where(eq(schema.budgetItems.id, input.budgetItemId));

      return goal;
    }),

  /** Convert a savings goal into a budget item, transferring the API category link. */
  convertGoalToBudgetItem: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        category: z.string().min(1),
        subcategory: z.string().min(1),
        isEssential: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch the savings goal
      const [goal] = await ctx.db
        .select()
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));
      if (!goal)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Savings goal not found",
        });

      // Find active budget profile
      const [profile] = await ctx.db
        .select()
        .from(schema.budgetProfiles)
        .where(eq(schema.budgetProfiles.isActive, true));
      if (!profile)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No active budget profile",
        });

      const numCols = profile.columnLabels.length;
      const amounts = new Array(numCols).fill(0) as number[];

      // Place at end of category
      const existingItems = await ctx.db
        .select({
          sortOrder: schema.budgetItems.sortOrder,
          category: schema.budgetItems.category,
        })
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, profile.id));
      const sameCat = existingItems.filter(
        (i) => i.category === input.category,
      );
      const maxSort =
        sameCat.length > 0
          ? Math.max(...sameCat.map((i) => i.sortOrder))
          : existingItems.length > 0
            ? Math.max(...existingItems.map((i) => i.sortOrder))
            : 0;

      // Create budget item with the API link transferred
      const [item] = await ctx.db
        .insert(schema.budgetItems)
        .values({
          profileId: profile.id,
          category: input.category,
          subcategory: input.subcategory,
          amounts,
          isEssential: input.isEssential,
          sortOrder: maxSort + 1,
          apiCategoryId: goal.apiCategoryId,
          apiCategoryName: goal.apiCategoryName,
          apiSyncDirection: "pull",
        })
        .returning();

      // Delete the savings goal (cascades to savings_monthly, planned transactions, overrides)
      await ctx.db
        .delete(schema.savingsGoals)
        .where(eq(schema.savingsGoals.id, input.goalId));

      return item;
    }),

  /** Get API category balances for linked savings goals (for display). */
  listApiBalances: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return { balances: [], service: null };

    const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
      ctx.db,
      active,
      "categories",
    );
    if (!categoriesCache) return { balances: [], service: active };

    const catMap = new Map<
      string,
      { balance: number; budgeted: number; activity: number }
    >();
    for (const group of categoriesCache.data) {
      for (const cat of group.categories) {
        catMap.set(cat.id, {
          balance: cat.balance,
          budgeted: cat.budgeted,
          activity: cat.activity,
        });
      }
    }

    const goals = await ctx.db.select().from(schema.savingsGoals);
    const balances = goals
      .filter((g) => g.apiSyncEnabled && g.apiCategoryId)
      .map((g) => {
        const cat = catMap.get(g.apiCategoryId!);
        return {
          goalId: g.id,
          apiCategoryName: g.apiCategoryName,
          balance: cat?.balance ?? 0,
          budgeted: cat?.budgeted ?? 0,
          activity: cat?.activity ?? 0,
        };
      });

    return { balances, service: active };
  }),

  /**
   * Push monthly contributions as budget API goal targets for linked sinking funds.
   * Sets the goal target at the plan/category level (not month-specific).
   * Can optionally push a single goal by ID.
   */
  pushContributionsToApi: savingsProcedure
    .input(z.object({ goalId: z.number().int().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const client = await getBudgetAPIClient(ctx.db);
      if (!client) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No budget API active",
        });
      }

      const goals = await ctx.db.select().from(schema.savingsGoals);
      const linked = goals.filter((g) => g.apiSyncEnabled && g.apiCategoryId);
      const toPush = input?.goalId
        ? linked.filter((g) => g.id === input.goalId)
        : linked;

      if (toPush.length === 0) return { pushed: 0 };

      let pushed = 0;
      for (const goal of toPush) {
        const monthly = num(goal.monthlyContribution);
        // Push monthly contribution as the YNAB goal target (plan-level, not month-specific)
        if (monthly > 0) {
          try {
            await client.updateCategoryGoalTarget(
              goal.apiCategoryId!,
              monthly,
            );
            pushed++;
          } catch {
            // Skip goals that fail (e.g., category deleted in API)
          }
        }
      }

      return { pushed };
    }),

  // ══ REIMBURSEMENT CATEGORY ══

  /** Link a reimbursement tracking category to the e-fund goal. */
  linkReimbursementCategory: savingsProcedure
    .input(
      z.object({
        goalId: z.number().int(),
        apiCategoryId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.savingsGoals)
        .set({ reimbursementApiCategoryId: input.apiCategoryId })
        .where(eq(schema.savingsGoals.id, input.goalId));
      return { ok: true };
    }),

  /** Get parsed reimbursement items from the linked YNAB category's note field. */
  listEfundReimbursements: protectedProcedure.query(async ({ ctx }) => {
    const active = await getActiveBudgetApi(ctx.db);
    if (active === "none") return null;

    // Find the e-fund goal with a linked reimbursement category
    const goals = await ctx.db.select().from(schema.savingsGoals);
    const efundGoal = goals.find(
      (g) => g.isEmergencyFund && g.reimbursementApiCategoryId,
    );
    if (!efundGoal) return null;

    const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
      ctx.db,
      active,
      "categories",
    );
    if (!categoriesCache) return null;

    // Find the reimbursement category in cache
    let reimbursementCat: {
      name: string;
      note?: string | null;
      balance: number;
      goalTarget?: number;
    } | null = null;
    for (const group of categoriesCache.data) {
      for (const cat of group.categories) {
        if (cat.id === efundGoal.reimbursementApiCategoryId) {
          reimbursementCat = cat;
          break;
        }
      }
      if (reimbursementCat) break;
    }
    if (!reimbursementCat) return null;

    // Parse note field: each line = "amount - description"
    // Supports: "50 - lunch", "1,200 — hotel", "$50.00 - taxi"
    const items: { amount: number; description: string }[] = [];
    const skippedLines: string[] = [];
    if (reimbursementCat.note) {
      for (const line of reimbursementCat.note.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(/^\$?([\d,.]+)\s*[-–—]\s*(.+)$/);
        if (match) {
          const amount = parseFloat(match[1]!.replace(/,/g, ""));
          if (!isNaN(amount) && amount > 0) {
            items.push({ amount, description: match[2]!.trim() });
          } else {
            skippedLines.push(trimmed);
          }
        } else {
          skippedLines.push(trimmed);
        }
      }
    }

    const total = items.reduce((s, i) => s + i.amount, 0);

    return {
      items,
      total,
      balance: reimbursementCat.balance,
      target: reimbursementCat.goalTarget ?? 0,
      categoryName: reimbursementCat.name,
      skippedLines: skippedLines.length > 0 ? skippedLines : undefined,
    };
  }),

  // ══ TRANSFERS (paired planned transactions) ══
  transfers: createTRPCRouter({
    create: savingsProcedure
      .input(
        z.object({
          fromGoalId: z.number().int(),
          toGoalId: z.number().int(),
          transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          amount: z.number().positive(),
          description: z.string().min(1),
          isRecurring: z.boolean().default(false),
          recurrenceMonths: z.number().int().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const pairId = `xfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const base = {
          transactionDate: input.transactionDate,
          description: input.description,
          isRecurring: input.isRecurring,
          recurrenceMonths: input.recurrenceMonths ?? null,
          transferPairId: pairId,
        };
        const [withdrawal, deposit] = await Promise.all([
          ctx.db
            .insert(schema.savingsPlannedTransactions)
            .values({
              ...base,
              goalId: input.fromGoalId,
              amount: String(-input.amount),
            })
            .returning()
            .then((r) => r[0]),
          ctx.db
            .insert(schema.savingsPlannedTransactions)
            .values({
              ...base,
              goalId: input.toGoalId,
              amount: String(input.amount),
            })
            .returning()
            .then((r) => r[0]),
        ]);
        return { pairId, withdrawal, deposit };
      }),
    delete: savingsProcedure
      .input(z.object({ transferPairId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(schema.savingsPlannedTransactions)
          .where(
            eq(
              schema.savingsPlannedTransactions.transferPairId,
              input.transferPairId,
            ),
          );
        return { ok: true };
      }),
  }),
});
