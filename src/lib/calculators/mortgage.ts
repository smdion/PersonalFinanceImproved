/**
 * Mortgage Calculator
 *
 * Handles multiple loans, refinance chains, extra payments, and what-if scenarios.
 *
 * Key concepts:
 *   - **Multi-loan support**: A household can have multiple mortgages (e.g. primary + rental).
 *     Each loan is amortized independently.
 *   - **Refinance chains**: When a loan is refinanced, the old loan is marked inactive and the
 *     new loan has `refinancedFromId` pointing to the old one. The loan history shows the chain
 *     (e.g. "Original 30yr → Refi 15yr") so users understand their mortgage history.
 *   - **Extra payments**: One-time or recurring principal payments reduce the loan faster. They
 *     are matched to amortization months by date. The calculator compares with-extras vs.
 *     without-extras to show interest saved and months ahead of schedule.
 *   - **What-if scenarios**: "What if I pay $200/month extra?" scenarios are computed by injecting
 *     hypothetical extra payments starting from asOfDate and comparing against the baseline.
 *
 * Amortization formula:
 *   Each month: interest = balance × (annual_rate / 12)
 *               principal = min(monthly_PI - interest, remaining_balance)
 *               extra = min(extra_payment, remaining_balance - principal)
 *               new_balance = balance - principal - extra
 *   Loop terminates when balance reaches $0 or term expires.
 */
import type {
  MortgageInput,
  MortgageResult,
  MortgageLoanInput,
  MortgageLoanResult,
  MortgageWhatIfResult,
  AmortizationEntry,
  MortgageExtraPayment,
} from "./types";
import { roundToCents, safeDivide } from "../utils/math";
import { MONTHS_PER_YEAR, AMORTIZATION_BALANCE_TOLERANCE } from "../constants";

export function calculateMortgage(input: MortgageInput): MortgageResult {
  const warnings: string[] = [];
  const { loans, extraPayments, whatIfScenarios, asOfDate } = input;

  // Validate interest rates — warn if they look like monthly rates instead of annual
  for (const loan of loans) {
    if (loan.interestRate > 0 && loan.interestRate < 0.01) {
      warnings.push(
        `${loan.name}: interest rate ${(loan.interestRate * 100).toFixed(3)}% looks like a monthly rate. ` +
          `This calculator expects an annual rate (e.g. 0.065 for 6.5%).`,
      );
    }
  }

  // Validate extra payments — reject negative amounts
  for (const ep of extraPayments) {
    if (ep.amount < 0) {
      warnings.push(
        `Extra payment on ${ep.date} has negative amount ($${ep.amount.toFixed(2)}). ` +
          `Negative extra payments are not supported and will be ignored.`,
      );
    }
  }

  // Amortize each currently active loan
  const loanResults: MortgageLoanResult[] = [];
  for (const loan of loans.filter((l) => l.isActive)) {
    const result = amortizeLoan(loan, extraPayments, asOfDate);
    loanResults.push(result);
  }

  // Amortize historical (inactive) loans for reference.
  // For refinanced loans, truncate at the refinance date (= the new loan's start date)
  // so we show actual interest paid, not full-term projected interest.
  const historicalResults: MortgageLoanResult[] = [];
  for (const loan of loans.filter((l) => !l.isActive)) {
    // Find the loan that refinanced from this one
    const successor = loans.find((l) => l.refinancedFromId === loan.id);
    const wasRefinanced = !!successor;
    // Use paidOffDate if set, else derive from refinance successor start date
    const endDate =
      loan.paidOffDate ?? (successor ? successor.startDate : undefined);
    const result = amortizeLoan(loan, extraPayments, asOfDate, endDate);
    // Attach historical metadata
    result.wasRefinanced = wasRefinanced;
    result.paidOffDate = endDate;
    result.endedBalance = endDate
      ? (result.amortizationSchedule[result.amortizationSchedule.length - 1]
          ?.balance ?? 0)
      : undefined;
    historicalResults.push(result);
  }

  // Build loanHistory after amortization so we can include endedBalance
  const loanHistory = loans.map((loan) => {
    const refinancedInto = loans.find((l) => l.refinancedFromId === loan.id);
    const histResult = historicalResults.find((r) => r.loanId === loan.id);
    return {
      loanId: loan.id,
      name: loan.name,
      isActive: loan.isActive,
      refinancedInto: refinancedInto?.name,
      paidOffDate: histResult?.paidOffDate,
      endedBalance: histResult?.endedBalance,
    };
  });

  // What-if scenarios: for each scenario × applicable active loans, compute a hypothetical
  // schedule with the extra monthly principal added starting from today, then compare against baseline.
  // If a scenario has a loanId, only apply to that loan; otherwise apply to all active loans.
  const whatIfResults: MortgageWhatIfResult[] = [];
  for (const scenario of whatIfScenarios) {
    const targetLoans = scenario.loanId
      ? loans.filter((l) => l.isActive && l.id === scenario.loanId)
      : loans.filter((l) => l.isActive);
    for (const loan of targetLoans) {
      const result = amortizeWhatIf(
        loan,
        extraPayments,
        asOfDate,
        scenario.extraMonthlyPrincipal,
      );
      const baseline = loanResults.find((r) => r.loanId === loan.id);
      if (baseline) {
        whatIfResults.push({
          scenarioId: scenario.id,
          label: `${loan.name}: ${scenario.label}`,
          payoffDate: result.payoffDate,
          totalInterest: result.totalInterestLife,
          interestSaved: roundToCents(
            baseline.totalInterestLife - result.totalInterestLife,
          ),
          monthsSaved:
            baseline.amortizationSchedule.length - result.totalMonths,
        });
      }
    }
  }

  return {
    loans: loanResults,
    historicalLoans: historicalResults,
    loanHistory,
    whatIfResults,
    warnings,
  };
}

