/**
 * Answer key, tax (function level): figures worked by hand from the
 * published rules, each with its working and citation beside it. Source of
 * the cases: the November review's tax spec (`specs/annual-tax.md` § 7) and
 * verdicts (`rebuild/annual-tax-verdicts.md`), as collected in the draft
 * answer key (`.scratch/docs/drafts/answer-key.md` § Tax). Ids are the
 * spec's own; the bracketed part is the docs/CALCULATIONS.md row.
 *
 * Tables: the shipped `tax-data/us-federal/<year>.json` (read through
 * `tests/helpers/tax-data.ts`), the figures Rev. Proc. 2024-40 (RP24, 2025)
 * and Rev. Proc. 2025-32 (RP25, 2026) publish. The Form 1040 rate schedules
 * are the Pub 15-T standard tables shifted down by their first taxed
 * threshold (`toTaxableIncomeBrackets`, spec BR-6), the path the Taxes page
 * takes. Every expected figure below is worked from the publication, never
 * read from those tables or from `src/`.
 *
 * Citations: RP24 / RP25 § 4.01 Tables 1-3 (MFJ, HOH, Single rate
 * schedules), § 4.03 (gains thresholds), § 4.14 (standard deduction and
 * the age add-on); Pub 915 (2025) Worksheet 1 (taxable Social Security,
 * line numbers kept); i1040 (2025) p.38, Qualified Dividends and Capital
 * Gain Tax Worksheet (QDCG, lines 1-25); IRC 86, 1(h), 151(d)(5)(C).
 *
 * Not written here, on purpose:
 * - MFS cases B6, B7, B12, L8, L14, P5, P10: closed under decision B2 (MFS
 *   stays disclosed as unsupported), v0.11 Tax "Filing statuses: no QSS;
 *   MFS unrepresentable".
 * - P26 and P27 (the Tax Table figure): closed, Ledgr uses the exact
 *   schedule and discloses it (spec BR-5); P26b below pins the schedule
 *   figure. v0.12 UI "Disclosure list additions".
 * - S18 (an adjustment larger than income): closed, adjustments to income
 *   can't be entered and none is planned; v0.12 UI "Disclosure list
 *   additions".
 * - The survivor cases m14-MFJ, m21-edge, m30-MAGI: no worked figure yet
 *   (v0.9.x Tax "Answer key: derive the three survivor cases").
 */
import { describe, it } from "vitest";
import { cents, xfail } from "../fixtures/answer-key";
import { readTaxData, taxDataLimitMap } from "../helpers/tax-data";
import {
  sumBracketTax,
  toTaxableIncomeBrackets,
} from "@/lib/calculators/tax-brackets";
import { computeLtcgTax, type LtcgBracketTable } from "@/lib/config/tax-tables";
import {
  computeTaxableSS,
  computeTaxFromSlots,
  taxableSSFor,
  type WithholdingBracket,
} from "@/lib/calculators/engine/tax-estimation";
import { computeObbbaSeniorDeduction } from "@/lib/calculators/engine/obbba-senior-deduction";
import type {
  DecumulationSlot,
  FilingStatusType,
} from "@/lib/calculators/types";

type Year = 2025 | 2026;

// ── The shipped tables, as the code reads them ──────────────────────────

const taxData = readTaxData();
const limits = taxDataLimitMap();

function shippedYear(year: Year) {
  const d = taxData.years[String(year)];
  if (!d?.ltcg) throw new Error(`no complete ${year} in tax-data`);
  return d;
}

/** A shipped limit (`contribution_limits` key) for a year. */
function limit(year: Year, key: string): number {
  const v = limits.get(`${year}:${key}`);
  if (v === undefined) throw new Error(`no ${year} ${key}`);
  return v;
}

/** The Pub 15-T standard (non-2(c)) withholding table, as shipped. */
function withholding(year: Year, status: FilingStatusType) {
  const t = shippedYear(year).withholding.tables[status];
  if (!t) throw new Error(`no ${year} ${status} withholding table`);
  return t.standard as WithholdingBracket[];
}

