// YNAB API client implementing BudgetAPIClient.
// Base URL: https://api.ynab.com/v1; auth: Bearer token.
// Amounts: milliunits (÷1000 for dollars).

import { serviceError } from "./errors";
import "server-only";
import type {
  BudgetAPIClient,
  GoalShape,
  PreparedGoalWrite,
} from "./interface";
import type {
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetMonth,
  BudgetMonthDetail,
  BudgetTransaction,
  NewBudgetTransaction,
} from "./types";
import { fromMilliunits, toMilliunits } from "./conversions";
import { roundToCents } from "@/lib/utils/math";
import { externalRequest } from "@/lib/http/external-request";
import type { z } from "zod/v4";
import {
  ynabSchemas,
  type YnabCategory,
  type YnabTransaction,
} from "./ynab-schemas";
import {
  mapAccount,
  mapCategoryGroup,
  mapMonth,
  mapMonthDetail,
  mapTransaction,
} from "./ynab-mappers";
import { transactionIdempotencyKey } from "./idempotency";
import {
  YNAB_EXPENSE_EXCLUDED_CATEGORIES,
  YNAB_INTERNAL_GROUPS,
} from "@/lib/config/ynab";

const YNAB_BASE = "https://api.ynab.com/v1";

/** No target yet, or one repeating every month: what a monthly push may
 *  replace. Weekly, yearly, every-N-months and dated targets aren't. */
function isPlainMonthlyGoal(c: YnabCategory): boolean {
  if (c.goal_target == null || c.goal_type === "MF") return true;
  return (
    c.goal_type === "NEED" &&
    c.goal_cadence === 1 &&
    (c.goal_cadence_frequency ?? 1) === 1
  );
}

// -- Client --

/** YNAB's `import_id` is its dedupe key (it has no Idempotency-Key header):
 *  the canonical fingerprint's hash, prefixed so it's recognizable as
 *  Ledgr's; YNAB allows 36 characters. */
function ynabImportId(tx: NewBudgetTransaction): string {
  const idempotencyKey = transactionIdempotencyKey({
    importKey: tx.importKey,
    accountId: tx.accountId,
    date: tx.date,
    amount: toMilliunits(tx.amount),
    payee: tx.payeeName ?? null,
    memo: tx.memo ?? null,
  });
  return `ledgr:${idempotencyKey.slice(0, 30)}`;
}

/** The budgets an access token can open (YNAB's `/budgets` list). Also
 *  used before a connection is saved, to pick the budget. */
export async function listYnabBudgets(
  accessToken: string,
): Promise<Array<{ id: string; name: string; lastModified: string | null }>> {
  const res = await externalRequest({
    service: "ynab",
    endpoint: "/budgets",
    url: `${YNAB_BASE}/budgets?include_accounts=false`,
    headers: { Authorization: `Bearer ${accessToken}` },
    schema: ynabSchemas.budgets,
  });
  return res.data.budgets.map((b) => ({
    id: b.id,
    name: b.name,
    lastModified: b.last_modified_on ?? null,
  }));
}

export class YnabClient implements BudgetAPIClient {
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

