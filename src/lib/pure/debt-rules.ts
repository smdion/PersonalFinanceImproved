/**
 * Money Guy's borrowing rules on the debts list (config CAR_RULE,
 * STUDENT_LOAN_RULE). Pure: the milestones judge from these.
 */
import { CAR_RULE, STUDENT_LOAN_RULE } from "@/lib/config/milestones";

export type CarLoanCheck = {
  name: string;
  /** Down payment ÷ price; null without a price and original amount. */
  downShare: number | null;
  termMonths: number | null;
  /** Each part: true met, false missed, null not known. */
  downOk: boolean | null;
  termOk: boolean | null;
};

/** 20 and 3 per open car loan (down payment, term). */
export function checkCarLoan(loan: {
  name: string;
  purchasePrice: number | null;
  originalAmount: number | null;
  termMonths: number | null;
}): CarLoanCheck {
  const downShare =
    loan.purchasePrice && loan.purchasePrice > 0 && loan.originalAmount != null
      ? (loan.purchasePrice - loan.originalAmount) / loan.purchasePrice
      : null;
  return {
    name: loan.name,
    downShare,
    termMonths: loan.termMonths,
    downOk:
      downShare === null ? null : downShare >= CAR_RULE.minDownShare - 1e-9,
    termOk:
      loan.termMonths === null
        ? null
        : loan.termMonths <= CAR_RULE.maxTermMonths,
  };
}

/** The 8: every car payment together against gross monthly pay. Null when
 *  a payment or the pay isn't known. */
export function carPaymentShare(
  monthlyPayments: readonly (number | null)[],
  grossAnnualPay: number,
): number | null {
  if (grossAnnualPay <= 0 || monthlyPayments.some((p) => p === null))
    return null;
  const total = monthlyPayments.reduce<number>((s, p) => s + (p ?? 0), 0);
  return total / (grossAnnualPay / 12);
}

/**
 * The salary a person's student loans are judged against: the first year
 * of pay at or after the earliest loan's year that's a full year, within
 * STUDENT_LOAN_RULE.maxYearsAfterLoan. A year is full when some job ran
 * through its January and some job through its December — a first job
 * starting after January makes that year partial (the next counts); a
 * second job taken mid-year, or one job following another, doesn't. Null
 * when there's none.
 */
export function firstFullSalary(
  salaries: readonly { year: number; salary: number }[],
  jobs: readonly { startDate: string; endDate: string | null }[],
  loanYear: number,
): { year: number; salary: number } | null {
  const heldOn = (start: string, end: string) =>
    jobs.some((j) => j.startDate <= start && (j.endDate ?? "9999") >= end);
  const full = (year: number) =>
    heldOn(`${year}-01-31`, `${year}-01-01`) &&
    heldOn(`${year}-12-31`, `${year}-12-01`);
  return (
    [...salaries]
      .filter(
        (s) =>
          s.salary > 0 &&
          s.year >= loanYear &&
          s.year - loanYear <= STUDENT_LOAN_RULE.maxYearsAfterLoan &&
          full(s.year),
      )
      .sort((a, b) => a.year - b.year)[0] ?? null
  );
}
