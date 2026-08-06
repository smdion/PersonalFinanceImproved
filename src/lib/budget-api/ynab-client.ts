// YNAB API client implementing BudgetAPIClient.
// Base URL: https://api.ynab.com/v1
// Auth: Bearer token
// Amounts: milliunits (÷1000 for dollars)

import type { BudgetAPIClient } from "./interface";
import type {
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetCategory,
  BudgetMonth,
  BudgetMonthDetail,
  BudgetTransaction,
  NewBudgetTransaction,
  DeltaSyncResult,
} from "./types";
import { fromMilliunits, toMilliunits } from "./conversions";
import { budgetApiRequest } from "./errors";
import { transactionIdempotencyKey } from "./idempotency";

const YNAB_BASE = "https://api.ynab.com/v1";

// -- YNAB API response types (partial, what we need) --

type YnabAccount = {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  balance: number; // milliunits
  cleared_balance: number;
  transfer_payee_id: string;
};

type YnabCategoryGroup = {
  id: string;
  name: string;
  hidden: boolean;
  categories: YnabCategory[];
};

type YnabCategory = {
  id: string;
  name: string;
  category_group_id: string;
  category_group_name?: string;
  hidden: boolean;
  budgeted: number;
  activity: number;
  balance: number;
  goal_target: number | null;
  goal_type: string | null;
  note: string | null;
};

/** YNAB internal category groups that should never surface in our app. */
export const YNAB_INTERNAL_GROUPS = new Set([
  "Internal Master Category",
  "Hidden Categories",
]);

/** YNAB category names excluded from expense comparisons (system/non-expense categories). */
export const YNAB_EXPENSE_EXCLUDED_CATEGORIES = new Set([
  "Split", // parent of split txns — children carry real categories
  "Inflow: Ready to Assign", // income inflows, not expenses
  "Uncategorized", // unassigned noise until categorized
]);

/** YNAB category groups excluded from expense views (not real spending). */
export const YNAB_EXPENSE_EXCLUDED_GROUPS = new Set([
  "Credit Card Payments", // internal transfers between accounts
]);

type YnabMonth = {
  month: string;
  income: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  categories?: YnabCategory[];
};

type YnabTransaction = {
  id: string;
  account_id: string;
  account_name: string;
  date: string;
  amount: number;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  cleared: string;
  approved: boolean;
  deleted: boolean;
};

type YnabResponse<T> = {
  data: T;
};

type YnabDeltaResponse<T> = {
  data: T & { server_knowledge: number };
};

// -- Account type mapping --

const YNAB_ACCOUNT_TYPE_MAP: Record<string, BudgetAccount["type"]> = {
  checking: "checking",
  savings: "savings",
  cash: "cash",
  creditCard: "creditCard",
  lineOfCredit: "lineOfCredit",
  mortgage: "mortgage",
  otherAsset: "tracking",
  otherLiability: "tracking",
  investmentAccount: "tracking",
  autoLoan: "tracking",
  studentLoan: "tracking",
  personalLoan: "tracking",
  medicalDebt: "tracking",
  otherDebt: "tracking",
};

// -- Conversion helpers --

function mapAccount(a: YnabAccount): BudgetAccount {
  return {
    id: a.id,
    name: a.name,
    type: YNAB_ACCOUNT_TYPE_MAP[a.type] ?? "other",
    onBudget: a.on_budget,
    closed: a.closed,
    balance: fromMilliunits(a.balance),
    clearedBalance: fromMilliunits(a.cleared_balance),
    transferPayeeId: a.transfer_payee_id,
  };
}

function mapCategory(c: YnabCategory, groupName: string): BudgetCategory {
  return {
    id: c.id,
    name: c.name,
    groupId: c.category_group_id,
    groupName,
    hidden: c.hidden,
    budgeted: fromMilliunits(c.budgeted),
    activity: fromMilliunits(c.activity),
    balance: fromMilliunits(c.balance),
    goalTarget:
      c.goal_target != null ? fromMilliunits(c.goal_target) : undefined,
    goalType: c.goal_type ?? undefined,
    note: c.note ?? null,
  };
}

