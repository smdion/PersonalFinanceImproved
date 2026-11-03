/**
 * 2026 tax figures as published, hand-keyed from each document (read
 * 2026-11-03), never from `tax-data/us-federal/2026.json`. Checked by
 * `tests/tax-data/irs-published.test.ts`.
 *
 * - RP25: Rev. Proc. 2025-32 § 4 (2026 items, as in effect on
 *   2025-10-09), https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
 * - T26: Pub 15-T (2026), Dec 3, 2025,
 *   https://www.irs.gov/pub/irs-prior/p15t--2026.pdf
 */
import type { PublishedYear } from "./types";

export const PUBLISHED_2026: PublishedYear = {
  year: 2026,

  rateSchedule: {
    Single: {
      cite: "Rev. Proc. 2025-32 § 4.01 Table 3 (Unmarried Individuals), p. 11",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 12_400, baseTax: 1_240, rate: 0.12 },
        { over: 50_400, baseTax: 5_800, rate: 0.22 },
        { over: 105_700, baseTax: 17_966, rate: 0.24 },
        { over: 201_775, baseTax: 41_024, rate: 0.32 },
        { over: 256_225, baseTax: 58_448, rate: 0.35 },
        { over: 640_600, baseTax: 192_979.25, rate: 0.37 },
      ],
    },
    MFJ: {
      cite: "Rev. Proc. 2025-32 § 4.01 Table 1 (Married Filing Joint Returns and Surviving Spouses), p. 10",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 24_800, baseTax: 2_480, rate: 0.12 },
        { over: 100_800, baseTax: 11_600, rate: 0.22 },
        { over: 211_400, baseTax: 35_932, rate: 0.24 },
        { over: 403_550, baseTax: 82_048, rate: 0.32 },
        { over: 512_450, baseTax: 116_896, rate: 0.35 },
        { over: 768_700, baseTax: 206_583.5, rate: 0.37 },
      ],
    },
    HOH: {
      cite: "Rev. Proc. 2025-32 § 4.01 Table 2 (Heads of Households), pp. 10-11",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 17_700, baseTax: 1_770, rate: 0.12 },
        { over: 67_450, baseTax: 7_740, rate: 0.22 },
        { over: 105_700, baseTax: 16_155, rate: 0.24 },
        { over: 201_750, baseTax: 39_207, rate: 0.32 },
        { over: 256_200, baseTax: 56_631, rate: 0.35 },
        { over: 640_600, baseTax: 191_171, rate: 0.37 },
      ],
    },
  },

  standardDeduction: {
    Single: {
      value: 16_100,
      cite: "Rev. Proc. 2025-32 § 4.14(1) (Unmarried Individuals), p. 18",
    },
    MFJ: {
      value: 32_200,
      cite: "Rev. Proc. 2025-32 § 4.14(1) (Married Filing Joint Returns and Surviving Spouses), p. 18",
    },
    HOH: {
      value: 24_150,
      cite: "Rev. Proc. 2025-32 § 4.14(1) (Heads of Households), p. 18",
    },
  },

  agedOrBlind: {
    married: { value: 1_650, cite: "Rev. Proc. 2025-32 § 4.14(3), p. 18" },
    unmarried: {
      value: 2_050,
      cite: "Rev. Proc. 2025-32 § 4.14(3) (unmarried and not a surviving spouse), p. 18",
    },
  },

  ltcg: {
    Single: {
      value: { zeroRateTop: 49_450, fifteenRateTop: 545_500 },
      cite: "Rev. Proc. 2025-32 § 4.03 (All Other Individuals), p. 13",
    },
    MFJ: {
      value: { zeroRateTop: 98_900, fifteenRateTop: 613_700 },
      cite: "Rev. Proc. 2025-32 § 4.03 (Married Filing Joint Returns and Surviving Spouse), p. 13",
    },
    HOH: {
      value: { zeroRateTop: 66_200, fifteenRateTop: 579_600 },
      cite: "Rev. Proc. 2025-32 § 4.03 (Heads of Household), p. 13",
    },
  },

  // Columns A, C, D of each annual schedule as printed.
  withholding: {
    Single: {
      standard: {
        cite: "Pub 15-T (2026) § 1, Annual Percentage Method tables, STANDARD, Single or Married Filing Separately, p. 12",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 7_500, tentative: 0, rate: 0.1 },
          { atLeast: 19_900, tentative: 1_240, rate: 0.12 },
          { atLeast: 57_900, tentative: 5_800, rate: 0.22 },
          { atLeast: 113_200, tentative: 17_966, rate: 0.24 },
          { atLeast: 209_275, tentative: 41_024, rate: 0.32 },
          { atLeast: 263_725, tentative: 58_448, rate: 0.35 },
          { atLeast: 648_100, tentative: 192_979.25, rate: 0.37 },
        ],
      },
      checkbox: {
        cite: "Pub 15-T (2026) § 1, Annual Percentage Method tables, Form W-4 Step 2 Checkbox, Single or Married Filing Separately, p. 12",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 8_050, tentative: 0, rate: 0.1 },
          { atLeast: 14_250, tentative: 620, rate: 0.12 },
          { atLeast: 33_250, tentative: 2_900, rate: 0.22 },
          { atLeast: 60_900, tentative: 8_983, rate: 0.24 },
          { atLeast: 108_938, tentative: 20_512, rate: 0.32 },
          { atLeast: 136_163, tentative: 29_224, rate: 0.35 },
          { atLeast: 328_350, tentative: 96_489.63, rate: 0.37 },
        ],
      },
    },
    MFJ: {
      standard: {
        cite: "Pub 15-T (2026) § 1, Annual Percentage Method tables, STANDARD, Married Filing Jointly, p. 12",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 19_300, tentative: 0, rate: 0.1 },
          { atLeast: 44_100, tentative: 2_480, rate: 0.12 },
          { atLeast: 120_100, tentative: 11_600, rate: 0.22 },
          { atLeast: 230_700, tentative: 35_932, rate: 0.24 },
          { atLeast: 422_850, tentative: 82_048, rate: 0.32 },
          { atLeast: 531_750, tentative: 116_896, rate: 0.35 },
          { atLeast: 788_000, tentative: 206_583.5, rate: 0.37 },
        ],
      },
      checkbox: {
        cite: "Pub 15-T (2026) § 1, Annual Percentage Method tables, Form W-4 Step 2 Checkbox, Married Filing Jointly, p. 12",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 16_100, tentative: 0, rate: 0.1 },
          { atLeast: 28_500, tentative: 1_240, rate: 0.12 },
          { atLeast: 66_500, tentative: 5_800, rate: 0.22 },
          { atLeast: 121_800, tentative: 17_966, rate: 0.24 },
          { atLeast: 217_875, tentative: 41_024, rate: 0.32 },
          { atLeast: 272_325, tentative: 58_448, rate: 0.35 },
          { atLeast: 400_450, tentative: 103_291.75, rate: 0.37 },
        ],
      },
    },
    HOH: {
      standard: {
        cite: "Pub 15-T (2026) § 1, Annual Percentage Method tables, STANDARD, Head of Household, p. 12",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 15_550, tentative: 0, rate: 0.1 },
          { atLeast: 33_250, tentative: 1_770, rate: 0.12 },
          { atLeast: 83_000, tentative: 7_740, rate: 0.22 },
          { atLeast: 121_250, tentative: 16_155, rate: 0.24 },
          { atLeast: 217_300, tentative: 39_207, rate: 0.32 },
          { atLeast: 271_750, tentative: 56_631, rate: 0.35 },
          { atLeast: 656_150, tentative: 191_171, rate: 0.37 },
        ],
      },
      checkbox: {
        cite: "Pub 15-T (2026) § 1, Annual Percentage Method tables, Form W-4 Step 2 Checkbox, Head of Household, p. 12",
        value: [
          { atLeast: 0, tentative: 0, rate: 0 },
          { atLeast: 12_075, tentative: 0, rate: 0.1 },
          { atLeast: 20_925, tentative: 885, rate: 0.12 },
          { atLeast: 45_800, tentative: 3_870, rate: 0.22 },
          { atLeast: 64_925, tentative: 8_077.5, rate: 0.24 },
          { atLeast: 112_950, tentative: 19_603.5, rate: 0.32 },
          { atLeast: 140_175, tentative: 28_315.5, rate: 0.35 },
          { atLeast: 332_375, tentative: 95_585.5, rate: 0.37 },
        ],
      },
    },
  },
};