/** The Form 1040 rate schedule rebuilt from the withholding table. */
function rateSchedule(year: Year, status: FilingStatusType) {
  const rows = withholding(year, status);
  return toTaxableIncomeBrackets(
    rows.map((r, i) => ({
      min: r.threshold,
      max: rows[i + 1]?.threshold ?? null,
      rate: r.rate,
    })),
  );
}

function ltcgBrackets(year: Year): LtcgBracketTable {
  return shippedYear(year).ltcg!.brackets as LtcgBracketTable;
}

/** TAX(status, x): the exact schedule (spec BR-2), as the Taxes page runs it. */
function scheduleTax(year: Year, status: FilingStatusType, ti: number) {
  return sumBracketTax(ti, rateSchedule(year, status)).total;
}

/** QDCG worksheet line 23, as `computeLtcgTax`'s callers build it: the
 *  ordinary portion (line 5) on the schedule, the gains stacked on it. */
function stackedTax(
  year: Year,
  status: FilingStatusType,
  taxableIncome: number,
  gains: number,
) {
  const ordinary = taxableIncome - gains;
  return (
    scheduleTax(year, status, ordinary) +
    computeLtcgTax(ordinary, gains, status, ltcgBrackets(year))
  );
}

/**
 * One year's tax as the engine prices it (`computeTaxFromSlots`):
 * `ordinary` gross ordinary income (fed as a Traditional draw), `gains`
 * long-term gains (a brokerage draw with no basis), `taxableSS`, and the
 * return's whole deduction (`deductions`: basic, add-ons and senior), which
 * the engine passes as `standardDeduction`.
 */
function yearTax(c: {
  year: Year;
  status: FilingStatusType;
  ordinary: number;
  gains?: number;
  taxableSS?: number;
  deductions: number;
}): number {
  const gains = c.gains ?? 0;
  const slot = (
    category: DecumulationSlot["category"],
    o: Partial<DecumulationSlot>,
  ): DecumulationSlot => ({
    category,
    withdrawal: 0,
    rothWithdrawal: 0,
    traditionalWithdrawal: 0,
    cappedByAccount: false,
    cappedByTaxType: false,
    remainingNeed: 0,
    ...o,
  });
  return computeTaxFromSlots({
    slots: [
      slot("401k", {
        withdrawal: c.ordinary,
        traditionalWithdrawal: c.ordinary,
      }),
      slot("brokerage", { withdrawal: gains }),
    ],
    taxableSS: c.taxableSS ?? 0,
    balances: { afterTax: Math.max(gains, 1), afterTaxBasis: 0 },
    brokerageBasisRatio: 0,
    taxRates: {
      traditionalFallbackRate: 0,
      roth: 0,
      hsa: 0,
      brokerage: 0,
      taxBrackets: withholding(c.year, c.status),
      ltcgBrackets: ltcgBrackets(c.year),
      standardDeduction: c.deductions,
    },
    filingStatus: c.status,
  }).taxCost;
}

/** Taxable Social Security as the engine asks for it (`taxableSSFor`):
 *  other income in AGI fed as a Traditional draw. */
function taxableSS(
  benefits: number,
  other: number,
  status: FilingStatusType,
  gains = 0,
) {
  return taxableSSFor(
    benefits,
    {
      totalTraditionalWithdrawal: other,
      rothTaxableGrowth: 0,
      brokerageGainsPortion: gains,
    },
    status,
  );
}

/**
 * The return's deductions, composed from the shipped limits the way the
 * engine folds them (there's no one function yet: v0.11 Tax "One
 * `returnDeductions()`"): basic + one add-on per person 65+ (IRC 63(f)) +
 * the senior deduction (IRC 151(d)(5)(C), `computeObbbaSeniorDeduction`)
 * on this return's MAGI.
 */
