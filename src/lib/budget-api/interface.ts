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

  /** An account's balance: transactions dated on or before `asOfDate`
   *  ("YYYY-MM-DD"), or up to today when omitted. A snapshot push passes its
   *  own date so later-dated transactions don't change its adjustment. */
  getAccountBalance(accountId: string, asOfDate?: string): Promise<number>;

  // -- Categories & Months --

  /** Category groups with nested categories; numbers are `asOf`'s month's. */
  getCategories(asOf: Date): Promise<BudgetCategoryGroup[]>;

  /** List monthly summaries for a date range */
  getMonths(start: string, end: string): Promise<BudgetMonth[]>;

  /** Detailed month with per-category data. Callers always pass `month` as
   *  `YYYY-MM-01`; each client converts to its own wire format (Actual's
   *  wrapper wants `YYYY-MM`, see ActualClient's `toActualMonthId`). */
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
