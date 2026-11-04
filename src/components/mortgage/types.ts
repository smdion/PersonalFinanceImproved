import type { RouterOutputs } from "@/lib/trpc";

type MortgageResult = NonNullable<
  RouterOutputs["mortgage"]["computeActiveSummary"]["result"]
>;

/** One loan in computeActiveSummary's result. */
export type LoanSummary = MortgageResult["loans"][number];

export type AmortEntry = LoanSummary["amortizationSchedule"][number];

export type LoanHistoryEntry = MortgageResult["loanHistory"][number];

export type WhatIfScenarioRow = {
  id: number;
  loanId: number | null;
  label: string;
  extraMonthlyPrincipal: string;
  extraOneTimePayment: string;
  refinanceRate: string | null;
  refinanceTerm: number | null;
  sortOrder: number;
};

export type WhatIfResultRow = {
  scenarioId?: number;
  label: string;
  payoffDate: string;
  totalInterest: number;
  interestSaved: number;
  monthsSaved: number;
};
