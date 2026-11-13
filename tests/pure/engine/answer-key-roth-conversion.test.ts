/**
 * Answer key, Roth conversions (v0.10.5 overnight batch): the amount that
 * fills a target band (RET-10), the conversion's tax and the year's tax
 * re-priced after it (RET-11). Every expected figure is worked by hand
 * from the publication first, never read from `src/`; the shipped 2026
 * tables are only the input. Invented households only.
 *
 * Citations: IRC 408A(d)(3)(A) (a conversion is gross income in the year
 * converted, so its tax is the year's tax with it less the tax without
 * it); IRC 1 and Rev. Proc. 2025-32 (RP25, 2026) § 4.01 (rate schedules,
 * written out in `tax/answer-key-tax-rates`), § 4.03 (gains: 0% to
 * 98,900 MFJ), § 4.14(1) (standard deduction $32,200 MFJ, $16,100
 * Single); the i1040 (2025) Qualified Dividends and Capital Gain Tax
 * Worksheet; IRC 86 and Pub 915 (2025) Worksheet 1 (taxable Social
 * Security, line numbers kept: base 25,000 Single, line 11 9,000).
 * The size of a conversion is owner design (fill the target band's
 * gross-income top, `incomeCapForMarginalRate`, from the Traditional
 * balance); its tax is law.
 */
import { describe, it } from "vitest";
import { cents, xfail } from "../../fixtures/answer-key";
import {
  engineHousehold,
  type KeyHousehold,
} from "../../fixtures/answer-key-household";
import { runOneYear } from "../../fixtures/answer-key";
import { readTaxData } from "../../helpers/tax-data";
import { performRothConversion } from "@/lib/pure/engine/roth-conversion";
import { repriceConversionYear } from "@/lib/pure/engine/projection-year-handlers/conversion-year-reprice";
import { accountBalancesFromTaxBuckets } from "../fixtures/tax-bucket-split";
import type { WithholdingBracket } from "@/lib/pure/engine/tax-estimation";
import type { LtcgBracketTable } from "@/lib/config/tax-tables";
import type { TaxBuckets } from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";

const y2026 = readTaxData().years["2026"]!;
const mfjTable = y2026.withholding.tables.MFJ!.standard as WithholdingBracket[];
const singleTable = y2026.withholding.tables.Single!
  .standard as WithholdingBracket[];
const ltcg2026 = y2026.ltcg!.brackets as LtcgBracketTable;

/** One MFJ 2026 conversion at the 12% target, after `traditional` of
 *  Traditional draws, with the Traditional and brokerage money given. */
function convert(c: { traditional: number; preTax: number; afterTax: number }) {
  const balances: TaxBuckets = {
    preTax: c.preTax,
    taxFree: 0,
    hsa: 0,
    afterTax: c.afterTax,
    afterTaxBasis: c.afterTax,
  };
  const r = performRothConversion({
    enableRothConversions: true,
    taxBrackets: mfjTable,
    taxMultiplier: 1,
    standardDeduction: 32_200,
    rothConversionTarget: 0.12,
    rothBracketTarget: undefined,
    totalTraditionalWithdrawal: c.traditional,
    taxableSS: 0,
    brokerageGainsPortion: 0,
    rothTaxableGrowth: 0,
    irmaaBrackets: {},
    filingStatus: "MFJ",
    balances,
    accountBalance: accountBalancesFromTaxBuckets(balances),
  });
  return { ...r, balances };
}

