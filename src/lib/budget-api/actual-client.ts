// Actual Budget HTTP API client implementing BudgetAPIClient.
// Uses jhonderson/actual-http-api wrapper.
// Base URL: {serverUrl}/v1/budgets/{budgetSyncId}
// Auth: x-api-key header
// Amounts: integer cents (÷100 for dollars)

import type { BudgetAPIClient } from "./interface";
import type {
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetCategory,
  BudgetMonth,
  BudgetMonthDetail,
  BudgetTransaction,
  NewBudgetTransaction,
} from "./types";
import { fromCents, toCents } from "./conversions";

// -- Actual API response types --

type ActualAccount = {
  id: string;
  name: string;
  type: string;
  offbudget: boolean;
  closed: boolean;
  balance?: number; // cents (may need separate call)
};

type ActualCategoryGroup = {
  id: string;
  name: string;
  is_income: boolean;
  hidden: boolean;
  categories: ActualCategory[];
};

type ActualCategory = {
  id: string;
  name: string;
  group_id: string;
  hidden: boolean;
  budgeted?: number; // cents
  spent?: number; // cents (negative = spending)
  balance?: number; // cents
  goal?: number | null; // cents
};

type ActualMonth = {
  month: string;
  income: number;
  budgeted: number;
  spent: number;
  to_budget: number;
  categories?: ActualCategory[];
};

type ActualTransaction = {
  id: string;
  account: string;
  account_name?: string;
  date: string;
  amount: number; // cents
  payee?: string;
  payee_name?: string;
  category?: string;
  category_name?: string;
  notes?: string;
  cleared: boolean;
  reconciled: boolean;
};

// -- Account type mapping --

const ACTUAL_ACCOUNT_TYPE_MAP: Record<string, BudgetAccount["type"]> = {
  checking: "checking",
  savings: "savings",
  cash: "cash",
  credit: "creditCard",
  mortgage: "mortgage",
  debt: "lineOfCredit",
  investment: "tracking",
  other: "other",
};

// -- Conversion helpers --

function mapAccount(a: ActualAccount): BudgetAccount {
  return {
    id: a.id,
    name: a.name,
    type: ACTUAL_ACCOUNT_TYPE_MAP[a.type] ?? "other",
    onBudget: !a.offbudget,
    closed: a.closed,
    balance: fromCents(a.balance ?? 0),
    clearedBalance: fromCents(a.balance ?? 0), // Actual doesn't distinguish
  };
}

function mapCategory(c: ActualCategory, groupName: string): BudgetCategory {
  return {
    id: c.id,
    name: c.name,
    groupId: c.group_id,
    groupName,
    hidden: c.hidden,
    budgeted: fromCents(c.budgeted ?? 0),
    activity: fromCents(c.spent ?? 0),
    balance: fromCents(c.balance ?? 0),
    goalTarget: c.goal != null ? fromCents(c.goal) : undefined,
  };
}

function mapCategoryGroup(g: ActualCategoryGroup): BudgetCategoryGroup {
  return {
    id: g.id,
    name: g.name,
    hidden: g.hidden || g.is_income,
    categories: g.categories.map((c) => mapCategory(c, g.name)),
  };
}

function mapMonth(m: ActualMonth): BudgetMonth {
  return {
    month: m.month,
    income: fromCents(m.income),
    budgeted: fromCents(m.budgeted),
    activity: fromCents(m.spent),
    toBeBudgeted: fromCents(m.to_budget),
  };
}

function mapMonthDetail(m: ActualMonth): BudgetMonthDetail {
  return {
    ...mapMonth(m),
    categories: (m.categories ?? []).map((c) => mapCategory(c, "")),
  };
}

function mapTransaction(t: ActualTransaction): BudgetTransaction {
  return {
    id: t.id,
    accountId: t.account,
    accountName: t.account_name ?? "",
    date: t.date,
    amount: fromCents(t.amount),
    payeeName: t.payee_name ?? t.payee ?? null,
    categoryId: t.category ?? null,
    categoryName: t.category_name ?? null,
    memo: t.notes ?? null,
    cleared: t.cleared || t.reconciled,
    approved: true, // Actual doesn't have approved flag
    deleted: false,
  };
}

// -- Client --

export class ActualClient implements BudgetAPIClient {
  readonly supportsDeltaSync = false;

  private readonly headers: Record<string, string>;
  private readonly budgetPath: string;

