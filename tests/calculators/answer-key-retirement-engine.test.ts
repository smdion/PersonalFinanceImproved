/**
 * Answer key, retirement through the engine: rules the function-level
 * files check alone, run here through `calculateProjection` so the
 * engine's own wiring is under test (`.scratch/docs/drafts/answer-key.md`
 * § Retirement rules, "Retirement test audit": "Through the engine, not
 * pure tests" and the boundary cases; audit mutants in
 * `reviews/2026-11-01/rebuild/retirement-verdicts.md` § Test audit). Ids
 * are the function-level case's own with an `:engine` suffix, or the audit
 * mutant's (`ret/RT08`, `ret/RT38`) for a boundary the key has no case
 * for; the bracketed part is the docs/CALCULATIONS.md row. No new case ids
 * (plan commit 15).
 *
 * - The penalty priced (P9, E13, E17; engine audit M08, RT56): the
 *   function-level figures are `tests/pure/answer-key-penalties.test.ts`'s.
 * - IRMAA per enrolled person (I10, I11; RT34) and the on-top surcharge in
 *   the third retired year (RT38): `tests/config/answer-key-irmaa.test.ts`.
 * - The two-year lookback (I26, I29, C5; RT33): the same file, and spec
 *   `specs/retirement-rules.md` § 14.6 C5.
 * - Spouses in different RMD cohorts (RT08): `answer-key-rmd.test.ts` (R4
 *   to R7 starts, Table III).
 *
 * Households: `tests/fixtures/answer-key-household.ts` (invented; 0%
 * return, inflation and limit growth, so the 2026 tables hold in every
 * year; the plan starts 2026-01-01, retired from the start). 2026 figures:
 * Rev. Proc. 2025-32 § 4.01 Tables 1 (MFJ: 10% to 24,800, 12% to 100,800,
 * 22% to 211,400, 24% to 403,550) and 3 (Single: 10% to 12,400, 12% to
 * 50,400, 22% to 105,700, 24% to 201,775); § 4.14 standard deduction
 * 32,200 MFJ, 16,100 Single, 65+ add-on 1,650 married, 2,050 unmarried.
 * CMS 2026 IRMAA a year per enrolled person (CMS26, as in the IRMAA file):
 * joint > 218,000 1,148.40, > 274,000 2,884.80, > 342,000 4,620.00,
 * > 410,000 6,355.20; individual > 109,000 1,148.40, > 137,000 2,884.80.
 *
 * The engine's year model, as these cases read it (each cited where used):
 * - A need-sized year's draw W grosses up until W − tax − penalty = need
 *   (`engine/tax-gross-up.ts`: the penalty is priced inside the gross-up
 *   since v0.9.8 `5f379577`); W at ±$1 (key § Re-run: the gross-up can stop
 *   a cent short). Ledger tax = `taxCost + penaltyCost`.
 * - MAGI for IRMAA is the year's Traditional draw + Roth conversion +
 *   taxable Social Security + gains (`decumulation-year.ts:1222`). Premium
 *   year N reads year N−2's (`:1314-1317`); the first two retired years
 *   have no lookback and read their own (v0.11 Retirement rules "First two
 *   IRMAA years ignore working income"). Charged per person 65+ (`:553`,
 *   `:1327`).
 * - "On top of my budget": from the third retired year the N−2 surcharge
 *   joins the need (`:561-586`, its own copy of the count at `:582`); in
 *   the first two it only lowers what's spent (`spending` less
 *   `irmaaPaid`).
 * - The senior deduction (IRC 151(d)(5)(C)) uses last year's MAGI, pooled,
 *   and is 0 in the first retired year (`decumulation-year.ts:469-482`;
 *   v0.11 Tax "Senior deduction must use same-year MAGI in every year").
 *   Every year whose W a case asserts is chosen so the law's amount and
 *   the engine's are both 0: this year's MAGI ≥ 250,000 joint (6% of the
 *   excess over 150,000 takes each 6,000) and last year's ≥ 350,000 (the
 *   pooled 12,000), or the first retired year. Other years' W is only
 *   placed in its IRMAA tier, which holds either way.
 * - RMDs per owner from each person's own birth year (`context.ts:141-152`,
 *   `getRmdStartAge`), from the year of the start age, prior year-end
 *   balance ÷ the Uniform Lifetime divisor.
 *
 * Mutation-checked by hand when written (break, see a failure, restore):
 * RT56 (penalty 5%), RT34 (charge once a household, `:1327`) and its twin
 * at the need (`:582`), RT33 (one-year lookback, `:1316`) and its twin at
 * the need (`:579`), RT38 (on-top need from the fourth year, `:572`), RT08
 * (`context.ts:149`, the spouse takes the primary's cohort). v0.10.0
 * commit 39 (one IRMAA-cost function in place of `:582` and `:1327`)
 * rests on the I10/I11 and RT38 tests: together they fail an engine that
 * charges IRMAA once a household at either site.
 */
