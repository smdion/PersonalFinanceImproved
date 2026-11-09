/**
 * OBBBA senior deduction: $6,000/person 65+, 2025-2028, phased out 6% of MAGI over $75k/$150k MFJ,
 * on top of §63(f). Folded into the standard deduction before routing, with last year's MAGI as
 * the phaseout basis (this year's isn't known yet), so decumulation year 1 gets $0.
 */

type ObbbaSeniorDeductionInput = {
  /** Household members 65+ in the projection year this deduction applies to. */
  seniorCount: number;
  /** Prior year's MAGI — the phaseout basis. Unknown in decumulation year 1
   *  (no MAGI history exists yet) ⇒ $0 deduction that year only. */
  magi: { kind: "known"; value: number } | { kind: "unknown" };
  /** $6,000/person per the statute — from `contribution_limits`
   *  (`obbba_senior_deduction_per_person`). Undefined ⇒ not seeded for this
   *  tax year ⇒ $0 (same convention as every other deduction figure here). */
  perPerson: number | undefined;
  /** Filing-status-resolved phaseout start ($150k MFJ / $75k Single/HoH/MFS)
   *  — from `contribution_limits`. */
  phaseoutStart: number | undefined;
  /** 6% per the statute — from `contribution_limits`
   *  (`obbba_senior_deduction_phaseout_rate`). */
  phaseoutRate: number | undefined;
  /** The projection year this deduction is being computed for. */
  year: number;
  /** Last year the deduction is authorized, from `contribution_limits`
   *  (`obbba_senior_deduction_sunset_year`). Undefined (not seeded) ⇒ $0. */
  sunsetYear: number | undefined;
};

/**
 * The OBBBA deduction reduces the TOTAL claimed amount (perPerson x
 * seniorCount), not each person's share independently — the 6% phaseout
 * applies once against the combined base, per the statute's own worksheet.
 */
export function computeObbbaSeniorDeduction(
  input: ObbbaSeniorDeductionInput,
): number {
  const {
    seniorCount,
    magi,
    perPerson,
    phaseoutStart,
    phaseoutRate,
    year,
    sunsetYear,
  } = input;
  if (
    seniorCount <= 0 ||
    perPerson == null ||
    phaseoutStart == null ||
    phaseoutRate == null ||
    magi.kind === "unknown" ||
    sunsetYear == null ||
    year > sunsetYear
  ) {
    return 0;
  }
  const base = perPerson * seniorCount;
  const reduction = phaseoutRate * Math.max(0, magi.value - phaseoutStart);
  return Math.max(0, base - reduction);
}
