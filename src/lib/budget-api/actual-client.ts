// Actual Budget HTTP API client implementing BudgetAPIClient.
// Uses jhonderson/actual-http-api wrapper.
// Base URL: {serverUrl}/v1/budgets/{budgetSyncId}
// Auth: x-api-key header
// Amounts: integer cents (÷100 for dollars)

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
import {
  actualSchemas,
  type ActualAccount,
  type ActualCategoryGroup,
  type ActualMonth,
  type ActualPayee,
  type ActualTransaction,
} from "./actual-schemas";
import {
  mergeGoalIntoNote,
  parseGoalFromNote,
  type ActualTemplateShape,
} from "./actual-goal-notes";
import { transactionIdempotencyKey } from "./idempotency";
import { log } from "@/lib/logger";

/** A category's fields as the mappers read them: `/categories` has no
 *  numbers, a month's income category has none either. */
type CategoryFields = {
  id: string;
  name: string;
  group_id: string;
  hidden: boolean;
  budgeted?: number;
  spent?: number;
  balance?: number;
};

// -- Conversion helpers --

function mapAccount(a: ActualAccount): BudgetAccount {
  return {
    id: a.id,
    name: a.name,
    // The wrapper's account list carries no type.
    type: "other",
    onBudget: !a.offbudget,
    closed: a.closed,
    // The list has no balances: getAccounts reads each one, or stops.
    balance: 0,
    clearedBalance: 0, // Actual doesn't distinguish
  };
}

function mapCategory(c: CategoryFields, groupName: string): BudgetCategory {
  return {
    id: c.id,
    name: c.name,
    groupId: c.group_id,
    groupName,
    hidden: c.hidden,
    budgeted: fromCents(c.budgeted ?? 0),
    activity: fromCents(c.spent ?? 0),
    balance: fromCents(c.balance ?? 0),
    // Set from the category's note (overlayNoteGoals); Actual sends none.
    goalTarget: undefined,
  };
}

function mapCategoryGroup(
  g: ActualCategoryGroup & { categories: CategoryFields[] },
): BudgetCategoryGroup {
  return {
    id: g.id,
    name: g.name,
    hidden: g.hidden || g.is_income,
    isIncome: g.is_income,
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
    toBeBudgeted: m.toBudget === null ? null : fromCents(m.toBudget),
  };
}

function mapMonthDetail(m: ActualMonth): BudgetMonthDetail {
  const categories = m.categoryGroups.flatMap((g) =>
    g.categories.map((c) => mapCategory(c, g.name)),
  );
  return {
    ...mapMonth(m),
    categories,
  };
}

/** Names for a transaction's ids. A lookup without the id gives `null`:
 *  an id is never shown as a name. */
type TransactionNames = {
  accountName: string;
  categories: ReadonlyMap<string, string>;
  payees: ReadonlyMap<string, string>;
};

const NO_NAMES: TransactionNames = {
  accountName: "",
  categories: new Map(),
  payees: new Map(),
};

function nameOf(
  names: ReadonlyMap<string, string>,
  id: string | null | undefined,
): string | null {
  return id ? (names.get(id) ?? null) : null;
}

/** Payee id to name. A transfer payee with no name of its own takes its
 *  account's name. */
function payeeNames(
  payees: ActualPayee[],
  accounts: ActualAccount[],
): Map<string, string> {
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const out = new Map<string, string>();
  for (const p of payees) {
    const name =
      p.name?.trim() || (p.transfer_acct && accountNames.get(p.transfer_acct));
    if (name) out.set(p.id, name);
  }
  return out;
}

function mapTransaction(
  t: ActualTransaction,
  names: TransactionNames,
): BudgetTransaction {
  return {
    id: t.id,
    accountId: t.account,
    accountName: names.accountName,
    date: t.date,
    amount: fromCents(t.amount),
    payeeName: nameOf(names.payees, t.payee),
    categoryId: t.category ?? null,
    categoryName: nameOf(names.categories, t.category),
    memo: t.notes ?? null,
    cleared: t.cleared || t.reconciled,
    approved: true, // Actual doesn't have approved flag
    deleted: false,
    ...(t.subtransactions.length && {
      subtransactions: t.subtransactions
        .filter((st) => !st.tombstone)
        .map((st) => ({
          categoryId: st.category ?? null,
          categoryName: nameOf(names.categories, st.category),
          amount: fromCents(st.amount),
          memo: st.notes ?? null,
        })),
    }),
  };
}