import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  EngineDecumulationYear,
  ProjectionInput,
} from "@/lib/calculators/types";
import { cents } from "../fixtures/answer-key";
import {
  engineHousehold,
  retiredYear,
  type KeyHousehold,
} from "../fixtures/answer-key-household";

/** Gross-up convergence on a withdrawal-sized figure (see the header). */
const GROSS_UP = 1;

/** Every retired year of a projection, by year. */
function retiredYears(input: ProjectionInput) {
  const rows = calculateProjection(input).projectionByYear;
  return (year: number): EngineDecumulationYear => {
    const r = rows.find((y) => y.year === year);
    if (!r || r.phase !== "decumulation")
      throw new Error(`${year} isn't a retired year`);
    return r;
  };
}

/** IRMAA awareness on, on top of the budget or not. */
const withIrmaa = (h: KeyHousehold, onTop = false): ProjectionInput => ({
  ...engineHousehold(h),
  enableIrmaaAwareness: true,
  irmaaOnTopOfBudget: onTop,
});

// ---------------------------------------------------------------------------
// A. A priced early-withdrawal penalty (engine audit M08; audit RT56)
// ---------------------------------------------------------------------------

describe("answer key through the engine: the penalty is priced", () => {
  /** A Single person 52 or 35, retired, penalized draws allowed. */
  const early = (
    birthYear: number,
    spending: number,
    accounts: Pick<KeyHousehold, "traditionalIra" | "rothIra">,
  ) => {
    const r = retiredYear(
      {
        status: "Single",
        people: [{ birthYear }],
        spending,
        endYear: 2027,
        allowPenalizedWithdrawals: true,
        ...accounts,
      },
      2026,
    );
    const roth = r.individualAccountBalances.find(
      (a) => a.taxType === "taxFree",
    );
    return {
      withdrawal: r.totalWithdrawal,
      tax: r.taxCost,
      penalty: r.penaltyCost ?? NaN,
      delivered: r.deliveredAfterTax ?? NaN,
      ...(roth ? { basisDrawn: roth.rothBasisDrawn ?? NaN } : {}),
      unmet: r.unmetNeed ?? 0,
    };
  };

  it("ret/P9:engine [RET-18] 35, a Traditional IRA, no basis: a 2,700 need draws 3,000, 300 of it the additional tax", () => {
    // ret/P9: 10% × 3,000 = 300 (IRC 72(t)(1)). Invented: born 1991 (35 in
    // 2026, the year model's age), Single, IRA 100,000, spending 2,700. W
    // ≤ 16,100 (the standard deduction) has no income tax, so W − 0.10W =
    // 2,700: W = 3,000, penalty 300, tax 0, delivered 2,700 and no unmet
    // need. RT56 (5%): W = 2,700 / 0.95 = 2,842.11, penalty 142.11. A
    // gross-up blind to the penalty (before `5f379577`): W 2,700, 270
    // short.
    cents(
      early(1991, 2_700, { traditionalIra: 100_000 }),
      { withdrawal: 3_000, tax: 0, penalty: 300, delivered: 2_700, unmet: 0 },
      GROSS_UP,
    );
  });

  it("ret/E13:engine [RET-21] 52, a 2022 conversion in its clock: an 18,500 need draws 20,000, income 0, additional tax 1,500", () => {
    // ret/E13: regular 5,000 first, then 15,000 of the 2022 conversion,
    // inside its five-year clock (to 12/31/2026; IRC 408A(d)(3)(F)), so 10%
    // × 15,000 = 1,500; all of it basis, income 0. Invented: born 1974
    // (52), Single, a Roth IRA of 35,000 = regular 5,000 + conversion
    // 30,000, no earnings. Need 18,500: the first 5,000 is free, then W −
    // 5,000 − 0.10 × (W − 5,000) = 13,500, W = 20,000. Basis drawn 20,000
    // (income 0, tax 0). RT56: W = 5,000 + 13,500 / 0.95 = 19,210.53.
    cents(
      early(1974, 18_500, {
        rothIra: {
          balance: 35_000,
          regular: 5_000,
          conversions: 30_000,
          latestConversionYear: 2022,
        },
      }),
      {
        withdrawal: 20_000,
        tax: 0,
        penalty: 1_500,
        delivered: 18_500,
        basisDrawn: 20_000,
        unmet: 0,
      },
      GROSS_UP,
    );
  });

  it("ret/E17:engine [RET-21] 52, ordering reaches earnings: a 16,700 need draws 18,000, income 3,000, additional tax 1,300", () => {
    // ret/E17: regular 5,000 free; the 2024 conversion's 10,000 in its
    // clock; then 3,000 of earnings, income and charged: 10% × 13,000 =
    // 1,300. Invented: born 1974, Single, a Roth IRA of 18,000 = regular
    // 5,000 + conversion 10,000 + earnings 3,000. Income 3,000 < 16,100
    // standard deduction: tax 0. Need 18,000 − 1,300 = 16,700, so W =
    // 18,000, the whole account; basis drawn 15,000, so 3,000 is income.
    // RT56: W = 5,000 + 11,700 / 0.95 = 17,315.79.
    cents(
      early(1974, 16_700, {
        rothIra: {
          balance: 18_000,
          regular: 5_000,
          conversions: 10_000,
          latestConversionYear: 2024,
        },
      }),
      {
        withdrawal: 18_000,
        tax: 0,
        penalty: 1_300,
        delivered: 16_700,
        basisDrawn: 15_000,
        unmet: 0,
      },
      GROSS_UP,
    );
  });
});

