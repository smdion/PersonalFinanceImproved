/**
 * Answer key, the decided engine behaviors (DECISIONS § November review
 * decisions, D1–D12; the pending-decisions table's D2, D6 and the EN3
 * todo item), written before their fixes as expected failures naming the
 * release and item (`v0.11.1 <ITEM>`). Each figure is worked by hand
 * beside it from the decision's text and the invented household.
 *
 * Household (`tests/pure/fixtures/two-person-household.ts`): Ann 78 (born
 * 1948), Bo 65 (born 1961), MFJ; as of 2026-03-07; flat 0% returns and no
 * inflation, so balances read straight; a flat 20% on taxable income
 * (`traditionalFallbackRate`), so a need N is a draw of N ÷ 0.8.
 *
 * Year 0's share (`context.ts`, ENG-05): as of March 7 (day ≤ 15, March
 * still to come) leaves 10 of 12 months, 10/12 of the year.
 *
 * Elsewhere: D1's case is strategies/N3 in `answer-key-routing.test.ts`;
 * LM3Y's (year 0 by checks left for a job held all year) is in
 * `tests/server/services/contributions/cap-pass.test.ts`.
 *
 * The D4, D12.x and D12.18 cases below read year 1 (2027), clear of year
 * 0's share (D2), unless a case says otherwise.
 */
import { describe } from "vitest";
import { xfail } from "../../fixtures/answer-key";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  EngineYearProjection,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { acct, household } from "../fixtures/two-person-household";

const D2 = `v0.11.1 EN2 D2 "Prorate year-0 spending and contributions alike" (decision D2, UD-01)`;
const EN3 = `v0.11.1 EN3 "Retirement year = this year with no earner runs year 0 as accumulation"`;
const D6 = `v0.11.1 EN2 D6 "Income above spending is reinvested in a taxable brokerage" (decision D6, UD-03)`;
const D4 = `v0.11.1 EN2 D4 "Conversion tax from brokerage first, never Roth; a short brokerage shrinks the conversion" (decision D4, UD-08)`;
const D12_2 = `v0.11.1 EN2 D12.2 "Contribution limits grow by IRS indexing, rounded down by each limit's rule" (decision D12.2, UD-12)`;
const D12_3 = `v0.11.1 EN2 D12.3 "Social Security starts in the claim month" (decision D12.3, UD-13)`;
const D12_8 = `v0.11.1 EN2 D12.8 "A goal draw is grossed up for its tax from the same brokerage" (decision D12.8, UD-20)`;
const D12_9 = `v0.11.1 EN2 D12.9 "Indexed tax figures grow year by year with IRS rounding" (decision D12.9, UD-22)`;
const D12_10 = `v0.11.1 EN2 D12.10 "The salary cap is a ceiling in today's dollars" (decision D12.10, UD-23)`;
const D12_16 = `v0.11.1 EN2 D12.16 "The tax multiplier scales income tax, above 1 too" (decision D12.16, UD-29)`;
const D12_18 = `v0.11.1 EN2 D12.18 "A lump sum in retirement covers the year's need first" (decision D12.18, UD-31)`;

const IRA = () => [acct("Traditional IRA", "ira", 1_000_000, 1)];

function years(
  overrides: Parameters<typeof household>[1],
  accounts = IRA(),
  decumulation: Parameters<typeof household>[2] = {},
): EngineYearProjection[] {
  return calculateProjection(household(accounts, overrides, decumulation))
    .projectionByYear;
}

/** The fixture's distribution tax rates with `changes` on top. */
function taxRates(
  changes: Partial<
    ProjectionInput["decumulationDefaults"]["distributionTaxRates"]
  >,
): Partial<ProjectionInput["decumulationDefaults"]> {
  return {
    distributionTaxRates: {
      ...household([]).decumulationDefaults.distributionTaxRates,
      ...changes,
    },
  };
}

/** Year `year`'s row, which must be a retirement year. */
function retiredRow(ys: EngineYearProjection[], year: number) {
  const y = ys.find((r) => r.year === year);
  if (y?.phase !== "decumulation") throw new Error(`${year} isn't retired`);
  return y;
}

