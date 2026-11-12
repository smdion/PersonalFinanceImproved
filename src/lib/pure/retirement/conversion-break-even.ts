/** When a Roth conversion plan pays for itself, against no conversions. */

/** The first year the plan's cumulative tax (income tax, IRMAA and the
 *  conversions' own tax) falls below the no-conversion run's; null when it
 *  never does within the rows. */
export function firstBreakEvenYear(
  rows: readonly {
    year: number;
    cumulativeTaxWith: number;
    cumulativeTaxWithout: number;
  }[],
): number | null {
  return (
    rows.find((r) => r.cumulativeTaxWith < r.cumulativeTaxWithout)?.year ?? null
  );
}
