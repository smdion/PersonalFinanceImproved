import { trpc } from "@/lib/trpc";

export type AmortEntry = {
  month: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  extraPayment: number;
  balance: number;
};

export type LoanSummary = {
  loanId: number;
  name: string;
  currentBalance: number;
  remainingMonths: number;
  totalInterestLife: number;
  amortizationSchedule: AmortEntry[];
  payoffDate: string;
  payoffPercent: number;
  totalInterestPaid: number;
  totalInterestSaved: number;
  monthsAheadOfSchedule: number;
  fullTermStandardInterest?: number;
  paidOffDate?: string;
  endedBalance?: number;
  wasRefinanced?: boolean;
};

export type LoanHistoryEntry = {
  loanId: number;
  name: string;
  isActive: boolean;
  refinancedInto?: string;
  paidOffDate?: string;
  endedBalance?: number;
};

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

export type TrpcUtils = ReturnType<typeof trpc.useUtils>;