/** Year `year`'s row, which must be a working year. */
function workingRow(ys: EngineYearProjection[], year: number) {
  const y = ys.find((r) => r.year === year);
  if (y?.phase !== "accumulation") throw new Error(`${year} isn't working`);
  return y;
}

/** Ann working until 2035 (the fixture's people, a salary and no saving). */
const WORKING = { retirementYear: 2035, currentSalary: 100_000 };

describe("answer key: year 0 of a retired household (decision D2)", () => {
  // Retired since 2013, need 40,000. D2: year 0 spends the year's
  // remaining share, 40,000 × 10/12 = 33,333.33; at the flat 20% the draw
  // is 33,333.33 ÷ 0.8 = 41,666.67, which covers the year's RMD
  // (1,000,000 ÷ 24.1 = 41,493.78, Pub 590-B Table II, owner 78 and
  // spouse 65), so no RMD top-up. Today year 0 spends the whole year.
  xfail({
    id: "engine/D2-retired [ENG-05]",
    todo: D2,
    run: () => {
      const y0 = years({ decumulationAnnualExpenses: 40_000 })[0]!;
      if (y0.phase !== "decumulation") throw new Error("year 0 isn't retired");
      return { spending: y0.projectedExpenses, draw: y0.totalWithdrawal };
    },
    expected: { spending: 33_333.33, draw: 41_666.67 },
    today: { spending: 40_000, draw: 50_000 },
  });
});

describe("answer key: retiring this year with no earner (EN3)", () => {
  // Retirement year 2026 = year 0, nobody earns (no salary). The year is a
  // retirement year: it takes its draw and its RMD, which is a whole year's
  // (the law sizes it from last Dec 31's balance and never prorates it):
  // 1,000,000 ÷ 24.1 = 41,493.78 (Pub 590-B Table II, owner 78, spouse 65).
  // Today year 0 runs as a working year: no draw and no RMD.
  xfail({
    id: "engine/EN3 [ENG-04]",
    todo: EN3,
    run: () => {
      const y0 = years({
        decumulationAnnualExpenses: 40_000,
        retirementYear: 2026,
      })[0]!;
      return {
        retired: y0.phase === "decumulation" ? 1 : 0,
        rmd: y0.phase === "decumulation" ? y0.rmdAmount : 0,
      };
    },
    expected: { retired: 1, rmd: 41_493.78 },
    today: { retired: 0, rmd: 0 },
  });
});

describe("answer key: Social Security above the need (decision D6)", () => {
  // Roth IRA 1,000,000 only (no RMD); Ann's Social Security 100,000 a year
  // (claimed), need 60,000. Taxable Social Security (Pub 915 Worksheet 1,
  // MFJ): provisional income 0.5 × 100,000 = 50,000; 0.5 × (50,000 −
  // 32,000) = 9,000 capped at 6,000, plus 0.85 × (50,000 − 44,000) = 5,100:
  // 11,100. Its tax at the flat 20%: 2,220. D6: spending is the need,
  // 60,000, and the rest, 100,000 − 60,000 − 2,220 = 37,780, is reinvested
  // in a taxable brokerage. Read in 2027 (year 1), clear of year 0's share.
  // Today the whole 97,780 after tax counts as spent and nothing is kept.
  xfail({
    id: "engine/D6 [ENG-25]",
    todo: D6,
    run: () => {
      const ys = years(
        {
          annualExpenses: 60_000,
          decumulationAnnualExpenses: 60_000,
          socialSecurityEntries: [
            {
              personId: 1,
              personName: "Ann",
              birthYear: 1948,
              startAge: 70,
              annualAmount: 100_000,
            },
            {
              personId: 2,
              personName: "Bo",
              birthYear: 1961,
              startAge: 70,
              annualAmount: 0,
            },
          ],
        },
        [acct("Roth IRA", "ira", 1_000_000, 1, "taxFree")],
      );
      const [y0, y1] = [ys[0]!, ys[1]!];
      if (y1.phase !== "decumulation") throw new Error("2027 isn't retired");
      return {
        spending: y1.spending,
        reinvested: y1.balanceByTaxType.afterTax - y0.balanceByTaxType.afterTax,
      };
    },
    expected: { spending: 60_000, reinvested: 37_780 },
    today: { spending: 97_780, reinvested: 0 },
  });
});