// ---------------------------------------------------------------------------
// B. IRMAA per enrolled person (audit RT34) and on top in the third year
//    (audit RT38)
// ---------------------------------------------------------------------------

describe("answer key through the engine: IRMAA per person on Medicare", () => {
  /** An MFJ couple drawing a Traditional IRA, no Social Security. */
  const couple = (
    birthYears: [number, number],
    spending: number,
    extra: Partial<KeyHousehold> = {},
  ): KeyHousehold => ({
    status: "MFJ",
    people: [{ birthYear: birthYears[0] }, { birthYear: birthYears[1] }],
    traditionalIra: 5_000_000,
    spending,
    endYear: 2029,
    ...extra,
  });

  /** A year's draw and surcharge; 2026 is the first retired year (its own
   *  MAGI), 2028 the first that looks back (2026's). */
  const irmaaYears = (h: KeyHousehold) => {
    const at = retiredYears(withIrmaa(h));
    return {
      w2026: at(2026).totalWithdrawal,
      irmaa2026: at(2026).irmaaCost,
      irmaa2028: at(2028).irmaaCost,
    };
  };

  it("ret/I10:engine [RET-16] both 65 or older, joint MAGI in the first tier: 1,148.40 each, 2,296.80 (RT34)", () => {
    // ret/I10: > 218,000 joint is the first tier, 1,148.40 per enrolled
    // person (20 CFR 418.1101(a); IM-5). Invented: born 1959 and 1960 (67
    // and 66), spending 220,924 every year. 2026: deductions 32,200 + 2 ×
    // 1,650 = 35,500 (no senior amount: the engine's first year, and the
    // law's too at this MAGI); tax = 0.24 × (W − 35,500) − 14,804 (24%
    // band, 35,932 at 211,400), so W − tax = 0.76W + 23,324 = 220,924: W
    // = 260,000, tax 39,076. MAGI 260,000: 218,000 < 260,000 ≤ 274,000.
    // 2028 reads 2026's 260,000 (the 2027 and 2028 draws move with the
    // engine's prior-year senior amount, not asserted). Both enrolled:
    // 2 × 1,148.40 = 2,296.80 in both years. RT34 (once a household):
    // 1,148.40.
    cents(
      irmaaYears(couple([1959, 1960], 220_924)),
      { w2026: 260_000, irmaa2026: 2_296.8, irmaa2028: 2_296.8 },
      GROSS_UP,
    );
  });

  it("ret/I11:engine [RET-16] one of the two 65 or older, the same tier: 1,148.40", () => {
    // ret/I11: only the enrolled spouse pays. Invented: born 1961 and 1962
    // (65 and 64 in 2026; 67 and 66 by 2028, but 2028's premium is
    // charged on the count of 2028, both enrolled: 2,296.80). 2026:
    // deductions 32,200 + 1,650 = 33,850; 0.76W + 0.24 × 33,850 + 14,804
    // = 220,528 gives W = 260,000, tax 39,472; first tier, one person:
    // 1,148.40. A count of every person (not every person 65+) gives
    // 2,296.80 in 2026.
    cents(
      irmaaYears(couple([1961, 1962], 220_528)),
      { w2026: 260_000, irmaa2026: 1_148.4, irmaa2028: 2_296.8 },
      GROSS_UP,
    );
  });

  it("ret/RT38 [RET-16] on top of the budget, the third retired year's need carries the 2026 surcharge for both", () => {
    // Invented: born 1959 and 1960, IRMAA paid on top of the budget;
    // spending 220,924 in 2026, a typed 300,000 for 2027, 220,924 again
    // from 2028.
    // 2026 (first year): W 260,000 as ret/I10:engine, MAGI tier 1, 2 ×
    // 1,148.40 = 2,296.80 charged; not in the need, so spent 220,924 −
    // 2,296.80 = 218,627.20.
    // 2027: W ≈ 362,342 (the engine's senior amount from 2026, 12,000 − 6%
    // × 110,000 = 5,400; 364,047 with none): ≥ 350,000 either way, so
    // 2028 has no senior amount in the engine or the law (2028's own MAGI
    // is ≥ 250,000).
    // 2028 (third year): need = 220,924 + 2026's surcharge 2,296.80 =
    // 223,220.80 (decision E1: charged on top; `:561-586`). 0.76W + 23,324
    // = 223,220.80: W = 263,022.11, tax 0.24 × 227,522.11 − 14,804 =
    // 39,801.31. 2028's charge reads 2026 too: 2,296.80, so 220,924 is
    // spent.
    // RT38 (from the fourth year): need 220,924, W 260,000. The need site
    // reading 2027 (tier 3, 2 × 4,620 = 9,240): W 272,157.89. The need
    // site's count dropped: W 261,511.05.
    const at = retiredYears(
      withIrmaa(
        couple([1959, 1960], 220_924, {
          budgetFrom: [
            { year: 2027, monthly: 300_000 / 12 },
            { year: 2028, monthly: 220_924 / 12 },
          ],
        }),
        true,
      ),
    );
    cents(
      {
        need2026: at(2026).afterTaxNeed,
        charged2026: at(2026).irmaaCost,
        need2028: at(2028).afterTaxNeed,
        charged2028: at(2028).irmaaCost,
      },
      {
        need2026: 220_924,
        charged2026: 2_296.8,
        need2028: 223_220.8,
        charged2028: 2_296.8,
      },
    );
    cents(
      {
        w2026: at(2026).totalWithdrawal,
        spent2026: at(2026).spending,
        w2028: at(2028).totalWithdrawal,
        tax2028: at(2028).taxCost,
        spent2028: at(2028).spending,
      },
      {
        w2026: 260_000,
        spent2026: 218_627.2,
        w2028: 263_022.11,
        tax2028: 39_801.31,
        spent2028: 220_924,
      },
      GROSS_UP,
    );
    expect(at(2027).totalWithdrawal).toBeGreaterThan(350_000);
  });
});