// -- Client --

/**
 * `BudgetAPIClient.getMonthDetail`'s `month` param has no format documented
 * on the shared interface (interface.ts) -- every caller (sync/core.ts,
 * budget-api/cache.ts) has always passed YNAB's own native month format,
 * `YYYY-MM-01` (a full ISO date, first of the month -- YNAB's real API
 * requires exactly this). Actual's `actual-http-api` wrapper's `/months/:id`
 * route wants the SHORTER `YYYY-MM` (no day) -- confirmed via a real
 * "Invalid month format, use YYYY-MM: 2026-08-01" error from a // lint-violation-ok
 * live sync attempt. Never worked for Actual before this fix; nothing
 * in this codebase had ever exercised the mismatch until this specific
 * error surfaced.
 *
 * `slice(0, 7)` is idempotent regardless of which format arrives --
 * `"2026-08-01".slice(0, 7)` and `"2026-08".slice(0, 7)` both produce // lint-violation-ok
 * `"2026-08"` -- so this is safe against getMonths()'s own internal
 * getMonthDetail(id) calls, which already pass bare YYYY-MM ids straight
 * from Actual's own `/months` list.
 */
/** At most this many requests to the wrapper at once: it reloads the
 *  budget per request and struggles when many run together. */
/** The `until_date` every transaction list sends. The wrapper's lists end at
 *  its own today unless told otherwise, which dropped every transaction
 *  dated after that (a future-dated snapshot adjustment among them) from
 *  sync, the snapshot scan and the read-back. The last day Actual's
 *  YYYYMMDD dates can hold. */
const ACTUAL_LIST_UNTIL = "9999-12-31";

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

function toActualMonthId(month: string): string {
  return month.slice(0, 7);
}

/**
 * actual-http-api reloads the budget on every request through one shared,
 * unlocked @actual-app/api client. Once the budget is loaded, concurrent
 * requests are fine; the FIRST load after the wrapper starts is not — it
 * runs any schema migrations (after every Actual upgrade) and logs in, and
 * concurrent requests close the database under each other ("No budget file
 * is open", "The database connection is not open", "startServices called
 * while services are already running"). Every retry then repeats the race,
 * so a sync never recovers — confirmed live on the 26.8.1 → 26.10.0 bump:
 * one request loaded fine, the fan-out did not.
 *
 * So per wrapper: while it is cold, the first request runs alone and the
 * rest wait for it. If that load fails, the waiters fail with the same
 * error instead of piling on. A load failure on a warm wrapper (it was
 * restarted under us) marks it cold; a request that's harmless to repeat —
 * or any the wrapper says never ran ("No budget file is open") — is retried
 * once through the same single-request path. A POST that timed out or hit a
 * server error isn't: it may have been applied, and the next sync picks it
 * up.
 */
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

/** Test-only: forget every wrapper's warm state. */
export function resetActualWrapperGates(): void {
  wrapperGates.clear();
}