describe("answer key: a brokerage too small for the conversion's tax (decision D4)", () => {
  // Bo (65, no RMD) holds a Traditional IRA 400,000, a Roth IRA 100,000
  // and a brokerage 5,000 (all basis, so selling it realizes no gain).
  // Invented brackets: 10% up to 500,000, 37% above; conversions on, to
  // the 10% bracket. Read in 2026, the first year that converts (D2's
  // share changes the draw, not this): the room to 500,000 is far more
  // than the brokerage's 5,000 can pay 10% on. D4: the tax comes from the
  // brokerage, never the Roth, and a short brokerage shrinks the
  // conversion to what it can pay: 5,000 ÷ 10% = 50,000 converted, all
  // 5,000 of brokerage spent. Today the whole conversion is skipped when
  // the brokerage can't pay all of its tax (`roth-conversion.ts`, "skip
  // conversion").
  xfail({
    id: "engine/D4 [RET-11]",
    todo: D4,
    run: () => {
      const y0 = retiredRow(
        years(
          {},
          [
            acct("Bo IRA", "ira", 400_000, 2),
            acct("Bo Roth IRA", "ira", 100_000, 2, "taxFree"),
            acct("Bo brokerage", "brokerage", 5_000, 2, "afterTax"),
          ],
          taxRates({
            taxBrackets: [
              { threshold: 0, baseWithholding: 0, rate: 0.1 },
              { threshold: 500_000, baseWithholding: 50_000, rate: 0.37 },
            ],
            enableRothConversions: true,
            rothConversionTarget: 0.1,
          }),
        ),
        2026,
      );
      return {
        converted: y0.rothConversionAmount,
        conversionTax: y0.rothConversionTaxCost,
        brokerage: y0.balanceByTaxType.afterTax,
      };
    },
    expected: { converted: 50_000, conversionTax: 5_000, brokerage: 0 },
    today: { converted: 0, conversionTax: 0, brokerage: 5_000 },
  });
});

describe("answer key: limits grown into 2027 (decision D12.2)", () => {
  // Ann (78, catch-up eligible) works until 2035 on 200,000 and saves all
  // of it, so each limit binds. The fixture's limits: 401(k) 23,500 plus
  // the 7,500 catch-up; IRA 7,000 plus 1,000; grown 3% a year. D12.2:
  // grow with the plan's rate, then round down as each limit's rule says:
  // 401(k) 23,500 × 1.03 = 24,205 → 24,000 (IRC § 402(g)(4), $500
  // multiples), catch-up 7,500 × 1.03 = 7,725 → 7,500 (§ 414(v)(2)(C),
  // $500): 31,500. IRA 7,000 × 1.03 = 7,210 → 7,000 (§ 219(b)(5)(C)(i),
  // $500), catch-up 1,000 × 1.03 = 1,030 → 1,000 (§ 219(b)(5)(C)(iii),
  // $100): 8,000. Today each grows unrounded: 31,930 and 8,240. (The
  // HSA is left out: its 1,000 catch-up is fixed by § 223(b)(3)(B), and
  // D12.2's "grow the catch-ups" doesn't say whether that one grows.)
  xfail({
    id: "engine/D12.2 [LIM-27]",
    todo: D12_2,
    run: () => {
      const h = household([acct("Ann 401k", "401k", 100_000, 1)], {
        ...WORKING,
        currentSalary: 200_000,
        limitGrowthRate: 0.03,
      });
      const ys = calculateProjection({
        ...h,
        accumulationDefaults: {
          ...h.accumulationDefaults,
          contributionRate: 1,
        },
      }).projectionByYear;
      const limit = (category: string) =>
        workingRow(ys, 2027).slots.find((s) => s.category === category)!
          .irsLimit;
      return { k401: limit("401k"), ira: limit("ira") };
    },
    expected: { k401: 31_500, ira: 8_000 },
    today: { k401: 31_930, ira: 8_240 },
  });
});

