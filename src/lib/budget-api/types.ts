// Shared types for budget API integrations (YNAB, Actual Budget).
// All amounts are in dollars (number). Each client converts at its boundary.

import type { BudgetApiService } from "@/lib/config/budget-apps";

/** A budget account (checking, savings, tracking, etc.) */
export type BudgetAccount = {
  id: string;
  name: string;
  type:
    | "checking"
    | "savings"
    | "cash"
    | "creditCard"
    | "lineOfCredit"
    | "mortgage"
    | "tracking"
    | "other";
  onBudget: boolean;
  closed: boolean;
  balance: number;
  clearedBalance: number;
  /** Transfer payee ID (YNAB-specific, null for Actual) */
  transferPayeeId?: string;
};

/** A budget category group with nested categories */
export type BudgetCategoryGroup = {
  id: string;
  name: string;
  hidden: boolean;
  /** Its categories hold income, never expenses. */
  isIncome: boolean;
  categories: BudgetCategory[];
};

/** A single budget category */
export type BudgetCategory = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  hidden: boolean;
  budgeted: number;
  activity: number;
  balance: number;
  /** Goal target amount (if set) */
  goalTarget?: number;
  goalType?: string;
  /** Category note/memo (used for reimbursement tracking, etc.) */
  note?: string | null;
};

/** Monthly budget summary */
export type BudgetMonth = {
  month: string; // "YYYY-MM-01"
  income: number;
  budgeted: number;
  activity: number;
  /** Null for an Actual tracking budget, which has no "to budget". */
  toBeBudgeted: number | null;
};

/** Detailed monthly budget with per-category data */
export type BudgetMonthDetail = {
  month: string;
  income: number;
  budgeted: number;
  activity: number;
  toBeBudgeted: number | null;
  categories: BudgetCategory[];
};

/** One part of a split transaction. */
type BudgetSubTransaction = {
  categoryId: string | null;
  categoryName: string | null;
  /** Dollars, signed (outflow negative). */
  amount: number;
  memo: string | null;
};

/** A transaction from the budget API */
export type BudgetTransaction = {
  id: string;
  accountId: string;
  accountName: string;
  date: string; // "YYYY-MM-DD"
  amount: number;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  memo: string | null;
  cleared: boolean;
  approved: boolean;
  deleted: boolean;
  /** The parts of a split transaction (only readers that need splits use
   *  this — the parent keeps its own category, so expense compares and
   *  drift are unchanged). Absent when the transaction isn't split. */
  subtransactions?: BudgetSubTransaction[];
};

/** Input for creating a new transaction */
export type NewBudgetTransaction = {
  /** Hashed into the import id: a fresh one gives a new id (YNAB keeps a
   *  deleted transaction's id reserved); reuse it only to find this same
   *  write again. */
  importKey: string;
  accountId: string;
  date: string; // "YYYY-MM-DD"
  amount: number;
  payeeName?: string;
  categoryId?: string;
  memo?: string;
  cleared?: boolean;
  /** Verified against a statement; implies cleared whatever `cleared` says
   *  (each client derives `cleared` itself). DELETE still succeeds on a
   *  reconciled transaction in both YNAB and Actual, so resync can repost. */
  reconciled?: boolean;
  approved?: boolean;
};

/** Connection config stored in api_connections.config JSONB */
export type YnabConfig = {
  accessToken: string;
  budgetId: string;
};

export type ActualConfig = {
  serverUrl: string;
  apiKey: string;
  budgetSyncId: string;
  /** Browser-reachable URL of the Actual web app (`serverUrl` is often an
   *  internal address for API calls). The nav link to the active budget API
   *  renders only when this is set. */
  externalUrl?: string;
};

/** Budget API service identifier: the keys of BUDGET_SERVICES. */
export type { BudgetApiService };

/** The active budget API setting stored in app_settings */
export type ActiveBudgetApi = "none" | BudgetApiService;
