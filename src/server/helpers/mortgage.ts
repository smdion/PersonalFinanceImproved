/**
 * Mortgage balance computation helpers.
 */
import * as schema from "@/lib/db/schema";
import { calculateMortgage } from "@/lib/pure/debts/mortgage";
import type {
  MortgageLoanInput,
  MortgageExtraPayment,
} from "@/lib/pure/types/calculators";
import { MAX_EXTRA_PAYMENTS } from "@/lib/constants";
import { toNumber } from "./transforms";

/**
 * The active mortgage loan — the only place that should resolve `isActive`
 * from an already-loaded loans array. Falls back to the first loan (by id)
 * if none is marked active. Returns undefined only when no loans exist.
 */
export function getActiveMortgageLoan<T extends { isActive: boolean }>(
  mortgageLoans: T[],
): T | undefined {
  return mortgageLoans.find((l) => l.isActive) ?? mortgageLoans[0];
}

/** `start` plus `months` calendar months (UTC, matching how the ISO date
 *  strings parse), clamped to the target month's last day. */
export function addMonthsClamped(start: Date, months: number): Date {
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out = new Date(start);
  out.setUTCFullYear(year, month, Math.min(start.getUTCDate(), lastDay));
  return out;
}

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
      // MAX_EXTRA_PAYMENTS imported from constants (50 years of monthly payments)
      let count = 0;
      // Each date is start + n months, clamped to that month's last day —
      // stepping with setMonth(+1) turns Jan 31 into Mar 3, then the 3rd of
      // every later month, dropping payments from the series.
      let current = addMonthsClamped(start, 0);
      while (current <= end && count < MAX_EXTRA_PAYMENTS) {
        extras.push({
          loanId: ep.loanId,
          date: current,
          amount: toNumber(ep.amount),
        });
        count++;
        current = addMonthsClamped(start, count);
      }
    }
  }

  return { loanInputs, extras };
}

/** Total mortgage balance across all loans at `asOfDate`. A live balance
 *  (api_balance) applies only to the current period from its own date on;
 *  `currentDate` is today unless a caller's clock is pinned. */
export function computeMortgageBalance(
  mortgageLoans: (typeof schema.mortgageLoans.$inferSelect)[],
  extraPayments: (typeof schema.mortgageExtraPayments.$inferSelect)[],
  asOfDate: Date = new Date(),
  currentDate: Date = new Date(),
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
    currentDate,
  });
  return result.loans.reduce((s, l) => s + l.currentBalance, 0);
}
