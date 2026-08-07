// Budget API client interface — implemented by YNAB and Actual Budget clients.
// All amounts in the interface use dollars (number).

import type {
  BudgetAccount,
  BudgetCategoryGroup,
  BudgetMonth,
  BudgetMonthDetail,
  BudgetTransaction,
  NewBudgetTransaction,
  DeltaSyncResult,
} from "./types";

export interface BudgetAPIClient {
  /** Test that the connection is valid and the budget is accessible */
  testConnection(): Promise<boolean>;

  /** Human-readable name of the connected budget */
  getBudgetName(): Promise<string>;

  // -- Accounts --

  /** List all accounts in the budget */
  getAccounts(): Promise<BudgetAccount[]>;

  /** Get balance for a single account */
  getAccountBalance(accountId: string): Promise<number>;

  // -- Categories & Months --

  /** List all category groups with nested categories */
  getCategories(): Promise<BudgetCategoryGroup[]>;

  /** List monthly summaries for a date range */
  getMonths(start: string, end: string): Promise<BudgetMonth[]>;

  /** Get detailed month with per-category data */
  getMonthDetail(month: string): Promise<BudgetMonthDetail>;

  /** Update the budgeted amount for a category in a month */
  updateCategoryBudgeted(
    month: string,
    categoryId: string,
    amount: number,
  ): Promise<void>;

  /** Set a recurring monthly-assignment goal (displays in YNAB as goal_type
   * "NEED"/"MF" — same concept, old vs. new name) via the plan-level
   * endpoint: goal_target + goal_frequency: "monthly". Note goal_type
   * itself is a read-only, derived field in YNAB's API — it cannot be set
   * directly; see the implementation for the full explanation. */
  updateCategoryGoalTarget(
    categoryId: string,
    targetAmount: number,
  ): Promise<void>;

  /** Update a target-balance goal's dollar amount ONLY — does not create or
   * change the goal's type/cadence. YNAB's public API cannot create the
   * "Custom cadence, no repeat" goal shape (confirmed by live testing and
   * against the OpenAPI spec: `goal_frequency` only accepts monthly/weekly/
   * yearly); every attempt to do so via this endpoint either no-opped or
   * actively corrupted the goal into a recurring monthly re-assignment.
   * The goal's type must be configured once, manually, in the YNAB app —
   * this sends a single `goal_target` PATCH and nothing else, which per the
   * spec updates only the amount and leaves the existing shape untouched.
   * See the implementation for the full history of what was tried. */
  updateCategoryTargetBalance(
    categoryId: string,
    targetAmount: number,
  ): Promise<void>;

  // -- Transactions --

  /** List transactions since a date */
  getTransactions(sinceDate: string): Promise<BudgetTransaction[]>;

  /** Create a new transaction, returns the transaction ID */
  createTransaction(tx: NewBudgetTransaction): Promise<string>;

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

  // -- Delta sync --

  /** Whether this client supports incremental delta sync */
  readonly supportsDeltaSync: boolean;

  /** Get changes since last sync (YNAB only). Returns null if not supported. */
  getDelta?(serverKnowledge: number): Promise<DeltaSyncResult<unknown> | null>;
}
