/** A run of the year's checks summed from the year schedule: the one reader of year totals. */
import type { PeriodBreakdown } from "./paycheck.types";
import { roundToCents, sumBy } from "../../utils/math";

export type YearTotals = {
  /** Regular pay on the checks in the range. */
  gross: number;
  preTax: number;
  federal: number;
  ficaSS: number;
  ficaMedicare: number;
  /** Social Security + Medicare on the regular pay. */
  fica: number;
  postTax: number;
  /** Take-home from the regular pay. */
  net: number;
  /** The bonus paid on a check in the range, with its own withholding. */
  bonusGross: number;
  bonusFederal: number;
  bonusFica: number;
};

/**
 * The year schedule's checks `first` through `last` (calendar check numbers, 1-indexed,
 * inclusive) summed line by line, each to the cent. Rows before a job's start are zeros.
 */
export function yearTotals(
  schedule: readonly PeriodBreakdown[],
  first: number,
  last: number,
): YearTotals {
  const rows = schedule.slice(Math.max(0, first - 1), Math.max(0, last));
  const total = (pick: (p: PeriodBreakdown) => number) =>
    roundToCents(sumBy(rows, pick));
  return {
    gross: total((p) => p.gross),
    preTax: total((p) => p.preTaxDeductions),
    federal: total((p) => p.federalWithholding),
    ficaSS: total((p) => p.ficaSS),
    ficaMedicare: total((p) => p.ficaMedicare),
    fica: total((p) => p.ficaSS + p.ficaMedicare),
    postTax: total((p) => p.postTaxDeductions),
    net: total((p) => p.netPay),
    bonusGross: total((p) => p.bonusGross),
    bonusFederal: total((p) => p.bonusWithholding),
    bonusFica: total((p) => p.bonusFica),
  };
}

/** A bonus check's take-home: its gross less its withholding, its FICA and what it takes. */
export function bonusCheckNet(c: {
  gross: number;
  federal: number;
  fica: number;
  contributions: number;
}): number {
  return roundToCents(c.gross - c.federal - c.fica - c.contributions);
}
