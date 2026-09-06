// Social Security claiming-age rules — Full Retirement Age (FRA) by birth
// year, and the early/delayed claiming adjustment formula.
// Source: SSA "Retirement Age Calculator" / SSA Publication 05-10147.
//
// PIA (Primary Insurance Amount, the benefit at FRA) is a direct user input
// in this app, not derived from an earnings history — see
// .scratch/docs/plans/SOCIAL-SECURITY-OPTIMIZATION-PLAN.md decision #1.
// This module only handles the claiming-age math layered on top of a known
// PIA: FRA lookup and the early/delayed adjustment multiplier.
//
// Philosophy: Config declares, code executes. FRA and the adjustment rates
// are fixed by law (unlike RMD/IRMAA/tax tables, they don't change yearly),
// so this is a static constant module, not a versioned DB table.

/** Full Retirement Age, in whole years + months, by birth year. */
export type FullRetirementAge = { years: number; months: number };

/**
 * FRA by birth year. 65y0m for 1937 and earlier, sliding in 2-month
 * increments through the 1943-1954 plateau at 66y0m, to 67y0m for 1960
 * and later. Birth years 1938-1942 and 1955-1959 are the transition
 * years SSA's own table lists individually.
 */
export function getFullRetirementAge(birthYear: number): FullRetirementAge {
  if (birthYear <= 1937) return { years: 65, months: 0 };
  if (birthYear === 1938) return { years: 65, months: 2 };
  if (birthYear === 1939) return { years: 65, months: 4 };
  if (birthYear === 1940) return { years: 65, months: 6 };
  if (birthYear === 1941) return { years: 65, months: 8 };
  if (birthYear === 1942) return { years: 65, months: 10 };
  if (birthYear >= 1943 && birthYear <= 1954) return { years: 66, months: 0 };
  if (birthYear === 1955) return { years: 66, months: 2 };
  if (birthYear === 1956) return { years: 66, months: 4 };
  if (birthYear === 1957) return { years: 66, months: 6 };
  if (birthYear === 1958) return { years: 66, months: 8 };
  if (birthYear === 1959) return { years: 66, months: 10 };
  return { years: 67, months: 0 }; // 1960 and later
}

/** Convert a `FullRetirementAge` to a total month count from birth. */
export function fraToMonths(fra: FullRetirementAge): number {
  return fra.years * 12 + fra.months;
}

/** Earliest age Social Security retirement benefits can be claimed. */
export const SS_EARLIEST_CLAIMING_AGE_MONTHS = 62 * 12;

/** Latest age at which delayed-retirement credits keep accruing. */
export const SS_LATEST_CLAIMING_AGE_MONTHS = 70 * 12;

/**
 * Early-claiming reduction: 5/9 of 1% per month for the first 36 months
 * before FRA, then 5/12 of 1% per month beyond that.
 */
const EARLY_REDUCTION_RATE_FIRST_36 = 5 / 9 / 100;
const EARLY_REDUCTION_RATE_BEYOND_36 = 5 / 12 / 100;

/** Delayed-claiming credit: 2/3 of 1% per month past FRA, up to age 70. */
const DELAYED_CREDIT_RATE_PER_MONTH = 2 / 3 / 100;

/**
 * Multiplier applied to PIA for claiming at `claimingAgeMonths` instead of
 * FRA. Returns 1 exactly at FRA, less than 1 for early claiming (as early as
 * age 62), more than 1 for delayed claiming (up to age 70). Clamps the input
 * to [62, 70] years — claiming outside that range isn't possible under
 * current law.
 */
export function getClaimingAdjustmentMultiplier(
  fra: FullRetirementAge,
  claimingAgeMonths: number,
): number {
  const fraMonths = fraToMonths(fra);
  const clampedMonths = Math.min(
    Math.max(claimingAgeMonths, SS_EARLIEST_CLAIMING_AGE_MONTHS),
    SS_LATEST_CLAIMING_AGE_MONTHS,
  );

  if (clampedMonths === fraMonths) return 1;

  if (clampedMonths < fraMonths) {
    const monthsEarly = fraMonths - clampedMonths;
    const first36 = Math.min(monthsEarly, 36);
    const beyond36 = Math.max(monthsEarly - 36, 0);
    const reduction =
      first36 * EARLY_REDUCTION_RATE_FIRST_36 +
      beyond36 * EARLY_REDUCTION_RATE_BEYOND_36;
    return 1 - reduction;
  }

  const monthsDelayed = clampedMonths - fraMonths;
  return 1 + monthsDelayed * DELAYED_CREDIT_RATE_PER_MONTH;
}
