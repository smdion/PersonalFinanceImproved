/**
 * 2027 tax figures as published, hand-keyed from each document (read
 * 2026-11-09), never from `tax-data/us-federal/2027.json`. Checked by
 * `tests/tax-data/irs-published.test.ts` once complete.
 *
 * - RP26: Rev. Proc. 2026-35 § 3 (2027 items),
 *   https://www.irs.gov/pub/irs-drop/rp-26-35.pdf. Pages are the PDF's
 *   (no printed page numbers in the text layer).
 * - HHS26: 2026 HHS Poverty Guidelines, 91 FR 1797 (Jan 15, 2026),
 *   https://www.govinfo.gov/content/pkg/FR-2026-01-15/pdf/2026-00755.pdf
 *
 * STILL BLANK (unpublished as of 2026-11-09): Pub 15-T (2027) § 1 annual
 * percentage-method tables, both columns (irs.gov/pub/irs-pdf/p15t.pdf is
 * still "For use in 2026"); CMS's 2027 Medicare Parts A & B fact sheet
 * (Part B and Part D IRMAA tables). Key them from those documents, then
 * add this year to PUBLISHED in tests/tax-data/irs-published.test.ts;
 * that test lists any blank left.
 */
import type { PublishedYear } from "./types";

export const PUBLISHED_2027: PublishedYear = {
  year: 2027,

  rateSchedule: {
    Single: {
      cite: "Rev. Proc. 2026-35 § 3.01 Table 3 (Unmarried Individuals), pp. 5-6",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 12_800, baseTax: 1_280, rate: 0.12 },
        { over: 52_025, baseTax: 5_987, rate: 0.22 },
        { over: 109_125, baseTax: 18_549, rate: 0.24 },
        { over: 208_325, baseTax: 42_357, rate: 0.32 },
        { over: 264_550, baseTax: 60_349, rate: 0.35 },
        { over: 661_375, baseTax: 199_237.75, rate: 0.37 },
      ],
    },
    MFJ: {
      cite: "Rev. Proc. 2026-35 § 3.01 Table 1 (Married Individuals Filing Joint Returns and Surviving Spouses), pp. 4-5",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 25_600, baseTax: 2_560, rate: 0.12 },
        { over: 104_050, baseTax: 11_974, rate: 0.22 },
        { over: 218_250, baseTax: 37_098, rate: 0.24 },
        { over: 416_650, baseTax: 84_714, rate: 0.32 },
        { over: 529_100, baseTax: 120_698, rate: 0.35 },
        { over: 793_650, baseTax: 213_290.5, rate: 0.37 },
      ],
    },
    HOH: {
      cite: "Rev. Proc. 2026-35 § 3.01 Table 2 (Heads of Households), p. 5",
      value: [
        { over: 0, baseTax: 0, rate: 0.1 },
        { over: 18_250, baseTax: 1_825, rate: 0.12 },
        { over: 69_650, baseTax: 7_993, rate: 0.22 },
        { over: 109_100, baseTax: 16_672, rate: 0.24 },
        { over: 208_300, baseTax: 40_480, rate: 0.32 },
        { over: 264_550, baseTax: 58_480, rate: 0.35 },
        { over: 661_350, baseTax: 197_360, rate: 0.37 },
      ],
    },
  },

  standardDeduction: {
    Single: {
      value: 16_600,
      cite: "Rev. Proc. 2026-35 § 3.15(1) (Unmarried Individuals), p. 13",
    },
    MFJ: {
      value: 33_200,
      cite: "Rev. Proc. 2026-35 § 3.15(1) (Married Individuals Filing Joint Returns and Surviving Spouses), p. 13",
    },
    HOH: {
      value: 24_925,
      cite: "Rev. Proc. 2026-35 § 3.15(1) (Heads of Households), p. 13",
    },
  },

  agedOrBlind: {
    married: { value: 1_700, cite: "Rev. Proc. 2026-35 § 3.15(3), p. 13" },
    unmarried: {
      value: 2_100,
      cite: "Rev. Proc. 2026-35 § 3.15(3) (unmarried and not a surviving spouse), p. 13",
    },
  },

  ltcg: {
    Single: {
      value: { zeroRateTop: 51_050, fifteenRateTop: 563_200 },
      cite: "Rev. Proc. 2026-35 § 3.03 (All Other Individuals), p. 7",
    },
    MFJ: {
      value: { zeroRateTop: 102_100, fifteenRateTop: 633_600 },
      cite: "Rev. Proc. 2026-35 § 3.03 (Married Individuals Filing Joint Returns and Surviving Spouse), p. 7",
    },
    HOH: {
      value: { zeroRateTop: 68_350, fifteenRateTop: 598_400 },
      cite: "Rev. Proc. 2026-35 § 3.03 (Heads of Households), p. 7",
    },
  },

  // BLANK: Pub 15-T (2027) not yet published (checked 2026-11-09).
  withholding: {
    Single: {
      standard: {
        cite: "",
        value: [
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
        ],
      },
      checkbox: {
        cite: "",
        value: [
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
        ],
      },
    },
    MFJ: {
      standard: {
        cite: "",
        value: [
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
        ],
      },
      checkbox: {
        cite: "",
        value: [
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
        ],
      },
    },
    HOH: {
      standard: {
        cite: "",
        value: [
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
        ],
      },
      checkbox: {
        cite: "",
        value: [
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
          { atLeast: NaN, tentative: NaN, rate: NaN },
        ],
      },
    },
  },
  // BLANK: CMS 2027 Medicare Parts A & B fact sheet not yet published
  // (checked 2026-11-09).
  irmaa: {
    individual: {
      cite: "",
      value: [
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
      ],
    },
    joint: {
      cite: "",
      value: [
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
        { over: NaN, partB: NaN, partD: NaN },
      ],
    },
  },

  // 2027 coverage uses the guidelines HHS published in 2026.
  fpl: {
    cite: "HHS, Annual Update of the HHS Poverty Guidelines, 91 FR 1797 (Jan 15, 2026), 2026 guidelines for the 48 contiguous states and DC, p. 1798",
    value: {
      1: 15_960,
      2: 21_640,
      3: 27_320,
      4: 33_000,
      5: 38_680,
      6: 44_360,
      7: 50_040,
      8: 55_720,
    },
  },
};
