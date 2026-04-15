import type { PerfCategory } from "@/lib/config/display-labels";

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
  keyStats: {
    income: string;
    portfolioSize: string;
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
    payPeriod: "weekly" | "biweekly" | "semimonthly" | "monthly";
    payWeek: "even" | "odd" | "na";
    startDate: string;
    anchorPayDate: string | null;
    endDate: string | null;
    bonusPercent: string;
    bonusMonth: number | null;
    bonusDayOfMonth?: number | null;
    w4FilingStatus: "MFJ" | "Single" | "HOH";
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
    accountType: string;
    taxTreatment: string;
    contributionMethod: string;
    contributionValue: string;
    employerMatchType: string;
    employerMatchValue: string | null;
    employerMaxMatchPct: string | null;
    /** accountLabel of the performance account to link to */
    perfAccountLabel?: string;
    parentCategory?: string;
  }[];

  portfolioSnapshots: {
    snapshotDate: string;
  }[];

  portfolioAccounts: {
    institution: string;
    accountType: string;
    taxType: "preTax" | "taxFree" | "afterTax" | "hsa";
    amount: string;
    label: string | null;
    ownerPersonName: string | null;
    parentCategory?: string;
    perfAccountLabel?: string;
  }[];

  performanceAccounts: {
    institution: string;
    accountType: string;
    accountLabel: string;
    ownershipType: "individual" | "joint";
    parentCategory: string;
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
    withdrawalStrategy: string;
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
    parentCategory: string;
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