  constructor(
    private readonly serverUrl: string,
    apiKey: string,
    private readonly budgetSyncId: string,
  ) {
    this.headers = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };
    // Strip trailing slash
    const base = serverUrl.replace(/\/$/, "");
    this.budgetPath = `${base}/v1/budgets/${budgetSyncId}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.budgetPath}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...this.headers, ...init?.headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Actual API ${res.status}: ${res.statusText} — ${body}`,
        );
      }
      return res.json() as Promise<T>;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Actual API request timed out (15s)");
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      // Try fetching accounts as a connection test
      await this.request<{ data: unknown[] }>("/accounts");
      return true;
    } catch {
      return false;
    }
  }

  async getBudgetName(): Promise<string> {
    // Actual HTTP API doesn't have a budget name endpoint;
    // return the sync ID as the display name
    return `Actual (${this.budgetSyncId.slice(0, 8)}...)`;
  }

  // -- Accounts --

  async getAccounts(): Promise<BudgetAccount[]> {
    const res = await this.request<{ data: ActualAccount[] }>("/accounts");
    // Fetch balances for each account
    const accounts = res.data.map(mapAccount);
    // Try to get balances individually
    for (const acct of accounts) {
      try {
        const balRes = await this.request<{ data: { balance: number } }>(
          `/accounts/${acct.id}/balance`,
        );
        acct.balance = fromCents(balRes.data.balance);
        acct.clearedBalance = acct.balance;
      } catch {
        // Balance may already be included in the account data
      }
    }
    return accounts;
  }

  async getAccountBalance(accountId: string): Promise<number> {
    const res = await this.request<{ data: { balance: number } }>(
      `/accounts/${accountId}/balance`,
    );
    return fromCents(res.data.balance);
  }

  // -- Categories & Months --

  async getCategories(): Promise<BudgetCategoryGroup[]> {
    const [groupsRes, catsRes] = await Promise.all([
      this.request<{ data: ActualCategoryGroup[] }>("/categorygroups"),
      this.request<{ data: ActualCategory[] }>("/categories"),
    ]);

    // Merge categories into groups
    const catsByGroup = new Map<string, ActualCategory[]>();
    for (const cat of catsRes.data) {
      const list = catsByGroup.get(cat.group_id) ?? [];
      list.push(cat);
      catsByGroup.set(cat.group_id, list);
    }

    return groupsRes.data.map((g) => ({
      ...mapCategoryGroup({
        ...g,
        categories: catsByGroup.get(g.id) ?? [],
      }),
    }));
  }

  async getMonths(_start: string, _end: string): Promise<BudgetMonth[]> {
    const res = await this.request<{ data: ActualMonth[] }>("/months");
    return res.data
      .filter((m) => m.month >= _start && m.month <= _end)
      .map(mapMonth);
  }

  async getMonthDetail(month: string): Promise<BudgetMonthDetail> {
    const res = await this.request<{ data: ActualMonth }>(`/months/${month}`);
    return mapMonthDetail(res.data);
  }

  async updateCategoryBudgeted(
    month: string,
    categoryId: string,
    amount: number,
  ): Promise<void> {
    await this.request(`/months/${month}/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({ budgeted: toCents(amount) }),
    });
  }

  async updateCategoryGoalTarget(
    _categoryId: string,
    _targetAmount: number,
    _month: string,
  ): Promise<void> {
    // Actual Budget doesn't support goal targets natively — no-op
  }

  // -- Transactions --

  async getTransactions(sinceDate: string): Promise<BudgetTransaction[]> {
    // Actual requires transactions per account; fetch all accounts then aggregate
    const accounts = await this.request<{ data: ActualAccount[] }>("/accounts");
    const allTx: BudgetTransaction[] = [];

    for (const acct of accounts.data) {
      if (acct.closed) continue;
      try {
        const res = await this.request<{ data: ActualTransaction[] }>(
          `/accounts/${acct.id}/transactions?since_date=${sinceDate}`,
        );
        allTx.push(
          ...res.data.map((t) =>
            mapTransaction({ ...t, account_name: acct.name }),
          ),
        );
      } catch {
        // Skip accounts with no transactions endpoint
      }
    }

    return allTx;
  }

  async createTransaction(tx: NewBudgetTransaction): Promise<string> {
    const res = await this.request<{ data: { id: string } }>(
      `/accounts/${tx.accountId}/transactions`,
      {
        method: "POST",
        body: JSON.stringify({
          date: tx.date,
          amount: toCents(tx.amount),
          payee_name: tx.payeeName,
          category: tx.categoryId,
          notes: tx.memo,
          cleared: tx.cleared ?? false,
        }),
      },
    );
    return res.data.id;
  }

  async updateTransaction(
    txId: string,
    tx: Partial<NewBudgetTransaction>,
  ): Promise<void> {
    const body: Record<string, unknown> = {};
    if (tx.date !== undefined) body.date = tx.date;
    if (tx.amount !== undefined) body.amount = toCents(tx.amount);
    if (tx.payeeName !== undefined) body.payee_name = tx.payeeName;
    if (tx.categoryId !== undefined) body.category = tx.categoryId;
    if (tx.memo !== undefined) body.notes = tx.memo;
    if (tx.cleared !== undefined) body.cleared = tx.cleared;

    await this.request(`/transactions/${txId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
}
