// IRS Uniform Lifetime Table for Required Minimum Distributions (IRS Pub 590-B, Table III), the
// Joint and Last Survivor Table beside it (rmd-joint-life-table.ts); SECURE 2.0 start ages via
// getRmdStartAge(). The engine imports these and hardcodes no RMD knowledge.
import { roundToCents } from "../utils/math";
import { ageInYear } from "../utils/date";
import {
  FILING_STATUS_RULES,
  filingTable,
  type ReturnFilingStatus,
} from "./filing-status";
import { jointLifeDivisor } from "./rmd-joint-life-table";

/** IRS Uniform Lifetime Table — divisor by age (ages 72–120). */
export const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
};

/** The RMD divisor for the owner's age, or null below the table (ages above 120 read the 120
 *  row). Table II at the spouse's age when the spouse is the sole beneficiary and more than 10
 *  years younger (Reg. § 1.401(a)(9)-5(c)(2)); otherwise Table III, the Uniform Lifetime. */
export function getRmdFactor(
  age: number,
  soleBeneficiarySpouseAge?: number | null,
): number | null {
  if (age < 72) return null;
  const row = Math.min(age, 120);
  if (
    soleBeneficiarySpouseAge != null &&
    soleBeneficiarySpouseAge >= 0 &&
    age - soleBeneficiarySpouseAge > 10
  )
    return (
      jointLifeDivisor(row, Math.min(soleBeneficiarySpouseAge, 120)) ?? null
    );
  return UNIFORM_LIFETIME_TABLE[row] ?? null;
}

/** The RMD: prior-year-end Traditional balance ÷ `getRmdFactor`'s divisor, shared by
 *  enforcement and the QCD-ordering hoist (docs/RULES.md Single Computation Path). null when
 *  `age` is below the table; callers decide what "no RMD" means. */
export function computeRmdAmount(
  priorYearEndTradBalance: number,
  age: number,
  soleBeneficiarySpouseAge?: number | null,
): number | null {
  const factor = getRmdFactor(age, soleBeneficiarySpouseAge);
  if (factor == null || factor <= 0) return null;
  return roundToCents(priorYearEndTradBalance / factor);
}

/** Each person's sole-beneficiary spouse's age in `year`, for `getRmdFactor`: on a joint return
 *  of two, the other spouse (Ledgr has no beneficiary input); none otherwise. */
export function soleBeneficiarySpouseAges(
  filingStatus: ReturnFilingStatus | undefined,
  people: ReadonlyMap<number, { birthYear: number }>,
  year: number,
): Map<number, number> {
  const joint =
    filingStatus != null &&
    filingTable(FILING_STATUS_RULES, filingStatus).peopleOnReturn === 2;
  const [a, b] = [...people];
  if (!joint || people.size !== 2 || !a || !b) return new Map();
  return new Map([
    [a[0], ageInYear(b[1].birthYear, year)],
    [b[0], ageInYear(a[1].birthYear, year)],
  ]);
}

/** SECURE 2.0 RMD start age: 72 if born ≤ 1950, 73 for 1951–1959, 75 if born ≥ 1960. */
export function getRmdStartAge(birthYear: number): number {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}
