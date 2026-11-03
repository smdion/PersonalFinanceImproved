/**
 * The Uniform Lifetime Table, hand-keyed from Pub 590-B (2025), Appendix B,
 * Table III (Uniform Lifetime), p. 67,
 * https://www.irs.gov/pub/irs-pdf/p590b.pdf (read 2026-11-03), never from
 * `src/lib/config/rmd-tables.ts`. The table is Treas. Reg.
 * § 1.401(a)(9)-9(c); Pub 590-B prints it as "Age / Applicable
 * Denominator", ages 72 to "120 and over". Checked by
 * tests/config/rmd-tables.test.ts.
 *
 * Cross-checked by hand (not imported) against the review's parsed Joint
 * and Last Survivor Table, Reg. § 1.401(a)(9)-9(d)
 * (`.scratch/docs/reviews/2026-11-01/rebuild/retirement_tables.json`):
 * the Uniform table is that table at a beneficiary 10 years younger, and
 * all 49 cells agree.
 */
import type { Cited } from "./types";

export const UNIFORM_LIFETIME_PUBLISHED: Cited<
  Readonly<Record<number, number>>
> = {
  cite: "Pub 590-B (2025) Appendix B, Table III (Uniform Lifetime), p. 67",
  value: {
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
    // "120 and over"
    120: 2.0,
  },
};
