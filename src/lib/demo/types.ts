import type { PerfCategory } from "@/lib/config/display-labels";
import type { AccountCategory } from "@/lib/config/account-types";
import type {
  AccountOwnership,
  EmployerMatchType,
  HsaCoverageType,
  PayPeriod,
  PayWeek,
  TaxTreatment,
} from "@/lib/config/enum-values";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type { DebtKind } from "@/lib/config/enum-values";
import type { W4FilingStatus } from "@/lib/config/filing-status";

/**
 * DemoProfile — complete, holistic dataset for a demo persona.
 *
 * Every table that the app reads must be represented. If a profile has a
 * mortgage it MUST also have property taxes, home value, and the right
 * budget items. Data flows (budget -> savings pool -> projections -> net worth)
 * must be internally consistent.
 *
 * Values use plain objects matching the Drizzle insert shapes. IDs are
 * assigned at seed time via RETURNING, so only foreign-key *names* (not
 * numeric IDs) are referenced across tables. The seeder resolves names -> IDs.
 */

export type DemoProfile = {
  slug: string;
  name: string;
  description: string;
  /** The chooser card's stats. Income and portfolio size are derived from
   *  the seeded rows (demoKeyStats); the savings rate is stored because
   *  the server computes it from database rows — tests/routers/demo-seed-
   *  stats.test.ts seeds each profile and checks it against the
   *  Contribution page's figure. */
  keyStats: {
    savingsRate: string;
  };

  people: {
    name: string;
    dateOfBirth: string;
    isPrimaryUser: boolean;
  }[];

  jobs: {
    personName: string;
    employerName: string;
    title: string | null;
    annualSalary: string;
    payPeriod: PayPeriod;
    payWeek: PayWeek;
    startDate: string;
    anchorPayDate: string | null;
    endDate: string | null;
    bonusPercent: string;
    bonusMonth: number | null;
    bonusDayOfMonth?: number | null;
    w4FilingStatus: W4FilingStatus;
  }[];

  budgetProfiles: {
    name: string;
    isActive: boolean;
    columnLabels: string[];
    columnMonths: number[] | null;
  }[];

  budgetItems: {
    profileName: string;
    category: string;
    subcategory: string;
    isEssential: boolean;
    amounts: number[];
  }[];

  savingsGoals: {
    name: string;
    targetAmount: string | null;
    targetMonths: number | null;
    priority: number;
    isEmergencyFund: boolean;
    monthlyContribution: string;
    allocationPercent: string | null;
  }[];

  savingsMonthly: {
    goalName: string;
    monthDate: string;
    balance: string;
  }[];

  contributionAccounts: {
    personName: string;
    /** The job (by employerName) the account is deducted from: its pay
     *  sizes the contribution and its match. Required for any account with
     *  an employer match or a percent-of-salary contribution. */
    employerName?: string;
    accountType: AccountCategory;
    taxTreatment: TaxTreatment;
    contributionMethod: string;
    contributionValue: string;
    employerMatchType: EmployerMatchType;
    employerMatchValue: string | null;
    employerMaxMatchPct: string | null;
    /** accountLabel of the performance account to link to */
    perfAccountLabel?: string;
    parentCategory?: PerfCategory;
    /** An HSA's coverage — what sizes its IRS limit. */
    hsaCoverageType?: HsaCoverageType;
  }[];

  portfolioSnapshots: {
    snapshotDate: string;
  }[];

  portfolioAccounts: {
    institution: string;
    accountType: AccountCategory;
    taxType: "preTax" | "taxFree" | "afterTax" | "hsa";
    amount: string;
    label: string | null;
    ownerPersonName: string | null;
    parentCategory?: PerfCategory;
    perfAccountLabel?: string;
  }[];

  performanceAccounts: {
    institution: string;
    accountType: AccountCategory;
    accountLabel: string;
    ownershipType: AccountOwnership;
    parentCategory: PerfCategory;
    label: string | null;
    isActive: boolean;
    /** Resolves to ownerPersonId FK */
    ownerPersonName?: string | null;
  }[];

  annualPerformance: {
    /** Perf-category key — must be one of the PERF_CATEGORY_* constants.
     *  TypeScript enforces this at compile time via the PerfCategory type. */
    category: PerfCategory;
    year: number;
    beginningBalance: string;
    totalContributions: string;
    yearlyGainLoss: string;
    endingBalance: string;
    annualReturnPct: string | null;
    employerContributions: string;
    fees: string;
    lifetimeGains: string;
    lifetimeContributions: string;
    lifetimeMatch: string;
  }[];

  retirementSettings: {
    personName: string;
    retirementAge: number;
    endAge: number;
    returnAfterRetirement: string;
    annualInflation: string;
    salaryAnnualIncrease: string;
    withdrawalRate: string;
    withdrawalStrategy: WithdrawalStrategyType;
    socialSecurityMonthly: string;
    ssStartAge: number;
  };

  /** Per-person retirement overrides (for multi-person households).
   *  Each entry creates a separate retirement_settings row.
   *  Fields not specified fall back to the primary retirementSettings. */
  perPersonRetirementSettings?: {
    personName: string;
    retirementAge?: number;
    endAge?: number;
    withdrawalRate?: string;
    socialSecurityMonthly: string;
    ssStartAge: number;
  }[];

  returnRates: {
    age: number;
    rateOfReturn: string;
  }[];

  /** Debts besides the mortgage (Liabilities ▸ Other debts). */
  debts: {
    name: string;
    kind: DebtKind;
    ownerPersonName: string | null;
    balance: string;
    balanceAsOf: string;
    interestRate: string | null;
    monthlyPayment: string | null;
    originalAmount: string | null;
  }[];

  mortgageLoans: {
    name: string;
    isActive: boolean;
    principalAndInterest: string;
    interestRate: string;
    termYears: number;
    originalLoanAmount: string;
    firstPaymentDate: string;
    propertyValuePurchase: string;
    propertyValueEstimated: string | null;
  }[];

  accountPerformance: {
    year: number;
    institution: string;
    accountLabel: string;
    ownerPersonName: string | null;
    beginningBalance: string;
    totalContributions: string;
    yearlyGainLoss: string;
    endingBalance: string;
    annualReturnPct: string | null;
    employerContributions: string;
    fees: string;
    parentCategory: PerfCategory;
    /** Links to performanceAccounts.accountLabel for FK resolution */
    perfAccountLabel?: string;
  }[];

  otherAssetItems: {
    name: string;
    year: number;
    value: string;
    note: string | null;
  }[];

  propertyTaxes: {
    /** References mortgageLoans by name */
    loanName: string;
    year: number;
    assessedValue: string | null;
    taxAmount: string;
    note: string | null;
  }[];

  homeImprovements: {
    year: number;
    description: string;
    cost: string;
  }[];

  netWorthAnnual: {
    yearEndDate: string;
    grossIncome: string;
    combinedAgi: string;
    cash: string;
    houseValue: string;
    retirementTotal: string;
    portfolioTotal: string;
    mortgageBalance: string;
  }[];

  appSettings: {
    key: string;
    value: unknown;
  }[];
};