function deductions(c: {
  year: Year;
  status: FilingStatusType;
  seniors: number;
  magi: number;
}) {
  const s = c.status.toLowerCase();
  const addOn = limit(
    c.year,
    c.status === "MFJ"
      ? "additional_std_deduction_65_married"
      : "additional_std_deduction_65_unmarried",
  );
  return (
    limit(c.year, `standard_deduction_${s}`) +
    c.seniors * addOn +
    computeObbbaSeniorDeduction({
      seniorCount: c.seniors,
      magi: c.magi,
      perPerson: limit(c.year, "obbba_senior_deduction_per_person"),
      phaseoutStart: limit(
        c.year,
        c.status === "MFJ"
          ? "obbba_senior_deduction_phaseout_start_mfj"
          : "obbba_senior_deduction_phaseout_start_unmarried",
      ),
      phaseoutRate: limit(c.year, "obbba_senior_deduction_phaseout_rate"),
      year: c.year,
      sunsetYear: limit(c.year, "obbba_senior_deduction_sunset_year"),
    })
  );
}

const UNUSED_DEDUCTION = `v0.11 Tax "Unused standard deduction never shelters gains"`;
const LINE_25_CAP = `v0.11 Tax "Gap years have no 65+ deductions" (Schedule D line 25 cap, min(L23, L24))`;

// ── Social Security (Pub 915 Worksheet 1; IRC 86) ───────────────────────
// L8 provisional income = other + ½ benefits (+ tax-exempt interest).
// Base (L9): 25,000 Single/HOH, 32,000 MFJ. L11: 9,000 / 12,000.
// Taxable = min(min(½ B, ½ min(L10, L11)) + 85% × L12, 85% × B). "More
// than" the base: L8 equal to it is 0 (spec SS-2).

describe("answer key: taxable Social Security", () => {
  it("tax/P1 [TAX-15] under the base: 0 (Pub 915 p.4 Worksheet A)", () => {
    // Single, B 1,500, other 17,700: L8 = 17,700 + 750 = 18,450 ≤ 25,000.
    cents(taxableSS(1_500, 17_700, "Single"), 0);
  });

  it("tax/P2 [TAX-15] 50% tier: 2,990 (Pub 915 Example 1)", () => {
    // Single, B 5,980, other 28,990: L8 = 28,990 + 2,990 = 31,980;
    // L10 = 6,980 (under L11 9,000), ½ = 3,490; capped at ½ B = 2,990.
    cents(taxableSS(5_980, 28_990, "Single"), 2_990);
  });

  it("tax/P3 [TAX-15] IRA deduction netted into other income: 0 (Pub 915 Example 2)", () => {
    // MFJ, B 5,600, other 29,750, IRA deduction 1,000 (line 7). There is
    // no adjustment input, so the deduction is netted into other income:
    // 29,750 − 1,000 = 28,750 (L8 = L6 − L7 either way). L8 = 28,750 +
    // 2,800 = 31,550 ≤ 32,000.
    cents(taxableSS(5_600, 29_750 - 1_000, "MFJ"), 0);
  });

  it("tax/P4 [TAX-15] 85% tier: 6,275 (Pub 915 Example 3)", () => {
    // MFJ, B 10,000, other 40,500: L8 = 45,500; L10 = 13,500; L12 =
    // 1,500; L13 12,000, L14 6,000, L15 = min(5,000, 6,000) = 5,000;
    // L16 = 85% × 1,500 = 1,275; L17 6,275 < L18 8,500.
    cents(taxableSS(10_000, 40_500, "MFJ"), 6_275);
  });

  it("tax/P6 [TAX-15] Worksheet 1: 3,000 (Pub 915 pp.11-12, Terry)", () => {
    // Single, B 11,000, other 25,500: L8 = 31,000; L10 6,000; L14 3,000;
    // L15 = min(5,500, 3,000) = 3,000; L18 9,350. (2,500 with the
    // lump-sum election, which Ledgr doesn't model.)
    cents(taxableSS(11_000, 25_500, "Single"), 3_000);
  });

  it("tax/S10 [TAX-15] provisional income at the base: 0 (IRC 86)", () => {
    // Single, B 20,000, other 15,000: L8 = 25,000, not over 25,000.
    cents(taxableSS(20_000, 15_000, "Single"), 0);
  });

  it("tax/S11 [TAX-15] one dollar over the base: 0.50", () => {
    // L8 25,001; L10 1; ½ × 1 = 0.50.
    cents(taxableSS(20_000, 15_001, "Single"), 0.5);
  });

  it("tax/S12 [TAX-15] MFJ 50% tier at the adjusted base: 6,000", () => {
    // MFJ, B 40,000, other 24,000: L8 = 44,000 (adjusted base, not over:
    // L12 = 0); L10 12,000, L14 6,000; ½ B 20,000.
    cents(taxableSS(40_000, 24_000, "MFJ"), 6_000);
  });

  it("tax/S13 [TAX-15] Single 50% tier at the adjusted base: 4,500", () => {
    // B 30,000, other 19,000: L8 = 34,000; L10 9,000; L14 4,500.
    cents(taxableSS(30_000, 19_000, "Single"), 4_500);
  });

  it("tax/S14 [TAX-15] 85% of benefits caps it: 17,000", () => {
    // B 20,000, other 100,000: L8 110,000; L12 76,000; L17 = 4,500 +
    // 64,600 = 69,100; L18 = 85% × 20,000 = 17,000.
    cents(taxableSS(20_000, 100_000, "Single"), 17_000);
  });

  it("tax/S15 [TAX-15] half of benefits caps the 50% tier: 2,000 (survivor m14)", () => {
    // B 4,000, other 30,000: L8 32,000; L10 7,000, L14 3,500; L15 =
    // min(½ B 2,000, 3,500) = 2,000; L8 under 34,000, so no 85% tier.
    cents(taxableSS(4_000, 30_000, "Single"), 2_000);
  });

  it("tax/S16 [TAX-15] no benefits: 0", () => {
    cents(taxableSS(0, 500_000, "Single"), 0);
  });

  it("tax/S17 [TAX-15] HOH uses the Single base: 4,000", () => {
    // HOH, B 24,000, other 21,000: L8 33,000; L10 8,000; L14 4,000; ½ B
    // 12,000.
    cents(taxableSS(24_000, 21_000, "HOH"), 4_000);
  });

  it("tax/S19 [TAX-15] tax-exempt interest counts in provisional income: 2,500", () => {
    // B 20,000, other 12,000, muni interest 8,000 (Pub 915 line 4, IRC
    // 86(b)(2)(B)): L8 = 12,000 + 10,000 + 8,000 = 30,000; L10 5,000;
    // ½ = 2,500. `taxableSSFor` has no tax-exempt input, so this calls
    // `computeTaxableSS`, the function it wraps.
    cents(computeTaxableSS(20_000, 12_000, "Single", 8_000), 2_500);
  });
});

