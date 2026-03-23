/**
 * Mortgage balance computation helpers.
 */
import * as schema from "@/lib/db/schema";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import type {
  MortgageLoanInput,
  MortgageExtraPayment,
} from "@/lib/calculators/types";
import { MAX_EXTRA_PAYMENTS } from "@/lib/constants";
import { toNumber } from "./transforms";

/**
 * Build mortgage inputs from DB rows and compute current balance via amortization.
 * Used by networth and historical routers.
 */
export function buildMortgageInputs(
  mortgageLoans: (typeof schema.mortgageLoans.$inferSelect)[],
  extraPayments: (typeof schema.mortgageExtraPayments.$inferSelect)[],
): { loanInputs: MortgageLoanInput[]; extras: MortgageExtraPayment[] } {
  const loanInputs: MortgageLoanInput[] = mortgageLoans.map((l) => ({
    id: l.id,
    name: l.name,
    originalBalance: toNumber(l.originalLoanAmount),
    interestRate: toNumber(l.interestRate),
    termMonths: l.termYears * 12,
    startDate: new Date(l.firstPaymentDate),
    monthlyPI: toNumber(l.principalAndInterest),
    refinancedFromId: l.refinancedFromId ?? undefined,
    isActive: l.isActive,
    paidOffDate: l.paidOffDate ? new Date(l.paidOffDate) : undefined,
    apiBalance: l.apiBalance ? toNumber(l.apiBalance) : undefined,
    apiBalanceDate: l.apiBalanceDate ? new Date(l.apiBalanceDate) : undefined,
  }));

  const extras: MortgageExtraPayment[] = [];
  for (const ep of extraPayments) {
    if (ep.paymentDate) {
      extras.push({
        loanId: ep.loanId,
        date: new Date(ep.paymentDate),
        amount: toNumber(ep.amount),
      });
    } else if (ep.startDate && ep.endDate) {
      const start = new Date(ep.startDate);
      const end = new Date(ep.endDate);
      const current = new Date(start);
      // MAX_EXTRA_PAYMENTS imported from constants (50 years of monthly payments)
      let count = 0;
      while (current <= end && count < MAX_EXTRA_PAYMENTS) {
        extras.push({
          loanId: ep.loanId,
          date: new Date(current),
          amount: toNumber(ep.amount),
        });
        current.setMonth(current.getMonth() + 1);
        count++;
      }
    }
  }

  return { loanInputs, extras };
}

/** Compute total current mortgage balance across all loans. */
export function computeMortgageBalance(
  mortgageLoans: (typeof schema.mortgageLoans.$inferSelect)[],
  extraPayments: (typeof schema.mortgageExtraPayments.$inferSelect)[],
  asOfDate: Date = new Date(),
): number {
  const { loanInputs, extras } = buildMortgageInputs(
    mortgageLoans,
    extraPayments,
  );
  const result = calculateMortgage({
    loans: loanInputs,
    extraPayments: extras,
    whatIfScenarios: [],
    asOfDate,
  });
  return result.loans.reduce((s, l) => s + l.currentBalance, 0);
}