function mapCategoryGroup(g: YnabCategoryGroup): BudgetCategoryGroup {
  return {
    id: g.id,
    name: g.name,
    hidden: g.hidden,
    categories: g.categories.map((c) => mapCategory(c, g.name)),
  };
}

function mapMonth(m: YnabMonth): BudgetMonth {
  return {
    month: m.month,
    income: fromMilliunits(m.income),
    budgeted: fromMilliunits(m.budgeted),
    activity: fromMilliunits(m.activity),
    toBeBudgeted: fromMilliunits(m.to_be_budgeted),
  };
}

function mapMonthDetail(m: YnabMonth): BudgetMonthDetail {
  return {
    ...mapMonth(m),
    categories: (m.categories ?? [])
      .filter(
        (c) =>
          !c.category_group_name ||
          !YNAB_INTERNAL_GROUPS.has(c.category_group_name),
      )
      .map((c) => mapCategory(c, c.category_group_name ?? "")),
  };
}

function mapTransaction(t: YnabTransaction): BudgetTransaction {
  return {
    id: t.id,
    accountId: t.account_id,
    accountName: t.account_name,
    date: t.date,
    amount: fromMilliunits(t.amount),
    payeeName: t.payee_name,
    categoryId: t.category_id,
    categoryName: t.category_name,
    memo: t.memo,
    cleared: t.cleared === "cleared" || t.cleared === "reconciled",
    approved: t.approved,
    deleted: t.deleted,
  };
}

// -- Client --

export class YnabClient implements BudgetAPIClient {
  readonly supportsDeltaSync = true;

  getExcludedCategoryNames(): Set<string> {
    return YNAB_EXPENSE_EXCLUDED_CATEGORIES;
  }

  private readonly headers: Record<string, string>;
  private readonly budgetPath: string;

  constructor(
    private readonly accessToken: string,
    private readonly budgetId: string,
  ) {
    this.headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
    this.budgetPath = `${YNAB_BASE}/budgets/${budgetId}`;
  }

