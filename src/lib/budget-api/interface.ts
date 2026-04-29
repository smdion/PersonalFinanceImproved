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

  /** Update the goal target for a category (plan-level, not month-specific).
   * goalType: YNAB goal_type to set alongside the target (e.g. "TB" for target balance). */
  updateCategoryGoalTarget(
    categoryId: string,
    targetAmount: number,
    goalType?: string,
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

  // -- Delta sync --

  /** Whether this client supports incremental delta sync */
  readonly supportsDeltaSync: boolean;

  /** Get changes since last sync (YNAB only). Returns null if not supported. */
  getDelta?(serverKnowledge: number): Promise<DeltaSyncResult<unknown> | null>;
}