// ── Brackets (exact schedule, spec BR-2) ────────────────────────────────
// 2026 (RP25 § 4.01): Single 10% to 12,400, 12% to 50,400, 22% to
// 105,700, 24% to 201,775, 32% to 256,225, 35% to 640,600. MFJ 24,800 /
// 100,800. HOH 17,700 / 67,450 / 105,700 / 201,750 / 256,200 / 640,600.
// 2025 (RP24 § 2.01): Single 11,925 / 48,475 / 103,350 / 197,300 /
// 250,525 / 626,350; MFJ 23,850 / 96,950; HOH 17,000 / 64,850 / 103,350.

describe("answer key: the rate schedules", () => {
  it("tax/B1 [TAX-05] zero income: 0", () => {
    cents(scheduleTax(2026, "Single", 0), 0);
  });

  it("tax/B2 [TAX-05] top of the 2026 Single 10% band: 1,240.00", () => {
    // 10% × 12,400 (RP25 Table 3).
    cents(scheduleTax(2026, "Single", 12_400), 1_240);
  });

  it("tax/B3 [TAX-05] first dollar at 12%: 1,240.12", () => {
    // 1,240 + 12% × 1.
    cents(scheduleTax(2026, "Single", 12_401), 1_240.12);
  });

  it("tax/B4 [TAX-05] top of the 2026 MFJ 12% band: 11,600.00", () => {
    // 10% × 24,800 = 2,480; 12% × (100,800 − 24,800) = 9,120 (RP25
    // Table 1).
    cents(scheduleTax(2026, "MFJ", 100_800), 11_600);
  });

  it("tax/B5 [TAX-05] top of the 2026 HOH 12% band: 7,740.00", () => {
    // 10% × 17,700 = 1,770; 12% × (67,450 − 17,700) = 5,970 (RP25
    // Table 2).
    cents(scheduleTax(2026, "HOH", 67_450), 7_740);
  });

  it("tax/B8 [TAX-05] 2026 Single 35% band: 108,769.25", () => {
    // Base at 256,225: 1,240 + 4,560 + 22% × 55,300 (12,166) + 24% ×
    // 96,075 (23,058) + 32% × 54,450 (17,424) = 58,448; + 35% × (400,000
    // − 256,225 = 143,775) = 50,321.25.
    cents(scheduleTax(2026, "Single", 400_000), 108_769.25);
  });

  it("tax/B10 [TAX-05] first dollar at 37%, 2025 Single: 188,770.12", () => {
    // RP24 Table 3 base at 626,350: 188,769.75 (1,192.50 + 4,386 +
    // 12,072.50 + 22,548 + 17,032 + 35% × 375,825); + 0.37.
    cents(scheduleTax(2025, "Single", 626_351), 188_770.12);
  });

  it("tax/B11 [TAX-05] 2025 HOH 22% band: 15,175.00", () => {
    // 10% × 17,000 = 1,700; 12% × 47,850 = 5,742 (7,442 at 64,850);
    // 22% × (100,000 − 64,850 = 35,150) = 7,733 (RP24 Table 2).
    cents(scheduleTax(2025, "HOH", 100_000), 15_175);
  });

  it("tax/B13 [TAX-05] first dollar at 37%, 2026 HOH: 191,171.37", () => {
    // Base at 640,600: 1,770 + 5,970 + 22% × 38,250 (8,415) + 24% ×
    // 96,050 (23,052) + 32% × 54,450 (17,424) + 35% × 384,400 (134,540)
    // = 191,171; + 0.37.
    cents(scheduleTax(2026, "HOH", 640_601), 191_171.37);
  });

  it("tax/P26b [TAX-05] exact schedule, not the Tax Table: 2,559.00 (i1040 p.68)", () => {
    // 2025 MFJ, TI 25,300: 10% × 23,850 = 2,385; 12% × 1,450 = 174. (The
    // Tax Table prints 2,562, from the 25,325 band midpoint: P26, closed.)
    cents(scheduleTax(2025, "MFJ", 25_300), 2_559);
  });
});

