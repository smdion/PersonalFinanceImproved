import type { ApiSyncDirection } from "@/lib/config/enum-values";
import type { BudgetInput } from "@/lib/pure/budget/budget.types";

export function previewCash(
  conn: {
    accountMappings:
      | {
          localId?: string;
          remoteAccountId: string;
          syncDirection: ApiSyncDirection;
        }[]
      | null;
  },
  accounts: {
    id: string;
    name: string;
    type: string;
    onBudget: boolean;
    closed: boolean;
    balance: number;
  }[],
) {
  const cashMappings = (conn?.accountMappings ?? []).filter(
    (m) =>
      m.localId === "cash" &&
      (m.syncDirection === "pull" || m.syncDirection === "both"),
  );
  const cashTypes = new Set(["checking", "savings", "cash"]);
  const onBudgetCashAccounts =
    cashMappings.length > 0
      ? accounts.filter((a) =>
          cashMappings.some((m) => m.remoteAccountId === a.id),
        )
      : accounts.filter(
          (a) => a.onBudget && !a.closed && cashTypes.has(a.type),
        );
  const apiCash = onBudgetCashAccounts.reduce((sum, a) => sum + a.balance, 0);
  return { onBudgetCashAccounts, apiCash };
}

export function previewApiCategories(
  monthCache: {
    data: {
      categories: {
        id: string;
        budgeted: number;
        activity: number;
        balance: number;
      }[];
    };
  } | null,
  categoryGroups: {
    name: string;
    hidden: boolean;
    categories: { id: string; name: string; hidden: boolean }[];
  }[],
) {
  const monthCategories = monthCache?.data?.categories ?? [];
  const monthMap = new Map(monthCategories.map((c) => [c.id, c]));

  const apiCats: Array<{
    id: string;
    name: string;
    groupName: string;
    budgeted: number;
    activity: number;
    balance: number;
  }> = [];
  for (const g of categoryGroups) {
    if (g.hidden) continue;
    for (const c of g.categories) {
      if (c.hidden) continue;
      const m = monthMap.get(c.id);
      apiCats.push({
        id: c.id,
        name: c.name,
        groupName: g.name,
        budgeted: m?.budgeted ?? 0,
        activity: m?.activity ?? 0,
        balance: m?.balance ?? 0,
      });
    }
  }

  // Normalize name for fuzzy matching: strip non-alpha chars (emoji, parens, symbols), lowercase, trim
  const normalize = (s: string) =>
    s
      .replace(/\(.*?\)/g, "")
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  return { apiCats, normalize };
}

export function matchBudgetItems(
  budgetItemRows: {
    id: number;
    category: BudgetInput["items"][number]["category"];
    subcategory: string;
    amounts: number[];
    apiCategoryId: string | null;
    apiCategoryName: string | null;
    apiSyncDirection: ApiSyncDirection | null;
    contributionAccountId: number | null;
  }[],
  apiCats: ReturnType<typeof previewApiCategories>["apiCats"],
  colIndex: number,
  normalize: (s: string) => string,
) {
  type BudgetMatch = {
    budgetItemId: number;
    ledgrName: string;
    ledgrCategory: string;
    ledgrAmount: number;
    status: "linked" | "suggested" | "unmatched" | "orphaned";
    apiCategoryId: string | null;
    apiCategoryName: string | null;
    apiGroupName: string | null;
    apiBudgeted: number | null;
    apiActivity: number | null;
    syncDirection: "pull" | "push" | "both" | null;
    nameDrifted?: boolean;
    categoryDrifted?: boolean;
    contributionAccountId: number | null;
  };

  const usedApiIds = new Set<string>();
  const budgetMatches: BudgetMatch[] = [];

  // First pass: already linked items
  for (const item of budgetItemRows) {
    if (item.apiCategoryId) {
      const apiCat = apiCats.find((c) => c.id === item.apiCategoryId);
      usedApiIds.add(item.apiCategoryId);
      const currentApiName = apiCat?.name ?? item.apiCategoryName;
      if (!apiCat) {
        // The stored id resolves to no current API category (the budget was
        // rebuilt upstream, which regenerates ids): "orphaned", so the UI offers
        // a re-link rather than a push that would write nowhere.
        budgetMatches.push({
          budgetItemId: item.id,
          ledgrName: item.subcategory,
          ledgrCategory: item.category,
          ledgrAmount: item.amounts[colIndex] ?? 0,
          status: "orphaned",
          apiCategoryId: item.apiCategoryId,
          apiCategoryName: currentApiName,
          apiGroupName: null,
          apiBudgeted: null,
          apiActivity: null,
          syncDirection: item.apiSyncDirection,
          contributionAccountId: item.contributionAccountId,
        });
        continue;
      }
      budgetMatches.push({
        budgetItemId: item.id,
        ledgrName: item.subcategory,
        ledgrCategory: item.category,
        ledgrAmount: item.amounts[colIndex] ?? 0,
        status: "linked",
        apiCategoryId: item.apiCategoryId,
        apiCategoryName: currentApiName,
        apiGroupName: apiCat?.groupName ?? null,
        apiBudgeted: apiCat?.budgeted ?? null,
        apiActivity: apiCat?.activity ?? null,
        syncDirection: item.apiSyncDirection,
        nameDrifted:
          currentApiName != null && item.subcategory !== currentApiName,
        categoryDrifted:
          apiCat?.groupName != null && item.category !== apiCat.groupName,
        contributionAccountId: item.contributionAccountId,
      });
    }
  }

  // Second pass: fuzzy match unlinked items
  for (const item of budgetItemRows) {
    if (item.apiCategoryId) continue;
    const normSub = normalize(item.subcategory);
    const match = apiCats.find(
      (c) => !usedApiIds.has(c.id) && normalize(c.name) === normSub,
    );
    if (match) {
      usedApiIds.add(match.id);
      budgetMatches.push({
        budgetItemId: item.id,
        ledgrName: item.subcategory,
        ledgrCategory: item.category,
        ledgrAmount: item.amounts[colIndex] ?? 0,
        status: "suggested",
        apiCategoryId: match.id,
        apiCategoryName: match.name,
        apiGroupName: match.groupName,
        apiBudgeted: match.budgeted,
        apiActivity: match.activity,
        syncDirection: null,
        contributionAccountId: item.contributionAccountId,
      });
    } else {
      budgetMatches.push({
        budgetItemId: item.id,
        ledgrName: item.subcategory,
        ledgrCategory: item.category,
        ledgrAmount: item.amounts[colIndex] ?? 0,
        status: "unmatched",
        apiCategoryId: null,
        apiCategoryName: null,
        apiGroupName: null,
        apiBudgeted: null,
        apiActivity: null,
        syncDirection: null,
        contributionAccountId: item.contributionAccountId,
      });
    }
  }
  return { usedApiIds, budgetMatches };
}