/**
 * Amortizes a single loan with actual extra payments and computes current status.
 *
 * Builds two schedules:
 *   1. With extra payments (actual) — shows real payoff timeline
 *   2. Without extra payments (standard) — the original loan terms
 * Comparing the two gives: interest saved, months ahead of schedule.
 *
 * For historical (refinanced) loans, pass `endDate` to truncate the schedule at the
 * refinance date. This ensures we show actual interest paid, not full-term projected.
 */
function amortizeLoan(
  loan: MortgageLoanInput,
  extraPayments: MortgageExtraPayment[],
  asOfDate: Date,
  endDate?: Date,
): MortgageLoanResult {
  // Only consider extra payments belonging to this loan
  const loanExtras = extraPayments.filter((ep) => ep.loanId === loan.id);
  let schedule = buildAmortization(loan, loanExtras);
  const fullStandardSchedule = buildAmortization(loan, []); // baseline without extras (full term)
  let standardSchedule = [...fullStandardSchedule];

  // For refinanced loans, truncate schedules at the refinance date
  if (endDate) {
    schedule = schedule.filter((e) => e.date <= endDate);
    standardSchedule = standardSchedule.filter((e) => e.date <= endDate);
  }

  // Walk the schedule to find where we are today (or end of loan life for historical)
  const effectiveDate = endDate && endDate < asOfDate ? endDate : asOfDate;
  let currentBalance = loan.originalBalance;
  let totalInterestPaid = 0;
  for (const entry of schedule) {
    if (entry.date > effectiveDate) break;
    currentBalance = entry.balance;
    totalInterestPaid += entry.interest;
  }

  // For historical loans that ended before today, balance should reflect the last entry
  if (endDate && endDate < asOfDate && schedule.length > 0) {
    currentBalance = schedule[schedule.length - 1]!.balance;
    totalInterestPaid = schedule.reduce((s, e) => s + e.interest, 0);
  }

  // API balance override: when YNAB provides a more accurate balance, use it as current
  // and store the calculated balance for comparison.
  // Only apply for present-day queries — historical year-end balances should use amortization.
  let apiBalance: number | undefined;
  let apiBalanceDate: Date | undefined;
  let calculatedBalance: number | undefined;
  const isCurrentPeriod =
    !endDate && new Date().getFullYear() - asOfDate.getFullYear() <= 0;
  if (loan.apiBalance != null && isCurrentPeriod) {
    calculatedBalance = roundToCents(currentBalance);
    apiBalance = loan.apiBalance;
    apiBalanceDate = loan.apiBalanceDate;
    currentBalance = loan.apiBalance;
  }

  // How much of the original loan has been paid off (0.0 to 1.0)
  const payoffPercent = Number(
    safeDivide(loan.originalBalance - currentBalance, loan.originalBalance) ??
      0,
  );

  // Compare actual vs. standard to show impact of extra payments
  const totalInterestLife = schedule.reduce((s, e) => s + e.interest, 0);
  const standardInterestLife = standardSchedule.reduce(
    (s, e) => s + e.interest,
    0,
  );
  const totalInterestSaved = roundToCents(
    standardInterestLife - totalInterestLife,
  );

  // For historical loans that have ended, remainingMonths is 0
  const remainingEntries = endDate
    ? []
    : schedule.filter((e) => e.date > asOfDate);
  const remainingMonths = remainingEntries.length;
  const monthsAheadOfSchedule = standardSchedule.length - schedule.length;

  const lastEntry = schedule[schedule.length - 1];
  const payoffDate = lastEntry?.date ?? loan.startDate;

  // For historical loans, provide the full-term standard interest for Refinance Impact comparison
  const fullTermStandardInterest = endDate
    ? roundToCents(fullStandardSchedule.reduce((s, e) => s + e.interest, 0))
    : undefined;

  return {
    loanId: loan.id,
    name: loan.name,
    currentBalance: roundToCents(currentBalance),
    payoffPercent,
    totalInterestPaid: roundToCents(totalInterestPaid),
    totalInterestLife: roundToCents(totalInterestLife),
    totalInterestSaved,
    remainingMonths,
    monthsAheadOfSchedule,
    payoffDate,
    amortizationSchedule: schedule,
    fullTermStandardInterest,
    apiBalance,
    apiBalanceDate,
    calculatedBalance,
  };
}

