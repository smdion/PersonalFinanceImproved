/**
 * Budget lines that end: each line linked to a loan stops the year after
 * that loan's payoff, on the loan's own schedule (extra payments included).
 *
 * A line can hold more than the payment (escrow lumped in), so only the
 * principal and interest leaves the budget: taxes and insurance outlive the
 * loan. A link to a refinanced loan follows it to the loan that replaced it.
 * Spending typed in for a phase has no lines, so nothing ends in it.
 */
import * as schema from "@/lib/db/schema";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import type { ExpenseEnding } from "@/lib/calculators/types";
import { computeBudgetAnnualTotal } from "@/server/helpers";
import { buildMortgageInputs } from "@/server/helpers/mortgage";
import { toNumber } from "@/server/helpers/transforms";
import type { Db } from "@/lib/db";

type Loan = typeof schema.mortgageLoans.$inferSelect;
type Item = typeof schema.budgetItems.$inferSelect;
type Phase = {
  profileId: number | undefined;
  column: number;
  months: number[] | null;
  /** The phase's whole budget, a year. */
  annual: number;
  /** Spending was typed in: no lines to end. */
  typed: boolean;
};

/** The loan a link now means: follows refinances to the current one. */
export function currentLoan(loans: readonly Loan[], id: number): Loan | null {
  let loan = loans.find((l) => l.id === id) ?? null;
  for (let hops = 0; loan && hops < loans.length; hops++) {
    const next = loans.find((l) => l.refinancedFromId === loan!.id);
    if (!next) break;
    loan = next;
  }
  return loan;
}

export async function loadExpenseEndings(
  db: Db,
  args: {
    items: readonly Item[];
    accumulation: Phase;
    decumulation: Phase;
    asOfDate: Date;
  },
): Promise<ExpenseEnding[]> {
  const { items, accumulation, decumulation, asOfDate } = args;
  const linked = items.filter((i) => i.mortgageLoanId !== null);
  if (linked.length === 0) return [];
  const [loans, extraPayments] = await Promise.all([
    db.select().from(schema.mortgageLoans),
    db.select().from(schema.mortgageExtraPayments),
  ]);
  const { loanInputs, extras } = buildMortgageInputs(loans, extraPayments);
  const schedules = calculateMortgage({
    loans: loanInputs,
    extraPayments: extras,
    whatIfScenarios: [],
    asOfDate,
  }).loans;

  const shareOf = (loan: Loan, phase: Phase) => {
    const item = linked.find(
      (i) =>
        i.profileId === phase.profileId &&
        i.mortgageLoanId !== null &&
        currentLoan(loans, i.mortgageLoanId)?.id === loan.id,
    );
    if (!item || phase.typed || phase.annual <= 0) return 0;
    const line = computeBudgetAnnualTotal(
      [{ amounts: item.amounts as number[] }],
      phase.column,
      phase.months,
    );
    const payment = toNumber(loan.principalAndInterest) * 12;
    return Math.min(1, Math.min(line, payment) / phase.annual);
  };

  const current = new Map(
    linked.flatMap((i) => {
      const loan = currentLoan(loans, i.mortgageLoanId!);
      return loan ? [[loan.id, loan] as const] : [];
    }),
  );
  return [...current.values()].flatMap((loan) => {
    const payoff =
      loan.paidOffDate ??
      schedules.find((s) => s.loanId === loan.id)?.payoffDate;
    if (!payoff) return [];
    return [
      {
        year: new Date(payoff).getFullYear() + 1,
        accumulation: shareOf(loan, accumulation),
        decumulation: shareOf(loan, decumulation),
      },
    ];
  });
}
