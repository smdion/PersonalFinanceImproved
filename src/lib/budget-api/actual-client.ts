// Actual Budget client (BudgetAPIClient) over the jhonderson/actual-http-api wrapper.
// Base URL: {serverUrl}/v1/budgets/{budgetSyncId}; auth: x-api-key header.
// Amounts: integer cents (÷100 for dollars).

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
} from "./types";
import { fromCents, toCents } from "./conversions";
import {
  BudgetApiError,
  isResendable,
  isTransientError,
  retold,
  serviceError,
} from "./errors";
import { externalRequest } from "@/lib/http/external-request";
import type { z } from "zod/v4";
import { actualSchemas } from "./actual-schemas";
import {
  NO_NAMES,
  mapAccount,
  mapCategoryGroup,
  mapMonthDetail,
  mapTransaction,
  payeeNames,
  type CategoryFields,
} from "./actual-mappers";
import {
  mergeGoalIntoNote,
  parseGoalFromNote,
  type ActualTemplateShape,
} from "./actual-goal-notes";
import { transactionIdempotencyKey } from "./idempotency";
import { log } from "@/lib/logger";

// -- Client --

/** The `until_date` every transaction list sends: the last day Actual's
 *  YYYYMMDD dates can hold. Otherwise the wrapper's lists end at its own
 *  today and drop later-dated transactions (e.g. snapshot adjustments). */
const ACTUAL_LIST_UNTIL = "9999-12-31";

/** At most this many requests to the wrapper at once: it reloads the
 *  budget per request and struggles when many run together. */
const WRAPPER_BATCH_SIZE = 10;

/** The import id Ledgr writes to `imported_id`, prefixed so it's
 *  recognizable in the Actual UI; createTransaction finds its new
 *  transaction by it (the wrapper's POST doesn't dedupe on it). */
function actualImportedId(tx: NewBudgetTransaction): string {
  const idempotencyKey = transactionIdempotencyKey({
    importKey: tx.importKey,
    accountId: tx.accountId,
    date: tx.date,
    amount: toCents(tx.amount),
    payee: tx.payeeName ?? null,
    memo: tx.memo ?? null,
  });
  return `ledgr:${idempotencyKey.slice(0, 30)}`;
}

/** Runs `fn` over `items`, `size` at a time. */
async function inBatches<T>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size)
    await Promise.all(items.slice(i, i + size).map(fn));
}

/** Actual's month id. The wrapper's `/months/:id` wants `YYYY-MM`; callers pass
 *  YNAB's `YYYY-MM-01`, and getMonths passes Actual's own bare ids: the slice
 *  takes both. */
function toActualMonthId(month: string): string {
  return month.slice(0, 7);
}

/** A cold wrapper's first budget load (migrations + login) breaks under
 *  concurrent requests, so per wrapper the first request runs alone and the
 *  rest wait; a load failure on a warm wrapper marks it cold again. */
type WrapperGate = { warm: boolean; pending: Promise<void> | null };
const wrapperGates = new Map<string, WrapperGate>();

function gateFor(wrapperUrl: string): WrapperGate {
  let gate = wrapperGates.get(wrapperUrl);
  if (!gate) {
    gate = { warm: false, pending: null };
    wrapperGates.set(wrapperUrl, gate);
  }
  return gate;
}

/** @internal Test-only: forget every wrapper's warm state. */
export function resetActualWrapperGates(): void {
  wrapperGates.clear();
}

/** The wrapper had no budget open, so the request never ran. */
function isBudgetNotOpen(err: unknown): boolean {
  return (
    err instanceof BudgetApiError &&
    err.status === 404 &&
    /no budget file is open/i.test(err.responseText ?? "")
  );
}

/** True if the wrapper failed to load the budget, not the request itself. */
function isBudgetLoadFailure(err: unknown): boolean {
  if (!(err instanceof BudgetApiError)) return false;
  if (
    err.code === "server" ||
    err.code === "network" ||
    err.code === "timeout"
  ) {
    return true;
  }
  return isBudgetNotOpen(err);
}

