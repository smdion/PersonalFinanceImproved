// Budget API client interface — implemented by YNAB and Actual Budget clients.
// All amounts in the interface use dollars (number).

import type {
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetMonth,
  BudgetMonthDetail,
  BudgetTransaction,
  NewBudgetTransaction,
} from "./types";

export type GoalShape = "monthly" | "target-balance";

/** A goal write whose reads and checks are done; `apply` only writes. */
export interface PreparedGoalWrite {
  apply(): Promise<void>;
}

export interface BudgetAPIClient {
  /** Resolves when the budget answers; throws the service's error, so the
   *  user can be told why it didn't. */
  testConnection(): Promise<void>;

  /** Human-readable name of the connected budget */
  getBudgetName(): Promise<string>;

  // -- Accounts --

  /** List all accounts in the budget */
  getAccounts(): Promise<BudgetAccount[]>;

  /** An account's balance: every transaction dated on or before `asOfDate`
   *  ("YYYY-MM-DD"), or, omitted, everything up to today. A snapshot push
   *  passes its own date, so transactions dated after it (or the budget
   *  app's own clock) don't change the adjustment it posts. */
  getAccountBalance(accountId: string, asOfDate?: string): Promise<number>;

  // -- Categories & Months --

  /** Category groups with nested categories; numbers are `asOf`'s month's. */
  getCategories(asOf: Date): Promise<BudgetCategoryGroup[]>;

  /** List monthly summaries for a date range */
  getMonths(start: string, end: string): Promise<BudgetMonth[]>;

  /** Get detailed month with per-category data.
   *
   *  `month` is always `YYYY-MM-01` (a full ISO date, first of the month —
   *  every caller in this codebase computes it this way, matching YNAB's
   *  own native format, which YNAB's real API requires exactly). NOT every
   *  underlying service's API actually wants this shape on the wire —
   *  Actual's wrapper wants the shorter `YYYY-MM` — so each client
   *  implementation is responsible for converting to whatever its own API
   *  needs internally (see ActualClient's `toActualMonthId` for why this
   *  bit the app in practice). Callers should never need to
   *  know this; always pass `YYYY-MM-01`. */
  getMonthDetail(month: string): Promise<BudgetMonthDetail>;

  /** Update the budgeted amount for a category in a month.
   *  `month` format: same `YYYY-MM-01` contract as getMonthDetail above. */
  updateCategoryBudgeted(
    month: string,
    categoryId: string,
    amount: number,
  ): Promise<void>;

  /** Reads and checks a goal write (`"conflict"` if the target has another
   *  shape); `apply()` only writes, so a push reads every item first. Each
   *  client's implementation says how it stores the two shapes. */
  prepareGoalWrite(
    categoryId: string,
    shape: GoalShape,
    targetAmount: number,
  ): Promise<PreparedGoalWrite>;

  // -- Transactions --

  /** List transactions since a date */
  getTransactions(sinceDate: string): Promise<BudgetTransaction[]>;

  /** Create a new transaction, returns the transaction ID */
  createTransaction(tx: NewBudgetTransaction): Promise<string>;

  /** The transaction `createTransaction(tx)` would have written, found by
   *  its deterministic import id on `tx.date`, or null. For a write whose
   *  response was lost or unreadable: it may have been applied. */
  findCreatedTransaction(tx: NewBudgetTransaction): Promise<string | null>;

  /** Update an existing transaction */
  updateTransaction(
    txId: string,
    tx: Partial<NewBudgetTransaction>,
  ): Promise<void>;

  /** Delete a transaction by ID */
  deleteTransaction(transactionId: string): Promise<void>;

  /** List transactions for a single account since a date */
  getAccountTransactions(
    accountId: string,
    sinceDate: string,
  ): Promise<BudgetTransaction[]>;

  /** Category names that should never surface in expense comparisons
   *  (system/non-expense categories — e.g. YNAB's "Split", "Uncategorized").
   *  Returns an empty set for services with no such concept. */
  getExcludedCategoryNames(): Set<string>;
}