// ---------------------------------------------------------------------------
// C. The lookback: premium year N reads N−2 (audit RT33)
// ---------------------------------------------------------------------------

describe("answer key through the engine: the two-year lookback", () => {
  /** A Roth conversion in 2026 only, filling ordinary income to the top of
   *  `target`'s bracket, its tax paid from the brokerage; the conversion
   *  isn't capped at the next IRMAA cliff, so its size is the bracket's. */
  const convertIn2026 = (h: KeyHousehold, target: number): ProjectionInput => {
    const base = withIrmaa(h);
    const d = base.decumulationDefaults;
    return {
      ...base,
      irmaaAwareRothConversions: false,
      decumulationDefaults: {
        ...d,
        distributionTaxRates: {
          ...d.distributionTaxRates,
          enableRothConversions: true,
          rothConversionTarget: target,
        },
      },
      decumulationOverrides: [{ year: 2027, rothConversionTarget: 0 }],
    };
  };

  it("ret/I26:engine [RET-16] 2026 joint MAGI 300,000 sets the 2028 premium: 2,884.80 each; 2027's lower MAGI sets 2029's: 0", () => {
    // ret/I26: 274,000 < 300,000 ≤ 342,000, the second joint tier, read
    // two years on (42 USC 1395r(i)(4)(B)(i); IM-2). Invented: born 1959
    // and 1960, spending 251,324 in 2026, a typed 160,000 from 2027.
    // 2026: 0.76W + 23,324 = 251,324 (24% band, as ret/I10:engine): W =
    // 300,000, tax 48,676. 2027: W ≈ 180,710 (the engine's senior amount
    // from 2026 is 12,000 − 6% × 150,000 = 3,000: deductions 38,500; 22%
    // band, tax = 0.22 × (W − 38,500) − 10,576, 0.78W = 140,954; 179,864
    // with the law's same-year 2 × 3,000): ≤ 218,000 either way, no tier.
    // 2028 reads 2026: 2 × 2,884.80 = 5,769.60; 2029 reads 2027: 0. RT33
    // (one year): 2028 reads 2027, 0.
    const at = retiredYears(
      withIrmaa({
        status: "MFJ",
        people: [{ birthYear: 1959 }, { birthYear: 1960 }],
        traditionalIra: 5_000_000,
        spending: 251_324,
        budgetFrom: [{ year: 2027, monthly: 160_000 / 12 }],
        endYear: 2030,
      }),
    );
    cents(at(2026).totalWithdrawal, 300_000, GROSS_UP);
    expect(at(2027).totalWithdrawal).toBeLessThan(218_000);
    cents(
      { irmaa2028: at(2028).irmaaCost, irmaa2029: at(2029).irmaaCost },
      { irmaa2028: 5_769.6, irmaa2029: 0 },
    );
  });

  it("ret/I29:engine [RET-16] a 2026 conversion on a Single base of 60,000 sets the 2028 premium: 1,148.40", () => {
    // ret/I29 (base 60,000 + a 100,000 conversion, two years on) through
    // the engine, which sizes a conversion to a bracket, not a figure.
    // Invented: born 1960 (66), Single, spending 55,226, brokerage 500,000
    // (basis 500,000) to pay the conversion's tax, a conversion to the top
    // of the 22% bracket in 2026 only. 2026: deductions 16,100 + 2,050 =
    // 18,150 (no senior amount in the engine's first year); W = 60,000:
    // tax 10% × 12,400 + 12% × 29,450 = 4,774, 60,000 − 4,774 = 55,226.
    // The conversion fills to 105,700 + 18,150 = 123,850, so 63,850; MAGI
    // 123,850: 109,000 < 123,850 ≤ 137,000 (and with the law's 3,069
    // senior amount the 22% top is 126,919, the same tier). 2027: W ≈
    // 59,582, no conversion, MAGI ≤ 109,000. 2028 reads 2026: 1,148.40;
    // 2029 reads 2027: 0. RT33: 2028 reads 2027, 0.
    const at = retiredYears(
      convertIn2026(
        {
          status: "Single",
          people: [{ birthYear: 1960 }],
          traditionalIra: 5_000_000,
          brokerage: { balance: 500_000, basis: 500_000 },
          spending: 55_226,
          endYear: 2030,
        },
        0.22,
      ),
    );
    cents(
      {
        w2026: at(2026).totalWithdrawal,
        magi2026: at(2026).totalWithdrawal + at(2026).rothConversionAmount,
        converted2027: at(2027).rothConversionAmount,
      },
      { w2026: 60_000, magi2026: 123_850, converted2027: 0 },
      GROSS_UP,
    );
    expect(at(2027).totalWithdrawal).toBeLessThan(109_000);
    cents(
      { irmaa2028: at(2028).irmaaCost, irmaa2029: at(2029).irmaaCost },
      { irmaa2028: 1_148.4, irmaa2029: 0 },
    );
  });

  it("ret/C5:engine [RET-16] a 2026 conversion raises the 2028 premium, not 2027's: 6,355.20 each", () => {
    // Spec C5: a conversion in 2026 is 2026 income and raises the premium
    // of 2028. Invented: born 1959 and 1960, spending 220,924 every year,
    // brokerage 500,000 (basis 500,000), a conversion to the top of the
    // 24% bracket in 2026 only. 2026: W = 260,000 (as ret/I10:engine);
    // the conversion fills to 403,550 + 35,500 = 439,050, so 179,050;
    // MAGI 439,050: 410,000 < 439,050 < 750,000, the fourth joint tier,
    // 6,355.20 a person. 2027: no conversion, and no senior amount (2026's
    // MAGI over 350,000; the law's 0 at this year's 260,000): W 260,000,
    // tier 1. 2028 reads 2026: 2 × 6,355.20 = 12,710.40; 2029 reads
    // 2027: 2 × 1,148.40 = 2,296.80. RT33: 2028 reads 2027, 2,296.80.
    const at = retiredYears(
      convertIn2026(
        {
          status: "MFJ",
          people: [{ birthYear: 1959 }, { birthYear: 1960 }],
          traditionalIra: 5_000_000,
          brokerage: { balance: 500_000, basis: 500_000 },
          spending: 220_924,
          endYear: 2030,
        },
        0.24,
      ),
    );
    cents(
      {
        w2026: at(2026).totalWithdrawal,
        converted2026: at(2026).rothConversionAmount,
        w2027: at(2027).totalWithdrawal,
        converted2027: at(2027).rothConversionAmount,
      },
      {
        w2026: 260_000,
        converted2026: 179_050,
        w2027: 260_000,
        converted2027: 0,
      },
      GROSS_UP,
    );
    cents(
      { irmaa2028: at(2028).irmaaCost, irmaa2029: at(2029).irmaaCost },
      { irmaa2028: 12_710.4, irmaa2029: 2_296.8 },
    );
  });
});

