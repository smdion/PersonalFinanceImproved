// Relocation decision tool types.

/** Year-specific expense adjustment for relocation analysis. */
export type RelocationYearAdjustment = {
  year: number;
  /** Monthly expense override for the relocation scenario in that year. When using a budget profile, this is resolved server-side. */
  monthlyExpenses: number;
  /** Optional budget profile ID — when set, monthlyExpenses is resolved from this profile+column server-side. */
  profileId?: number;
  /** Budget column index within the profile. Required when profileId is set. */
  budgetColumn?: number;
  notes?: string;
};

/** Year-specific contribution rate override for relocation analysis. */
export type RelocationContributionOverride = {
  year: number;
  /** Contribution rate as decimal (e.g. 0.25 = 25% of salary). Applies from this year onward until the next override. */
  rate: number;
  notes?: string;
};

/** A large one-time or financed purchase tied to the relocation scenario (home, car, furniture, etc.). */
export type RelocationLargePurchase = {
  name: string;
  purchasePrice: number;
  /** Down payment as decimal (0.20 = 20%). If absent or 1, purchase is all-cash. */
  downPaymentPercent?: number;
  /** Annual interest rate for financed portion (e.g. 0.065 = 6.5%). */
  loanRate?: number;
  /** Loan term in years (e.g. 30). */
  loanTermYears?: number;
  /** Ongoing monthly costs added to relocation expenses from purchase year onward (property tax, HOA, insurance, maintenance, etc.). */
  ongoingMonthlyCost?: number;
  /** Net proceeds from selling an existing asset (e.g. current home equity minus fees). Added to portfolio in purchase year. */
  saleProceeds?: number;
  /** Calendar year of purchase. */
  purchaseYear: number;
};

export type RelocationInput = {
  /** Current monthly expenses (from active budget column). */
  currentMonthlyExpenses: number;
  /** Relocation monthly expenses (from selected budget column). */
  relocationMonthlyExpenses: number;
  /** Year-specific overrides to relocation expenses (phase-in, cost cuts, etc.). */
  yearAdjustments: RelocationYearAdjustment[];
  /** Year-specific contribution rate overrides (% of salary). Each applies from that year onward until the next override. */
  contributionOverrides: RelocationContributionOverride[];
  /** Large purchases tied to the relocation (home, car, etc.). */
  largePurchases: RelocationLargePurchase[];
  /** Current age of primary person. */
  currentAge: number;
  retirementAge: number;
  /** Current total portfolio value. */
  currentPortfolio: number;

  // --- Per-scenario contribution & salary params ---
  /** Total annual employee contributions (current scenario). */
  currentAnnualContributions: number;
  /** Total annual employer match (current scenario). */
  currentEmployerContributions: number;
  /** Combined annual salary (current scenario). */
  currentCombinedSalary: number;
  /** Total annual employee contributions (relocation scenario). */
  relocationAnnualContributions: number;
  /** Total annual employer match (relocation scenario). */
  relocationEmployerContributions: number;
  /** Combined annual salary (relocation scenario). */
  relocationCombinedSalary: number;

  /** Salary growth rate for current scenario. */
  currentSalaryGrowthRate: number;
  /** Salary growth rate for relocation scenario (may differ). */
  relocationSalaryGrowthRate: number;

  /** Withdrawal rate for FI target (e.g. 0.04). */
  withdrawalRate: number;
  inflationRate: number;
  /** Average real return rate (nominal minus inflation). */
  nominalReturnRate: number;
  socialSecurityAnnual: number;
  asOfDate: Date;
};

export type RelocationYearProjection = {
  year: number;
  age: number;
  /** Portfolio balance under current budget. */
  currentBalance: number;
  /** Portfolio balance under relocation budget. */
  relocationBalance: number;
  /** Gap: relocation - current (negative = behind). */
  delta: number;
  /** Annual expenses used in relocation scenario this year. */
  relocationExpenses: number;
  /** Annual contribution used in current scenario this year. */
  currentContribution: number;
  /** Annual contribution used in relocation scenario this year. */
  relocationContribution: number;
  /** Whether this year has an expense adjustment. */
  hasAdjustment: boolean;
  /** Whether this year has a contribution override. */
  hasContributionOverride: boolean;
  /** Net portfolio impact from large purchases this year (negative = withdrawal, positive = sale proceeds). */
  largePurchaseImpact: number;
  /** Total monthly loan + ongoing payments from large purchases active this year. */
  monthlyPaymentFromPurchases: number;
};

export type RelocationResult = {
  // Budget comparison
  currentAnnualExpenses: number;
  relocationAnnualExpenses: number;
  annualExpenseDelta: number;
  monthlyExpenseDelta: number;
  percentExpenseIncrease: number;

  // Savings rate impact
  /** (salary - currentAnnualExpenses) / salary */
  currentSavingsRate: number;
  /** (salary - relocationAnnualExpenses) / salary */
  relocationSavingsRate: number;
  savingsRateDrop: number;

  // FI targets (annual expenses / withdrawal rate)
  currentFiTarget: number;
  relocationFiTarget: number;
  additionalNestEggNeeded: number;

  // FI age (when portfolio crosses FI target during accumulation)
  currentFiAge: number | null;
  relocationFiAge: number | null;
  fiAgeDelay: number | null;

  /** Recommended minimum portfolio before relocating. */
  recommendedPortfolioToRelocate: number;
  /** Earliest age where relocating still reaches relocation FI target by retirement. */
  earliestRelocateAge: number | null;

  /** Total one-time portfolio hit from all large purchases (cash outlays minus sale proceeds). */
  totalLargePurchasePortfolioHit: number;
  /** Steady-state monthly cost added by large purchases (ongoing costs + loan payments for active loans). */
  steadyStateMonthlyFromPurchases: number;

  projectionByYear: RelocationYearProjection[];
  warnings: string[];
};
