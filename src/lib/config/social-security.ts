// Social Security claiming-age math on a user-entered PIA (benefit at FRA): FRA by birth year
// and the early/delayed adjustment (SSA Publication 05-10147). Fixed by law, not yearly data,
// so static constants rather than a versioned table.

/** Full Retirement Age, in whole years + months, by birth year. */
type FullRetirementAge = { years: number; months: number };

/** FRA by birth year: 65y0m through 1937, +2 months a year to the 1943-1954 plateau at
 *  66y0m, then +2 months a year to 67y0m for 1960 and later. */
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

/** The one "has this person set a PIA" check for `social_security_pia` (a decimal string, so
 *  "" and "0" must read as not set). Returns the ANNUAL PIA (stored monthly), or null unless
 *  a usable positive amount. */
export function parseAnnualPia(
  raw: string | number | null | undefined,
): number | null {
  if (raw == null || raw === "") return null;
  const monthly = typeof raw === "number" ? raw : parseFloat(raw);
  return Number.isFinite(monthly) && monthly > 0 ? monthly * 12 : null;
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

/** Multiplier on PIA for claiming at `claimingAgeMonths`: 1 at FRA, below 1 early, above 1
 *  delayed. The age is clamped to [62, 70], the only claiming ages the law allows. */
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

/** Spousal early-claiming reduction per month before FRA: 25/36 of 1% for the first 36 months,
 *  5/12 of 1% beyond (unlike the worker's 5/9%). No delayed credits: capped at 50% of the
 *  higher earner's PIA. */
const SPOUSAL_REDUCTION_RATE_FIRST_36 = 25 / 36 / 100;
const SPOUSAL_REDUCTION_RATE_BEYOND_36 = 5 / 12 / 100;

/** Fraction of the higher earner's PIA a spousal benefit is based on. */
export const SPOUSAL_BENEFIT_BASE_RATE = 0.5;

/** Multiplier on `SPOUSAL_BENEFIT_BASE_RATE * higherEarnerPia` for claiming at
 *  `claimingAgeMonths`: 1 at or after FRA (no delayed credit), below 1 early. Clamped to
 *  [62, FRA]. */
export function getSpousalAdjustmentMultiplier(
  fra: FullRetirementAge,
  claimingAgeMonths: number,
): number {
  const fraMonths = fraToMonths(fra);
  const clampedMonths = Math.min(
    Math.max(claimingAgeMonths, SS_EARLIEST_CLAIMING_AGE_MONTHS),
    fraMonths,
  );

  if (clampedMonths >= fraMonths) return 1;

  const monthsEarly = fraMonths - clampedMonths;
  const first36 = Math.min(monthsEarly, 36);
  const beyond36 = Math.max(monthsEarly - 36, 0);
  const reduction =
    first36 * SPOUSAL_REDUCTION_RATE_FIRST_36 +
    beyond36 * SPOUSAL_REDUCTION_RATE_BEYOND_36;
  return 1 - reduction;
}
