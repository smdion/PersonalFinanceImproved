import type { ViewMode } from "@/lib/context/scenario-context";
import type { PaycheckResult } from "@/lib/calculators/types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  getAllCategories,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";

// Raw DB row types for inline editing
export type RawDeduction = {
  id: number;
  jobId: number;
  deductionName: string;
  amountPerPeriod: string;
  isPretax: boolean;
  ficaExempt: boolean;
};

export type RawContrib = {
  id: number;
  jobId: number | null;
  personId: number;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string;
  taxTreatment: string;
  contributionMethod: string;
  contributionValue: string;
  employerMatchType: string;
  employerMatchValue: string | null;
  employerMaxMatchPct: string | null;
  employerMatchTaxTreatment: string;
  hsaCoverageType: string | null;
  ownership: string;
  autoMaximize: boolean;
  isActive: boolean;
  targetAnnual: string | null;
  allocationPriority: number;
  notes: string | null;
  displayNameOverride?: string;
};

// Deduction row data used for aligned rendering
export type DeductionRowData =
  | {
      type: "real";
      name: string;
      amount: number;
      raw: RawDeduction | undefined;
    }
  | {
      type: "placeholder";
      name: string;
      /** Which job this placeholder belongs to, so we can create the deduction */
      jobId: number;
      /** Whether this placeholder is for a pre-tax deduction (inferred from the other side) */
      isPretax: boolean;
      /** Whether this placeholder deduction would be FICA-exempt */
      ficaExempt: boolean;
    };

export type AccountTypeSnapshot = {
  accountType: string;
  colorKey: string;
  parentCategory: string;
  limit: number;
  employeeContrib: number;
  employerMatch: number;
  totalContrib: number;
  fundingPct: number;
  fundingMissing: number;
  pctOfSalaryToMax: number | null;
  currentPctOfSalary: number | null;
  tradContrib: number;
  taxFreeContrib: number;
  bonusContrib: number;
  isJoint: boolean;
  hasDiscountBar: boolean;
  employerMatchLabel: string;
  targetAnnual: number | null;
  allocationPriority: number;
};

export type PersonSnapshot = {
  person: { id: number; name: string };
  salary: number;
  bonusGross: number;
  periodsPerYear: number;
  accountTypes: AccountTypeSnapshot[];
  totals: {
    retirementWithoutMatch: number;
    retirementWithMatch: number;
    portfolioWithoutMatch: number;
    portfolioWithMatch: number;
    totalWithoutMatch: number;
    totalWithMatch: number;
  };
};

export type ContribCardProps = {
  contrib: RawContrib;
  onUpdateContrib: (id: number, field: string, value: string) => void;
  onToggleAutoMax?: (
    id: number,
    value: boolean,
    targetContribValue?: number,
  ) => void;
  onDeleteContrib?: (id: number) => void;
  _methodLabel: (m: string) => string;
  salary?: number;
  periodsPerYear?: number;
  annualLimit?: number;
  siblingAnnualContribs?: number; // other accounts sharing same IRS limit (e.g., trad 401k + roth 401k)
  employerMatchAnnual?: number; // this account's employer match annual amount
};

export type CreateDeductionData = {
  jobId: number;
  deductionName: string;
  amountPerPeriod: string;
  isPretax: boolean;
  ficaExempt: boolean;
};

export type CreateContribData = {
  personId: number;
  jobId?: number | null;
  accountType: AccountCategory;
  subType?: string | null;
  label?: string | null;
  parentCategory?: "Retirement" | "Portfolio";
  taxTreatment: "pre_tax" | "tax_free" | "after_tax" | "hsa";
  contributionMethod:
    | "percent_of_salary"
    | "fixed_per_period"
    | "fixed_monthly"
    | "fixed_annual";
  contributionValue: string;
  employerMatchType:
    | "none"
    | "percent_of_contribution"
    | "dollar_match"
    | "fixed_annual";
  isActive: boolean;
};

export type JointContrib = {
  id: number;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  contributionValue: string;
  contributionMethod: string;
  taxTreatment: string;
  ownerName: string;
};

/** Account category options for dropdowns — derived from config */
export const WATERFALL_CATEGORIES: AccountCategory[] = getAllCategories();

/** Sub-type options by account category — derived from config */
export const SUB_TYPE_OPTIONS: Partial<Record<AccountCategory, string[]>> =
  Object.fromEntries(
    getAllCategories()
      .filter((c) => ACCOUNT_TYPE_CONFIG[c].subTypeOptions.length > 0)
      .map((c) => [c, ACCOUNT_TYPE_CONFIG[c].subTypeOptions]),
  );

export type { PaycheckResult, ViewMode, AccountCategory };
