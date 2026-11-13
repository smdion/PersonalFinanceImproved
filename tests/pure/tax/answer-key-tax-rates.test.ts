/**
 * Answer key, tax rows that had no case (v0.10.5 overnight batch): wage
 * AGI (TAX-02), the rate schedule walked band by band (TAX-04) and the
 * long-term gains rate and room (TAX-18). Every expected figure is worked
 * by hand from the publication first, never read from `src/` or from the
 * shipped tables; the shipped tables are only the input, as the code
 * reads them. Invented households only.
 *
 * Citations: Rev. Proc. 2025-32 (RP25, 2026) § 4.01 Tables 1-3 (MFJ, HOH,
 * Single rate schedules), § 4.03 (the 0% and 15% maximum amounts) and
 * § 4.14(1) (standard deduction, $32,200 MFJ, $24,150 HOH, $16,100
 * Single); Rev. Proc. 2025-19 (HSA, self-only $4,400 for 2026); Form 1040
 * (2025) lines 1a, 8, 10, 11 and Schedule 1 line 13 (the HSA deduction,
 * Form 8889 line 13); IRC 1(h)(1)(B)-(C) (the 0% and 15% amounts are "not
 * more than" ceilings); IRC 62(a)(19) and 223(a) (HSA money paid outside
 * payroll is an above-the-line deduction); IRC 125 and 402(g) (cafeteria-
 * plan and elective-deferral money is not box-1 wages).
 *
 * The 2026 schedules from RP25 § 4.01, each band's base worked here from
 * its widths (10% × the first band, plus 12% × the second, …):
 *   MFJ:    24,800 | 100,800 | 211,400 | 403,550 | 512,450 | 768,700
 *           bases 2,480 | 11,600 | 35,932 | 82,048 | 116,896 | 206,583.50
 *   Single: 12,400 | 50,400 | 105,700 | 201,775 | 256,225 | 640,600
 *           bases 1,240 | 5,800 | 17,966 | 41,024 | 58,448 | 192,979.25
 *   HOH:    17,700 | 67,450 | 105,700 | 201,750 | 256,200 | 640,600
 *           bases 1,770 | 7,740 | 16,155 | 39,207 | 56,631 | 191,171
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import {
  account,
  deduction,
  job,
  liabilityInput,
  limit,
} from "../fixtures/paycheck-answer-key";
import { readTaxData } from "../../helpers/tax-data";
import { sumBracketTax } from "@/lib/pure/tax/tax-brackets";
import {
  getLtcgRate,
  ltcgRateForNextDollar,
  ltcgRoomForRate,
} from "@/lib/pure/tax/ltcg";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import { computeAnnualEarnings } from "@/lib/pure/household/household-income";
import { calculateHouseholdTax } from "@/lib/pure/tax/tax";
import type { LtcgBracketTable } from "@/lib/config/tax-tables";
import type { PaycheckInput } from "@/lib/pure/paycheck/paycheck.types";
import type { FilingStatusKey } from "@/lib/config/filing-status";
import { NO_ONE_65 } from "./tax-helpers";

const ltcg2026 = readTaxData().years["2026"]!.ltcg!
  .brackets as LtcgBracketTable;

/** The year's liability for one job, the Taxes page's path:
 *  computeAnnualEarnings, then calculateHouseholdTax. */
function yearTax(input: PaycheckInput, status: FilingStatusKey) {
  const r = calculatePaycheck(input);
  const earnings = computeAnnualEarnings({
    salary: input.annualSalary,
    periodsPerYear: r.periodsPerYear,
    paycheck: r,
    contributionAccounts: input.contributionAccounts,
    deductions: input.deductions,
  });
  return calculateHouseholdTax({
    ageDeductions: NO_ONE_65,
    people: [earnings],
    taxBrackets: liabilityInput(status),
    medicareLiabilityThreshold: limit(
      2026,
      `fica_medicare_surtax_liability_${status.toLowerCase()}`,
    ),
  });
}

// ── TAX-02: wage AGI (Form 1040 lines 1a-11) ────────────────────────────

