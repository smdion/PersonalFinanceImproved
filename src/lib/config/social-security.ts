// Social Security claiming-age math on a user-entered PIA (benefit at FRA): FRA by birth year
// and the early/delayed adjustment (SSA Publication 05-10147). Fixed by law, not yearly data,
// so static constants rather than a versioned table.

/** Full Retirement Age, in whole years + months, by birth year. */
export type FullRetirementAge = { years: number; months: number };

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

/** Fraction of the higher earner's PIA a spousal benefit is based on. */
export const SPOUSAL_BENEFIT_BASE_RATE = 0.5;