describe("answer key: Social Security's first year (decision D12.3)", () => {
  // Bo, born July 1961, claims 24,000 a year at 67: July 2028. D12.3:
  // paid from the claim month, so 2028 gets July–December, 24,000 × 6/12
  // = 12,000, and 2029 the whole 24,000 (no inflation). Today the whole
  // year from the year he turns 67.
  xfail({
    id: "engine/D12.3 [RET-32]",
    todo: D12_3,
    run: () => {
      const ys = years(
        {
          socialSecurityEntries: [
            {
              personId: 1,
              personName: "Ann",
              birthYear: 1948,
              startAge: 70,
              annualAmount: 0,
            },
            {
              personId: 2,
              personName: "Bo",
              birthYear: 1961,
              startAge: 67,
              annualAmount: 24_000,
            },
          ],
          people: [
            { personId: 1, birthYear: 1948, birthMonth: 1 },
            { personId: 2, birthYear: 1961, birthMonth: 7 },
          ],
        },
        [acct("Roth IRA", "ira", 1_000_000, 1, "taxFree")],
      );
      return {
        ss2028: retiredRow(ys, 2028).ssIncome,
        ss2029: retiredRow(ys, 2029).ssIncome,
      };
    },
    expected: { ss2028: 12_000, ss2029: 24_000 },
    today: { ss2028: 24_000, ss2029: 24_000 },
  });
});

