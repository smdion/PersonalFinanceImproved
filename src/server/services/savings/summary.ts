import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { asc, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { safeDivide } from "@/lib/utils/math";
import { calculateSavings } from "@/lib/pure/savings/savings";
import { calculateEFund, DEFAULT_EFUND_MONTHS } from "@/lib/pure/savings/efund";
import {
  getEssentialExpenses,
  resolveEfundTierIndex,
} from "@/lib/pure/savings/efund-expenses";
import { getResolvedGoalAllocations } from "@/server/services/savings/savings-allocation";
import { loadSavingsGoalLinks } from "@/server/data/category-links";
import { getActiveBudgetProfile } from "@/server/data/budget-profiles";
import { toNumber } from "@/lib/utils/numbers";
import type { SavingsInput } from "@/lib/pure/savings/savings.types";
import type { EFundInput } from "@/lib/pure/savings/efund.types";
import { getActiveBudgetApi, cacheGet } from "@/lib/budget-api";
import { currentMonthKey } from "@/lib/utils/date-keys";

export async function computeSavingsSummary(
  ctx: { db: Db; scope: RequestScope },
  input: { budgetTierOverride?: number } | undefined,
) {
  const [
    goals,
    selfLoans,
    activeProfile,
    budgetItems,
    plannedTransactions,
    allocationOverrides,
    appSettings,
    settlements,
  ] = await Promise.all([
    ctx.db
      .select()
      .from(schema.savingsGoals)
      .orderBy(asc(schema.savingsGoals.priority)),
    ctx.db.select().from(schema.selfLoans),
    getActiveBudgetProfile(ctx.db),
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
    ctx.db.select().from(schema.savingsPlannedTxSettlements),
  ]);

  // Get latest balance for each active goal from savings_monthly (single query)
  const activeGoals = goals.filter((g) => g.isActive);
  const activeGoalIds = activeGoals.map((g) => g.id);

  const balanceMap = new Map<number, number>();
  if (activeGoalIds.length > 0) {
    const { isPostgres } = await import("@/lib/db/dialect");
    const { queryRaw } = await import("@/lib/db/compat");
    const inList = sql.join(
      activeGoalIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const latestBalances = isPostgres()
      ? await queryRaw<{ goal_id: number; balance: string }>(
          ctx.db,
          sql`
              SELECT DISTINCT ON (goal_id) goal_id, balance
              FROM savings_monthly
              WHERE goal_id IN (${inList})
              ORDER BY goal_id, month_date DESC
            `,
        )
      : await queryRaw<{ goal_id: number; balance: string }>(
          ctx.db,
          sql`
              SELECT goal_id, balance FROM savings_monthly t1
              WHERE month_date = (
                SELECT MAX(t2.month_date) FROM savings_monthly t2
                WHERE t2.goal_id = t1.goal_id
              )
              AND goal_id IN (${inList})
            `,
        );
    for (const row of latestBalances) {
      balanceMap.set(row.goal_id, toNumber(row.balance));
    }
  }

  // API-linked goals: live balance and current-month `budgeted` both from the
  // month-scoped cache entry, so they're never differently aged; without that
  // entry neither applies (savings_monthly balance, "add full allocation").
  const activeServiceForSummary = await getActiveBudgetApi(ctx.db);
  // Loaded for EVERY goal: the client gets the full list, and each goal's
  // isApiSyncEnabled/apiCategoryId/apiCategoryName reflect this resolved link.
  const summaryPrimaryLinks =
    activeServiceForSummary === "none"
      ? new Map()
      : await loadSavingsGoalLinks(
          ctx.db,
          goals.map((g) => g.id),
          activeServiceForSummary,
          "primary",
        );
  const apiLinkedGoals = activeGoals
    .map((g) => ({
      ...g,
      apiCategoryId: summaryPrimaryLinks.get(g.id)?.categoryId ?? null,
    }))
    .filter((g) => g.apiCategoryId);
  const currentMonthBudgetedMap = new Map<number, number>();
  if (apiLinkedGoals.length > 0 && activeServiceForSummary !== "none") {
    const now = ctx.scope.asOf;
    const monthCache = await cacheGet(
      ctx.db,
      activeServiceForSummary,
      `months/${currentMonthKey(now)}`,
    );
    if (monthCache) {
      const catById = new Map(monthCache.data.categories.map((c) => [c.id, c]));
      for (const goal of apiLinkedGoals) {
        const cat = catById.get(goal.apiCategoryId!);
        if (cat) {
          balanceMap.set(goal.id, cat.balance);
          currentMonthBudgetedMap.set(goal.id, cat.budgeted);
        }
      }
    }
  }

  // Budget profile info for tier selection
  const budgetTierLabels = activeProfile?.columnLabels ?? [];

  const efundGoal = activeGoals.find((g) => g.isEmergencyFund);
  const efundTierIndex = resolveEfundTierIndex(
    appSettings,
    input?.budgetTierOverride,
    budgetTierLabels.length,
  );

  // Essential expenses for e-fund tier
  let essentialMonthlyExpenses = 0;
  if (activeProfile) {
    essentialMonthlyExpenses = getEssentialExpenses(
      budgetItems as {
        profileId: number;
        isEssential: boolean;
        amounts: number[];
      }[],
      activeProfile,
      efundTierIndex,
    );
  }

  // E-Fund calculator (compute before savings so e-fund target flows into projections)
  let efundResult = null;

  if (efundGoal) {
    // Self-loan tracking is exclusive, else the same money counts twice: a linked
    // reimbursement category's goalTarget, otherwise the self_loans table.
    let outstandingSelfLoans: number;
    const efundReimbursementLinks =
      activeServiceForSummary === "none"
        ? new Map()
        : await loadSavingsGoalLinks(
            ctx.db,
            [efundGoal.id],
            activeServiceForSummary,
            "reimbursement",
          );
    const efundReimbursementCategoryId = efundReimbursementLinks.get(
      efundGoal.id,
    )?.categoryId;
    if (efundReimbursementCategoryId) {
      outstandingSelfLoans = 0;
      if (activeServiceForSummary !== "none") {
        const categoriesCache = await cacheGet(
          ctx.db,
          activeServiceForSummary,
          "categories",
        );
        if (categoriesCache) {
          for (const group of categoriesCache.data) {
            for (const cat of group.categories) {
              if (cat.id === efundReimbursementCategoryId) {
                outstandingSelfLoans = cat.goalTarget ?? 0;
              }
            }
          }
        }
      }
    } else {
      outstandingSelfLoans = selfLoans
        .filter((l) => l.fromGoalId === efundGoal.id)
        .reduce(
          // A loan repaid in full (or past it) has nothing outstanding.
          (s, l) =>
            s + Math.max(0, toNumber(l.amount) - toNumber(l.repaidAmount)),
          0,
        );
    }

    const efundInput: EFundInput = {
      emergencyFundBalance: balanceMap.get(efundGoal.id) ?? 0,
      outstandingSelfLoans,
      essentialMonthlyExpenses,
      targetMonths: efundGoal.targetMonths ?? DEFAULT_EFUND_MONTHS,
      asOfDate: ctx.scope.asOf,
    };
    efundResult = calculateEFund(efundInput);
  }

  // Resolve each goal's funding for the active profile — funding is
  // entirely per-profile, no shared default (see getResolvedGoalAllocations,
  // the only path that reads allocationPercent/monthlyContribution).
  const resolvedByGoal = await getResolvedGoalAllocations(
    ctx.db,
    goals,
    activeProfile?.id ?? null,
  );

  // Calculate total monthly contributions for the pool
  const totalMonthlyPool = activeGoals.reduce(
    (s, g) => s + (resolvedByGoal.get(g.id)?.monthlyContribution ?? 0),
    0,
  );

  const savingsInput: SavingsInput = {
    goals: activeGoals.map((g) => {
      const monthlyContribution =
        resolvedByGoal.get(g.id)?.monthlyContribution ?? 0;
      // E-fund target is derived from calculator (targetMonths × essential expenses)
      const targetBalance =
        g.isEmergencyFund && efundResult
          ? efundResult.targetAmount
          : toNumber(g.targetAmount);
      // E-fund uses balanceWithRepay so the savings goal list stays consistent
      // with the e-fund detail card (both show the "after repay" view).
      const currentBalance =
        g.isEmergencyFund && efundResult
          ? efundResult.balanceWithRepay
          : (balanceMap.get(g.id) ?? 0);
      return {
        id: g.id,
        name: g.name,
        currentBalance,
        targetBalance,
        allocationPercent: safeDivide(monthlyContribution, totalMonthlyPool, 0),
        isEmergencyFund: g.isEmergencyFund,
        isActive: g.isActive,
      };
    }),
    monthlySavingsPool: totalMonthlyPool,
    essentialMonthlyExpenses,
    asOfDate: ctx.scope.asOf,
  };

  const savingsResult = calculateSavings(savingsInput);

  // Group settlements by plannedTxId → occurrence-month strings ("YYYY-MM"),
  // normalized from the stored date (always the 1st of the month).
  const settledByTxId = new Map<number, string[]>();
  for (const s of settlements) {
    const list = settledByTxId.get(s.plannedTxId) ?? [];
    list.push(s.occurrenceMonth.slice(0, 7));
    settledByTxId.set(s.plannedTxId, list);
  }

  // Transform planned transactions for the client
  const plannedTx = plannedTransactions.map((t) => ({
    id: t.id,
    goalId: t.goalId,
    transactionDate: t.transactionDate,
    amount: toNumber(t.amount),
    description: t.description,
    isRecurring: t.isRecurring,
    recurrenceMonths: t.recurrenceMonths,
    transferPairId: t.transferPairId,
    source: t.source,
    settledOccurrences: settledByTxId.get(t.id) ?? [],
  }));

  // Transform allocation overrides for the client
  const overrides = allocationOverrides.map((o) => ({
    id: o.id,
    goalId: o.goalId,
    monthDate: o.monthDate,
    amount: toNumber(o.amount),
    source: o.source,
  }));

  // Client goals carry the RESOLVED funding for the active profile as
  // synthesized fields (savings_goals has no funding columns), so every
  // client consumer reads it straight off this list.
  const goalsForClient = goals.map((g) => {
    // getResolvedGoalAllocations always returns one entry per input
    // goal (defaulting to $0/no-percent), never leaves one unset.
    const resolved = resolvedByGoal.get(g.id)!;
    const link = summaryPrimaryLinks.get(g.id);
    return {
      ...g,
      // Resolved link for the active service — overrides the dead raw
      // columns still present on `g` (see category-links.ts).
      apiCategoryId: link?.categoryId ?? null,
      apiCategoryName: link?.categoryName ?? null,
      isApiSyncEnabled: !!link,
      allocationPercent:
        resolved.allocationPercent != null
          ? resolved.allocationPercent.toFixed(3)
          : null,
      monthlyContribution: resolved.monthlyContribution.toFixed(2),
      // null when unknown: projectGoalBalances then adds the full allocation,
      // as for a goal not synced from the budget API.
      currentMonthBudgeted: currentMonthBudgetedMap.get(g.id) ?? null,
    };
  });

  return {
    savings: savingsResult,
    efund: efundResult,
    goals: goalsForClient,
    budgetTierLabels,
    efundTierIndex,
    plannedTransactions: plannedTx,
    allocationOverrides: overrides,
  };
}