/** Safe to send again after a failure: harmless to repeat (isResendable)
 *  or the wrapper says it never ran. A POST that timed out or hit a server
 *  error may have been applied, so resending could add it twice. */
function safeToResend(err: unknown, init?: RequestInit): boolean {
  return (
    isBudgetNotOpen(err) ||
    (err instanceof BudgetApiError && isResendable(err, init))
  );
}

export class ActualClient implements BudgetAPIClient {
  getExcludedCategoryNames(): Set<string> {
    return new Set();
  }

  private readonly headers: Record<string, string>;
  private readonly budgetPath: string;
  private readonly gate: WrapperGate;

  constructor(
    private readonly serverUrl: string,
    apiKey: string,
    private readonly budgetSyncId: string,
  ) {
    // serverUrl may be http:// (lib/http/url-safety.ts allows it for
    // Actual), so this x-api-key can cross the LAN in cleartext.
    this.headers = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };
    // Strip trailing slash
    const base = serverUrl.replace(/\/$/, "");
    this.budgetPath = `${base}/v1/budgets/${budgetSyncId}`;
    // Keyed by wrapper, not budget: the wrapper holds one loaded budget.
    this.gate = gateFor(base);
  }

  /** Internal fetch wrapper — see externalRequest (lib/http). */
  private send<S extends z.ZodType>(
    path: string,
    schema: S,
    init?: RequestInit,
  ): Promise<z.infer<S>> {
    return externalRequest({
      service: "actual",
      endpoint: path,
      url: `${this.budgetPath}${path}`,
      headers: this.headers,
      init,
      schema,
    });
  }

  /** send() behind the wrapper's cold-load gate — see WrapperGate above. */
  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    init?: RequestInit,
    retried = false,
  ): Promise<z.infer<S>> {
    const gate = this.gate;

    if (gate.warm) {
      try {
        return await this.send(path, schema, init);
      } catch (err) {
        if (retried || !isBudgetLoadFailure(err)) throw err;
        log("warn", "actual_client.wrapper_went_cold", {
          error: err instanceof Error ? err.message : String(err),
        });
        // The next request reloads the budget alone either way.
        gate.warm = false;
        if (!safeToResend(err, init)) throw err;
        return this.request(path, schema, init, true);
      }
    }

    if (gate.pending) {
      // Rejects only if the first request's budget load failed.
      await gate.pending;
      return this.request(path, schema, init, retried);
    }

    const attempt = this.send(path, schema, init);
    const pending = attempt.then(
      () => undefined,
      (err: unknown) => {
        if (isBudgetLoadFailure(err)) throw err;
      },
    );
    // Waiters see the rejection; this only stops an unhandled-rejection
    // warning when nobody is waiting.
    pending.catch(() => undefined);
    gate.pending = pending;
    try {
      const res = await attempt;
      gate.warm = true;
      return res;
    } catch (err) {
      // Any other error means the wrapper got past loading the budget.
      if (!isBudgetLoadFailure(err)) gate.warm = true;
      throw err;
    } finally {
      gate.pending = null;
    }
  }

  async testConnection(): Promise<void> {
    await this.request("/accounts", actualSchemas.accounts);
  }

  async getBudgetName(): Promise<string> {
    // Actual HTTP API doesn't have a budget name endpoint;
    // return the sync ID as the display name
    return `Actual (${this.budgetSyncId.slice(0, 8)}...)`;
  }

  // -- Accounts --

  async getAccounts(): Promise<BudgetAccount[]> {
    const res = await this.request("/accounts", actualSchemas.accounts);
    // Fetch balances for each account
    const accounts = res.data.map(mapAccount);
    // Balances in parallel; a transient failure gets one more try alone (the
    // wrapper struggles under concurrency). Still failing, the sync stops: a
    // missing balance would be written as $0 over the good cache.
    const failed: BudgetAccount[] = [];
    await inBatches(accounts, WRAPPER_BATCH_SIZE, async (account) => {
      try {
        // Same endpoint/shape as getAccountBalance below.
        const balance = await this.getAccountBalance(account.id);
        account.balance = balance;
        account.clearedBalance = balance;
      } catch (err) {
        if (!isTransientError(err)) throw err;
        failed.push(account);
      }
    });
    const unavailable: string[] = [];
    let lastError: BudgetApiError | undefined;
    for (const account of failed) {
      try {
        const balance = await this.getAccountBalance(account.id);
        account.balance = balance;
        account.clearedBalance = balance;
      } catch (err) {
        if (!isTransientError(err)) throw err;
        lastError = err as BudgetApiError;
        log("warn", "actual_client.balance_fetch_failed", {
          accountId: account.id,
          error: lastError.message,
        });
        unavailable.push(account.name);
      }
    }
    // Keeps the failure's code, so a caller can tell a timeout from a 5xx.
    if (lastError)
      throw retold(
        lastError,
        `Actual didn't return a balance for ${unavailable.join(", ")} — nothing was synced; try again`,
      );
    return accounts;
  }

  /** The wrapper's `GET /accounts/:id/balance` returns the balance as the
   *  bare `data` value (`res.json({ data: balance || 0 })`), not nested
   *  under `data.balance`. */
  async getAccountBalance(
    accountId: string,
    asOfDate?: string,
  ): Promise<number> {
    // cutoff_date is inclusive and read as a local date by the wrapper, so
    // the wrapper's time zone doesn't move the figure; without it the
    // balance is "up to the wrapper's today".
    const res = await this.request(
      `/accounts/${accountId}/balance${asOfDate ? `?cutoff_date=${asOfDate}` : ""}`,
      actualSchemas.balance,
    );
    return fromCents(res.data);
  }

  // -- Categories & Months --

  /** `/categorygroups` and `/categories` carry names only; each category's
   *  numbers come from the current month, merged in by id. A category the
   *  month doesn't list yet (just created) has 0 for each. */
  async getCategories(now: Date): Promise<BudgetCategoryGroup[]> {
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [groupsRes, catsRes, monthDetail] = await Promise.all([
      this.request("/categorygroups", actualSchemas.categoryGroups),
      this.request("/categories", actualSchemas.categories),
      this.getMonthDetail(currentMonth),
    ]);

    // monthDetail.categories already carries this month's numbers and the
    // note-goal overlay (getMonthDetail applies both), so the month is
    // fetched and overlaid once.
    const currentByCatId = new Map(
      monthDetail.categories.map((c) => [c.id, c]),
    );

    const catsByGroup = new Map<string, CategoryFields[]>();
    for (const cat of catsRes.data) {
      const list = catsByGroup.get(cat.group_id) ?? [];
      list.push(cat);
      catsByGroup.set(cat.group_id, list);
    }

    return groupsRes.data.map((g) => {
      const mapped = mapCategoryGroup({
        ...g,
        categories: catsByGroup.get(g.id) ?? [],
      });
      return {
        ...mapped,
        categories: mapped.categories.map((c) => currentByCatId.get(c.id) ?? c),
      };
    });
  }

  /** `GET /months` returns bare month-id strings (`"2020-01"`), not
   *  `ActualMonth` objects; only `GET /months/:id` carries
   *  income/budgeted/spent, so each month in range is fetched on its own. */
  async getMonths(start: string, end: string): Promise<BudgetMonth[]> {
    const res = await this.request("/months", actualSchemas.monthIds);
    const inRange = res.data.filter((id) => id >= start && id <= end);
    // Batched, not one unbounded Promise.all fan-out — a wide date range could otherwise fire dozens of
    // concurrent requests at the actual-http-api wrapper at once. No
    // live caller today, but this is the shape any future one inherits.
    const details: BudgetMonthDetail[] = [];
    await inBatches(inRange, WRAPPER_BATCH_SIZE, async (id) => {
      details.push(await this.getMonthDetail(id));
    });
    details.sort((a, b) => a.month.localeCompare(b.month));
    return details.map(({ categories: _categories, ...month }) => month);
  }

  async getMonthDetail(month: string): Promise<BudgetMonthDetail> {
    const res = await this.request(
      `/months/${toActualMonthId(month)}`,
      actualSchemas.month,
    );
    const detail = mapMonthDetail(res.data);
    await this.overlayNoteGoals(detail.categories);
    return detail;
  }

  /** Reads each category's goal from its note's `#template` (Actual sends
   *  no goal field). A note still failing after its second try stops the
   *  read: a goal left out would be cached as "no goal" over a good one. */
  private async overlayNoteGoals(categories: BudgetCategory[]): Promise<void> {
    const readNote = async (cat: BudgetCategory) => {
      const noteRes = await this.request(
        `/notes/category/${cat.id}`,
        actualSchemas.note,
      );
      const noteGoal =
        parseGoalFromNote(noteRes.data, "fixed") ??
        parseGoalFromNote(noteRes.data, "target-balance");
      if (noteGoal !== undefined) cat.goalTarget = noteGoal;
    };
    // A few at a time; a note that fails transiently gets one more try on
    // its own, as account balances do.
    const failed: BudgetCategory[] = [];
    await inBatches(categories, WRAPPER_BATCH_SIZE, async (cat) => {
      try {
        await readNote(cat);
      } catch (err) {
        if (!isTransientError(err)) throw err;
        failed.push(cat);
      }
    });
    for (const cat of failed) {
      try {
        await readNote(cat);
      } catch (err) {
        if (!isTransientError(err)) throw err;
        throw retold(
          err as BudgetApiError,
          `Actual didn't return the note for ${cat.name}, so its goal is unknown — nothing was synced; try again`,
        );
      }
    }
  }

  /** The wrapper's `PATCH /months/:month/categories/:id` requires the body
   *  nested under a non-empty `category` object, not a flat body. */
  async updateCategoryBudgeted(
    month: string,
    categoryId: string,
    amount: number,
  ): Promise<void> {
    await this.request(
      `/months/${toActualMonthId(month)}/categories/${categoryId}`,
      actualSchemas.written,
      {
        method: "PATCH",
        body: JSON.stringify({ category: { budgeted: toCents(amount) } }),
      },
    );
  }

  /** Actual's API can't write a structured goal, so a goal is a `#template`
   *  line in the category's note (what "Apply Budget Template" reads),
   *  merged by actual-goal-notes.ts without touching the rest of the note. */
  async prepareGoalWrite(
    categoryId: string,
    shape: GoalShape,
    targetAmount: number,
  ): Promise<PreparedGoalWrite> {
    const templateShape: ActualTemplateShape =
      shape === "monthly" ? "fixed" : "target-balance";
    const noteRes = await this.request(
      `/notes/category/${categoryId}`,
      actualSchemas.note,
    );
    const merged = mergeGoalIntoNote(noteRes.data, templateShape, targetAmount);
    if (!merged.ok) {
      throw serviceError("Actual", merged.reason, "conflict");
    }
    return {
      apply: async () => {
        await this.request(
          `/notes/category/${categoryId}`,
          actualSchemas.written,
          {
            method: "PUT",
            body: JSON.stringify({ data: merged.note }),
          },
        );
      },
    };
  }

  // -- Transactions --

  async getTransactions(sinceDate: string): Promise<BudgetTransaction[]> {
    // Actual lists transactions per account, with ids only: names come from
    // one read of each list, and a bad list fails the sync before any write.
    const [accounts, categories, payees] = await Promise.all([
      this.request("/accounts", actualSchemas.accounts),
      this.request("/categories", actualSchemas.categories),
      this.request("/payees", actualSchemas.payees),
    ]);
    const categoryNames = new Map(categories.data.map((c) => [c.id, c.name]));
    const payeeNameById = payeeNames(payees.data, accounts.data);
    const allTx: BudgetTransaction[] = [];

    for (const account of accounts.data) {
      if (account.closed) continue;
      try {
        const res = await this.request(
          `/accounts/${account.id}/transactions?since_date=${sinceDate}&until_date=${ACTUAL_LIST_UNTIL}`,
          actualSchemas.transactions,
        );
        allTx.push(
          ...res.data.map((t) =>
            mapTransaction(t, {
              accountName: account.name,
              categories: categoryNames,
              payees: payeeNameById,
            }),
          ),
        );
      } catch (err) {
        // Only a 404 (the account is gone) may be skipped. Any other failure
        // stops the sync, which changes nothing locally: a dropped account
        // would be cached as a complete transaction list.
        if (err instanceof BudgetApiError && err.status === 404) continue;
        log("warn", "actual_client.transactions_fetch_failed", {
          accountId: account.id,
          error: err instanceof Error ? err.message : String(err),
        });
        const reason = err instanceof Error ? err.message : String(err);
        if (err instanceof BudgetApiError) {
          throw retold(
            err,
            `Actual didn't return transactions for ${account.name} — nothing was synced: ${reason}`,
          );
        }
        throw new Error(
          `Actual didn't return transactions for ${account.name} — nothing was synced: ${reason}`,
        );
      }
    }

    return allTx;
  }

  async createTransaction(tx: NewBudgetTransaction): Promise<string> {
    const importedId = actualImportedId(tx);

    // The body must be nested under `transaction` (a flat body 400s). The
    // response is only `{"message":"ok"}` with no id, so the transaction is
    // looked back up by its deterministic `imported_id` to get its real id.
    await this.request(
      `/accounts/${tx.accountId}/transactions`,
      actualSchemas.written,
      {
        method: "POST",
        body: JSON.stringify({
          transaction: {
            account: tx.accountId,
            date: tx.date,
            amount: toCents(tx.amount),
            payee_name: tx.payeeName,
            category: tx.categoryId,
            notes: tx.memo,
            // reconciled implies cleared — never send reconciled: true with
            // cleared: false, an inconsistent state Actual's own UI can't
            // produce. See NewBudgetTransaction.reconciled docblock.
            cleared: tx.cleared || tx.reconciled || false,
            reconciled: tx.reconciled,
            imported_id: importedId,
          },
        }),
      },
    );
    const created = await this.findCreatedTransaction(tx);
    if (!created) {
      throw serviceError(
        "Actual",
        `Created a transaction on Actual (account ${tx.accountId}, imported_id ${importedId}) but couldn't find it back afterward to return its id.`,
        "server",
      );
    }
    return created;
  }

  async findCreatedTransaction(
    tx: NewBudgetTransaction,
  ): Promise<string | null> {
    const importedId = actualImportedId(tx);
    // Exactly the day it wrote: the wrapper's lists otherwise end at its
    // own today, so a later-dated transaction was posted but never found.
    const res = await this.request(
      `/accounts/${tx.accountId}/transactions?since_date=${tx.date}&until_date=${tx.date}`,
      actualSchemas.transactions,
    );
    return res.data.find((t) => t.imported_id === importedId)?.id ?? null;
  }

  async deleteTransaction(transactionId: string): Promise<void> {
    await this.request(
      `/transactions/${transactionId}`,
      actualSchemas.written,
      {
        method: "DELETE",
      },
    );
  }

  async getAccountTransactions(
    accountId: string,
    sinceDate: string,
  ): Promise<BudgetTransaction[]> {
    const res = await this.request(
      `/accounts/${accountId}/transactions?since_date=${sinceDate}&until_date=${ACTUAL_LIST_UNTIL}`,
      actualSchemas.transactions,
    );
    // Its one reader matches on the memo, so no names are looked up.
    return res.data.map((t) => mapTransaction(t, NO_NAMES));
  }

  /** The wrapper's `PATCH /transactions/:id` requires the body nested under
   *  a non-empty `transaction` object, as `createTransaction` does. */
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
    if (tx.reconciled !== undefined) {
      transaction.reconciled = tx.reconciled;
      // Same defensive coupling as createTransaction: reconciled implies
      // cleared, and wins over an explicit cleared:false in the same call.
      if (tx.reconciled) transaction.cleared = true;
    }

    await this.request(`/transactions/${txId}`, actualSchemas.written, {
      method: "PATCH",
      body: JSON.stringify({ transaction }),
    });
  }
}