// ── Gains (QDCG worksheet, i1040 p.38) ──────────────────────────────────
// T taxable income, G gains. L5 = T − G (ordinary portion); L9 = gains at
// 0% (to the 0% top); L17 at 15% (to the 15% top); L20 at 20%. Line 23 =
// 15% × L17 + 20% × L20 + TAX(L5). 0% / 15% tops: 2026 Single 49,450 /
// 545,500, MFJ 98,900 / 613,700; 2025 Single 48,350 / 533,400, MFJ 96,700
// / 600,050, HOH 64,750 / 566,700 (RP24 § 2.03, RP25 § 4.03).

describe("answer key: long-term gains", () => {
  it("tax/L1 [TAX-17] gains stack on ordinary income: 7,175.00", () => {
    // 2026 MFJ, T 127,800, G 100,000: L5 27,800, TAX = 2,480 + 12% ×
    // 3,000 = 2,840; L9 = 98,900 − 27,800 = 71,100 at 0%; L17 = 28,900 ×
    // 15% = 4,335. L23 7,175 < L24 TAX(127,800) = 11,600 + 22% × 27,000
    // = 17,540.
    cents(stackedTax(2026, "MFJ", 127_800, 100_000), 7_175);
  });

  it("tax/L9 [TAX-17] 2025 Single in the 35% band, gains at 15%: 74,047.25", () => {
    // T 310,000, G 20,000: L5 290,000, TAX = 57,231 (at 250,525) + 35% ×
    // 39,475 = 71,047.25; all 20,000 under the 533,400 top: 3,000.
    cents(stackedTax(2025, "Single", 310_000, 20_000), 74_047.25);
  });

  it("tax/L10 [TAX-17] 15% and 20% slices: 141,494.25", () => {
    // 2026 Single, T 600,000, G 200,000: L5 400,000, TAX 108,769.25
    // (B8); L17 = 545,500 − 400,000 = 145,500 × 15% = 21,825; L20 =
    // 54,500 × 20% = 10,900.
    cents(stackedTax(2026, "Single", 600_000, 200_000), 141_494.25);
  });

  it("tax/L12 [TAX-17] 2025 HOH stacking: 7,947.50", () => {
    // T 80,000, G 30,000: L5 50,000, TAX = 1,700 + 12% × 33,000 =
    // 5,660; L9 = 64,750 − 50,000 = 14,750 at 0%; L17 = 15,250 × 15% =
    // 2,287.50.
    cents(stackedTax(2025, "HOH", 80_000, 30_000), 7_947.5);
  });

  it("tax/L13 [TAX-17] first gains dollar over the 2025 MFJ 0% top: 0.15", () => {
    // T 96,701, all gains: L5 0; L9 96,700; L17 1 × 15%.
    cents(stackedTax(2025, "MFJ", 96_701, 96_701), 0.15);
  });

  it("tax/L15 [TAX-16] deduction larger than income: 0", () => {
    // 2026 MFJ, other income 10,000, no gains, deduction 32,200: T =
    // max(0, 10,000 − 32,200) = 0 (F1040 line 15).
    cents(
      yearTax({
        year: 2026,
        status: "MFJ",
        ordinary: 10_000,
        deductions: 32_200,
      }),
      0,
    );
  });

  // Unused deduction shelters gains (spec LT-3; F1040 line 15; QDCG lines
  // 1, 5, 10): T = AGI − deductions, so a deduction larger than ordinary
  // income comes off the gains. Today `toLtcgTaxableIncome` clamps the
  // ordinary part at 0 and `computeTaxFromSlots` taxes every gain dollar
  // (`tax-tables.ts:61`, `tax-estimation.ts:478`).
  describe("tax/L2 [TAX-16]", () => {
    // 2026 Single: other 5,000, G 60,000, deduction 16,100. T = 65,000 −
    // 16,100 = 48,900; L5 0; L9 = min(48,900, 49,450) = 48,900: all at
    // 0%. Today: ordinary clamped to 0, all 60,000 gains stacked from 0:
    // (60,000 − 49,450) × 15% = 1,582.50 (key "Today").
    xfail({
      id: "tax/L2 [TAX-16]",
      todo: UNUSED_DEDUCTION,
      run: () =>
        yearTax({
          year: 2026,
          status: "Single",
          ordinary: 5_000,
          gains: 60_000,
          deductions: 16_100,
        }),
      expected: 0,
      today: 1_582.5,
    });
  });

  describe("tax/L3 [TAX-16]", () => {
    // 2026 MFJ: no other income, G 131,100, deduction 32,200. T = 98,900,
    // exactly the 0% top: all at 0% (spec LT-7). Today: (131,100 −
    // 98,900) × 15% = 4,830.00 (worked here; the key says "3,165-type").
    xfail({
      id: "tax/L3 [TAX-16]",
      todo: UNUSED_DEDUCTION,
      run: () =>
        yearTax({
          year: 2026,
          status: "MFJ",
          ordinary: 0,
          gains: 131_100,
          deductions: 32_200,
        }),
      expected: 0,
      today: 4_830,
    });
  });

  describe("tax/L4 [TAX-16]", () => {
    // Same, G 131,101: T 98,901; L9 98,900, L17 1 × 15% = 0.15. Today:
    // 32,201 × 15% = 4,830.15 (worked here; the key says "clamped").
    xfail({
      id: "tax/L4 [TAX-16]",
      todo: UNUSED_DEDUCTION,
      run: () =>
        yearTax({
          year: 2026,
          status: "MFJ",
          ordinary: 0,
          gains: 131_101,
          deductions: 32_200,
        }),
      expected: 0.15,
      today: 4_830.15,
    });
  });

  describe("tax/L5 [TAX-16]", () => {
    // 2025 Single: no other income, G 64,100, deduction 15,750. T =
    // 48,350, the 2025 0% top: 0. Today: (64,100 − 48,350) × 15% =
    // 2,362.50 (worked here; the key says "clamped").
    xfail({
      id: "tax/L5 [TAX-16]",
      todo: UNUSED_DEDUCTION,
      run: () =>
        yearTax({
          year: 2025,
          status: "Single",
          ordinary: 0,
          gains: 64_100,
          deductions: 15_750,
        }),
      expected: 0,
      today: 2_362.5,
    });
  });

  // Line 25 cap (spec LT-4): the tax is the smaller of line 23 (stacked)
  // and line 24 (TAX on all of T). Where the 0% top sits under the 12%
  // band's top, a gain at 15% would cost more than at 12%. 2026 Single:
  // 50,400 − 49,450 = 950 of such room. `computeLtcgTax`
  // (`tax-tables.ts:169`) never sees the ordinary schedule, so no caller
  // caps it.
  describe("tax/L6 [TAX-17]", () => {
    // 2026 Single, T 50,400, G 950 (ordinary 65,550 before the 16,100
    // deduction): L5 49,450, TAX = 1,240 + 12% × 37,050 = 5,686; L17 950
    // × 15% = 142.50; L23 5,828.50. L24 = TAX(50,400) = 1,240 + 12% ×
    // 38,000 = 5,800. Line 25: 5,800.00. Today 5,828.50 (key).
    xfail({
      id: "tax/L6 [TAX-17]",
      todo: LINE_25_CAP,
      run: () =>
        yearTax({
          year: 2026,
          status: "Single",
          ordinary: 49_450 + 16_100,
          gains: 950,
          deductions: 16_100,
        }),
      expected: 5_800,
      today: 5_828.5,
    });
  });

  describe("tax/L7 [TAX-17]", () => {
    // 2026 Single, T 50,400, G 1,000: L5 49,400, TAX = 1,240 + 12% ×
    // 37,000 = 5,680; L9 50 at 0%, L17 950 × 15% = 142.50; L23 5,822.50;
    // L24 5,800. Line 25: 5,800.00. Today 5,822.50 (key).
    xfail({
      id: "tax/L7 [TAX-17]",
      todo: LINE_25_CAP,
      run: () =>
        yearTax({
          year: 2026,
          status: "Single",
          ordinary: 49_400 + 16_100,
          gains: 1_000,
          deductions: 16_100,
        }),
      expected: 5_800,
      today: 5_822.5,
    });
  });

  describe("tax/X3 [TAX-16]", () => {
    // Whole return, 2025 MFJ both 66: pension 20,000, LTCG 100,000. AGI
    // = MAGI = 120,000. Deductions: 31,500 + 2 × 1,600 (RP24 § 2.15(3))
    // = 34,700, plus senior 2 × 6,000 = 12,000 (MAGI under 150,000;
    // Schedule 1-A) = 46,700. T = 73,300; L5 = max(0, 73,300 − 100,000)
    // = 0; L9 = 73,300 under 96,700: 0. Today: ordinary clamped to 0,
    // gains from 0: (100,000 − 96,700) × 15% = 495 (key).
    xfail({
      id: "tax/X3 [TAX-16]",
      todo: UNUSED_DEDUCTION,
      run: () =>
        yearTax({
          year: 2025,
          status: "MFJ",
          ordinary: 20_000,
          gains: 100_000,
          deductions: deductions({
            year: 2025,
            status: "MFJ",
            seniors: 2,
            magi: 120_000,
          }),
        }),
      expected: 0,
      today: 495,
    });
  });
});

// ── Blocked, with an item that unblocks them ────────────────────────────

describe("answer key: tax cases blocked on a feature", () => {
  // Inputs and figures for each are in the answer key's Tax § Blocked.
  const QSS = 'v0.11 Tax "Filing statuses: no QSS"';
  it.todo(`tax/B9: blocked on ${QSS}`);
  it.todo(`tax/L11: blocked on ${QSS}`);
  it.todo(
    'tax/G1-60: blocked on v0.11 Tax "No income beyond portfolio and SS"',
  );
});
