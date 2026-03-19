// Shared types for budget API integrations (YNAB, Actual Budget).
// All amounts are in dollars (number). Each client converts at its boundary.

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
  toBeBudgeted: number;
};

/** Detailed monthly budget with per-category data */
export type BudgetMonthDetail = {
  month: string;
  income: number;
  budgeted: number;
  activity: number;
  toBeBudgeted: number;
  categories: BudgetCategory[];
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
};

/** Input for creating a new transaction */
export type NewBudgetTransaction = {
  accountId: string;
  date: string; // "YYYY-MM-DD"
  amount: number;
  payeeName?: string;
  categoryId?: string;
  memo?: string;
  cleared?: boolean;
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
};

export type BudgetApiConfig = YnabConfig | ActualConfig;

/** Budget API service identifier */
export type BudgetApiService = "ynab" | "actual";

/** The active budget API setting stored in app_settings */
export type ActiveBudgetApi = "none" | "ynab" | "actual";

/** Sync direction for linked items */
export type ApiSyncDirection = "pull" | "push" | "both";

/** Result of a delta sync operation */
export type DeltaSyncResult<T> = {
  data: T;
  serverKnowledge: number;
};