// ---------------------------------------------------------------------------
// D. Spouses in different RMD cohorts (audit RT08)
// ---------------------------------------------------------------------------

describe("answer key through the engine: each spouse's own RMD start", () => {
  it("ret/RT08 [RET-01] born 1959 (starts at 73) and 1960 (starts at 75): the younger spouse's first RMD is 2035, not 2033", () => {
    // IRC 401(a)(9)(C)(v) as SECURE 2.0 § 107: 73 for 1951-1959 (1959 by
    // decision E4, ret/R6), 75 from 1960 (ret/R7). Invented: MFJ, A born
    // 1959 with an IRA of 1,000,000 and Social Security of 50,000 (claimed
    // at 62), B born 1960 with an IRA of 500,000; spending 40,000, so
    // nothing is drawn but RMDs (0% return; the excess is reinvested).
    // Table III (Pub 590-B 2025): 73 26.5, 74 25.5, 75 24.6, 76 23.7.
    // A: 2032 (73) 1,000,000 / 26.5 = 37,735.85; 2033 962,264.15 / 25.5 =
    // 37,735.85; 2034 924,528.30 / 24.6 = 37,582.45; 2035 886,945.85 /
    // 23.7 = 37,423.88. B: none at 73 (2033) or 74; 2035 (75) 500,000 /
    // 24.6 = 20,325.20. RT08 (B on A's cohort): B 500,000 / 26.5 =
    // 18,867.92 in 2033.
    const h = engineHousehold({
      status: "MFJ",
      people: [
        { birthYear: 1959, socialSecurity: 50_000 },
        { birthYear: 1960 },
      ],
      traditionalIra: 1_000_000,
      spouseTraditionalIra: 500_000,
      spending: 40_000,
      endYear: 2036,
    });
    const at = retiredYears({
      ...h,
      socialSecurityEntries: h.socialSecurityEntries!.map((e) =>
        e.personId === 1 ? { ...e, startAge: 62 } : e,
      ),
    });
    const rmd = (year: number, personId: number) =>
      at(year).rmdByPerson?.find((p) => p.personId === personId)?.amount ?? 0;
    cents(
      {
        a2031: rmd(2031, 1),
        a2032: rmd(2032, 1),
        a2033: rmd(2033, 1),
        a2034: rmd(2034, 1),
        a2035: rmd(2035, 1),
        b2033: rmd(2033, 2),
        b2034: rmd(2034, 2),
        b2035: rmd(2035, 2),
      },
      {
        a2031: 0,
        a2032: 37_735.85,
        a2033: 37_735.85,
        a2034: 37_582.45,
        a2035: 37_423.88,
        b2033: 0,
        b2034: 0,
        b2035: 20_325.2,
      },
    );
  });
});