describe("answer key: the conversion amount and its tax", () => {
  it("ret/RET10-1 [RET-10] fills the 12% band's top from the Traditional balance", () => {
    // MFJ 2026, Traditional draws 50,000, no other income. The 12% band
    // tops out at taxable 100,800, gross 100,800 + 32,200 = 133,000. Room
    // 133,000 − 50,000 = 83,000; the 500,000 Traditional covers it.
    // Balances after: Traditional 417,000, Roth 83,000.
    const r = convert({
      traditional: 50_000,
      preTax: 500_000,
      afterTax: 50_000,
    });
    cents(
      {
        amount: r.rothConversionAmount,
        preTax: r.balances.preTax,
        roth: r.balances.taxFree,
      },
      { amount: 83_000, preTax: 417_000, roth: 83_000 },
    );
  });

  it("ret/RET10-2 [RET-10] the Traditional balance caps it", () => {
    // Same year, 30,000 of Traditional left: converts 30,000.
    const r = convert({
      traditional: 50_000,
      preTax: 30_000,
      afterTax: 50_000,
    });
    cents(r.rothConversionAmount, 30_000);
  });

  it("ret/RET11-1 [RET-11] the tax is the year's tax with it less without it", () => {
    // RET10-1's year. Without: TI 50,000 − 32,200 = 17,800, 10% = 1,780.
    // With 83,000: TI 133,000 − 32,200 = 100,800: 2,480 + 12% × 76,000 =
    // 11,600. The conversion's tax 11,600 − 1,780 = 9,820.00, paid from
    // the brokerage (all basis): 50,000 − 9,820 = 40,180.
    const r = convert({
      traditional: 50_000,
      preTax: 500_000,
      afterTax: 50_000,
    });
    cents(
      { tax: r.rothConversionTaxCost, brokerage: r.balances.afterTax },
      { tax: 9_820, brokerage: 40_180 },
    );
  });

  it("ret/RET11-2 [RET-11] the conversion pushes the year's gains out of 0%", () => {
    // RET10-1's year plus 40,000 of long-term gains. Before the
    // conversion: ordinary taxable 17,800, the gains stack to 57,800, all
    // under 98,900: 0. After: QDCG worksheet line 1 = 50,000 + 83,000 +
    // 40,000 − 32,200 = 140,800; line 5 (ordinary) 100,800; line 6
    // 98,900; line 7 = min(140,800, 98,900) = 98,900; line 8 = min(line
    // 5, line 7) = 98,900, so line 9 (at 0%) = 0 and the whole 40,000 is
    // at 15%: 6,000.00 (line 13 ≤ 613,700). NIIT: MAGI 173,000 is under
    // 250,000 (IRC 1411(b)): none. The rate at the top of the stack: 15%.
    // The year's own pricing (`priceTax`) is the engine's, so only the
    // gains it's handed are checked here.
    let gainsTax = NaN;
    const r = repriceConversionYear(
      { input: { filingStatus: "MFJ" } } as never,
      {
        ssIncome: 0,
        taxRates: {},
        tables: {
          grownLtcgBrackets: ltcg2026,
          grownTaxBrackets: undefined,
        },
      } as never,
      {
        priced: {
          taxFromSlots: {
            taxCost: 0,
            brokerageTaxCost: 0,
            rothTaxableGrowth: 0,
          },
          priceTax: (_ss: number, brokerageTaxCost: number) => {
            gainsTax = brokerageTaxCost;
            return { taxCost: brokerageTaxCost };
          },
          taxableSS: 0,
          standardDeduction: 32_200,
        },
        parts: { actualTaxableIncome: 50_000, brokerageGainsPortion: 40_000 },
        rmd: { totalTraditionalWithdrawal: 50_000 },
        conversion: { rothConversionAmount: 83_000 },
      } as never,
    );
    cents(
      { gains: gainsTax, rate: r.postConversionLtcgRate, niit: r.niitAmount },
      { gains: 6_000, rate: 0.15, niit: 0 },
    );
  });
});

