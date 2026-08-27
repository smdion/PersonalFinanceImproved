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
import { budgetApiRequest, BudgetApiError } from "./errors";
import {
  mergeGoalIntoNote,
  type ActualTemplateShape,
} from "./actual-goal-notes";
import { transactionIdempotencyKey } from "./idempotency";
import { log } from "@/lib/logger";

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

// Field names AND shape re-verified LIVE against the deployed wrapper —
// GET /months/:month does NOT return a flat `income`/`budgeted`/`spent`/
// `to_budget`/`categories` object; it returns `totalIncome`/`totalBudgeted`/
// `totalSpent`/`toBudget`/`categoryGroups` (categories nested one level
// deeper, per group, not a flat top-level array). The old flat-shaped type
// here silently read every field as `undefined` (NaN after fromCents) and
// `categories` as always empty — getMonthDetail() never actually returned
// any category data, breaking budget.syncBudgetFromApi's real pull for
// every Actual household.
type ActualMonth = {
  month: string;
  totalIncome: number;
  totalBudgeted: number;
  totalSpent: number;
  toBudget: number;
  categoryGroups?: ActualCategoryGroup[];
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
  imported_id?: string;
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
    income: fromCents(m.totalIncome),
    // Real totalBudgeted comes back negative (an outflow-from-ready-to-
    // assign figure) while every per-category `budgeted` is positive —
    // Math.abs so this summary matches that same "positive = allocated"
    // convention instead of surprising a caller expecting YNAB's sign.
    budgeted: Math.abs(fromCents(m.totalBudgeted)),
    activity: fromCents(m.totalSpent),
    toBeBudgeted: fromCents(m.toBudget),
  };
}