export function matchSavingsGoals(
  savingsGoalRowsWithLinks: {
    id: number;
    name: string;
    isEmergencyFund: boolean;
    apiCategoryId: string | null;
    apiCategoryName: string | null;
    reimbursementApiCategoryId: string | null;
  }[],
  apiCats: ReturnType<typeof previewApiCategories>["apiCats"],
  usedApiIds: Set<string>,
  normalize: (s: string) => string,
  conn: { skippedCategoryIds: string[] | null },
) {
  type SavingsMatch = {
    goalId: number;
    goalName: string;
    status: "linked" | "suggested" | "unmatched" | "orphaned";
    apiCategoryId: string | null;
    apiCategoryName: string | null;
    apiBalance: number | null;
    nameDrifted?: boolean;
    isEmergencyFund: boolean;
    reimbursementApiCategoryId: string | null;
  };

  const usedSavingsApiIds = new Set<string>();
  const savingsMatches: SavingsMatch[] = [];

  for (const goal of savingsGoalRowsWithLinks) {
    if (goal.apiCategoryId) {
      const apiCat = apiCats.find((c) => c.id === goal.apiCategoryId);
      usedSavingsApiIds.add(goal.apiCategoryId);
      const currentApiName = apiCat?.name ?? goal.apiCategoryName;
      if (!apiCat) {
        // See the matching budget-item comment above — a stored id that
        // no longer resolves to any current API category must not be
        // reported as "linked".
        savingsMatches.push({
          goalId: goal.id,
          goalName: goal.name,
          status: "orphaned",
          apiCategoryId: goal.apiCategoryId,
          apiCategoryName: currentApiName,
          apiBalance: null,
          isEmergencyFund: goal.isEmergencyFund,
          reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
        });
        continue;
      }
      savingsMatches.push({
        goalId: goal.id,
        goalName: goal.name,
        status: "linked",
        apiCategoryId: goal.apiCategoryId,
        apiCategoryName: currentApiName,
        apiBalance: apiCat?.balance ?? null,
        nameDrifted: currentApiName != null && goal.name !== currentApiName,
        isEmergencyFund: goal.isEmergencyFund,
        reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
      });
    }
  }

  // Fuzzy match unlinked savings goals
  for (const goal of savingsGoalRowsWithLinks) {
    if (goal.apiCategoryId) continue;
    const normGoal = normalize(goal.name);
    const match = apiCats.find(
      (c) =>
        !usedApiIds.has(c.id) &&
        !usedSavingsApiIds.has(c.id) &&
        normalize(c.name) === normGoal,
    );
    if (match) {
      usedSavingsApiIds.add(match.id);
      savingsMatches.push({
        goalId: goal.id,
        goalName: goal.name,
        status: "suggested",
        apiCategoryId: match.id,
        apiCategoryName: match.name,
        apiBalance: match.balance,
        isEmergencyFund: goal.isEmergencyFund,
        reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
      });
    } else {
      savingsMatches.push({
        goalId: goal.id,
        goalName: goal.name,
        status: "unmatched",
        apiCategoryId: null,
        apiCategoryName: null,
        apiBalance: null,
        isEmergencyFund: goal.isEmergencyFund,
        reimbursementApiCategoryId: goal.reimbursementApiCategoryId ?? null,
      });
    }
  }

  // API categories with no Ledgr match (budget or savings)
  const skippedIds = new Set(conn.skippedCategoryIds ?? []);
  const allUnmatchedApi = apiCats
    .filter((c) => !usedApiIds.has(c.id) && !usedSavingsApiIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      groupName: c.groupName,
      budgeted: c.budgeted,
    }));
  const unmatchedApi = allUnmatchedApi.filter((c) => !skippedIds.has(c.id));
  const skippedApi = allUnmatchedApi.filter((c) => skippedIds.has(c.id));
  return { savingsMatches, unmatchedApi, skippedApi };
}

export function previewAssetAccounts(
  assetItems: { id: number; name: string; year: number; value: string }[],
  currentYear: number,
) {
  const assetByName = new Map<
    string,
    { id: number; value: number; year: number }
  >();
  for (const a of assetItems) {
    if (a.year > currentYear) continue;
    const existing = assetByName.get(a.name);
    if (!existing || a.year > existing.year) {
      assetByName.set(a.name, {
        id: a.id,
        value: Number(a.value),
        year: a.year,
      });
    }
  }
  const assetLocalAccounts = Array.from(assetByName.entries())
    .map(([name, { id, value }]) => ({ label: name, balance: value, id }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return { assetLocalAccounts };
}