describe("answer key: wage AGI", () => {
  // One Single 2026 job, $104,000 biweekly ($4,000 a check, 26 checks):
  // traditional 401(k) $400 a check, Roth 401(k) $100 a check, § 125
  // health $150 a check.
  const accounts = [
    account({
      name: "401(k)",
      perCheck: 400,
      checks: 26,
      treatment: "pre_tax",
    }),
    account({
      name: "Roth 401(k)",
      perCheck: 100,
      checks: 26,
      treatment: "tax_free",
    }),
  ];
  const deductions = [deduction("Health", 150, "pre_tax")];

  it("tax/TAX02-1 [TAX-02] box 1 less the 401(k) and § 125, Roth stays in", () => {
    // Box 1 (line 1a) = 104,000 − 401(k) 400 × 26 = 10,400 − § 125 150 ×
    // 26 = 3,900 = 89,700 (IRC 402(g), 125; the Roth deferral is taxed,
    // 402A(a)). No other income or adjustment: line 11 AGI 89,700.
    // Line 15: 89,700 − 16,100 = 73,600. RP25 Single: 5,800 + 22% ×
    // (73,600 − 50,400) = 5,800 + 5,104 = 10,904.00.
    const tax = yearTax(
      job({ salary: 104_000, period: "biweekly", accounts, deductions }),
      "Single",
    );
    cents(
      { agi: tax.wageAgi, ti: tax.taxableIncome, tax: tax.federalTax },
      { agi: 89_700, ti: 73_600, tax: 10_904 },
    );
  });

  // The same job, plus $4,400 paid into an HSA outside payroll (self-only
  // limit, RP 2025-19). Form 8889 line 13 deducts it on Schedule 1 line 13
  // (IRC 62(a)(19), 223(a)), so line 10 is 4,400 and line 11 AGI is
  // 89,700 − 4,400 = 85,300. Line 15: 85,300 − 16,100 = 69,200. RP25
  // Single: 5,800 + 22% × (69,200 − 50,400) = 5,800 + 4,136 = 9,936.00.
  it("tax/TAX02-2 [TAX-02] an HSA paid outside payroll comes off AGI: 85,300", () => {
    cents(
      (() => {
        const hsa = {
          ...account({
            name: "HSA",
            perCheck: 0,
            checks: 26,
            treatment: "hsa",
            annual: 4_400,
          }),
          isPayrollDeducted: false,
        };
        const tax = yearTax(
          job({
            salary: 104_000,
            period: "biweekly",
            accounts: [...accounts, hsa],
            deductions,
          }),
          "Single",
        );
        return { agi: tax.wageAgi, tax: tax.federalTax };
      })(),
      { agi: 85_300, tax: 9_936 },
    );
  });
});

// ── TAX-04: the rate schedule, band by band (IRC 1; RP25 § 4.01) ────────

/** The 2026 schedule as RP25 § 4.01 prints its bands (written here from
 *  the publication, not read from tax data). */
type Status = "MFJ" | "Single" | "HOH";
const RP25: Record<Status, number[]> = {
  MFJ: [24_800, 100_800, 211_400, 403_550, 512_450, 768_700],
  Single: [12_400, 50_400, 105_700, 201_775, 256_225, 640_600],
  HOH: [17_700, 67_450, 105_700, 201_750, 256_200, 640_600],
};
const RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
const schedule = (status: Status) => {
  const tops = RP25[status];
  return RATES.map((rate, i) => ({
    min: i === 0 ? 0 : tops[i - 1]!,
    max: tops[i] ?? null,
    rate,
  }));
};

