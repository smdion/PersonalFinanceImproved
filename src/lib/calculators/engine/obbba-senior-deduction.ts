/**
 * OBBBA temporary senior deduction (One Big Beautiful Bill Act, 2025) — a
 * $6,000-per-person deduction for taxpayers age 65+, tax years 2025-2028
 * only, phased out at 6% of MAGI above $75,000 (Single/HoH/MFS) / $150,000
 * (MFJ). Separate from, and in addition to, the long-standing IRC §63(f)
 * additional standard deduction (`ADDITIONAL_STANDARD_DEDUCTION_AGE`,
 * folded in directly by `decumulation-year.ts`).
 *
 * Design note (advisor-reviewed, first plan rejected as a no-op — see
 * `.scratch/docs/plans/DESIGN-NOTE-v0.7.11-obbba-senior-deduction.md`):
 * this MUST be folded into the standard deduction BEFORE withdrawal
 * routing/tax estimation runs, same injection point as §63(f) — by the time
 * `decumulation-year.ts`'s post-withdrawal tax recompute runs,
 * `actualTraditionalRate` is already fixed by `computeTaxFromSlots` and
 * there is no live taxable-income variable left to apply a deduction to.
 *
 * MAGI circularity: this year's real MAGI isn't known until AFTER this
 * deduction needs to be folded in (routing hasn't run yet). Uses LAST
 * YEAR'S MAGI as the phaseout basis — the same 1-year-lag pattern IRMAA's
 * 2-year lookback already uses to break an identical circularity. Year 1 of
 * decumulation (no prior-year MAGI exists yet) gets $0 — a deliberate,
 * understood, self-healing gap (consistent with every other "undefined ⇒ 0"
 * deduction convention in this engine), not silently zeroed by accident.
 */

export type ObbbaSeniorDeductionInput = {
  /** Household members 65+ in the projection year this deduction applies to. */
  seniorCount: number;
  /** Prior year's MAGI — the phaseout basis. Undefined in decumulation year 1
   *  (no MAGI history exists yet) ⇒ $0 deduction that year only. */
  magi: number | undefined;
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
  /** Last year Congress authorized this deduction (2028) — from
   *  `contribution_limits` (`obbba_senior_deduction_sunset_year`), NOT a
   *  hardcoded literal, so the sunset tracks the seed data rather than a
   *  second, independently-maintained boundary. Undefined ⇒ not seeded ⇒ $0
   *  (treated as "the deduction doesn't exist" rather than "no sunset"). */
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
    magi == null ||
    sunsetYear == null ||
    year > sunsetYear
  ) {
    return 0;
  }
  const base = perPerson * seniorCount;
  const reduction = phaseoutRate * Math.max(0, magi - phaseoutStart);
  return Math.max(0, base - reduction);
}
