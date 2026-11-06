import type { RouterOutputs } from "@/lib/trpc";
import type { ContribResolutionStatus } from "@/lib/pure/household/profiles";

export type RawItem = {
  id: number;
  category: string;
  subcategory: string;
  amounts: number[];
  /** Linked contribution account's monthly amount for the SELECTED column
   *  (displayed instead of DB amounts). Prefer contribAmounts when rendering
   *  a specific column. */
  contribAmount?: number | null;
  /** Per-column linked contribution amounts — index i is column i, all
   *  from the active Contribution/Salary profiles. Null when unlinked. */
  contribAmounts?: number[] | null;
  isEssential: boolean;
  /** Linked budget API category ID (YNAB UUID, etc.) */
  apiCategoryId?: string | null;
  /** Linked budget API category display name */
  apiCategoryName?: string | null;
  /** Sync direction for linked items */
  apiSyncDirection?: "pull" | "push" | "both" | null;
  /** Linked contribution account ID */
  contributionAccountId?: number | null;
  /** Per-column reason a linked item's amount is $0 — see
   *  ContribResolutionStatus. Null when unlinked. Index i is column i. */
  contribStatus?: ContribResolutionStatus[] | null;
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

/** A single profile row from `trpc.budget.listProfiles`. */
export type BudgetProfileListEntry =
  RouterOutputs["budget"]["listProfiles"][number];
