import type { Db } from "@/lib/db";
import type { RequestScope } from "@/server/data/request-scope";
import { asc, sql, lt } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { safeDivide } from "@/lib/utils/math";
import { calculateSavings } from "@/lib/pure/savings/savings";
import { calculateEFund } from "@/lib/pure/savings/efund";
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
import type { BudgetCategoryGroup, BudgetMonthDetail } from "@/lib/budget-api";
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
    ctx.db
      .select()
      .from(schema.selfLoans)
      .where(lt(schema.selfLoans.repaidAmount, schema.selfLoans.amount)),
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

  // Override balances for API-linked goals with live cache values, AND
  // capture each linked category's current-month `budgeted` amount
  // (currentMonthBudgetedMap) so projectGoalBalances can tell whether
  // this month's contribution is already reflected in `balance`
  // instead of guessing from the calendar date.
  //
  // Both come from the SAME month-scoped cache entry
  // (`months/${currentMonthKey}`), not the generic "categories" cache
  // the balance override used to read alone — sourcing balance and budgeted from two independently-
  // aged snapshots risks subtracting THIS month's budgeted amount
  // from a STALE prior month's balance (e.g. synced Aug 31 11pm,
  // read Sept 1 9am — "categories" would still hold August's numbers
  // with no signal it's the wrong month). The month-scoped key is
  // self-verifying: if `months/<currentMonthKey>` is absent, we know
  // we don't have that month's data at all.
  //
  // Degrades safely when that cache entry is missing (no sync yet
  // this month — most likely right at a month rollover, e.g. viewed
  // Oct 1 before the first October sync ran): the live balance
  // override does NOT fire at all for these goals, same as before
  // this phase existed — `balance` falls back to whatever
  // savings_monthly last recorded (set above), which could itself be
  // a prior month's synced snapshot, not "right now". Real but
  // low-impact: the very next sync (same one that populates
  // months/${currentMonthKey}) also refreshes savings_monthly.
  // currentMonthBudgetedMap stays empty for these goals — the same
  // "unknown, add the full allocation" conservative default a
  // non-API-synced goal already gets in projectGoalBalances.
  // Read-only display path — resolve against the currently active
  // service only (no cross-service ambiguity here; see
  // src/server/data/category-links.ts).
  const activeServiceForSummary = await getActiveBudgetApi(ctx.db);
  // Loaded for EVERY goal (not just active ones) — goalsForClient below
  // sends the full goals list to the client, and each goal's
  // isApiSyncEnabled/apiCategoryId/apiCategoryName must reflect this
  // same resolved link, not the dead raw columns.
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
    const monthCache = await cacheGet<BudgetMonthDetail>(
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
      activeProfile.id,
      efundTierIndex,
      activeProfile.columnMonths ?? null,
    );
  }

  // E-Fund calculator (compute before savings so e-fund target flows into projections)
  let efundResult = null;

  if (efundGoal) {
    // Self-loan tracking is exclusive: if a YNAB reimbursement category is
    // linked, its goalTarget is the source of truth (YNAB-tracked workflow).
    // Otherwise fall back to the Ledgr DB self_loans table. Using both at
    // once causes double-counting because the same money appears in both places.
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
        const categoriesCache = await cacheGet<BudgetCategoryGroup[]>(
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
          (s, l) => s + (toNumber(l.amount) - toNumber(l.repaidAmount)),
          0,
        );
    }

    const efundInput: EFundInput = {
      emergencyFundBalance: balanceMap.get(efundGoal.id) ?? 0,
      outstandingSelfLoans,
      essentialMonthlyExpenses,
      targetMonths: efundGoal.targetMonths ?? 4,
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
      const monthlyContrib = resolvedByGoal.get(g.id)?.monthlyContribution ?? 0;
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
        allocationPercent: safeDivide(monthlyContrib, totalMonthlyPool, 0),
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

  // goals sent to the client carry the RESOLVED funding for the active
  // profile as synthesized fields (savings_goals itself has no funding
  // columns anymore) — every client-side consumer (fund cards,
  // recalculate/lock-in previews) reads allocationPercent/
  // monthlyContribution straight off this list, so resolving once here
  // keeps them all correct without each one re-deriving it.
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
      // null (not just absent) when unknown — projectGoalBalances
      // treats "no evidence this month is already funded" as "add
      // the full allocation," the same conservative default a
      // non-API-synced goal already gets. See
      // currentMonthBudgetedMap's own comment above for why this is
      // null instead of falling back to a differently-aged number.
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
