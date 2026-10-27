// ACA (Affordable Care Act) subsidy cliff tables.
// The poverty levels are yearly data (tax-data/us-federal/ →
// `fpl_by_household`; coverage year N uses the guidelines HHS published in
// N−1, 26 CFR §1.36B-1(h)), passed in by the caller.
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
 * Get the ACA subsidy cliff (400% of FPL) for a given household size.
 * Above this MAGI, all premium tax credits are lost.
 *
 * @param fplByHousehold The poverty levels by household size
 *   (`fpl_by_household`, resolved; sizes 1–8 always present —
 *   fplByHouseholdAmountsSchema). Households over 8 use size 8.
 */
export function getAcaSubsidyCliff(
  householdSize: number,
  fplByHousehold: Record<number, number>,
): number {
  const size = Math.min(Math.max(1, householdSize), 8);
  const fpl = fplByHousehold[size];
  if (fpl == null)
    throw new Error(`No poverty level for a household of ${size}`);
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
