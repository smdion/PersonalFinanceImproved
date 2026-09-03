// ACA (Affordable Care Act) subsidy cliff tables.
// Source: HHS Federal Poverty Level guidelines.
//
// IMPORTANT CAVEAT: The subsidy estimation in this file uses NATIONAL AVERAGE benchmark
// premiums. Actual ACA premiums and subsidy amounts vary dramatically by state, county,
// age band, tobacco status, and plan metal level. These estimates are useful for
// directional planning (especially the cliff at 400% FPL) but should NOT be treated as
// precise figures. Users should verify their actual subsidy at HealthCare.gov (or their
// state marketplace) using their specific location, ages, and household composition.
//
// Key: Going $1 over 400% FPL costs $15,000-$25,000+ in lost subsidies.
// Roth and HSA withdrawals do NOT count toward MAGI.

/**
 * Which coverage year these guidelines apply to: 26 CFR §1.36B-1(h) sets ACA
 * premium tax credit eligibility for a coverage year using the HHS
 * poverty guidelines PUBLISHED IN THE PRIOR calendar year (guidelines
 * are released each January and apply to marketplace open enrollment
 * that same fall, for the FOLLOWING coverage year). So coverage year
 * 2026 uses the guidelines HHS published in early 2025 -- this table's
 * values are that one-year-lagged publication, not a same-year figure.
 *
 * `FPL_COVERAGE_YEAR` names the COVERAGE year (2026), matching every
 * other `*_DATA_YEAR`-style anchor's convention of naming the year the
 * projection engine actually compares against -- NOT the HHS publication
 * year, which is one year earlier. When refreshing this table for a new
 * coverage year, pull the guidelines HHS published in the PRIOR calendar
 * year (e.g. coverage year 2027 -> guidelines published in 2026), and
 * bump `FPL_COVERAGE_YEAR` to the coverage year, not the publication
 * year -- getting this backwards silently shifts every projection year's
 * growth by one year in bracket-growth.ts's `growthFactor` math.
 */
export const FPL_COVERAGE_YEAR = 2026;

/** Federal Poverty Level by household size (2026 coverage year, continental US). */
export const FPL_BY_HOUSEHOLD: Record<number, number> = {
  1: 15650,
  2: 21150,
  3: 26650,
  4: 32150,
  5: 37650,
  6: 43150,
  7: 48650,
  8: 54150,
};

/**
 * Get the ACA subsidy cliff (400% of FPL) for a given household size.
 * Above this MAGI, all premium tax credits are lost.
 *
 * @param fplOverride DB-resolved FPL map from `fpl_by_household`.
 *   Same override-else-default pattern as LTCG/IRMAA brackets — undefined
 *   ⇒ the hardcoded `FPL_BY_HOUSEHOLD` fallback. The seed row is
 *   byte-identical to the fallback, so passing it is a no-op today; it
 *   exists so a re-seeded / edited FPL year reaches the engine.
 */
export function getAcaSubsidyCliff(
  householdSize: number,
  fplOverride?: Record<number, number>,
): number {
  const table = fplOverride ?? FPL_BY_HOUSEHOLD;
  const clamped = Math.min(Math.max(1, householdSize), 8);
  const fpl = table[clamped] ?? table[2] ?? FPL_BY_HOUSEHOLD[2]!;
  return fpl * 4;
}

/**
 * ACA MAGI (§36B(d)(2)(B)) for a decumulation year — single computation
 * path shared by `checkAca` and any future consumer. Adds back the
 * FULL gross SS benefit, unlike IRMAA MAGI
 * (which uses the 0-85% taxable slice) — this is the one real difference
 * between the two MAGI definitions, so it lives here rather than being
 * re-derived at each call site.
 */
export function acaMagi(input: {
  totalTraditionalWithdrawal: number;
  rothConversionAmount: number;
  brokerageGainsPortion: number;
  /** Non-qualified Roth growth income — ordinary income, belongs in AGI/MAGI
   *  like any other (previously omitted here
   *  while currentYearMagi/NIIT/the IRMAA lookback already included it —
   *  see decumulation-year.ts's own comment on this exact field, which
   *  named "the ACA subsidy check below" as needing it too). */
  rothTaxableGrowth: number;
  ssIncome: number;
}): number {
  return (
    input.totalTraditionalWithdrawal +
    input.rothConversionAmount +
    input.brokerageGainsPortion +
    input.rothTaxableGrowth +
    input.ssIncome
  );
}

// `estimateAcaSubsidyValue` was removed. It had no production
// caller (the audit and a prior advisor pass both confirmed it dead), and
// it carried the last of the inline ACA rate ladders — the applicable-
// percentage sliding scale (2/4/6/7.5/8.5 %) and the age-band benchmark
// premiums (7200/9600/12000/15600) — as bare `if/else` literals with no
// year anchor. If ACA subsidy *value* estimation is ever
// wanted, rebuild it as a year-keyed table wired through resolveTaxParams,
// not as inline constants.