function mapMonthDetail(m: ActualMonth): BudgetMonthDetail {
  const categories = (m.categoryGroups ?? []).flatMap((g) =>
    g.categories.map((c) => mapCategory(c, g.name)),
  );
  return {
    ...mapMonth(m),
    categories,
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

  getExcludedCategoryNames(): Set<string> {
    return new Set();
  }

  private readonly headers: Record<string, string>;
  private readonly budgetPath: string;

  constructor(
    private readonly serverUrl: string,
    apiKey: string,
    private readonly budgetSyncId: string,
  ) {
    // L130 (2026-08-06): serverUrl may be http:// (see url-safety.ts —
    // permitted for LAN-friendly self-hosted use), in which case this
    // x-api-key header is sent in cleartext. Accepted tradeoff, documented
    // in validateOutboundUrl()'s doc comment; not fixed here.
    this.headers = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };
    // Strip trailing slash
    const base = serverUrl.replace(/\/$/, "");
    this.budgetPath = `${base}/v1/budgets/${budgetSyncId}`;
  }

  /** Internal fetch wrapper — see budgetApiRequest in ./errors (M45). */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.budgetPath}${path}`;
    return budgetApiRequest<T>(url, this.headers, init);
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
    // Try to get balances individually (parallelized — each call already
    // retries up to 3x with exponential backoff via budgetApiRequest).
    await Promise.all(
      accounts.map(async (acct) => {
        try {
          // Same endpoint/shape as getAccountBalance below — call it
          // directly instead of re-duplicating the (previously wrong)
          // response parsing here. This duplicate site had the identical
          // `data.balance` bug, silently producing NaN for every account's
          // balance (no throw, so the catch below never caught it).
          const balance = await this.getAccountBalance(acct.id);
          acct.balance = balance;
          acct.clearedBalance = balance;
        } catch (err) {
          // Balance may already be included in the account data, but this
          // could also be a real failure (auth, network, etc.) — log it so
          // it's debuggable instead of failing silently.
          log("warn", "actual_client.balance_fetch_failed", {
            accountId: acct.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
    return accounts;
  }

  /**
   * The wrapper's `GET /accounts/:id/balance` returns the balance as the
   * bare `data` value (`res.json({ data: balance || 0 })` — verified
   * against actual-http-api's literal route source, 26.8.1), NOT nested
   * under `data.balance`. Reading `res.data.balance` (the old code here)
   * silently produced NaN on every call — pushSnapshotToBudgetApi's
   * delta-vs-live-balance math was broken for every Actual household. */
  async getAccountBalance(accountId: string): Promise<number> {
    const res = await this.request<{ data: number }>(
      `/accounts/${accountId}/balance`,
    );
    return fromCents(res.data);
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

  /** `GET /months` (no month id) does NOT return `ActualMonth` objects —
   * re-verified LIVE against the deployed wrapper: it's a bare array of
   * month-id strings (`["2020-01", ..., "2027-07"]`), each of which needs
   * its own `GET /months/:id` call to get real data (only that endpoint
   * returns income/budgeted/spent — see mapMonth's docblock). The old code
   * here treated each string as an `ActualMonth` object, reading every
   * field off a string primitive — always NaN/undefined, though this
   * method currently has no live caller in the app so it never surfaced. */
  async getMonths(start: string, end: string): Promise<BudgetMonth[]> {
    const res = await this.request<{ data: string[] }>("/months");
    const inRange = res.data.filter((id) => id >= start && id <= end);
    const details = await Promise.all(
      inRange.map((id) => this.getMonthDetail(id)),
    );
    return details.map(({ categories: _categories, ...month }) => month);
  }

  async getMonthDetail(month: string): Promise<BudgetMonthDetail> {
    const res = await this.request<{ data: ActualMonth }>(`/months/${month}`);
    return mapMonthDetail(res.data);
  }

  /** The wrapper's `PATCH /months/:month/categories/:id` requires
   * `req.body.category` (a non-empty object — `isEmpty(req.body.category)`
   * throws otherwise), not a flat top-level body. Verified against the
   * route's literal source, 26.8.1. The old flat `{budgeted}` body made
   * every budgeted-amount push to Actual fail. */
  async updateCategoryBudgeted(
    month: string,
    categoryId: string,
    amount: number,
  ): Promise<void> {
    await this.request(`/months/${month}/categories/${categoryId}`, {
      method: "PATCH",
      body: JSON.stringify({ category: { budgeted: toCents(amount) } }),
    });
  }

  /**
   * There is no STRUCTURED field to write a category's goal amount —
   * verified against `@actual-app/api`'s own docs: `updateCategory` only
   * ever accepts name/group_id/is_income, on any release channel. Actual's
   * newer Budget Automations engine stores a goal as `goal_def` directly on
   * the category row (what `getCategories`' `cat.goal` reads — read-only
   * via this wrapper), but that field is never exposed for writing.
   *
   * The REAL, working mechanism is Actual's older note-based template
   * syntax (`#template <amount>` for a recurring monthly assignment,
   * `#template up to <amount>` for a refill-to-balance target) — written
   * through the actual-http-api wrapper's `PUT /notes/category/:id`
   * endpoint, the same place a household's own free-text category notes
   * live. `mergeGoalIntoNote` (`actual-goal-notes.ts`) does the actual
   * read-merge-write so this never clobbers unrelated note content or a
   * differently-shaped template the household configured directly in
   * Actual — it either updates a matching-shape template in place, appends
   * a fresh one if none exists, or throws `BudgetApiError` (code
   * `"conflict"`) if an incompatible template is already there.
   *
   * Known caveat: this writes the OLD note-based mechanism, not the newer
   * `goal_def` field `getCategories` reads back — so a goal pushed here
   * won't appear in `cat.goal`/`goalTarget` reads until the household (or
   * Actual itself) also sets it through the newer mechanism. The note-based
   * `#template` IS what Actual's own "Apply Budget Template" action reads,
   * though, so the push still does something real. */
  private async writeGoalNote(
    categoryId: string,
    shape: ActualTemplateShape,
    amount: number,
  ): Promise<void> {
    const noteRes = await this.request<{ data: string | null }>(
      `/notes/category/${categoryId}`,
    );
    const merged = mergeGoalIntoNote(noteRes.data, shape, amount);
    if (!merged.ok) {
      throw new BudgetApiError(merged.reason, "conflict", null);
    }
    await this.request(`/notes/category/${categoryId}`, {
      method: "PUT",
      body: JSON.stringify({ data: merged.note }),
    });
  }

  async updateCategoryGoalTarget(
    categoryId: string,
    targetAmount: number,
  ): Promise<void> {
    await this.writeGoalNote(categoryId, "fixed", targetAmount);
  }

  async updateCategoryTargetBalance(
    categoryId: string,
    targetAmount: number,
  ): Promise<void> {
    await this.writeGoalNote(categoryId, "target-balance", targetAmount);
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
    // v0.5 expert-review M20: deterministic idempotency key. Actual's
    // transaction model includes an `imported_id` field that the server
    // uses for dedupe on import. Mirror the YNAB pattern: hash the
    // canonical fingerprint and prefix it so it's recognizable as
    // ledgr-generated in the Actual UI.
    const idempotencyKey = transactionIdempotencyKey({
      accountId: tx.accountId,
      date: tx.date,
      amount: toCents(tx.amount),
      payee: tx.payeeName ?? null,
      memo: tx.memo ?? null,
    });
    const importedId = `ledgr:${idempotencyKey.slice(0, 30)}`;

    // The wrapper's `POST /accounts/:id/transactions` request body must be
    // nested under a `transaction` key (verified against the route's
    // literal source, and reconfirmed live: an un-nested body 400s). Its
    // response, however, does NOT return the created transaction's id —
    // this was re-checked LIVE against the deployed image (both with and
    // without `imported_id` set) and it always replies `{"message":"ok"}`,
    // contradicting what actual-http-api's own budget.js source appeared
    // to promise (`addTransaction` resolving to `transactionIds[0]`) for
    // whatever reason (version drift between the pinned source read and
    // the deployed `:latest` build, a code path this wrapper's `addTransaction`
    // doesn't actually take, etc.) — don't trust that source reading over
    // this live-confirmed behavior again without re-verifying live.
    //
    // So: look the transaction back up by its own deterministic
    // `imported_id` immediately after creating it — the only way this
    // client gets a real id back, which `deleteTransaction`,
    // `pushSnapshotToBudgetApi`'s in-run rollback, and any future caller
    // that needs the id all depend on.
    await this.request(`/accounts/${tx.accountId}/transactions`, {
      method: "POST",
      body: JSON.stringify({
        transaction: {
          account: tx.accountId,
          date: tx.date,
          amount: toCents(tx.amount),
          payee_name: tx.payeeName,
          category: tx.categoryId,
          notes: tx.memo,
          cleared: tx.cleared ?? false,
          imported_id: importedId,
        },
      }),
    });
    const res = await this.request<{ data: ActualTransaction[] }>(
      `/accounts/${tx.accountId}/transactions?since_date=${tx.date}`,
    );
    const created = res.data.find((t) => t.imported_id === importedId);
    if (!created) {
      throw new BudgetApiError(
        `Created a transaction on Actual (account ${tx.accountId}, imported_id ${importedId}) but couldn't find it back afterward to return its id.`,
        "server",
        null,
      );
    }
    return created.id;
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    await this.request(`/transactions/${transactionId}`, { method: "DELETE" });
  }

  async getAccountTransactions(
    accountId: string,
    sinceDate: string,
  ): Promise<BudgetTransaction[]> {
    const res = await this.request<{ data: ActualTransaction[] }>(
      `/accounts/${accountId}/transactions?since_date=${sinceDate}`,
    );
    return res.data.map((t) => mapTransaction(t));
  }

  /** Same request-body nesting fix as `createTransaction` — the wrapper's
   * `PATCH /transactions/:id` requires `req.body.transaction` (a non-empty
   * object; validated via the same `validateTransactionBody`), not a flat
   * top-level body. Verified against the route's literal source, 26.8.1. */
  async updateTransaction(
    txId: string,
    tx: Partial<NewBudgetTransaction>,
  ): Promise<void> {
    const transaction: Record<string, unknown> = {};
    if (tx.date !== undefined) transaction.date = tx.date;
    if (tx.amount !== undefined) transaction.amount = toCents(tx.amount);
    if (tx.payeeName !== undefined) transaction.payee_name = tx.payeeName;
    if (tx.categoryId !== undefined) transaction.category = tx.categoryId;
    if (tx.memo !== undefined) transaction.notes = tx.memo;
    if (tx.cleared !== undefined) transaction.cleared = tx.cleared;

    await this.request(`/transactions/${txId}`, {
      method: "PATCH",
      body: JSON.stringify({ transaction }),
    });
  }
}