describe("answer key: a conversion year's gains, line 25", () => {
  it("tax/L6:conversion [TAX-17] the re-priced gains stop at the 12% band's cost: 114", () => {
    // tax/L6 with part of its ordinary income a conversion: 2026 Single,
    // draws 55,550 + conversion 10,000 = 65,550 ordinary before the 16,100
    // deduction, gains 950. L23 stacks the 950 at 15% (142.50); line 24
    // less the ordinary tax is 5,800 − 5,686 = 114 (L6's figures), so the
    // re-priced gains are 114.00.
    let gainsTax = NaN;
    repriceConversionYear(
      { input: { filingStatus: "Single" } } as never,
      {
        ssIncome: 0,
        taxRates: { taxMultiplier: 1 },
        tables: {
          grownLtcgBrackets: ltcg2026,
          grownTaxBrackets: singleTable,
        },
      } as never,
      {
        priced: {
          taxFromSlots: {
            taxCost: 0,
            brokerageTaxCost: 0,
            rothTaxableGrowth: 0,
          },
          priceTax: (_ss: number, brokerageTaxCost: number) => {
            gainsTax = brokerageTaxCost;
            return { taxCost: brokerageTaxCost };
          },
          taxableSS: 0,
          standardDeduction: 16_100,
        },
        parts: { actualTaxableIncome: 55_550, brokerageGainsPortion: 950 },
        rmd: { totalTraditionalWithdrawal: 55_550 },
        conversion: { rothConversionAmount: 10_000 },
      } as never,
    );
    cents(gainsTax, 114);
  });
});

// ── The conversion and Social Security (IRC 86; Pub 915) ────────────────
// Single, born 1963 (63 in 2026: no 65+ deduction), $20,000 Social
// Security claimed at 63, spending $20,000 (Social Security covers it:
// no draw), a $60,000 Traditional IRA, $20,000 brokerage all basis (pays
// the conversion's tax), conversions on at 12%.
// Size (owner design): the 12% band's gross top is 50,400 + 16,100 =
// 66,500; nothing else is income before it, so the whole 60,000 converts.
// Law: Pub 915 Worksheet 1 with the conversion in line 3 (it is gross
// income, 408A(d)(3)): L1 20,000; L2 10,000; L3 60,000; L8 70,000; L9
// 25,000; L10 45,000; L11 9,000; L12 36,000; L13 9,000; L14 4,500; L15
// min(10,000, 4,500) = 4,500; L16 85% × 36,000 = 30,600; L17 35,100;
// L18 85% × 20,000 = 17,000; taxable 17,000.
// TI 60,000 + 17,000 − 16,100 = 60,900: RP25 Single 5,800 + 22% × 10,500
// = 8,110.00 for the year, all of it the conversion's (without it the
// year has no taxable income).
// Today the year's taxable Social Security is figured before the
// conversion (L8 10,000, under the base: 0), so the year is taxed on
// 43,900: 1,240 + 12% × 31,500 = 5,020.00, $3,090 short (the 17,000 of
// benefits the conversion makes taxable: 12% × 6,500 + 22% × 10,500).

const torpedo: KeyHousehold = {
  status: "Single",
  people: [{ birthYear: 1963, socialSecurity: 20_000 }],
  traditionalIra: 60_000,
  brokerage: { balance: 20_000, basis: 20_000 },
  spending: 20_000,
  endYear: 2027,
};

function torpedoYear() {
  const base = engineHousehold(torpedo);
  const input: ProjectionInput = {
    ...base,
    // Claimed at 63, so 2026 has the benefit (the fixture claims at 67).
    ssStartAge: 63,
    decumulationDefaults: {
      ...base.decumulationDefaults,
      distributionTaxRates: {
        ...base.decumulationDefaults.distributionTaxRates,
        enableRothConversions: true,
        rothConversionTarget: 0.12,
      },
    },
  };
  const r = runOneYear(input, 2026);
  if (r.phase !== "decumulation") throw new Error("2026 isn't retired");
  return r;
}

describe("answer key through the engine: a conversion and Social Security", () => {
  it("ret/RET10-3 [RET-10] the whole Traditional balance fits under the band", () => {
    cents(torpedoYear().rothConversionAmount, 60_000);
  });

  xfail({
    id: "ret/RET11-3 [RET-11]",
    todo: "v0.11 Tax \"A Roth conversion's Social Security torpedo isn't priced\"",
    run: () => {
      const r = torpedoYear();
      return {
        taxableSS: r.taxableSS,
        tax: r.taxCost + r.rothConversionTaxCost,
      };
    },
    expected: { taxableSS: 17_000, tax: 8_110 },
    today: { taxableSS: 0, tax: 5_020 },
  });
});
