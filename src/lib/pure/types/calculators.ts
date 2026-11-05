/** calculateMortgage's input and result: loans, extra payments, what-if
 *  scenarios and the amortization schedule. */

export type * from "../paycheck/paycheck.types";
export type * from "../budget/budget.types";
export type * from "../contributions/contribution.types";
export type * from "../net-worth/net-worth.types";
export type * from "../savings/savings.types";
export type * from "../savings/efund.types";

export type MortgageLoanInput = {
  id: number;
  name: string;
  originalBalance: number;
  interestRate: number;
  termMonths: number;
  startDate: Date;
  monthlyPI: number;
  refinancedFromId?: number;
  isActive: boolean;
  paidOffDate?: Date;
  apiBalance?: number;
  apiBalanceDate?: Date;
};

export type MortgageExtraPayment = {
  loanId: number;
  date: Date;
  amount: number;
};

export type MortgageWhatIf = {
  id?: number;
  label: string;
  extraMonthlyPrincipal: number;
  extraOneTimePayment?: number;
  refinanceRate?: number;
  refinanceTerm?: number;
  loanId?: number;
};

export type MortgageInput = {
  loans: MortgageLoanInput[];
  extraPayments: MortgageExtraPayment[];
  whatIfScenarios: MortgageWhatIf[];
  asOfDate: Date;
  // Request-resolved "now" for detecting present-period queries.
  // Defaults to asOfDate when omitted (preserves behavior for callers querying the present).
  currentDate?: Date;
};

export type AmortizationEntry = {
  month: number;
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  extraPayment: number;
  balance: number;
};

export type MortgageLoanResult = {
  loanId: number;
  name: string;
  currentBalance: number;
  payoffPercent: number;
  totalInterestPaid: number;
  totalInterestLife: number;
  totalInterestSaved: number;
  remainingMonths: number;
  monthsAheadOfSchedule: number;
  payoffDate: Date;
  amortizationSchedule: AmortizationEntry[];
  /** For historical (refinanced) loans: what the full-term standard interest would have been
   *  if the loan ran to completion with no extras. Used by the Refinance Impact comparison.
   *  Undefined for active loans. */
  fullTermStandardInterest?: number;
  /** For historical loans: months remaining on the original full-term standard schedule as of
   *  asOfDate (same counting method as remainingMonths). Used for totalMonthsSaved computation. */
  fullTermStandardRemainingMonths?: number;
  /** Date the loan was paid off or refinanced. Only set for historical loans. */
  paidOffDate?: Date;
  /** Balance at the time the loan was paid off / refinanced. */
  endedBalance?: number;
  /** Whether this loan was refinanced into another loan. */
  wasRefinanced?: boolean;
  /** API-synced balance (e.g. from YNAB). When present, overrides the calculated balance. */
  apiBalance?: number;
  /** Date the API balance was last synced. */
  apiBalanceDate?: Date;
  /** Amortization-calculated balance before API override (only set when apiBalance differs). */
  calculatedBalance?: number;
};

export type MortgageWhatIfResult = {
  scenarioId?: number;
  label: string;
  payoffDate: Date;
  totalInterest: number;
  interestSaved: number;
  monthsSaved: number;
};

type LoanHistoryEntry = {
  loanId: number;
  name: string;
  isActive: boolean;
  interestRate: number;
  refinancedInto?: string;
  paidOffDate?: Date;
  endedBalance?: number;
};

export type MortgageResult = {
  loans: MortgageLoanResult[];
  historicalLoans: MortgageLoanResult[];
  loanHistory: LoanHistoryEntry[];
  whatIfResults: MortgageWhatIfResult[];
  warnings: string[];
  /** Months saved by refinancing (rate/term benefit), independent of extra payments. */
  monthsSavedByRefi: number;
  /** Months saved by extra payments on the active loan (= active loan's monthsAheadOfSchedule). */
  monthsSavedByExtras: number;
  /** Total months saved vs. the original loan with no extras and no refinancing. */
  totalMonthsSaved: number;
};
