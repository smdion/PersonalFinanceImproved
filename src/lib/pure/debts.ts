/**
 * A debt's payoff estimate — one computation for the Liabilities debts list
 * and the milestones (FOO steps 3 and 9). Counted forward from the date the
 * balance is as of, at the entered rate and monthly payment.
 */
import { loanPayoffMonths } from "@/lib/utils/math";

export type DebtPayoffEstimate = {
  /** Months from the balance's date; null when not estimable. */
  months: number | null;
  /** YYYY-MM; null when not estimable. */
  payoffMonth: string | null;
  /** The payment doesn't cover the interest — it never pays off. */
  never: boolean;
  /** The estimate falls before this month but the debt is still open — the
   *  balance needs updating before it says anything. */
  stale: boolean;
};

export function debtPayoffEstimate(
  d: {
    balance: number;
    interestRate: number | null;
    monthlyPayment: number | null;
    balanceAsOf: string;
  },
  /** Today, YYYY-MM-DD. */
  today: string,
): DebtPayoffEstimate {
  const none = { months: null, payoffMonth: null, never: false, stale: false };
  const months = loanPayoffMonths(d.balance, d.interestRate, d.monthlyPayment);
  if (months === undefined) return none;
  if (months === null) return { ...none, never: true };
  const [y, m] = d.balanceAsOf.split("-").map(Number) as [number, number];
  const i = y * 12 + (m - 1) + months;
  const payoffMonth = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  if (d.balance > 0 && payoffMonth < today.slice(0, 7))
    return { ...none, stale: true };
  return { months, payoffMonth, never: false, stale: false };
}
