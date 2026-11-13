// ACA (Affordable Care Act) subsidy cliff at 400% FPL. Poverty levels are yearly data passed in
// by the caller (`fpl_by_household`; coverage year N uses the HHS guidelines published in N−1,
// 26 CFR §1.36B-1(h)). Roth and HSA withdrawals do NOT count toward MAGI.
import { filingRules, type ReturnFilingStatus } from "./filing-status";

/** The largest household the Healthcare settings offer (and the
 *  retirement-settings input accepts). */
export const HOUSEHOLD_SIZE_MAX = 12;

/** The ACA family size when none is stated: the household's people (unknown: the return's
 *  minimum), at least the return's minimum family (no status known: one), at most 12. */
export function acaHouseholdSize(
  peopleCount: number | undefined,
  status: ReturnFilingStatus | null | undefined,
): number {
  const minimum = status == null ? 1 : filingRules(status).minimumFamily;
  return Math.min(
    Math.max(peopleCount ?? minimum, minimum),
    HOUSEHOLD_SIZE_MAX,
  );
}

/** The poverty level for a household size. `fplByHousehold` holds sizes 1–8; each person
 *  over 8 adds HHS's fixed step, the same as from 7 to 8, so it's taken from the data. */
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
