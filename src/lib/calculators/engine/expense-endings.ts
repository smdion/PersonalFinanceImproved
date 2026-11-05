/**
 * Spending in the budget that ends on a date: a loan paid off. Each ending
 * is a share of the phase's budget, not a dollar figure, so it needs no
 * record of how the budget has inflated (CPI, the post-retirement rate, or
 * none for a strategy that doesn't use it) and works on a reactive
 * strategy's carried amount the same way.
 *
 * A figure the household typed for a year (a budget override) is what it
 * says: an ending never trims it, then or after.
 */
import type { ExpenseEnding } from "../../pure/engine/types/projection-result";

type Phase = "accumulation" | "decumulation";

/** What's left of the phase's budget in `year`, 0 to 1. */
function remainingShare(
  endings: readonly ExpenseEnding[],
  phase: Phase,
  year: number,
): number {
  const ended = endings
    .filter((e) => e.year <= year)
    .reduce((t, e) => t + e[phase], 0);
  return Math.max(0, 1 - ended);
}

/** The factor taking last year's expenses to this year's. On the year a
 *  phase's budget is first seeded, everything already ended comes off. */
export function expenseEndingFactor(args: {
  endings: readonly ExpenseEnding[] | undefined;
  phase: Phase;
  year: number;
  seeded: boolean;
}): number {
  const { endings, phase, year, seeded } = args;
  if (!endings || endings.length === 0) return 1;
  const now = remainingShare(endings, phase, year);
  if (seeded) return now;
  const before = remainingShare(endings, phase, year - 1);
  return before > 0 ? now / before : 0;
}
