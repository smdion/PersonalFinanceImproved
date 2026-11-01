/**
 * The rate Guyton-Klinger actually anchors on (not the flat "Initial
 * Withdrawal Rate" setting): what the portfolio pays in the first retirement
 * year — spending less Social Security — over the retirement balance carried
 * into it. Null while Social Security covers all of it (the engine anchors
 * later), or with no retirement year or balance.
 */
export function gkAnchorRate(
  years: readonly {
    phase: string;
    retirementBalance: number;
    projectedExpenses?: number;
    ssIncome?: number;
  }[],
): number | null {
  const i = years.findIndex((y) => y.phase === "decumulation");
  if (i <= 0) return null;
  const first = years[i]!;
  const carriedIn = years[i - 1]!.retirementBalance;
  const draw = (first.projectedExpenses ?? 0) - (first.ssIncome ?? 0);
  return carriedIn > 0 && draw > 0 ? draw / carriedIn : null;
}
