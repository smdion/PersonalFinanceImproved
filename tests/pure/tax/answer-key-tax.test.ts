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
 * Citations: RP24 (2025) § 2.01 Tables 1-3 (MFJ, HOH, Single rate
 * schedules), § 2.03 (gains thresholds), § 2.15(3) (the age add-on); RP25
 * (2026) § 4.01 Tables 1-3, § 4.03, § 4.14(1) (standard deduction) and
 * § 4.14(3) (add-on); 2025's standard deduction as OBBBA § 70102 set it,
 * restated in RP25 § 3.01 (it replaces RP24 § 2.15(1)); Pub 915 (2025) Worksheet 1 (taxable Social Security,
 * line numbers kept); i1040 (2025) p.38, Qualified Dividends and Capital
 * Gain Tax Worksheet (QDCG, lines 1-25); Schedule 1-A (2025) Part V; IRC
 * 86, 1(h), 151(d)(5)(C), 1411 and Form 8960; IRC 3101(b)(2), 3102(f) and
 * the Form 8959 instructions (i8959); the IRS NIIT Q&A.
 *
 * Not written here, on purpose:
 * - MFS cases B6, B7, B12, L8, L14, P5, P10, E12, N1, A3, X5: closed under decision B2 (MFS
 *   stays disclosed as unsupported), v0.11 Tax "Filing statuses: no QSS;
 *   MFS unrepresentable".
 * - P26 and P27 (the Tax Table figure): closed, Ledgr uses the exact
 *   schedule and discloses it (spec BR-5); P26b below pins the schedule
 *   figure. v0.12 UI "Disclosure list additions".
 * - Self-employment and railroad (RRTA) cases P7, P8, P9, P12, P13, P14:
 *   closed, no such input is planned; v0.12 UI "Disclosure list additions".
 * - S18 (an adjustment larger than income): closed, adjustments to income
 *   can't be entered and none is planned; v0.12 UI "Disclosure list
 *   additions".
 * - P24 (a dependent's deduction, Pub 501 Dependent Example 1) and P25's
 *   dependent half (Example 3): closed, a dependent filer is disclosed,
 *   not built (owner, 2026-11-02 and 2026-11-03); v0.12 UI "Disclosure
 *   list additions". P25's blindness half stays below as `it.todo`.
 */
import { describe, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { retiredYear } from "../../fixtures/answer-key-household";
import { readTaxData, taxDataLimitMap } from "../../helpers/tax-data";
import {
  sumBracketTax,
  toTaxableIncomeBrackets,
} from "@/lib/pure/tax/tax-brackets";
import type { LtcgBracketTable } from "@/lib/config/tax-tables";
import { computeLtcgTax } from "@/lib/pure/tax/ltcg";
import {
  computeTaxableSS,
  computeTaxFromSlots,
  taxableSSFor,
  type WithholdingBracket,
} from "@/lib/pure/engine/tax-estimation";
import { computeObbbaSeniorDeduction } from "@/lib/pure/tax/return-deductions";
import { computeNiit } from "@/lib/pure/tax/niit";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import type { DecumulationSlot } from "@/lib/pure/engine/types";
import type { TaxBracketInput } from "@/lib/pure/paycheck/paycheck.types";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";
import { NO_ONE_65 } from "./tax-helpers";

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
function withholding(year: Year, status: ReturnFilingStatus) {
  const t = shippedYear(year).withholding.tables[status];
  if (!t) throw new Error(`no ${year} ${status} withholding table`);
  return t.standard as WithholdingBracket[];
}

/** The Form 1040 rate schedule rebuilt from the withholding table. */
function rateSchedule(year: Year, status: ReturnFilingStatus) {
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
function scheduleTax(year: Year, status: ReturnFilingStatus, ti: number) {
  return sumBracketTax(ti, rateSchedule(year, status)).total;
}

/** QDCG worksheet line 23, as `computeLtcgTax`'s callers build it: the
 *  ordinary portion (line 5) on the schedule, the gains stacked on it. */
function stackedTax(
  year: Year,
  status: ReturnFilingStatus,
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
  status: ReturnFilingStatus;
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
    rothTaxableGrowth: 0,
    penaltyCost: 0,
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
  status: ReturnFilingStatus,
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
 * The senior deduction (IRC 151(d)(5)(C), `computeObbbaSeniorDeduction`)
 * on the shipped limits. `year` is the tax year; the figures come from the
 * latest shipped file at or before it (they aren't indexed, spec SR-12).
 */
function seniorDeduction(c: {
  year: number;
  status: ReturnFilingStatus;
  seniors: number;
  magi: number;
}) {
  const from: Year = c.year <= 2025 ? 2025 : 2026;
  return computeObbbaSeniorDeduction({
    seniorCount: c.seniors,
    magi: { kind: "known", value: c.magi },
    perPerson: limit(from, "obbba_senior_deduction_per_person"),
    phaseoutStart: limit(
      from,
      c.status === "MFJ"
        ? "obbba_senior_deduction_phaseout_start_mfj"
        : "obbba_senior_deduction_phaseout_start_unmarried",
    ),
    phaseoutRate: limit(from, "obbba_senior_deduction_phaseout_rate"),
    year: c.year,
    sunsetYear: limit(from, "obbba_senior_deduction_sunset_year"),
  });
}

/**
 * The return's deductions, composed from the shipped limits the way the
 * engine folds them (there's no one function yet: v0.11 Tax "One
 * `returnDeductions()`"): basic + one add-on per person 65+ (IRC 63(f)) +
 * the senior deduction on this return's MAGI.
 */
function deductions(c: {
  year: Year;
  status: ReturnFilingStatus;
  seniors: number;
  magi: number;
}) {
  const addOn = limit(
    c.year,
    c.status === "MFJ"
      ? "additional_std_deduction_65_married"
      : "additional_std_deduction_65_unmarried",
  );
  return (
    limit(c.year, `standard_deduction_${c.status.toLowerCase()}`) +
    c.seniors * addOn +
    seniorDeduction(c)
  );
}

/** The Taxes page's bracket input for a status, on the shipped 2026
 *  figures (the shape `buildLiabilityBracketInput` gives
 *  `calculateHouseholdTax`). */
function liabilityInput(status: ReturnFilingStatus): TaxBracketInput {
  return {
    filingStatus: status,
    w4Checkbox: false,
    brackets: rateSchedule(2026, status),
    standardDeduction: limit(
      2026,
      `standard_deduction_${status.toLowerCase()}`,
    ),
    w4Adjustment: 0,
    socialSecurityWageBase: limit(2026, "ss_wage_base"),
    socialSecurityRate: limit(2026, "fica_ss_rate"),
    medicareRate: limit(2026, "fica_medicare_rate"),
    medicareAdditionalRate: limit(2026, "fica_medicare_surtax_rate"),
    medicareAdditionalThreshold: limit(2026, "fica_medicare_surtax_threshold"),
  };
}

/**
 * The household's 2026 annual tax (`calculateHouseholdTax`), one entry per
 * job's wages. The Additional Medicare liability threshold is the status's
 * (`fica_medicare_surtax_liability_<status>`); employers withhold above
 * the per-employer 200,000 (IRC 3102(f)).
 */
function householdTax(status: ReturnFilingStatus, jobs: number[]) {
  return calculateHouseholdTax({
    ageDeductions: NO_ONE_65,
    people: jobs.map((w) => ({ federalWages: w, ficaWages: w })),
    taxBrackets: liabilityInput(status),
    medicareLiabilityThreshold: limit(
      2026,
      `fica_medicare_surtax_liability_${status.toLowerCase()}`,
    ),
  });
}

/**
 * Additional Medicare: the liability, and the balance due at filing
 * (liability − withheld, Form 8959 Part V). `calculateHouseholdTax`
 * returns the liability; withholding shows only in its warning, rounded to
 * the dollar, so the balance is read from there (none when they're within
 * a dollar).
 */
function additionalMedicare(status: ReturnFilingStatus, jobs: number[]) {
  const r = householdTax(status, jobs);
  const note = r.warnings.find((w) => w.startsWith("Additional Medicare"));
  const amount = (re: RegExp) =>
    Number(note?.match(re)?.[1]?.replace(/,/g, "") ?? NaN);
  const balance = !note
    ? 0
    : /more is due/.test(note)
      ? amount(/about \$([\d,]+) more is due/)
      : -amount(/about \$([\d,]+) comes back/);
  return { liability: r.additionalMedicare, balance };
}

// ── Social Security (Pub 915 Worksheet 1; IRC 86) ───────────────────────
// L8 provisional income = other + ½ benefits (+ tax-exempt interest).
// Base (line 9): 25,000 Single/HOH, 32,000 MFJ. Line 11: 9,000 / 12,000.
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
// 15% × line 17 + 20% × line 20 + TAX(line 5). 0% / 15% tops: 2026 Single 49,450 /
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
  // income comes off the gains. Today `ltcgStackBase` clamps the
  // ordinary part at 0 and `computeTaxFromSlots` taxes every gain dollar
  // (`lib/pure/tax/ltcg.ts`, `lib/pure/engine/tax-estimation.ts`).
  describe("tax/L2 [TAX-16]", () => {
    // 2026 Single: other 5,000, G 60,000, deduction 16,100. T = 65,000 −
    // 16,100 = 48,900; L5 0; L9 = min(48,900, 49,450) = 48,900: all at
    // 0%. Today: ordinary clamped to 0, all 60,000 gains stacked from 0:
    // (60,000 − 49,450) × 15% = 1,582.50 (key "Today").
    it("tax/L2 [TAX-16]", () => {
      cents(
        (() =>
          yearTax({
            year: 2026,
            status: "Single",
            ordinary: 5_000,
            gains: 60_000,
            deductions: 16_100,
          }))(),
        0,
      );
    });
  });

  describe("tax/L3 [TAX-16]", () => {
    // 2026 MFJ: no other income, G 131,100, deduction 32,200. T = 98,900,
    // exactly the 0% top: all at 0% (spec LT-7). Today: (131,100 −
    // 98,900) × 15% = 4,830.00 (worked here; the key says "3,165-type").
    it("tax/L3 [TAX-16]", () => {
      cents(
        (() =>
          yearTax({
            year: 2026,
            status: "MFJ",
            ordinary: 0,
            gains: 131_100,
            deductions: 32_200,
          }))(),
        0,
      );
    });
  });

  describe("tax/L4 [TAX-16]", () => {
    // Same, G 131,101: T 98,901; L9 98,900, L17 1 × 15% = 0.15. Today:
    // 32,201 × 15% = 4,830.15 (worked here; the key says "clamped").
    it("tax/L4 [TAX-16]", () => {
      cents(
        (() =>
          yearTax({
            year: 2026,
            status: "MFJ",
            ordinary: 0,
            gains: 131_101,
            deductions: 32_200,
          }))(),
        0.15,
      );
    });
  });

  describe("tax/L5 [TAX-16]", () => {
    // 2025 Single: no other income, G 64,100, deduction 15,750. T =
    // 48,350, the 2025 0% top: 0. Today: (64,100 − 48,350) × 15% =
    // 2,362.50 (worked here; the key says "clamped").
    it("tax/L5 [TAX-16]", () => {
      cents(
        (() =>
          yearTax({
            year: 2025,
            status: "Single",
            ordinary: 0,
            gains: 64_100,
            deductions: 15_750,
          }))(),
        0,
      );
    });
  });

  // Line 25 cap (spec LT-4): the tax is the smaller of line 23 (stacked)
  // and line 24 (TAX on all of T). Where the 0% top sits under the 12%
  // band's top, a gain at 15% would cost more than at 12%. 2026 Single:
  // 50,400 − 49,450 = 950 of such room.
  it("tax/L6 [TAX-17] 2026 Single, T 50,400, G 950: line 25 5,800", () => {
    // Ordinary 65,550 before the 16,100 deduction: L5 49,450, TAX = 1,240
    // + 12% × 37,050 = 5,686; L17 950 × 15% = 142.50; L23 5,828.50. L24 =
    // TAX(50,400) = 1,240 + 12% × 38,000 = 5,800. Line 25: 5,800.00.
    cents(
      yearTax({
        year: 2026,
        status: "Single",
        ordinary: 49_450 + 16_100,
        gains: 950,
        deductions: 16_100,
      }),
      5_800,
    );
  });

  it("tax/L7 [TAX-17] 2026 Single, T 50,400, G 1,000: line 25 5,800", () => {
    // L5 49,400, TAX = 1,240 + 12% × 37,000 = 5,680; L9 50 at 0%, L17 950
    // × 15% = 142.50; L23 5,822.50; L24 5,800. Line 25: 5,800.00.
    cents(
      yearTax({
        year: 2026,
        status: "Single",
        ordinary: 49_400 + 16_100,
        gains: 1_000,
        deductions: 16_100,
      }),
      5_800,
    );
  });

  describe("tax/X3 [TAX-16] {return 2025 MFJ}", () => {
    // Whole return, 2025 MFJ both 66: pension 20,000, LTCG 100,000. AGI
    // = MAGI = 120,000. Deductions: 31,500 + 2 × 1,600 (RP24 § 2.15(3))
    // = 34,700, plus senior 2 × 6,000 = 12,000 (MAGI under 150,000;
    // Schedule 1-A) = 46,700. T = 73,300; L5 = max(0, 73,300 − 100,000)
    // = 0; L9 = 73,300 under 96,700: 0. Today: ordinary clamped to 0,
    // gains from 0: (100,000 − 96,700) × 15% = 495 (key).
    it("tax/X3 [TAX-16] {return 2025 MFJ}", () => {
      cents(
        (() =>
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
          }))(),
        0,
      );
    });
  });
});

// ── Senior deduction (IRC 151(d)(5)(C); Schedule 1-A Part V) ────────────
// Per qualified person: 6,000 − 6% × max(0, MAGI − start), floor 0; start
// 150,000 on a joint return, 75,000 otherwise (spec SR-6). Line 35's one
// reduced amount is entered for each person (lines 36a, 36b), so a joint
// return with two seniors gets 2 × that: gone at MAGI 250,000 (SR-7,
// SR-8). Tax years 2025-2028 only (SR-1).

describe("answer key: senior deduction", () => {
  it("tax/E1 [TAX-22] full amount, 2025 Single 70: 6,000", () => {
    // MAGI 75,000, not over the start.
    cents(
      seniorDeduction({
        year: 2025,
        status: "Single",
        seniors: 1,
        magi: 75_000,
      }),
      6_000,
    );
  });

  it("tax/E2 [TAX-22] phase-out: 4,500", () => {
    // Single, MAGI 100,000: 6% × 25,000 = 1,500 off.
    cents(
      seniorDeduction({
        year: 2026,
        status: "Single",
        seniors: 1,
        magi: 100_000,
      }),
      4_500,
    );
  });

  it("tax/E3 [TAX-22] last cent: 0.06", () => {
    // MAGI 174,999: 6,000 − 6% × 99,999 = 6,000 − 5,999.94.
    cents(
      seniorDeduction({
        year: 2026,
        status: "Single",
        seniors: 1,
        magi: 174_999,
      }),
      0.06,
    );
  });

  it("tax/E4 [TAX-22] gone at 175,000: 0", () => {
    // 6% × 100,000 = 6,000.
    cents(
      seniorDeduction({
        year: 2026,
        status: "Single",
        seniors: 1,
        magi: 175_000,
      }),
      0,
    );
  });

  it("tax/E5 [TAX-22] MFJ both 65+ at the start: 12,000", () => {
    // MAGI 150,000, not over: 2 × 6,000.
    cents(
      seniorDeduction({ year: 2026, status: "MFJ", seniors: 2, magi: 150_000 }),
      12_000,
    );
  });

  it("tax/E11 [TAX-22] MFJ, one 65+: 3,000 (Schedule 1-A lines 35-37)", () => {
    // MAGI 200,000: 6,000 − 6% × 50,000 = 3,000, for the one person.
    cents(
      seniorDeduction({ year: 2026, status: "MFJ", seniors: 1, magi: 200_000 }),
      3_000,
    );
  });

  it("tax/E14 [TAX-22] HOH 70: 3,300", () => {
    // Start 75,000; MAGI 120,000: 6% × 45,000 = 2,700 off.
    cents(
      seniorDeduction({ year: 2026, status: "HOH", seniors: 1, magi: 120_000 }),
      3_300,
    );
  });

  it("tax/E15 [TAX-22] 2028, the last year: 12,000", () => {
    // MFJ both 65+, MAGI 50,000; "tax years beginning before 2029".
    cents(
      seniorDeduction({ year: 2028, status: "MFJ", seniors: 2, magi: 50_000 }),
      12_000,
    );
  });

  it("tax/E16 [TAX-22] 2029, after the sunset: 0", () => {
    cents(
      seniorDeduction({ year: 2029, status: "MFJ", seniors: 2, magi: 50_000 }),
      0,
    );
  });

  // Each person's 6,000 is reduced by 6% of the joint MAGI over 150,000
  // and floored at 0 on its own (Schedule 1-A lines 35-37): two seniors
  // are gone at 250,000, as one is.
  const twoSeniors = (magi: number) =>
    seniorDeduction({ year: 2026, status: "MFJ", seniors: 2, magi });

  it("tax/E6 [TAX-22] MFJ two 65+, MAGI 150,001: 11,999.88", () => {
    // 2 × (6,000 − 6% × 1) = 11,999.88.
    cents(twoSeniors(150_001), 11_999.88);
  });

  it("tax/E7 [TAX-22] (also tax/HW-PO200) MFJ two 65+, MAGI 200,000: 6,000", () => {
    // 2 × (6,000 − 3,000) = 6,000. The CPA hand worksheet's phase-out
    // variant (HW-PO200, `comparison.md`) is the same household.
    cents(twoSeniors(200_000), 6_000);
  });

  it("tax/E8 [TAX-22] MFJ two 65+, MAGI 249,999: 0.12", () => {
    // 2 × (6,000 − 5,999.94) = 0.12.
    cents(twoSeniors(249_999), 0.12);
  });

  it("tax/E9 [TAX-22] (also tax/HW-PO250) MFJ two 65+, MAGI 250,000: 0", () => {
    // 6% × 100,000 = 6,000 off each. HW-PO250 is the same household.
    cents(twoSeniors(250_000), 0);
  });

  it("tax/E10 [TAX-22] MFJ two 65+, MAGI 300,000: 0", () => {
    cents(twoSeniors(300_000), 0);
  });
});

// ── NIIT (IRC 1411; Form 8960 lines 12-17) ──────────────────────────────
// 3.8% × min(NII, max(0, MAGI − threshold)); thresholds 250,000 MFJ,
// 200,000 Single and HOH, not indexed. NII floors at 0 (line 12). Wages,
// SS and IRA distributions aren't NII but are in MAGI (IRC 1411(c)(5)).

describe("answer key: net investment income tax", () => {
  it("tax/P15 [TAX-20] under the threshold: 0 (Reg. 1.1411-2(a) example, year 1)", () => {
    // Single, MAGI 190,000, NII 50,000.
    cents(computeNiit(190_000, 50_000, "Single"), 0);
  });

  it("tax/P16 [TAX-20] over it: 760 (same example, year 2)", () => {
    // MAGI 220,000: min(50,000, 20,000) × 3.8%.
    cents(computeNiit(220_000, 50_000, "Single"), 760);
  });

  it("tax/P17 [TAX-20] wages plus NII under the threshold: 0 (IRS NIIT Q&A Q19)", () => {
    // Wages 180,000 + NII 15,000 = MAGI 195,000.
    cents(computeNiit(180_000 + 15_000, 15_000, "Single"), 0);
  });

  it("tax/P18 [TAX-20] 2,660 (Q&A Q20)", () => {
    // Wages 180,000 + NII 90,000 = MAGI 270,000: min(90,000, 70,000) ×
    // 3.8%.
    cents(computeNiit(180_000 + 90_000, 90_000, "Single"), 2_660);
  });

  it("tax/P19 [TAX-20] MFJ: 1,900 (Q&A Q11 Example 2)", () => {
    // MAGI 300,000, NII 225,000: min(225,000, 50,000) × 3.8%.
    cents(computeNiit(300_000, 225_000, "MFJ"), 1_900);
  });

  it("tax/P20 [TAX-20] large NII, MAGI under: 0 (Q&A Q11 Example 3)", () => {
    cents(computeNiit(195_000, 150_000, "Single"), 0);
  });

  it("tax/N3 [TAX-20] HOH: 380", () => {
    // MAGI 230,000, NII 10,000: min(10,000, 30,000) × 3.8%.
    cents(computeNiit(230_000, 10_000, "HOH"), 380);
  });

  it("tax/N4 [TAX-20] MFJ at the threshold: 0", () => {
    // Not over 250,000 (spec NI-10).
    cents(computeNiit(250_000, 5_000, "MFJ"), 0);
  });

  it("tax/N5 [TAX-20] one dollar over: 0.038", () => {
    // min(5,000, 1) × 3.8% = 0.038 (the function rounds to 0.04, within
    // the half cent).
    cents(computeNiit(250_001, 5_000, "MFJ"), 0.038);
  });

  it("tax/N6 [TAX-20] an IRA draw raises MAGI but isn't NII: 1,900", () => {
    // MFJ, IRA 300,000 + LTCG 50,000: MAGI 350,000, NII 50,000 only;
    // min(50,000, 100,000) × 3.8%.
    cents(computeNiit(300_000 + 50_000, 50_000, "MFJ"), 1_900);
  });

  it("tax/N7 [TAX-20] wages aren't NII: 0", () => {
    cents(computeNiit(300_000, 0, "Single"), 0);
  });

  it("tax/N8 [TAX-20] negative NII floors at 0 (Form 8960 line 12)", () => {
    cents(computeNiit(300_000, -5_000, "Single"), 0);
  });
});

// ── Additional Medicare (IRC 3101(b)(2), 3102(f); i8959) ────────────────
// Liability 0.9% × max(0, combined Medicare wages − threshold): 250,000
// MFJ, 200,000 Single and HOH. Each employer withholds 0.9% on what it
// alone pays over 200,000. Balance = liability − withheld (negative is a
// credit on Form 8959 line 24).

describe("answer key: Additional Medicare", () => {
  it("tax/P11 [TAX-09] joint wages: 675, nothing withheld (i8959 Example 5)", () => {
    // MFJ, 150,000 + 175,000 = 325,000: 75,000 × 0.9% = 675; neither
    // employer pays over 200,000, so 675 is due.
    cents(additionalMedicare("MFJ", [150_000, 175_000]), {
      liability: 675,
      balance: 675,
    });
  });

  it("tax/A1 [TAX-09] one job: 900 owed, 900 withheld", () => {
    // Single, 300,000: 100,000 × 0.9% = 900; the employer withholds on
    // the same 100,000: balance 0.
    cents(additionalMedicare("Single", [300_000]), {
      liability: 900,
      balance: 0,
    });
  });

  it("tax/A2 [TAX-09] two jobs: 360 owed, nothing withheld", () => {
    // Single, 120,000 at each of two employers: 40,000 × 0.9% = 360;
    // neither pays over 200,000. (Each job is one entry; only the surtax
    // is read, since Social Security per person is a separate row.)
    cents(additionalMedicare("Single", [120_000, 120_000]), {
      liability: 360,
      balance: 360,
    });
  });

  it("tax/A5 [TAX-09] HOH at the threshold: 0", () => {
    cents(additionalMedicare("HOH", [200_000]), { liability: 0, balance: 0 });
  });

  it("tax/A6 [TAX-09] HOH one dollar over: 0.009, withheld alike", () => {
    // 1 × 0.9% = 0.009 owed and withheld (the function rounds both to
    // 0.01, within the half cent): balance 0.
    cents(additionalMedicare("HOH", [200_001]), {
      liability: 0.009,
      balance: 0,
    });
  });

  it("tax/A7 [TAX-09] MFJ withheld over liability: a 180 credit", () => {
    // 220,000 + 0 = 220,000, under 250,000: owes 0. The employer withholds
    // on 20,000: 180. Balance −180.
    cents(additionalMedicare("MFJ", [220_000, 0]), {
      liability: 0,
      balance: -180,
    });
  });

  it("tax/A8 [TAX-09] MFJ under the per-employer trigger: 450 due", () => {
    // 150,000 + 150,000 = 300,000: 50,000 × 0.9% = 450; nothing withheld.
    cents(additionalMedicare("MFJ", [150_000, 150_000]), {
      liability: 450,
      balance: 450,
    });
  });
});

// ── Whole returns (spec § 7.9) ──────────────────────────────────────────
// The steps in order (spec § 5): taxable SS from other income (Pub 915);
// AGI; senior deduction on that AGI; TI; QDCG worksheet. Function level:
// the engine takes no interest, dividend or pension input (v0.11 Tax "No
// income beyond portfolio and SS"), so ordinary income is fed as a
// Traditional draw and qualified dividends as gains.
//
// Each shipped tax year has a passing whole return per supported filing
// status, titled `{return <year> <status>}`; X3 (2025 MFJ, an expected
// failure) is tagged too. tests/lint/calculations-law-year.test.ts checks
// that every year in tax-data/us-federal/ has them.

describe("answer key: whole returns", () => {
  it("tax/X1 [TAX-16] {return 2026 MFJ} both 67: 4,484.00", () => {
    // IRA 50,000 + interest 5,000 ordinary; gains 30,000 (10,000 qualified
    // dividends + 20,000 LTCG); SS 40,000. Pub 915: other 85,000, L8 =
    // 85,000 + 20,000 = 105,000; L15 6,000, L16 = 85% × 61,000 = 51,850,
    // L17 57,850 > L18 34,000: taxable 34,000. AGI = 55,000 + 30,000 +
    // 34,000 = 119,000. Std 32,200 + 2 × 1,650 = 35,500; senior 2 × 6,000
    // (under 150,000) = 12,000; TI = 119,000 − 47,500 = 71,500. L5 41,500:
    // 2,480 + 12% × 16,700 = 4,484; L9 = all 30,000 at 0% (98,900 top).
    // NIIT 0 (MAGI under 250,000).
    const ss = taxableSS(40_000, 55_000, "MFJ", 30_000);
    const agi = 55_000 + 30_000 + ss;
    const ded = deductions({
      year: 2026,
      status: "MFJ",
      seniors: 2,
      magi: agi,
    });
    cents(
      {
        taxableSS: ss,
        agi,
        deductions: ded,
        tax: yearTax({
          year: 2026,
          status: "MFJ",
          ordinary: 55_000,
          gains: 30_000,
          taxableSS: ss,
          deductions: ded,
        }),
        niit: computeNiit(agi, 5_000 + 30_000, "MFJ"),
      },
      {
        taxableSS: 34_000,
        agi: 119_000,
        deductions: 47_500,
        tax: 4_484,
        niit: 0,
      },
    );
  });

  it("tax/X2 [TAX-16] {return 2026 Single} 70, senior phase-out: 14,875.60", () => {
    // Pension 60,000 (ordinary), LTCG 40,000, SS 30,000. Pub 915: other
    // 100,000, L8 115,000; L15 4,500 + 85% × 81,000 = 73,350 > L18
    // 25,500: taxable 25,500. AGI 125,500. Std 16,100 + 2,050 = 18,150;
    // senior 6,000 − 6% × 50,500 = 2,970; TI = 125,500 − 21,120 =
    // 104,380. L5 64,380: 1,240 + 4,560 + 22% × 13,980 = 8,875.60; L17
    // all 40,000 at 15% (over the 49,450 top) = 6,000; L23 14,875.60 <
    // L24 TAX(104,380) = 17,675.60.
    const ss = taxableSS(30_000, 60_000, "Single", 40_000);
    const agi = 60_000 + 40_000 + ss;
    const ded = deductions({
      year: 2026,
      status: "Single",
      seniors: 1,
      magi: agi,
    });
    cents(
      {
        taxableSS: ss,
        agi,
        deductions: ded,
        tax: yearTax({
          year: 2026,
          status: "Single",
          ordinary: 60_000,
          gains: 40_000,
          taxableSS: ss,
          deductions: ded,
        }),
      },
      { taxableSS: 25_500, agi: 125_500, deductions: 21_120, tax: 14_875.6 },
    );
  });

  it("tax/X6 [TAX-01] {return 2026 HOH} 45, wages 120,000: 13,988.00", () => {
    // TI = 120,000 − 24,150 = 95,850; 7,740 (at 67,450) + 22% × 28,400 =
    // 13,988, exact schedule (the Taxes page's path).
    cents(householdTax("HOH", [120_000]).federalTax, 13_988);
  });

  it("tax/X7 [TAX-16] 2026 Single, no income: 0", () => {
    cents(
      yearTax({
        year: 2026,
        status: "Single",
        ordinary: 0,
        deductions: 16_100,
      }),
      0,
    );
  });

  // 2025: RP24 § 2.01 Tables 1-3 (rate schedules), § 2.03 (gains tops:
  // MFJ 96,700, Single 48,350, HOH 64,750), § 2.15(3) (add-on: 1,600
  // married, 2,000 unmarried); the basic deduction as OBBBA § 70102 (IRC
  // 63(c)(7)) set it, restated in RP25 § 3.01: Single 15,750, MFJ 31,500,
  // HOH 23,625. Senior deduction: Schedule 1-A (2025) Part V.

  it("tax/X8 [TAX-16] {return 2025 MFJ} both 67: 4,599.00", () => {
    // X1's household in 2025. IRA 50,000 + interest 5,000 ordinary; gains
    // 30,000 (10,000 qualified dividends + 20,000 LTCG); SS 40,000. Pub
    // 915 (2025) Worksheet 1: L2 20,000; L3 85,000; L8 105,000 > L9
    // 32,000; L10 73,000; L11 12,000; L12 61,000; L13 12,000; L14 6,000;
    // L15 = min(20,000, 6,000) = 6,000; L16 = 85% × 61,000 = 51,850; L17
    // 57,850 > L18 = 85% × 40,000 = 34,000: taxable 34,000. AGI = 55,000
    // + 30,000 + 34,000 = 119,000. Deductions 31,500 + 2 × 1,600 = 34,700;
    // senior 2 × 6,000 = 12,000 (MAGI 119,000 not over 150,000); 46,700.
    // TI = 72,300. QDCG: L5 = 72,300 − 30,000 = 42,300; L7 = min(72,300,
    // 96,700) = 72,300; L9 = 72,300 − 42,300 = 30,000, all gains at 0%.
    // L22 TAX(42,300) = 10% × 23,850 + 12% × 18,450 = 2,385 + 2,214 =
    // 4,599; L24 TAX(72,300) = 2,385 + 12% × 48,450 = 8,199 > L23: 4,599.
    // NIIT 0 (MAGI under 250,000; IRC 1411(b)).
    const ss = taxableSS(40_000, 55_000, "MFJ", 30_000);
    const agi = 55_000 + 30_000 + ss;
    const ded = deductions({
      year: 2025,
      status: "MFJ",
      seniors: 2,
      magi: agi,
    });
    cents(
      {
        taxableSS: ss,
        agi,
        deductions: ded,
        tax: yearTax({
          year: 2025,
          status: "MFJ",
          ordinary: 55_000,
          gains: 30_000,
          taxableSS: ss,
          deductions: ded,
        }),
        niit: computeNiit(agi, 5_000 + 30_000, "MFJ"),
      },
      {
        taxableSS: 34_000,
        agi: 119_000,
        deductions: 46_700,
        tax: 4_599,
        niit: 0,
      },
    );
  });

  it("tax/X9 [TAX-16] {return 2025 Single} 70, senior phase-out: 15,165.60", () => {
    // X2's household in 2025. Pension 60,000 (ordinary), LTCG 40,000, SS
    // 30,000. Pub 915: L2 15,000; L3 100,000; L8 115,000 > L9 25,000; L10
    // 90,000; L11 9,000; L12 81,000; L14 4,500; L15 = min(15,000, 4,500)
    // = 4,500; L16 = 85% × 81,000 = 68,850; L17 73,350 > L18 = 85% ×
    // 30,000 = 25,500: taxable 25,500. AGI 125,500. Deductions 15,750 +
    // 2,000 = 17,750; senior 6,000 − 6% × (125,500 − 75,000) = 6,000 −
    // 3,030 = 2,970; 20,720. TI = 104,780. QDCG: L5 = 64,780, over the
    // 48,350 top, so L9 0 and all 40,000 at 15% = 6,000 (L14 104,780
    // under 533,400). L22 TAX(64,780) = 1,192.50 + 12% × 36,550 + 22% ×
    // (64,780 − 48,475) = 1,192.50 + 4,386 + 3,587.10 = 9,165.60; L23
    // 15,165.60 < L24 TAX(104,780) = 1,192.50 + 4,386 + 22% × 54,875 +
    // 24% × 1,430 = 17,994.20. NIIT 0 (MAGI under 200,000).
    const ss = taxableSS(30_000, 60_000, "Single", 40_000);
    const agi = 60_000 + 40_000 + ss;
    const ded = deductions({
      year: 2025,
      status: "Single",
      seniors: 1,
      magi: agi,
    });
    cents(
      {
        taxableSS: ss,
        agi,
        deductions: ded,
        tax: yearTax({
          year: 2025,
          status: "Single",
          ordinary: 60_000,
          gains: 40_000,
          taxableSS: ss,
          deductions: ded,
        }),
        niit: computeNiit(agi, 40_000, "Single"),
      },
      {
        taxableSS: 25_500,
        agi: 125_500,
        deductions: 20_720,
        tax: 15_165.6,
        niit: 0,
      },
    );
  });

  it("tax/X10 [TAX-16] {return 2025 HOH} 45, gains across the 0% top: 8,168.75", () => {
    // HOH under 65, no Social Security: ordinary 80,000, long-term gains
    // 20,000. AGI 100,000; deduction 23,625 (no add-on); TI 76,375. QDCG:
    // L4 20,000; L5 = 56,375; L7 = min(76,375, 64,750) = 64,750; L8 =
    // min(56,375, 64,750) = 56,375; L9 = 8,375 at 0%; L12 = 20,000 −
    // 8,375 = 11,625; L14 = min(76,375, 566,700) = 76,375; L16 = 76,375 −
    // (56,375 + 8,375) = 11,625; L17 11,625 × 15% = 1,743.75. L22
    // TAX(56,375) = 10% × 17,000 + 12% × 39,375 = 1,700 + 4,725 = 6,425;
    // L23 8,168.75 < L24 TAX(76,375) = 1,700 + 12% × 47,850 + 22% ×
    // 11,525 = 9,977.50. NIIT 0 (MAGI under 200,000).
    const agi = 80_000 + 20_000;
    const ded = deductions({
      year: 2025,
      status: "HOH",
      seniors: 0,
      magi: agi,
    });
    cents(
      {
        deductions: ded,
        tax: yearTax({
          year: 2025,
          status: "HOH",
          ordinary: 80_000,
          gains: 20_000,
          deductions: ded,
        }),
        niit: computeNiit(agi, 20_000, "HOH"),
      },
      { deductions: 23_625, tax: 8_168.75, niit: 0 },
    );
  });
});

// ── Survivors of the mutation audit ─────────────────────────────────────
// The tax verdict's test audit (`rebuild/annual-tax-verdicts.md` § Test
// audit) left wrong rules that no test caught; these cases fail under
// each. Worked here from `specs/annual-tax.md` § 4 (2026 figures) and § 6
// (the Pub 915 and QDCG worksheet lines it keeps); the verdict names the
// cases but works none.

describe("answer key: survivors of the mutation audit", () => {
  it("tax/m14-MFJ [TAX-15] low-benefit MFJ, half of benefits caps the 50% tier: 3,000 (survivor m14)", () => {
    // MFJ, B 6,000, other income 38,000 (Pub 915 Worksheet 1; spec §
    // 6.5): L1 6,000; L2 = ½ × 6,000 = 3,000; L3 38,000; L6 = 3,000 +
    // 38,000 = 41,000; L7 0; L8 41,000 > L9 32,000; L10 = 9,000; L11
    // 12,000; L12 = max(0, 9,000 − 12,000) = 0; L13 = min(9,000, 12,000)
    // = 9,000; L14 = 4,500; L15 = min(L2 3,000, L14 4,500) = 3,000; L16 =
    // 85% × 0 = 0; L17 3,000; L18 = 85% × 6,000 = 5,100; taxable =
    // min(3,000, 5,100) = 3,000. Without the line 15 cap (m14) it's 4,500.
    cents(taxableSS(6_000, 38_000, "MFJ"), 3_000);
  });

  it("tax/m21-edge [TAX-16] a mixed year at the 0% gains top: 2,840.00, then 2,840.15 (survivor m21)", () => {
    // 2026 MFJ under 65: Traditional 60,000 and long-term gains G;
    // deduction 32,200 (no add-ons). QDCG worksheet (i1040 p.38; spec §
    // 6.4), G 71,100: T = 131,100 − 32,200 = 98,900; L4 71,100; L5 = T −
    // L4 = 27,800; L7 = min(T, 98,900) = 98,900; L8 = min(L5, L7) =
    // 27,800; L9 = 71,100 at 0%; L10 = min(T, L4) = 71,100; L12 = 0; L17
    // 0; L20 0; L22 TAX(27,800) = 2,480 + 12% × 3,000 = 2,840; L23 2,840;
    // L24 TAX(98,900) = 2,480 + 12% × 74,100 = 11,372; L25 2,840.00.
    // G 71,101: T 98,901; L5 27,800; L9 71,100; L10 71,101; L12 1; L14 =
    // min(T, 613,700) = 98,901; L16 = 98,901 − (27,800 + 71,100) = 1; L17
    // = min(L12, L16) = 1 at 15%; L23 = 0.15 + 2,840 = 2,840.15 < L24
    // 11,372.12. Ordinary income exceeds the deduction, so neither the
    // unused-deduction nor the line 25 item moves this. Gains stacked on
    // gross ordinary income (60,000, m21) leave 38,900 of 0% room: 2,840 +
    // 15% × 32,200 = 7,670.00 at G 71,100.
    const tax = (gains: number) =>
      yearTax({
        year: 2026,
        status: "MFJ",
        ordinary: 60_000,
        gains,
        deductions: 32_200,
      });
    cents(
      { atTop: tax(71_100), overTop: tax(71_101) },
      { atTop: 2_840, overTop: 2_840.15 },
    );
  });

  it("tax/m30-MAGI [TAX-20] taxable Social Security is in NIIT and senior MAGI: NIIT 152, senior 0 (survivors m30, m39)", () => {
    // Engine year (the MAGI is wired in `decumulation-year.ts`, no
    // function of its own). Single, born 1956 (71 in 2027), Social
    // Security 40,000 (claimed), a brokerage with basis 0, so the draw W
    // is all long-term gain; flat 0% return and inflation; read 2027.
    // Spending 187,734 − 40,000 SS = need 147,734 = W − tax at W 170,000:
    // Pub 915: L8 = 170,000 + 20,000 = 190,000, far over 34,000: taxable
    // = L18 = 85% × 40,000 = 34,000. AGI = MAGI = 170,000 + 34,000 =
    // 204,000 (IRC 1411(d); IRC 151(d)(5)(C)(iii); spec NI-3, SR-5).
    // Senior: 6,000 − 6% × 129,000 < 0 → 0 (gone at 175,000), in 2026
    // and 2027 alike, so the prior-year MAGI the engine reads today gives
    // the same 0; deductions 16,100 + 2,050 = 18,150. TI = 204,000 −
    // 18,150 = 185,850; L5 = 185,850 − 170,000 = 15,850, TAX = 1,240 +
    // 12% × 3,450 = 1,654; L9 = 49,450 − 15,850 = 33,600 at 0%; L17 =
    // 136,400 × 15% = 20,460 (under the 545,500 top); L23 22,114.
    // NIIT (Form 8960 lines 12-17): 3.8% × min(NII 170,000, 204,000 −
    // 200,000) = 152. Tax 22,114 + 152 = 22,266 = 170,000 − 147,734.
    // Without taxable SS in MAGI: NIIT 0 (m30), and senior 6,000 − 6% ×
    // 95,000 = 300 (m39).
    const r = retiredYear(
      {
        status: "Single",
        people: [{ birthYear: 1956, socialSecurity: 40_000 }],
        brokerage: { balance: 5_000_000, basis: 0 },
        spending: 187_734,
        endYear: 2028,
      },
      2027,
    );
    // ±1: the gross-up stops within a cent of the need (answer key §
    // Re-run on 24bae33b).
    cents(
      {
        withdrawal: r.totalWithdrawal,
        taxableSS: r.taxableSS,
        deductions: r.standardDeduction ?? NaN,
        niit: r.niitAmount,
        tax: r.taxCost,
      },
      {
        withdrawal: 170_000,
        taxableSS: 34_000,
        deductions: 18_150,
        niit: 152,
        tax: 22_266,
      },
      1,
    );
  });
});

// ── Blocked, with an item that unblocks them ────────────────────────────

describe("answer key: tax cases blocked on a feature", () => {
  // Inputs and figures for each are in the answer key's Tax § Blocked.
  const QSS = 'v0.11 Tax "Filing statuses: no QSS"';
  it.todo(`tax/B9: blocked on ${QSS}`);
  it.todo(`tax/L11: blocked on ${QSS}`);
  it.todo(`tax/E13: blocked on ${QSS}`);
  it.todo(`tax/N2: blocked on ${QSS}`);
  it.todo(`tax/A4: blocked on ${QSS}`);
  it.todo(`tax/X4: blocked on ${QSS}`);
  it.todo(
    'tax/G1-60: blocked on v0.11 Tax "No income beyond portfolio and SS"',
  );

  // D4 also needs QSS; D2, D3, P22 and P25's blindness half the blindness
  // add-on built with it (v0.11 has no separate blindness item). P24 and
  // P25's dependent half are closed (header).
  const RETURN_DEDUCTIONS = 'v0.11 Tax "One returnDeductions()"';
  it.todo(`tax/D1: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(`tax/D2: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(`tax/D3: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(`tax/D4: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(`tax/D5: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(`tax/P21: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(`tax/P22: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(`tax/P23: blocked on ${RETURN_DEDUCTIONS}`);
  it.todo(
    `tax/P25: blindness half (Single, blind: the $2,000 add-on, Pub 501 Dependent Example 3) blocked on ${RETURN_DEDUCTIONS} (its blindness add-on)`,
  );
  it.todo(`tax/P28: blocked on ${RETURN_DEDUCTIONS}`);

  // A spouse who died: the day-before-birthday rule (i1040 p.110).
  const FIRST_DEATH =
    'v0.11 Retirement rules "Add: survivor benefit and first death"';
  it.todo(`tax/P29: blocked on ${FIRST_DEATH}`);
  it.todo(`tax/P30: blocked on ${FIRST_DEATH}`);
});
