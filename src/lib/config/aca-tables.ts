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

/** The largest household the Healthcare settings offer (and the
 *  retirement-settings input accepts). */
export const HOUSEHOLD_SIZE_MAX = 12;

/**
 * The poverty level for a household size. HHS publishes sizes 1–8 and,
 * for a larger household, a fixed amount for each person over 8 — the
 * same step as from 7 to 8, so it's taken from the data, not stored.
 *
 * @param fplByHousehold The poverty levels by household size
 *   (`fpl_by_household`, resolved; sizes 1–8 always present —
 *   fplByHouseholdAmountsSchema).
 */
function povertyLevel(
  householdSize: number,
  fplByHousehold: Record<number, number>,
): number {
  const size = Math.max(1, Math.floor(householdSize));
  const known = (n: number) => {
    const fpl = fplByHousehold[n];
    if (fpl == null)
      throw new Error(`No poverty level for a household of ${n}`);
    return fpl;
  };
  if (size <= 8) return known(size);
  const eight = known(8);
  const step = eight - known(7);
  if (step <= 0)
    throw new Error("Poverty levels must rise with household size (7 → 8)");
  return eight + (size - 8) * step;
}

/**
 * Get the ACA subsidy cliff (400% of FPL) for a given household size.
 * Above this MAGI, all premium tax credits are lost.
 */
export function getAcaSubsidyCliff(
  householdSize: number,
  fplByHousehold: Record<number, number>,
): number {
  return povertyLevel(householdSize, fplByHousehold) * 4;
}

// `estimateAcaSubsidyValue` was removed. It had no production
// caller (the audit and a prior advisor pass both confirmed it dead), and
// it carried the last of the inline ACA rate ladders — the applicable-
// percentage sliding scale (2/4/6/7.5/8.5 %) and the age-band benchmark
// premiums (7200/9600/12000/15600) — as bare `if/else` literals with no
// year anchor. If ACA subsidy *value* estimation is ever
// wanted, rebuild it as a year-keyed table wired through resolveTaxParams,
// not as inline constants.
