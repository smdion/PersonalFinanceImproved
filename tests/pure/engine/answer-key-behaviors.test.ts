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
 */
import { describe } from "vitest";
import { xfail } from "../../fixtures/answer-key";
import { calculateProjection } from "@/lib/pure/engine";
import type { EngineYearProjection } from "@/lib/pure/engine/types";
import { acct, household } from "../fixtures/two-person-household";

const D2 = `v0.11.1 EN2 D2 "Prorate year-0 spending and contributions alike" (decision D2, UD-01)`;
const EN3 = `v0.11.1 EN3 "Retirement year = this year with no earner runs year 0 as accumulation"`;
const D6 = `v0.11.1 EN2 D6 "Income above spending is reinvested in a taxable brokerage" (decision D6, UD-03)`;

const IRA = () => [acct("Traditional IRA", "ira", 1_000_000, 1)];

function years(
  overrides: Parameters<typeof household>[1],
  accounts = IRA(),
): EngineYearProjection[] {
  return calculateProjection(household(accounts, overrides)).projectionByYear;
}

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
