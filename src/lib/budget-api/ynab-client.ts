// YNAB API client implementing BudgetAPIClient.
// Base URL: https://api.ynab.com/v1
// Auth: Bearer token
// Amounts: milliunits (÷1000 for dollars)

import { BudgetApiError } from "./errors";
import "server-only";
import type {
  BudgetAPIClient,
  GoalShape,
  PreparedGoalWrite,
} from "./interface";
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
import { roundToCents } from "@/lib/utils/math";
import { externalRequest, uncheckedShape } from "@/lib/http/external-request";
import type { z } from "zod/v4";
import {
  ynabSchemas,
  type YnabAccount,
  type YnabCategory,
  type YnabCategoryGroup,
  type YnabMonth,
  type YnabTransaction,
} from "./ynab-schemas";
import { transactionIdempotencyKey } from "./idempotency";
import {
  YNAB_EXPENSE_EXCLUDED_CATEGORIES,
  YNAB_INTERNAL_GROUPS,
} from "@/lib/config/ynab";

const YNAB_BASE = "https://api.ynab.com/v1";

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
    transferPayeeId: a.transfer_payee_id ?? undefined,
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

function mapMonthDetail(
  m: YnabMonth & { categories: YnabCategory[] },
): BudgetMonthDetail {
  return {
    ...mapMonth(m),
    categories: m.categories
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
    payeeName: t.payee_name ?? null,
    categoryId: t.category_id ?? null,
    categoryName: t.category_name ?? null,
    memo: t.memo ?? null,
    cleared: t.cleared === "cleared" || t.cleared === "reconciled",
    approved: t.approved,
    deleted: t.deleted,
    ...(t.subtransactions.length && {
      subtransactions: t.subtransactions
        .filter((st) => !st.deleted)
        .map((st) => ({
          categoryId: st.category_id ?? null,
          categoryName: st.category_name ?? null,
          amount: fromMilliunits(st.amount),
          memo: st.memo ?? null,
        })),
    }),
  };
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

  async testConnection(): Promise<boolean> {
    try {
      // Use /settings — lightweight endpoint, avoids fetching the full budget object
      await this.request("/settings", ynabSchemas.written);
      return true;
    } catch {
      return false;
    }
  }

  async getBudgetName(): Promise<string> {
    // Use the budgets list endpoint to get the name without fetching the full budget
    const res = await this.request(
      `${YNAB_BASE}/budgets?include_accounts=false`,
      ynabSchemas.budgets,
    );
    const match = res.data.budgets.find((b) => b.id === this.budgetId);
    return match?.name ?? "Unknown Budget";
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
      throw new BudgetApiError(
        "This category's target isn't a plain monthly one — left untouched to avoid overwriting a target configured directly in YNAB.",
        "conflict",
        null,
      );
    return {
      apply: () => this.writeMonthlyGoal(categoryId, targetAmount),
    };
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
          // "reconciled" implies cleared — YNAB has no separate reconciled
          // field, just a 3-value enum. See NewBudgetTransaction.reconciled
          // docblock for why this derives cleared rather than trusting the
          // caller to set both.
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
    throw new BudgetApiError(
      holders.length > 0
        ? `YNAB won't post this transaction on account ${tx.accountId}: a deleted transaction holds its import_id ${importId}.`
        : `YNAB reported import_id ${importId} as a duplicate on account ${tx.accountId}, but no transaction with it was found.`,
      "client",
      null,
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

  // -- Delta sync --

  async getDelta(serverKnowledge: number): Promise<DeltaSyncResult<unknown>> {
    // No caller; reads the wrong shape, so its answer isn't checked.
    const res = await this.request(
      `?last_knowledge_of_server=${serverKnowledge}`,
      uncheckedShape<
        YnabDeltaResponse<{
          accounts: YnabAccount[];
          categories: YnabCategoryGroup[];
          transactions: YnabTransaction[];
          months: YnabMonth[];
        }>
      >(),
    );

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