  /** Internal fetch wrapper — see externalRequest (lib/http). */
  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    init?: RequestInit,
  ): Promise<z.infer<S>> {
    const url = path.startsWith("http") ? path : `${this.budgetPath}${path}`;
    return externalRequest({
      service: "ynab",
      endpoint: path,
      url,
      headers: this.headers,
      init,
      schema,
    });
  }

  async testConnection(): Promise<void> {
    // /settings — lightweight endpoint, avoids fetching the full budget object
    await this.request("/settings", ynabSchemas.written);
  }

  async getBudgetName(): Promise<string> {
    // The list carries the name without fetching the whole budget.
    const budgets = await listYnabBudgets(this.accessToken);
    return (
      budgets.find((b) => b.id === this.budgetId)?.name ?? "Unknown Budget"
    );
  }

  // -- Accounts --

  async getAccounts(): Promise<BudgetAccount[]> {
    const res = await this.request("/accounts", ynabSchemas.accounts);
    return res.data.accounts.map(mapAccount);
  }

  async getAccountBalance(
    accountId: string,
    asOfDate?: string,
  ): Promise<number> {
    const res = await this.request(
      `/accounts/${accountId}`,
      ynabSchemas.account,
    );
    const balance = fromMilliunits(res.data.account.balance);
    if (!asOfDate) return balance;
    // YNAB reports only the balance now: take off what's dated after.
    const later = (
      await this.getAccountTransactions(accountId, asOfDate)
    ).filter((t) => t.date > asOfDate);
    return roundToCents(later.reduce((s, t) => s - t.amount, balance));
  }

  // -- Categories & Months --

  async getCategories(): Promise<BudgetCategoryGroup[]> {
    const res = await this.request("/categories", ynabSchemas.categories);
    return res.data.category_groups
      .filter((g) => !YNAB_INTERNAL_GROUPS.has(g.name))
      .map(mapCategoryGroup);
  }

  async getMonths(start: string, _end: string): Promise<BudgetMonth[]> {
    // YNAB returns all months; we filter client-side
    const res = await this.request("/months", ynabSchemas.months);
    return res.data.months
      .filter((m) => m.month >= start && m.month <= _end)
      .map(mapMonth);
  }

  async getMonthDetail(month: string): Promise<BudgetMonthDetail> {
    const res = await this.request(`/months/${month}`, ynabSchemas.month);
    return mapMonthDetail(res.data.month);
  }

  async updateCategoryBudgeted(
    month: string,
    categoryId: string,
    amount: number,
  ): Promise<void> {
    await this.request(
      `/months/${month}/categories/${categoryId}`,
      ynabSchemas.written,
      {
        method: "PATCH",
        body: JSON.stringify({
          category: { budgeted: toMilliunits(amount) },
        }),
      },
    );
  }

  /** Reads the category for a monthly goal (only a plain monthly target or
   *  none may be replaced); a target-balance write needs no read. */
  async prepareGoalWrite(
    categoryId: string,
    shape: GoalShape,
    targetAmount: number,
  ): Promise<PreparedGoalWrite> {
    if (shape === "target-balance")
      return { apply: () => this.writeTargetBalance(categoryId, targetAmount) };
    // goal_frequency replaces whatever target is there, so a target of any
    // other shape is left alone and reported — the interface's contract,
    // and what Actual's note-based write does.
    const { data } = await this.request(
      `/categories/${categoryId}`,
      ynabSchemas.category,
    );
    if (!isPlainMonthlyGoal(data.category))
      throw serviceError(
        "YNAB",
        "This category's target isn't a plain monthly one — left untouched to avoid overwriting a target configured directly in YNAB.",
        "conflict",
      );
    return {
      apply: () => this.writeMonthlyGoal(categoryId, targetAmount),
    };
  }

  /** Set a recurring monthly goal (YNAB shows NEED / legacy MF) on the plan-level category:
   *  `goal_type` isn't writable, and omitting goal_frequency keeps an existing cadence,
   *  so "monthly" is sent explicitly. The month-category endpoint has no goal fields. */
  private async writeMonthlyGoal(
    categoryId: string,
    targetAmount: number,
  ): Promise<void> {
    await this.request(`/categories/${categoryId}`, ynabSchemas.written, {
      method: "PATCH",
      body: JSON.stringify({
        category:
          targetAmount === 0
            ? // Null removes a target; goal_frequency requires an amount.
              { goal_target: null }
            : {
                goal_target: toMilliunits(targetAmount),
                goal_frequency: "monthly",
              },
      }),
    });
  }

  /** Update only the amount of a target-balance goal (e.g. an emergency fund): sends just
   *  `goal_target`, which leaves the goal's shape untouched. The public API can't create
   *  that shape, so the goal is set up once in the YNAB app. */
  private async writeTargetBalance(
    categoryId: string,
    targetAmount: number,
  ): Promise<void> {
    await this.request(`/categories/${categoryId}`, ynabSchemas.written, {
      method: "PATCH",
      body: JSON.stringify({
        category: { goal_target: toMilliunits(targetAmount) },
      }),
    });
  }

  // -- Transactions --

  async getTransactions(sinceDate: string): Promise<BudgetTransaction[]> {
    const res = await this.request(
      `/transactions?since_date=${sinceDate}`,
      ynabSchemas.transactions,
    );
    return res.data.transactions.map(mapTransaction);
  }

  async createTransaction(tx: NewBudgetTransaction): Promise<string> {
    const importId = ynabImportId(tx);
    // A duplicate import_id isn't posted: YNAB answers without `transaction`
    // (in `duplicate_import_ids`). A live one with the id is returned; a
    // deleted one still holds the id, so nothing can be posted.
    const res = await this.request("/transactions", ynabSchemas.created, {
      method: "POST",
      body: JSON.stringify({
        transaction: {
          account_id: tx.accountId,
          date: tx.date,
          amount: toMilliunits(tx.amount),
          payee_name: tx.payeeName,
          category_id: tx.categoryId,
          memo: tx.memo,
          // "reconciled" implies cleared: YNAB has one 3-value enum, not a
          // separate reconciled field (see NewBudgetTransaction.reconciled).
          cleared: tx.reconciled
            ? "reconciled"
            : tx.cleared
              ? "cleared"
              : "uncleared",
          approved: tx.approved ?? true,
          import_id: importId,
        },
      }),
    });
    if (res.data.transaction) return res.data.transaction.id;
    const holders = await this.withImportId(tx);
    const live = holders.find((t) => !t.deleted);
    if (live) return live.id;
    throw serviceError(
      "YNAB",
      holders.length > 0
        ? `YNAB won't post this transaction on account ${tx.accountId}: a deleted transaction holds its import_id ${importId}.`
        : `YNAB reported import_id ${importId} as a duplicate on account ${tx.accountId}, but no transaction with it was found.`,
      "client",
    );
  }

  async findCreatedTransaction(
    tx: NewBudgetTransaction,
  ): Promise<string | null> {
    return (await this.withImportId(tx)).find((t) => !t.deleted)?.id ?? null;
  }

  /** Transactions on `tx.date` or later holding its import id (deleted
   *  ones too, if YNAB lists them). */
  private async withImportId(
    tx: NewBudgetTransaction,
  ): Promise<YnabTransaction[]> {
    const importId = ynabImportId(tx);
    const res = await this.request(
      `/accounts/${tx.accountId}/transactions?since_date=${tx.date}`,
      ynabSchemas.transactions,
    );
    return res.data.transactions.filter((t) => t.import_id === importId);
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    await this.request(`/transactions/${transactionId}`, ynabSchemas.written, {
      method: "DELETE",
    });
  }

  async getAccountTransactions(
    accountId: string,
    sinceDate: string,
  ): Promise<BudgetTransaction[]> {
    const res = await this.request(
      `/accounts/${accountId}/transactions?since_date=${sinceDate}`,
      ynabSchemas.transactions,
    );
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

    await this.request(`/transactions/${txId}`, ynabSchemas.written, {
      method: "PUT",
      body: JSON.stringify({ transaction: body }),
    });
  }
}