/**
 * What-if scenario: "What if I pay an extra $X/month starting now?"
 *
 * Takes the existing extra payments (already made) and injects hypothetical future extra
 * payments of `extraMonthlyPrincipal` every month from next month through end of term.
 * Returns the hypothetical payoff date, total interest, and total months for comparison
 * against the baseline.
 */
function amortizeWhatIf(
  loan: MortgageLoanInput,
  existingExtras: MortgageExtraPayment[],
  asOfDate: Date,
  extraMonthlyPrincipal: number,
): { payoffDate: Date; totalInterestLife: number; totalMonths: number } {
  const loanExtras = existingExtras.filter((ep) => ep.loanId === loan.id);
  const whatIfExtras: MortgageExtraPayment[] = [...loanExtras];
  // Inject hypothetical extra payments starting next month
  const startMonth = new Date(
    asOfDate.getFullYear(),
    asOfDate.getMonth() + 1,
    1,
  );
  for (let m = 0; m < loan.termMonths; m++) {
    const date = addMonths(startMonth, m);
    whatIfExtras.push({ loanId: loan.id, date, amount: extraMonthlyPrincipal });
  }

  const schedule = buildAmortization(loan, whatIfExtras);
  const totalInterestLife = schedule.reduce((s, e) => s + e.interest, 0);
  const lastEntry = schedule[schedule.length - 1];

  return {
    payoffDate: lastEntry?.date ?? loan.startDate,
    totalInterestLife: roundToCents(totalInterestLife),
    totalMonths: schedule.length,
  };
}

/**
 * Builds a month-by-month amortization schedule for a single loan.
 *
 * Standard amortization: fixed monthly P&I payment, with interest computed on remaining balance.
 * As balance decreases, more of each payment goes to principal.
 *
 * Extra payments are matched by month and applied as additional principal. If multiple extra
 * payments fall in the same month, they are summed. Extra principal cannot exceed the remaining
 * balance after the base principal payment.
 *
 * The loop terminates when balance drops below $0.005 (half a cent) to avoid floating-point
 * rounding issues that could create an extra month with a fraction-of-a-cent balance.
 */
function buildAmortization(
  loan: MortgageLoanInput,
  extraPayments: MortgageExtraPayment[],
): AmortizationEntry[] {
  const monthlyRate = loan.interestRate / MONTHS_PER_YEAR;
  let balance = loan.originalBalance;
  const schedule: AmortizationEntry[] = [];

  for (
    let m = 1;
    m <= loan.termMonths && balance > AMORTIZATION_BALANCE_TOLERANCE;
    m++
  ) {
    const paymentDate = addMonths(loan.startDate, m);

    // Interest accrued this month on the current balance
    const interest = roundToCents(balance * monthlyRate);
    // Base principal = monthly P&I payment minus interest (capped at remaining balance)
    const basePrincipal = Math.min(
      roundToCents(loan.monthlyPI - interest),
      balance,
    );

    // Sum all extra payments that fall in this month (skip negative amounts)
    const extraForMonth = extraPayments
      .filter((ep) => isSameMonth(ep.date, paymentDate) && ep.amount > 0)
      .reduce((sum, ep) => sum + ep.amount, 0);
    // Extra principal can't exceed what's left after base principal
    const extraPrincipal = Math.min(
      roundToCents(extraForMonth),
      roundToCents(balance - basePrincipal),
    );
    const totalPrincipal = basePrincipal + extraPrincipal;

    balance = roundToCents(Math.max(0, balance - totalPrincipal));

    schedule.push({
      month: m,
      date: paymentDate,
      payment: roundToCents(loan.monthlyPI + extraPrincipal),
      principal: roundToCents(totalPrincipal),
      interest,
      extraPayment: roundToCents(extraPrincipal),
      balance,
    });
  }

  return schedule;
}

/**
 * Adds N months to a date, clamping the day to the last day of the target month.
 * Uses UTC methods and normalises to noon UTC so that timezone differences between
 * server (UTC) and client (e.g. CST/UTC-6) never shift the displayed month.
 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCHours(12, 0, 0, 0); // noon UTC avoids day-boundary timezone shifts
  const targetMonth = result.getUTCMonth() + months;
  result.setUTCMonth(targetMonth);
  // If the day overflowed into the next month (e.g. Feb 31 → Mar 3),
  // roll back to the last day of the intended month.
  if (result.getUTCMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setUTCDate(0); // moves to the last day of the previous month
  }
  return result;
}

function isSameMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth()
  );
}
