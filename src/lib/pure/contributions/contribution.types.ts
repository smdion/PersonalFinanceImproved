/** calculateContributions' input and result: contribution and savings
 *  rates by group, employer match included and not. */

import type { ContributionAccountInput } from "../paycheck/paycheck.types";

export type ContributionInput = {
  annualSalary: number;
  /** Total compensation (always includes bonus) — used as denominator for savings rates.
   *  Falls back to annualSalary if not provided. */
  totalCompensation?: number;
  contributionAccounts: ContributionAccountInput[];
  limits: Record<string, number>;
  asOfDate: Date;
};

export type ContributionResult = {
  groupRates: Record<string, number>; // includes employer match
  groupRatesExMatch: Record<string, number>; // employee contributions only (no match)
  totalAnnualContributions: number; // employee + employer
  totalEmployeeOnly: number; // employee contributions only
  accounts: {
    name: string;
    group: string;
    annualContribution: number;
    employerMatch: number;
    percentOfSalary: number;
  }[];
  warnings: string[];
};