describe("answer key: a goal draw's tax (decision D12.8)", () => {
  // Ann works until 2035; a Portfolio brokerage of 100,000 with basis
  // 50,000 (half of any sale is gain) funds a 10,000 goal in 2027, gains
  // at the fixture's flat 15%. D12.8: the draw is grossed up from the same
  // brokerage so the goal gets its 10,000 after tax: 10,000 ÷ (1 − 0.5 ×
  // 0.15) = 10,810.81, its tax 10,810.81 × 0.5 × 0.15 = 810.81, and the
  // brokerage ends 2027 at 89,189.19. Today it draws 10,000, reports 750
  // of tax and pays none of it.
  xfail({
    id: "engine/D12.8 [ENG-14]",
    todo: D12_8,
    run: () => {
      const brokerage = {
        ...acct("Ann brokerage", "brokerage", 100_000, 1, "afterTax"),
        parentCategory: "Portfolio",
        startingBasis: 50_000,
      };
      const y = workingRow(
        years(
          {
            ...WORKING,
            brokerageGoals: [
              {
                id: 1,
                name: "Car",
                targetAmount: 10_000,
                targetYear: 2027,
                priority: 1,
              },
            ],
          },
          [acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"), brokerage],
        ),
        2027,
      );
      return {
        brokerage: y.balanceByTaxType.afterTax,
        taxCost: y.brokerageGoalWithdrawals[0]!.taxCost,
      };
    },
    expected: { brokerage: 89_189.19, taxCost: 810.81 },
    today: { brokerage: 90_000, taxCost: 750 },
  });
});

describe("answer key: the standard deduction grown into 2027 (decision D12.9)", () => {
  // A 2026 standard deduction of 32,200 (MFJ, the 2026 tax data), grown
  // at 3% inflation (no 65+ add-on in this fixture). D12.9: grow year by
  // year from the latest published year with the figure's IRS rounding:
  // 32,200 × 1.03 = 33,166, an increase of 966 rounded down to a multiple
  // of $50 (IRC § 63(c)(4)): 33,150. Today it grows unrounded, 33,166.
  xfail({
    id: "engine/D12.9 [TAX-23]",
    todo: D12_9,
    run: () =>
      retiredRow(
        years(
          { inflationRate: 0.03 },
          [acct("Roth IRA", "ira", 1_000_000, 1, "taxFree")],
          taxRates({ standardDeduction: 32_200, taxDataYear: 2026 }),
        ),
        2027,
      ).standardDeduction ?? NaN,
    expected: 33_150,
    today: 33_166,
  });
});

describe("answer key: the salary cap in today's dollars (decision D12.10)", () => {
  // Ann earns 100,000, raised 5% a year (none in year 0, which D12.10
  // also decides and today already does), capped at 105,000 in today's
  // dollars; inflation 3%. D12.10: the cap is a ceiling in today's
  // dollars, so it grows one year of inflation a year from year 0
  // (D12.11's index). 2028: 100,000 × 1.05² = 110,250 under the cap's
  // 105,000 × 1.03² = 111,394.50; 2029: 115,762.50 over the cap's
  // 105,000 × 1.03³ = 114,736.34. Today the cap is nominal: 105,000 from
  // 2027 on.
  xfail({
    id: "engine/D12.10 [ENG-08]",
    todo: D12_10,
    tolerance: 0.01,
    run: () => {
      const ys = years(
        {
          ...WORKING,
          salaryGrowthRate: 0.05,
          salaryCap: 105_000,
          inflationRate: 0.03,
        },
        [acct("Roth IRA", "ira", 1_000_000, 1, "taxFree")],
      );
      return {
        s2028: workingRow(ys, 2028).projectedSalary,
        s2029: workingRow(ys, 2029).projectedSalary,
      };
    },
    expected: { s2028: 110_250, s2029: 114_736.34 },
    today: { s2028: 105_000, s2029: 105_000 },
  });
});

describe("answer key: a tax multiplier above 1 (decision D12.16)", () => {
  // Bo's Traditional IRA (65, no RMD) funds a 40,000 need; invented
  // brackets, one 37% rate on every dollar; tax multiplier 1.4 (a stand-in
  // for state tax). D12.16: the multiplier scales income tax, 37% × 1.4 =
  // 51.8%, and the gross-up handles it: 40,000 ÷ (1 − 0.518) = 82,987.55
  // drawn, 42,987.55 of tax. Today the effective rate is capped at 50%
  // (`MAX_EFFECTIVE_TAX_RATE`): 80,000 drawn, 40,000 of tax.
  xfail({
    id: "engine/D12.16 [TAX-13]",
    todo: D12_16,
    run: () => {
      const y1 = retiredRow(
        years(
          {},
          [acct("Bo IRA", "ira", 1_000_000, 2)],
          taxRates({
            taxBrackets: [{ threshold: 0, baseWithholding: 0, rate: 0.37 }],
            taxMultiplier: 1.4,
          }),
        ),
        2027,
      );
      return { draw: y1.totalWithdrawal, tax: y1.taxCost };
    },
    expected: { draw: 82_987.55, tax: 42_987.55 },
    today: { draw: 80_000, tax: 40_000 },
  });
});

describe("answer key: a lump sum in a retirement year (decision D12.18)", () => {
  // Roth IRA 1,000,000 only (no RMD, no tax), need 40,000; a 30,000 lump
  // sum (no tax type: not taxable, D12.18's default) arrives in 2027 for
  // the brokerage. D12.18: an inflow covers the year's need first, so the
  // Roth draws only 40,000 − 30,000 = 10,000, and nothing is left to
  // reinvest. Today the lump sum is deposited (the brokerage ends 2027 at
  // 30,000) and the Roth still draws the whole 40,000. (D12.18's outflow
  // half has no input yet: a lump sum's amount is positive.)
  xfail({
    id: "engine/D12.18 [ENG-13]",
    todo: D12_18,
    run: () => {
      const y1 = retiredRow(
        years(
          {
            decumulationOverrides: [
              {
                year: 2027,
                lumpSums: [{ amount: 30_000, targetAccount: "brokerage" }],
              },
            ],
          },
          [acct("Roth IRA", "ira", 1_000_000, 1, "taxFree")],
        ),
        2027,
      );
      return {
        draw: y1.totalWithdrawal,
        brokerage: y1.balanceByTaxType.afterTax,
      };
    },
    expected: { draw: 10_000, brokerage: 0 },
    today: { draw: 40_000, brokerage: 30_000 },
  });
});
