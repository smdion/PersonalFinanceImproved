export type RawItem = {
  id: number;
  category: string;
  subcategory: string;
  amounts: number[];
  /** Linked contribution account's monthly amount (displayed instead of DB amounts). */
  contribAmount?: number | null;
  isEssential: boolean;
  /** Linked budget API category ID (YNAB UUID, etc.) */
  apiCategoryId?: string | null;
  /** Linked budget API category display name */
  apiCategoryName?: string | null;
  /** Sync direction for linked items */
  apiSyncDirection?: "pull" | "push" | "both" | null;
  /** Linked contribution account ID */
  contributionAccountId?: number | null;
};

export type PayrollBreakdown = {
  grossMonthly: number;
  federalWithholding: number;
  ficaSS: number;
  ficaMedicare: number;
  totalTaxes: number;
  preTaxLines: { name: string; monthly: number }[];
  totalPreTax: number;
  postTaxLines: { name: string; monthly: number }[];
  totalPostTax: number;
  netMonthly: number;
  takeHomeLines: { name: string; monthly: number }[];
  grossLines: { name: string; monthly: number }[];
  budgetNote: string;
};

export type ColumnResult = {
  totalMonthly: number;
  essentialTotal: number;
  discretionaryTotal: number;
};

export type SinkingFundLine = {
  id: number;
  name: string;
  monthlyContribution: number;
};

/**
 * A single profile row from `trpc.budget.listProfiles`. Hand-rolled here
 * (instead of inferring from `@/server/*`) because components/** is
 * lint-forbidden from importing server modules. Fields match the select
 * shape plus the client-side derived fields (annualTotal, columnCount)
 * the router attaches in its .map() pass.
 */
export type BudgetProfileListEntry = {
  id: number;
  name: string;
  isActive: boolean;
  columnLabels: unknown; // stored as JSON; callers cast to string[]
  columnMonths: unknown; // stored as JSON; callers cast to number[] | null
  annualTotal: number;
  columnCount: number;
};
