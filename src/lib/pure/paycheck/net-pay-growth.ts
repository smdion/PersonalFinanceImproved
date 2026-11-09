/** A paycheck's net pay grown to a later year by the stored growth entries. */

/**
 * Each later year's entry changes the running pay (pct = a percentage of
 * it, dollar = a flat bump carried forward); a year with no entry is 0%.
 */
export function projectedNetPay(
  base: number,
  targetYear: number,
  baseYear: number,
  yearlyGrowth: Record<string, { type: "pct" | "dollar"; value: number }>,
): number {
  let pay = base;
  for (let y = baseYear + 1; y <= targetYear; y++) {
    const e = yearlyGrowth[String(y)];
    if (!e || e.value === 0) continue;
    pay = e.type === "pct" ? pay * (1 + e.value / 100) : pay + e.value;
  }
  return pay;
}
