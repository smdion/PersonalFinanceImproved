/**
 * 2025 tax figures as published, hand-keyed from each document (read
 * 2026-11-03), never from `tax-data/us-federal/2025.json`. Checked by
 * `tests/tax-data/irs-published.test.ts`.
 *
 * - RP24: Rev. Proc. 2024-40, https://www.irs.gov/pub/irs-drop/rp-24-40.pdf
 * - RP25: Rev. Proc. 2025-32 § 3 (2025 items as modified by P.L. 119-21,
 *   the OBBBA), https://www.irs.gov/pub/irs-drop/rp-25-32.pdf. OBBBA § 70102
 *   raised only the 2025 basic standard deduction (RP25 § 3.01 removes
 *   RP24 § 2.15(1)); the rate tables, § 63(f) amounts and § 1(h)
 *   thresholds stand as RP24 printed them.
 * - T25: Pub 15-T (2025), https://www.irs.gov/pub/irs-prior/p15t--2025.pdf.
 *   Its tables predate the OBBBA and weren't reissued, so they embed the
 *   old $30,000 / $22,500 / $15,000 deductions; withholding for 2025 still
 *   follows them as printed.
 */
import type { PublishedYear } from "./types";

export const PUBLISHED_2025: PublishedYear = {
  year: 2025,

  rateSchedule: {
    Single: {
      cite: "Rev. Proc. 2024-40 § 2.01 Table 3 (Unmarried Individuals), p. 6",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 11_925, baseTax: 1_192.5, rate: 0.12 },
        { over: 48_475, baseTax: 5_578.5, rate: 0.22 },
        { over: 103_350, baseTax: 17_651, rate: 0.24 },
        { over: 197_300, baseTax: 40_199, rate: 0.32 },
        { over: 250_525, baseTax: 57_231, rate: 0.35 },
        { over: 626_350, baseTax: 188_769.75, rate: 0.37 },
      ],
    },
    MFJ: {
      cite: "Rev. Proc. 2024-40 § 2.01 Table 1 (Married Filing Joint Returns and Surviving Spouses), p. 5",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 23_850, baseTax: 2_385, rate: 0.12 },
        { over: 96_950, baseTax: 11_157, rate: 0.22 },
        { over: 206_700, baseTax: 35_302, rate: 0.24 },
        { over: 394_600, baseTax: 80_398, rate: 0.32 },
        { over: 501_050, baseTax: 114_462, rate: 0.35 },
        { over: 751_600, baseTax: 202_154.5, rate: 0.37 },
      ],
    },
    HOH: {
      cite: "Rev. Proc. 2024-40 § 2.01 Table 2 (Heads of Households), p. 5",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 17_000, baseTax: 1_700, rate: 0.12 },
        { over: 64_850, baseTax: 7_442, rate: 0.22 },
        { over: 103_350, baseTax: 15_912, rate: 0.24 },
        { over: 197_300, baseTax: 38_460, rate: 0.32 },
        { over: 250_500, baseTax: 55_484, rate: 0.35 },
        { over: 626_350, baseTax: 187_031.5, rate: 0.37 },
      ],
    },
  },

  // OBBBA § 70102 (IRC § 63(c)(7)) as restated by RP25 § 3.01, which
  // removes RP24 § 2.15(1) (15,000 / 30,000 / 22,500).
  standardDeduction: {
    Single: {
      value: 15_750,
      cite: "Rev. Proc. 2025-32 § 3.01 (Unmarried Individuals), p. 9",
    },
    MFJ: {
      value: 31_500,
      cite: "Rev. Proc. 2025-32 § 3.01 (Married Filing Joint Returns and Surviving Spouses), p. 9",
    },
    HOH: {
      value: 23_625,
      cite: "Rev. Proc. 2025-32 § 3.01 (Heads of Households), p. 9",
    },
  },

  agedOrBlind: {
    married: { value: 1_600, cite: "Rev. Proc. 2024-40 § 2.15(3), p. 12" },
    unmarried: {
      value: 2_000,
      cite: "Rev. Proc. 2024-40 § 2.15(3) (unmarried and not a surviving spouse), p. 12",
    },
  },

  ltcg: {
    Single: {
      value: { zeroRateTop: 48_350, fifteenRateTop: 533_400 },
      cite: "Rev. Proc. 2024-40 § 2.03 (All Other Individuals), p. 7",
    },
    MFJ: {
      value: { zeroRateTop: 96_700, fifteenRateTop: 600_050 },
      cite: "Rev. Proc. 2024-40 § 2.03 (Married Filing Joint Returns and Surviving Spouse), p. 7",
    },
    HOH: {
      value: { zeroRateTop: 64_750, fifteenRateTop: 566_700 },
      cite: "Rev. Proc. 2024-40 § 2.03 (Heads of Household), p. 7",
    },
  },

  // Columns A, C, D of each annual schedule as printed.
  withholding: {
    Single: {
      standard: {
        cite: "Pub 15-T (2025) § 1, Annual Percentage Method tables, STANDARD, Single or Married Filing Separately, p. 11",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 6_400, tentative: 0, rate: 0.1 },
          { atLeast: 18_325, tentative: 1_192.5, rate: 0.12 },
          { atLeast: 54_875, tentative: 5_578.5, rate: 0.22 },
          { atLeast: 109_750, tentative: 17_651, rate: 0.24 },
          { atLeast: 203_700, tentative: 40_199, rate: 0.32 },
          { atLeast: 256_925, tentative: 57_231, rate: 0.35 },
          { atLeast: 632_750, tentative: 188_769.75, rate: 0.37 },
        ],
      },
      checkbox: {
        cite: "Pub 15-T (2025) § 1, Annual Percentage Method tables, Form W-4 Step 2 Checkbox, Single or Married Filing Separately, p. 11",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 7_500, tentative: 0, rate: 0.1 },
          { atLeast: 13_463, tentative: 596.25, rate: 0.12 },
          { atLeast: 31_738, tentative: 2_789.25, rate: 0.22 },
          { atLeast: 59_175, tentative: 8_825.5, rate: 0.24 },
          { atLeast: 106_150, tentative: 20_099.5, rate: 0.32 },
          { atLeast: 132_763, tentative: 28_615.5, rate: 0.35 },
          { atLeast: 320_675, tentative: 94_384.88, rate: 0.37 },
        ],
      },
    },
    MFJ: {
      standard: {
        cite: "Pub 15-T (2025) § 1, Annual Percentage Method tables, STANDARD, Married Filing Jointly, p. 11",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 17_100, tentative: 0, rate: 0.1 },
          { atLeast: 40_950, tentative: 2_385, rate: 0.12 },
          { atLeast: 114_050, tentative: 11_157, rate: 0.22 },
          { atLeast: 223_800, tentative: 35_302, rate: 0.24 },
          { atLeast: 411_700, tentative: 80_398, rate: 0.32 },
          { atLeast: 518_150, tentative: 114_462, rate: 0.35 },
          { atLeast: 768_700, tentative: 202_154.5, rate: 0.37 },
        ],
      },
      checkbox: {
        cite: "Pub 15-T (2025) § 1, Annual Percentage Method tables, Form W-4 Step 2 Checkbox, Married Filing Jointly, p. 11",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 15_000, tentative: 0, rate: 0.1 },
          { atLeast: 26_925, tentative: 1_192.5, rate: 0.12 },
          { atLeast: 63_475, tentative: 5_578.5, rate: 0.22 },
          { atLeast: 118_350, tentative: 17_651, rate: 0.24 },
          { atLeast: 212_300, tentative: 40_199, rate: 0.32 },
          { atLeast: 265_525, tentative: 57_231, rate: 0.35 },
          { atLeast: 390_800, tentative: 101_077.25, rate: 0.37 },
        ],
      },
    },
    HOH: {
      standard: {
        cite: "Pub 15-T (2025) § 1, Annual Percentage Method tables, STANDARD, Head of Household, p. 11",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 13_900, tentative: 0, rate: 0.1 },
          { atLeast: 30_900, tentative: 1_700, rate: 0.12 },
          { atLeast: 78_750, tentative: 7_442, rate: 0.22 },
          { atLeast: 117_250, tentative: 15_912, rate: 0.24 },
          { atLeast: 211_200, tentative: 38_460, rate: 0.32 },
          { atLeast: 264_400, tentative: 55_484, rate: 0.35 },
          { atLeast: 640_250, tentative: 187_031.5, rate: 0.37 },
        ],
      },
      checkbox: {
        cite: "Pub 15-T (2025) § 1, Annual Percentage Method tables, Form W-4 Step 2 Checkbox, Head of Household, p. 11",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 11_250, tentative: 0, rate: 0.1 },
          { atLeast: 19_750, tentative: 850, rate: 0.12 },
          { atLeast: 43_675, tentative: 3_721, rate: 0.22 },
          { atLeast: 62_925, tentative: 7_956, rate: 0.24 },
          { atLeast: 109_900, tentative: 19_230, rate: 0.32 },
          { atLeast: 136_500, tentative: 27_742, rate: 0.35 },
          { atLeast: 324_425, tentative: 93_515.75, rate: 0.37 },
        ],
      },
    },
  },
};