/** The wrapper had no budget open, so the request never ran. */
function isBudgetNotOpen(err: unknown): boolean {
  return (
    err instanceof BudgetApiError &&
    err.status === 404 &&
    /no budget file is open/i.test(err.message)
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

/** Safe to send again after a failure: one that's harmless to repeat (the
 *  shared rule, isResendable), or one the wrapper says never ran. A POST
 *  that timed out or hit a server error may have been applied — sending it
 *  again could add a transaction twice. */
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
    // serverUrl may be http:// (see url-safety.ts —
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
    await inBatches(accounts, WRAPPER_BATCH_SIZE, async (acct) => {
      try {
        // Same endpoint/shape as getAccountBalance below.
        const balance = await this.getAccountBalance(acct.id);
        acct.balance = balance;
        acct.clearedBalance = balance;
      } catch (err) {
        if (!isTransientError(err)) throw err;
        failed.push(acct);
      }
    });
    const unavailable: string[] = [];
    let lastError: BudgetApiError | undefined;
    for (const acct of failed) {
      try {
        const balance = await this.getAccountBalance(acct.id);
        acct.balance = balance;
        acct.clearedBalance = balance;
      } catch (err) {
        if (!isTransientError(err)) throw err;
        lastError = err as BudgetApiError;
        log("warn", "actual_client.balance_fetch_failed", {
          accountId: acct.id,
          error: lastError.message,
        });
        unavailable.push(acct.name);
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

  /**
   * The wrapper's `GET /accounts/:id/balance` returns the balance as the
   * bare `data` value (`res.json({ data: balance || 0 })` — verified
   * against actual-http-api's literal route source, 26.8.1), NOT nested
   * under `data.balance`. Reading `res.data.balance` (the old code here)
   * silently produced NaN on every call — pushSnapshotToBudgetApi's
   * delta-vs-live-balance math was broken for every Actual household. */
  async getAccountBalance(
    accountId: string,
    asOfDate?: string,
  ): Promise<number> {
    // cutoff_date is inclusive and read as a local date by the wrapper, so
    // the wrapper's time zone no longer moves the figure; without it the
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
  async getCategories(): Promise<BudgetCategoryGroup[]> {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const [groupsRes, catsRes, monthDetail] = await Promise.all([
      this.request("/categorygroups", actualSchemas.categoryGroups),
      this.request("/categories", actualSchemas.categories),
      this.getMonthDetail(currentMonth),
    ]);

    // monthDetail.categories already carries this month's real numbers AND
    // the note-goal overlay (getMonthDetail applies both) — reuse it
    // instead of a second raw /months/:id fetch plus a second
    // overlayNoteGoals pass over every category (previously fetched the
    // month and ran the per-category note overlay twice).
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

  /** `GET /months` (no month id) does NOT return `ActualMonth` objects —
   * re-verified LIVE against the deployed wrapper: it's a bare array of
   * month-id strings (`["2020-01", ..., "2027-07"]`), each of which needs
   * its own `GET /months/:id` call to get real data (only that endpoint
   * returns income/budgeted/spent — see mapMonth's docblock). The old code
   * here treated each string as an `ActualMonth` object, reading every
   * field off a string primitive — always NaN/undefined, though this
   * method currently has no live caller in the app so it never surfaced. */
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

    for (const acct of accounts.data) {
      if (acct.closed) continue;
      try {
        const res = await this.request(
          `/accounts/${acct.id}/transactions?since_date=${sinceDate}&until_date=${ACTUAL_LIST_UNTIL}`,
          actualSchemas.transactions,
        );
        allTx.push(
          ...res.data.map((t) =>
            mapTransaction(t, {
              accountName: acct.name,
              categories: categoryNames,
              payees: payeeNameById,
            }),
          ),
        );
      } catch (err) {
        // Only a 404 (the account no longer exists) may be skipped. Any
        // other failure (auth, timeout, network) stops the sync: a dropped
        // account would be cached as a complete transaction list. The sync's
        // network phase throwing changes nothing locally.
        if (err instanceof BudgetApiError && err.status === 404) continue;
        log("warn", "actual_client.transactions_fetch_failed", {
          accountId: acct.id,
          error: err instanceof Error ? err.message : String(err),
        });
        const reason = err instanceof Error ? err.message : String(err);
        if (err instanceof BudgetApiError) {
          throw retold(
            err,
            `Actual didn't return transactions for ${acct.name} — nothing was synced: ${reason}`,
          );
        }
        throw new Error(
          `Actual didn't return transactions for ${acct.name} — nothing was synced: ${reason}`,
        );
      }
    }

    return allTx;
  }

  async createTransaction(tx: NewBudgetTransaction): Promise<string> {
    const importedId = actualImportedId(tx);

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