  /** Internal fetch wrapper — see budgetApiRequest in ./errors (M45). */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.budgetPath}${path}`;
    return budgetApiRequest<T>(url, this.headers, init);
  }

  async testConnection(): Promise<boolean> {
    try {
      // Use /settings — lightweight endpoint, avoids fetching the full budget object
      await this.request<YnabResponse<{ settings: unknown }>>("/settings");
      return true;
    } catch {
      return false;
    }
  }

  async getBudgetName(): Promise<string> {
    // Use the budgets list endpoint to get the name without fetching the full budget
    const res = await this.request<
      YnabResponse<{ budgets: Array<{ id: string; name: string }> }>
    >(`${YNAB_BASE}/budgets?include_accounts=false`);
    const match = res.data.budgets.find((b) => b.id === this.budgetId);
    return match?.name ?? "Unknown Budget";
  }

  // -- Accounts --

  async getAccounts(): Promise<BudgetAccount[]> {
    const res =
      await this.request<YnabResponse<{ accounts: YnabAccount[] }>>(
        "/accounts",
      );
    return res.data.accounts.map(mapAccount);
  }

  async getAccountBalance(accountId: string): Promise<number> {
    const res = await this.request<YnabResponse<{ account: YnabAccount }>>(
      `/accounts/${accountId}`,
    );
    return fromMilliunits(res.data.account.balance);
  }

  // -- Categories & Months --

  async getCategories(): Promise<BudgetCategoryGroup[]> {
    const res =
      await this.request<
        YnabResponse<{ category_groups: YnabCategoryGroup[] }>
      >("/categories");
    return res.data.category_groups
      .filter((g) => !YNAB_INTERNAL_GROUPS.has(g.name))
      .map(mapCategoryGroup);
  }

  async getMonths(start: string, _end: string): Promise<BudgetMonth[]> {
    // YNAB returns all months; we filter client-side
    const res =
      await this.request<YnabResponse<{ months: YnabMonth[] }>>("/months");
    return res.data.months
      .filter((m) => m.month >= start && m.month <= _end)
      .map(mapMonth);
  }

  async getMonthDetail(month: string): Promise<BudgetMonthDetail> {
    const res = await this.request<YnabResponse<{ month: YnabMonth }>>(
      `/months/${month}`,
    );
    return mapMonthDetail(res.data.month);
  }

  async updateCategoryBudgeted(
    month: string,
    categoryId: string,
    amount: number,
  ): Promise<void> {
    await this.request(`/months/${month}/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({
        category: { budgeted: toMilliunits(amount) },
      }),
    });
  }

  /**
   * Set a recurring "assign this every month" goal (what YNAB's UI/response
   * *displays* as goal_type "NEED", or legacy "MF" — same concept, just an
   * old vs. new name for it).
   *
   * IMPORTANT: `goal_type` is NOT a writable field in YNAB's current API —
   * verified against the live OpenAPI spec (api.ynab.com/papi/open_api_spec.yaml,
   * `SaveCategory` schema). It only appears on responses as a read-only
   * label YNAB derives from goal_target/goal_frequency/goal_target_date.
   * PATCHing a `goal_type` value (as this code used to do) is silently
   * ignored — it does nothing, in either direction. The actual write
   * surface is:
   *   - goal_target        — the dollar amount (required)
   *   - goal_frequency      — "monthly"/"weekly"/"yearly"; SETS the goal to
   *                           recurring at that cadence. Per the spec:
   *                           "replacing any existing target."
   *   - (goal_frequency omitted) — "Omit to leave an existing target's
   *                           cadence unchanged." For a category with NO
   *                           existing goal, omitting it still creates a
   *                           goal (a monthly NEED, per the spec's default),
   *                           but for a category that already has a
   *                           *different* cadence (or none), omitting
   *                           goal_frequency will NOT force it to monthly —
   *                           it just leaves whatever's already there. So
   *                           goal_frequency: "monthly" must be sent
   *                           explicitly to guarantee this goal is recurring
   *                           monthly regardless of the category's prior state.
   *
   * Goal fields only exist on the plan-level category endpoint — YNAB has
   * no month-specific goal fields, so PATCHing
   * /months/{month}/categories/{id} with goal_target 400s with "param is
   * missing or the value is empty or invalid: category" (the month-category
   * schema only accepts `budgeted`).
   */
  async updateCategoryGoalTarget(
    categoryId: string,
    targetAmount: number,
  ): Promise<void> {
    await this.request(`/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({
        category: {
          goal_target: toMilliunits(targetAmount),
          goal_frequency: "monthly",
        },
      }),
    });
  }

  /**
   * Update the dollar amount on a "build up to and hold a target balance"
   * goal (e.g. an emergency fund) WITHOUT touching its shape/cadence.
   *
   * This intentionally does NOT try to create or convert a goal into a
   * particular type — after repeated live testing against a real YNAB
   * account, every field combination this client tried
   * (`goal_type` — not writable at all, confirmed against the OpenAPI spec;
   * clear-then-recreate with no `goal_frequency`; clear-then-recreate with
   * `goal_needs_whole_amount` + `goal_target_date`) either left the goal
   * unchanged or made it WORSE: the last attempt produced a goal reading
   * "Set Aside Another $X Each Month" — a recurring monthly re-assignment
   * of the *full* target amount, which is actively wrong for an emergency
   * fund. `goal_frequency`'s only valid values are monthly/weekly/yearly
   * (there's no "none"/"custom" option in the public API), and the
   * "Custom cadence + Repeat off" shape YNAB's own app can create is not
   * achievable through this endpoint — it likely uses an internal API.
   *
   * So: this method only ever sends `goal_target`, a single PATCH, nothing
   * else. Per the OpenAPI spec, that updates just the amount and leaves
   * whatever goal shape is already configured (cadence, "set aside" vs.
   * "refill", target date, etc.) untouched. The goal's *type* must be set
   * up once, manually, in the YNAB app — this method is only safe to keep
   * the target dollar amount in sync with Ledgr afterward.
   */
  async updateCategoryTargetBalance(
    categoryId: string,
    targetAmount: number,
  ): Promise<void> {
    await this.request(`/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({
        category: { goal_target: toMilliunits(targetAmount) },
      }),
    });
  }

  // -- Transactions --

  async getTransactions(sinceDate: string): Promise<BudgetTransaction[]> {
    const res = await this.request<
      YnabResponse<{ transactions: YnabTransaction[] }>
    >(`/transactions?since_date=${sinceDate}`);
    return res.data.transactions.map(mapTransaction);
  }

  async createTransaction(tx: NewBudgetTransaction): Promise<string> {
    // v0.5 expert-review M20: deterministic idempotency key. YNAB doesn't
    // currently support an Idempotency-Key header officially, but the
    // import_id field on /transactions IS the upstream-side dedupe key —
    // YNAB rejects duplicate import_ids on the same account. We hash the
    // canonical fingerprint and use it as import_id, prefixed so it's
    // recognizable in the YNAB UI as ledgr-generated.
    const idempotencyKey = transactionIdempotencyKey({
      accountId: tx.accountId,
      date: tx.date,
      amount: toMilliunits(tx.amount),
      payee: tx.payeeName ?? null,
      memo: tx.memo ?? null,
    });
    // YNAB import_id is limited to 36 chars; truncate the base64url hash.
    const importId = `ledgr:${idempotencyKey.slice(0, 30)}`;

    const res = await this.request<
      YnabResponse<{ transaction: { id: string } }>
    >("/transactions", {
      method: "POST",
      body: JSON.stringify({
        transaction: {
          account_id: tx.accountId,
          date: tx.date,
          amount: toMilliunits(tx.amount),
          payee_name: tx.payeeName,
          category_id: tx.categoryId,
          memo: tx.memo,
          cleared: tx.cleared ? "cleared" : "uncleared",
          approved: tx.approved ?? true,
          import_id: importId,
        },
      }),
    });
    return res.data.transaction.id;
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    await this.request(`/transactions/${transactionId}`, { method: "DELETE" });
  }

  async getAccountTransactions(
    accountId: string,
    sinceDate: string,
  ): Promise<BudgetTransaction[]> {
    const res = await this.request<
      YnabResponse<{ transactions: YnabTransaction[] }>
    >(`/accounts/${accountId}/transactions?since_date=${sinceDate}`);
    return res.data.transactions.filter((t) => !t.deleted).map(mapTransaction);
  }

  async updateTransaction(
    txId: string,
    tx: Partial<NewBudgetTransaction>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (tx.accountId !== undefined) body.account_id = tx.accountId;
    if (tx.date !== undefined) body.date = tx.date;
    if (tx.amount !== undefined) body.amount = toMilliunits(tx.amount);
    if (tx.payeeName !== undefined) body.payee_name = tx.payeeName;
    if (tx.categoryId !== undefined) body.category_id = tx.categoryId;
    if (tx.memo !== undefined) body.memo = tx.memo;
    if (tx.cleared !== undefined)
      body.cleared = tx.cleared ? "cleared" : "uncleared";
    if (tx.approved !== undefined) body.approved = tx.approved;

    await this.request(`/transactions/${txId}`, {
      method: "PUT",
      body: JSON.stringify({ transaction: body }),
    });
  }

  // -- Delta sync --

  async getDelta(serverKnowledge: number): Promise<DeltaSyncResult<unknown>> {
    const res = await this.request<
      YnabDeltaResponse<{
        accounts: YnabAccount[];
        categories: YnabCategoryGroup[];
        transactions: YnabTransaction[];
        months: YnabMonth[];
      }>
    >(`?last_knowledge_of_server=${serverKnowledge}`);

    return {
      data: {
        accounts: res.data.accounts.map(mapAccount),
        categories: res.data.categories.map(mapCategoryGroup),
        transactions: res.data.transactions.map(mapTransaction),
        months: res.data.months.map(mapMonth),
      },
      serverKnowledge: res.data.server_knowledge,
    };
  }
}
