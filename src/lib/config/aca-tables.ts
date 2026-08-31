// ACA (Affordable Care Act) subsidy cliff tables.
// Source: HHS Federal Poverty Level guidelines (2026 projected).
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

/** Federal Poverty Level by household size (2026 projected, continental US). */
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
 */
export function getAcaSubsidyCliff(householdSize: number): number {
  const fpl =
    FPL_BY_HOUSEHOLD[Math.min(Math.max(1, householdSize), 8)] ??
    FPL_BY_HOUSEHOLD[2]!;
  return fpl * 4;
}

/**
 * ACA MAGI (§36B(d)(2)(B)) for a decumulation year — single computation
 * path shared by `checkAca` and any future consumer (R55 advisor review,
 * 2026-08-30). Adds back the FULL gross SS benefit, unlike IRMAA MAGI
 * (which uses the 0-85% taxable slice) — this is the one real difference
 * between the two MAGI definitions, so it lives here rather than being
 * re-derived at each call site.
 */
export function acaMagi(input: {
  totalTraditionalWithdrawal: number;
  rothConversionAmount: number;
  brokerageGainsPortion: number;
  ssIncome: number;
}): number {
  return (
    input.totalTraditionalWithdrawal +
    input.rothConversionAmount +
    input.brokerageGainsPortion +
    input.ssIncome
  );
}

/**
 * Estimate annual ACA subsidy value for a household.
 * Rough approximation: subsidy depends on age, location, and income.
 * Uses national average benchmark plan costs for ballpark estimates.
 *
 * Returns 0 if MAGI exceeds the subsidy cliff.
 */
export function estimateAcaSubsidyValue(
  magi: number,
  householdSize: number,
  primaryAge: number,
): number {
  const cliff = getAcaSubsidyCliff(householdSize);
  if (magi >= cliff) return 0;

  // Rough benchmark plan cost by age (national average, 2026 projected)
  // Actual varies hugely by state/county, but this gives a useful ballpark.
  let annualPremium: number;
  if (primaryAge < 50) annualPremium = 7200;
  else if (primaryAge < 55) annualPremium = 9600;
  else if (primaryAge < 60) annualPremium = 12000;
  else annualPremium = 15600;

  // For 2-person households, roughly 1.8x single premium
  if (householdSize >= 2) annualPremium = Math.round(annualPremium * 1.8);

  // Expected contribution as % of income (ACA sliding scale, simplified)
  const fpl =
    FPL_BY_HOUSEHOLD[Math.min(Math.max(1, householdSize), 8)] ??
    FPL_BY_HOUSEHOLD[2]!;
  const fplRatio = magi / fpl;
  let expectedContributionRate: number;
  if (fplRatio <= 1.5) expectedContributionRate = 0.02;
  else if (fplRatio <= 2.0) expectedContributionRate = 0.04;
  else if (fplRatio <= 2.5) expectedContributionRate = 0.06;
  else if (fplRatio <= 3.0) expectedContributionRate = 0.075;
  else expectedContributionRate = 0.085;

  const expectedContribution = magi * expectedContributionRate;
  return Math.max(0, Math.round(annualPremium - expectedContribution));
}
