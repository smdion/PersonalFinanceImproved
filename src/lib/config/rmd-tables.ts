// IRS Uniform Lifetime Table for Required Minimum Distributions (RMDs).
// Source: IRS Publication 590-B, Table III (Uniform Lifetime).
// SECURE 2.0 Act start-age rules applied via getRmdStartAge().
//
// Philosophy: Config declares, code executes. The engine imports these
// tables and never hardcodes RMD-specific knowledge.

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

/**
 * Get the RMD divisor for a given age, or null if age is below the table.
 * For ages above 120, uses the age-120 divisor (2.0).
 */
export function getRmdFactor(age: number): number | null {
  if (age < 72) return null;
  if (age > 120) return UNIFORM_LIFETIME_TABLE[120] ?? null;
  return UNIFORM_LIFETIME_TABLE[age] ?? null;
}

/**
 * SECURE 2.0 Act RMD start age based on birth year.
 * - Born ≤ 1950: age 72
 * - Born 1951–1959: age 73
 * - Born ≥ 1960: age 75
 */
export function getRmdStartAge(birthYear: number): number {
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}