describe("answer key: the rate schedule", () => {
  it("tax/TAX04-1 [TAX-04] MFJ at $250,000: 24% band", () => {
    // RP25 Table 1: over 211,400, not over 403,550: 35,932 + 24% ×
    // (250,000 − 211,400) = 35,932 + 9,264 = 45,196.00; marginal 24%.
    const r = sumBracketTax(250_000, schedule("MFJ"));
    cents(r.total, 45_196);
    expect(r.marginalRate).toBe(0.24);
  });

  it("tax/TAX04-2 [TAX-04] MFJ at a band's top: the lower band's rate", () => {
    // "Over 24,800 but not over 100,800": 2,480 + 12% × 76,000 = 11,600.00,
    // and 100,800 itself is taxed in the 12% band.
    const r = sumBracketTax(100_800, schedule("MFJ"));
    cents(r.total, 11_600);
    expect(r.marginalRate).toBe(0.12);
  });

  it("tax/TAX04-3 [TAX-04] Single at $1,000,000: the top band", () => {
    // RP25 Table 3: over 640,600: 192,979.25 + 37% × 359,400 =
    // 192,979.25 + 132,978 = 325,957.25.
    const r = sumBracketTax(1_000_000, schedule("Single"));
    cents(r.total, 325_957.25);
    expect(r.marginalRate).toBe(0.37);
  });

  it("tax/TAX04-4 [TAX-04] HOH at $80,000", () => {
    // RP25 Table 2: over 67,450, not over 105,700: 7,740 + 22% × 12,550 =
    // 7,740 + 2,761 = 10,501.00.
    cents(sumBracketTax(80_000, schedule("HOH")).total, 10_501);
  });

  it("tax/TAX04-5 [TAX-04] nothing at or below zero", () => {
    cents(sumBracketTax(0, schedule("Single")).total, 0);
  });
});

// ── TAX-18: the gains rate and room (IRC 1(h); RP25 § 4.03) ─────────────
// 2026 maximum zero-rate amount: 98,900 MFJ, 66,200 HOH, 49,450 Single;
// maximum 15% amount: 613,700 MFJ, 579,600 HOH, 545,500 Single. A gain
// is at 0% to the extent taxable income (ordinary + gains) is "not more
// than" the 0% amount (1(h)(1)(B)), at 15% up to the 15% amount
// (1(h)(1)(C)), 20% above.

describe("answer key: the gains rate and room", () => {
  it("tax/TAX18-1 [TAX-18] where a dollar sits: the 0% ceiling is in 0%", () => {
    // MFJ taxable income 98,900: not more than 98,900, so 0%. 98,901: 15%.
    // 613,700: 15%; 613,701: 20%.
    const rate = (ti: number) => getLtcgRate(ti, "MFJ", ltcg2026);
    expect([rate(98_900), rate(98_901), rate(613_700), rate(613_701)]).toEqual([
      0, 0.15, 0.15, 0.2,
    ]);
  });

  it("tax/TAX18-2 [TAX-18] the next dollar above a ceiling is the next rate", () => {
    // Single, taxable income already 49,450: the next dollar of gain makes
    // 49,451, past the 0% amount: 15%. At 49,449 the next dollar is the
    // 49,450th: 0%. HOH at 579,600: the next dollar is 20%.
    expect([
      ltcgRateForNextDollar(49_449, "Single", ltcg2026),
      ltcgRateForNextDollar(49_450, "Single", ltcg2026),
      ltcgRateForNextDollar(579_600, "HOH", ltcg2026),
    ]).toEqual([0, 0.15, 0.2]);
  });

  it("tax/TAX18-3 [TAX-18] room at 0% and 15% above ordinary taxable income", () => {
    // MFJ, ordinary taxable income 60,000: 0% room 98,900 − 60,000 =
    // 38,900; 15% room 613,700 − 60,000 = 553,700. Ordinary 120,000 is
    // past the 0% amount: room 0. Single ordinary 40,000: 49,450 − 40,000
    // = 9,450. HOH ordinary 0: the whole 66,200.
    cents(
      {
        mfj0: ltcgRoomForRate(0, 60_000, "MFJ", ltcg2026),
        mfj15: ltcgRoomForRate(0.15, 60_000, "MFJ", ltcg2026),
        past: ltcgRoomForRate(0, 120_000, "MFJ", ltcg2026),
        single0: ltcgRoomForRate(0, 40_000, "Single", ltcg2026),
        hoh0: ltcgRoomForRate(0, 0, "HOH", ltcg2026),
      },
      { mfj0: 38_900, mfj15: 553_700, past: 0, single0: 9_450, hoh0: 66_200 },
    );
  });
});
