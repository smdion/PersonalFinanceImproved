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
import { getIrmaaCost } from "@/lib/config/irmaa-tables";
import type { TaxBuckets } from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { getBasis } from "@/lib/pure/accounts/account-balance";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { openingTotals } from "@/lib/pure/engine/opening-state";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";

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

  it("ret/RET10-5 [RET-10] a short brokerage converts what its tax can pay, solved across the band edge", () => {
    // Decision D4 (UD-08): the conversion's tax comes from the brokerage,
    // and a short brokerage shrinks the conversion to what it can pay.
    // RET10-1's year (tax without 1,780.00) with 4,300 of brokerage, short
    // of 83,000's 9,820. The year's tax may reach 1,780 + 4,300 = 6,080:
    // the 10% band ends at taxable 24,800 (tax 2,480), so 6,080 − 2,480
    // = 3,600 at 12% = 30,000 more, taxable 54,800, gross 87,000: 37,000
    // (7,000 at 10% + 30,000 at 12% = 4,300.00). The tax is charged to the
    // cent, so each further cent adds 0.0012 and four still round to
    // 4,300.00 (0.0048); a fifth would be 4,300.01. Converted 37,000.04,
    // all the brokerage paid.
    const r = convert({
      traditional: 50_000,
      preTax: 500_000,
      afterTax: 4_300,
    });
    cents(
      {
        amount: r.rothConversionAmount,
        tax: r.rothConversionTaxCost,
        brokerage: r.balances.afterTax,
      },
      { amount: 37_000.04, tax: 4_300, brokerage: 0 },
    );
  });

  it("ret/RET10-6 [RET-10] the shrunk conversion is the largest cent whose tax rounds within the brokerage", () => {
    // RET10-5 with 5,000 of brokerage: 5,000 − 700 (the 10% part) =
    // 4,300 at 12% = 35,833.333…, so 42,833.33 costs 700 + 4,299.9996 =
    // 4,999.9996. The tax is charged to the cent: 42,833.37 costs
    // 5,000.0044 → 5,000.00, 42,833.38 costs 5,000.0056 → 5,000.01.
    // Converted 42,833.37; the brokerage is left at 0.
    const r = convert({
      traditional: 50_000,
      preTax: 500_000,
      afterTax: 5_000,
    });
    cents(
      {
        amount: r.rothConversionAmount,
        tax: r.rothConversionTaxCost,
        brokerage: r.balances.afterTax,
      },
      { amount: 42_833.37, tax: 5_000, brokerage: 0 },
    );
  });

  it("ret/RET10-7 [RET-10] an IRMAA-capped conversion stops at or under a grown tier's threshold, never half a cent over", () => {
    // A grown threshold keeps its fractions: 206,000 × 1.025³ =
    // 221,839.46875 (invented, MFJ, first tier 1,148.40). The tier starts
    // above it (20 CFR 418.1115(c)), so MAGI may reach 221,839.46 and no
    // more. Traditional draws 180,000: the 24% band's room (255,750) is
    // capped at 221,839.46 − 180,000 = 41,839.46, MAGI 221,839.46, no
    // surcharge two years on. The nearest cent, 41,839.47, would put MAGI
    // over the threshold and charge the whole tier.
    const tiers = [
      { magiThreshold: 221_839.46875, annualSurcharge: 1_148.4 },
      { magiThreshold: 280_000, annualSurcharge: 2_884.8 },
    ];
    const balances: TaxBuckets = {
      preTax: 500_000,
      taxFree: 0,
      hsa: 0,
      afterTax: 500_000,
      afterTaxBasis: 500_000,
    };
    const r = performRothConversion({
      enableRothConversions: true,
      taxBrackets: mfjTable,
      taxMultiplier: 1,
      standardDeduction: 32_200,
      rothConversionTarget: 0.24,
      rothBracketTarget: undefined,
      totalTraditionalWithdrawal: 180_000,
      taxableSS: 0,
      brokerageGainsPortion: 0,
      rothTaxableGrowth: 0,
      irmaaAwareRothConversions: true,
      irmaaBrackets: { MFJ: tiers },
      filingStatus: "MFJ",
      balances,
      accountBalance: accountBalancesFromTaxBuckets(balances),
    });
    const magi = 180_000 + r.rothConversionAmount;
    cents(
      {
        amount: r.rothConversionAmount,
        magi,
        surcharge: getIrmaaCost(magi, "MFJ", { MFJ: tiers }),
      },
      { amount: 41_839.46, magi: 221_839.46, surcharge: 0 },
    );
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

describe("answer key: the conversion's tax from a Retirement brokerage part", () => {
  /** RET10-1's year, the money held in parts: an IRA's Traditional part
   *  (500,000; its Roth part declared at $0) and a Retirement brokerage
   *  part (50,000 at a 20,000 basis). */
  function convertParts() {
    const ira = makeIndividualAccount({
      name: "IRA",
      category: "ira",
      taxType: "preTax",
      startingBalance: 500_000,
      parentCategory: "Retirement",
    });
    const iraRoth = makeIndividualAccount({
      ...ira,
      taxType: "taxFree",
      startingBalance: 0,
    });
    const brokerage = makeIndividualAccount({
      name: "Brokerage",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 50_000,
      startingBasis: 20_000,
      parentCategory: "Retirement",
    });
    const parts = [ira, iraRoth, brokerage];
    const indKey = makeIndKey();
    const indBalance = new Map(
      parts.map((p) => [indKey(p), p.startingBalance]),
    );
    const brokBasis = new Map([[indKey(brokerage), 20_000]]);
    const { balances, accountBalance } = openingTotals(parts);
    const none = { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 };
    const r = performRothConversion({
      enableRothConversions: true,
      taxBrackets: mfjTable,
      taxMultiplier: 1,
      standardDeduction: 32_200,
      rothConversionTarget: 0.12,
      rothBracketTarget: undefined,
      totalTraditionalWithdrawal: 50_000,
      taxableSS: 0,
      brokerageGainsPortion: 0,
      rothTaxableGrowth: 0,
      irmaaBrackets: {},
      filingStatus: "MFJ",
      balances,
      accountBalance,
      nonRetirement: { total: none, trad: none, roth: none, grandTotal: 0 },
      parts: {
        accounts: parts,
        balances: indBalance,
        keyOf: indKey,
        basis: brokBasis,
      },
    });
    return {
      r,
      balances,
      accountBalance,
      indBalance,
      brokBasis,
      indKey,
      ira,
      iraRoth,
      brokerage,
    };
  }

  it("ret/RET11-4 [ENG-20] the brokerage's basis falls by the part's basis sold, on every track", () => {
    // RET11-1's tax, 9,820, sells 9,820 of the brokerage part at its own
    // basis ratio 20,000 / 50,000 = 0.4 (average cost; IRC 1012): basis out
    // 9,820 × 0.4 = 3,928.00, so the part's basis is 16,072.00. The tax
    // buckets' brokerage basis and the brokerage category's basis are the
    // same money, so each falls by the same 3,928.00.
    const t = convertParts();
    cents(
      {
        part: t.brokBasis.get(t.indKey(t.brokerage))!,
        buckets: t.balances.afterTaxBasis,
        category: getBasis(t.accountBalance.brokerage),
      },
      { part: 16_072, buckets: 16_072, category: 16_072 },
    );
  });
  it("ret/RET10-4 [ENG-19] the converted money moves from the Traditional part to the same account's Roth part", () => {
    // RET10-1's 83,000 leaves the IRA's Traditional part (500,000 →
    // 417,000) and lands on its own Roth part (0 → 83,000), as the tax
    // buckets move it (IRC 408A(d)(3): the same account's money, taxed).
    const t = convertParts();
    cents(
      {
        traditional: t.indBalance.get(t.indKey(t.ira))!,
        roth: t.indBalance.get(t.indKey(t.iraRoth))!,
      },
      { traditional: 417_000, roth: 83_000 },
    );
  });
});

describe("answer key: a conversion year's gains, line 25", () => {
  // tax/L6 with part of its ordinary income a conversion: 2026 Single,
  // draws 55,550 + conversion 10,000 = 65,550 ordinary before the 16,100
  // deduction, gains 950. L23 stacks the 950 at 15% (142.50); line 24
  // less the ordinary tax is 5,800 − 5,686 = 114 (L6's figures).
  /** The conversion year's re-priced gains tax under a tax multiplier. */
  function repricedGains(taxMultiplier: number): number {
    let gainsTax = NaN;
    repriceConversionYear(
      { input: { filingStatus: "Single" } } as never,
      {
        ssIncome: 0,
        taxRates: { taxMultiplier },
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
    return gainsTax;
  }

  it("tax/L6:conversion [TAX-17] the re-priced gains stop at the 12% band's cost: 114", () => {
    // min(142.50, 114) = 114.00.
    cents(repricedGains(1), 114);
  });

  it("tax/L6:conversion-multiplier [TAX-17] a multiplier of 1.5 scales both sides: 171", () => {
    // The multiplier scales all income tax, gains included: the stacked
    // 142.50 × 1.5 = 213.75, line 25's 114 at the scaled ordinary rates
    // 114 × 1.5 = 171.00, so the re-priced gains are 171.00.
    cents(repricedGains(1.5), 171);
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

// ── The IRMAA-aware cap and who is on Medicare two years on ─────────────
// Premium year N reads tax year N − 2 (42 USC 1395r(i)(4)(B)(i); 20 CFR
// 418.1135) and only an enrollee pays it (1395r(i)(1)), so a 2026
// conversion can raise a premium only for someone 65 by 2028. Single, no
// Social Security, spending 54,980: W = 60,000 of Traditional draws (TI
// 60,000 − 16,100 = 43,900; 1,240 + 12% × 31,500 = 5,020), a 1,000,000
// Traditional IRA, a 500,000 brokerage all basis to pay the conversion's
// tax, conversions on at 22%, IRMAA-aware. The 22% band's gross top is
// 105,700 + 16,100 = 121,800: 61,800 of room. The 2026 individual first
// tier starts above 109,000 (CMS26).

function cappedYear(
  birthYear: number,
  couple?: { spouseBirthYear: number; spending: number },
) {
  const base = engineHousehold({
    status: couple ? "MFJ" : "Single",
    people: couple
      ? [{ birthYear }, { birthYear: couple.spouseBirthYear }]
      : [{ birthYear }],
    traditionalIra: 1_000_000,
    brokerage: { balance: 500_000, basis: 500_000 },
    spending: couple?.spending ?? 54_980,
    endYear: 2027,
  });
  const input: ProjectionInput = {
    ...base,
    irmaaAwareRothConversions: true,
    decumulationDefaults: {
      ...base.decumulationDefaults,
      distributionTaxRates: {
        ...base.decumulationDefaults.distributionTaxRates,
        enableRothConversions: true,
        rothConversionTarget: 0.22,
      },
    },
  };
  const r = runOneYear(input, 2026);
  if (r.phase !== "decumulation") throw new Error("2026 isn't retired");
  return { w: r.totalWithdrawal, converted: r.rothConversionAmount };
}

describe("answer key through the engine: the IRMAA cap and Medicare two years on", () => {
  it("ret/RET10-8 [RET-10] 63 in 2026, 65 in 2028: the conversion stops at the first tier, 109,000 − 60,000 = 49,000", () => {
    cents(cappedYear(1963), { w: 60_000, converted: 49_000 }, 1);
  });

  it("ret/RET10-8:62 [RET-10] 62 in 2026, 64 in 2028: no premium reads 2026, so the band's 61,800 converts", () => {
    cents(cappedYear(1964), { w: 60_000, converted: 61_800 }, 1);
  });

  it("ret/RET10-8:couple [RET-10] MFJ, born 1963 and 1970: one spouse on Medicare in 2028 is enough, the conversion stops at 218,000 − 150,000 = 68,000", () => {
    // Both under 65 in 2026: deductions 32,200. Spending 134,660: W =
    // 150,000 (TI 117,800; 2,480 + 12% × 76,000 + 22% × 17,000 = 15,340).
    // The 22% band's gross top is 211,400 + 32,200 = 243,600 (93,600 of
    // room); the joint first tier starts above 218,000, and the spouse
    // born 1963 is 65 in 2028, so the cap holds.
    cents(
      cappedYear(1963, { spouseBirthYear: 1970, spending: 134_660 }),
      { w: 150_000, converted: 68_000 },
      1,
    );
  });
});
