/**
 * Answer key, household: net worth, the emergency fund, the FI number and
 * progress, the wealth formula and Coast FIRE (`.scratch/docs/drafts/
 * answer-key.md` § Household math; rulings in `reviews/2026-11-01/
 * rebuild/household-verdicts.md`, worked cases in `reviews/2026-11-01/
 * specs/household-math.md` §§ 5, 7, 9, 13). Ids are the spec's own,
 * prefixed `household/`; the bracketed part is the docs/CALCULATIONS.md
 * row.
 *
 * Every figure is worked by hand, never read from `src/`:
 * - Net worth = everything owned − everything owed (Money Guy, "Net worth
 *   by age, 2025 edition"); at cost, the home is what was paid plus
 *   improvements (same page; S70). Retirement is inside Portfolio and
 *   counted once (DESIGN § Account Categories; S68).
 * - Emergency fund months = balance ÷ essential monthly spending (S86);
 *   no figure at 0 essentials (decision H6: the screen asks for them).
 * - FI number = annual expenses ÷ withdrawal rate, 25× at 4% (Money Guy,
 *   same page; GLOSSARY § FI); progress = liquid (accounts + cash) ÷ FI
 *   number; a future year's target grows with inflation (S107–S109).
 *   Ledgr's FI target is the private `computeFiTarget`, read here through
 *   `calculateNetWorth`.
 * - Wealth formula `(age × income) ÷ (10 + years until 40)` (Money Guy,
 *   "Are you a Prodigious Accumulator of Wealth": the "enhanced
 *   Millionaire Next Door calculation"; verdict G5).
 * - Coast FIRE reads retirement money only (DESIGN § Account Categories;
 *   S154).
 *
 * Blocked: FI-FINAL ("a finalized year keeps the FI target it had") needs
 * a stored target column; the `it.todo` at the end. Decision H6's spec
 * cases C85–C93 aren't run yet and stay out of the key.
 *
 * Inputs: invented households.
 */
import { describe, expect, it } from "vitest";
import { cents, xfail } from "../../fixtures/answer-key";
import { calculateNetWorth } from "@/lib/pure/net-worth/net-worth";
import { calculateEFund } from "@/lib/pure/savings/efund";
import { findCoastFireAge } from "@/lib/pure/retirement/coast-fire";
import { computePortfolioTotal } from "@/lib/pure/investments/returns";
import { inflateTarget } from "@/lib/pure/advice/milestones/milestones.shared";
import type { NetWorthInput } from "@/lib/pure/net-worth/net-worth.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import {
  withConsistentStart,
  makeAccumulationDefaults,
} from "../fixtures/engine-fixtures";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";

const AS_OF = new Date("2026-06-01T12:00:00Z");

/** Nothing owned or owed; age 40 on 100,000; 80,000 of expenses at 4%. */
const nothing: NetWorthInput = {
  portfolioTotal: 0,
  cash: 0,
  homeValueEstimated: 0,
  homeValueConservative: 0,
  otherAssets: 0,
  mortgageBalance: 0,
  otherLiabilities: 0,
  averageAge: 40,
  effectiveIncome: 100_000,
  lifetimeEarnings: 1_000_000,
  annualExpenses: 80_000,
  withdrawalRate: 0.04,
  asOfDate: AS_OF,
};
const netWorth = (v: Partial<NetWorthInput>) =>
  calculateNetWorth({ ...nothing, ...v });

/** C64's household: cash 20,000; accounts 500,000; home 400,000 at market
 *  (300,000 paid + 25,000 of improvements); car 30,000; mortgage 250,000;
 *  a 10,000 loan. */
const C64: Partial<NetWorthInput> = {
  cash: 20_000,
  portfolioTotal: 500_000,
  homeValueEstimated: 400_000,
  homeValueConservative: 300_000 + 25_000,
  otherAssets: 30_000,
  mortgageBalance: 250_000,
  otherLiabilities: 10_000,
};

describe("household: net worth", () => {
  it("household/C64 [HH-22] owned 950,000, owed 260,000: 690,000", () => {
    // 20,000 + 500,000 + 400,000 + 30,000 = 950,000; 250,000 + 10,000 =
    // 260,000; 950,000 − 260,000 = 690,000.
    cents(netWorth(C64).netWorthMarket, 690_000);
  });

  it("household/C65 [HH-22] the home at cost (300,000 + 25,000): 615,000", () => {
    // The home counts 325,000, not 400,000: 690,000 − 75,000 = 615,000.
    cents(netWorth(C64).netWorthCostBasis, 615_000);
  });

  it("household/C67 [HH-22] cash 5,000, student loans 60,000: −55,000", () => {
    cents(
      netWorth({ cash: 5_000, otherLiabilities: 60_000 }).netWorthMarket,
      -55_000,
    );
  });

  it("household/C68 [HH-22] accounts of 500,000, 350,000 of them Retirement: 500,000, not 850,000", () => {
    // A Retirement 401(k) of 350,000 and a Portfolio brokerage of 150,000:
    // Portfolio is every account, Retirement a part of it, so the total is
    // 350,000 + 150,000 = 500,000 (S68).
    const portfolioTotal = computePortfolioTotal([
      { endingBalance: "350000" },
      { endingBalance: "150000" },
    ]);
    cents(netWorth({ portfolioTotal }).netWorthMarket, 500_000);
  });

  it("household/C69 [HH-22] C64's liquid net worth: 520,000", () => {
    // Accounts + cash, no home and no car: 500,000 + 20,000 = 520,000
    // (S69). Read as FI progress's numerator: at 52,000 of expenses and 4%
    // the FI number is 1,300,000, and 520,000 / 1,300,000 = 40%.
    const r = netWorth({ ...C64, annualExpenses: 52_000 });
    cents(r.fiTarget, 1_300_000);
    cents(r.fiProgress, 0.4, 0.00005);
  });
});

describe("household: the emergency fund", () => {
  const months = (fund: number, essentials: number) =>
    calculateEFund({
      emergencyFundBalance: fund,
      outstandingSelfLoans: 0,
      essentialMonthlyExpenses: essentials,
      targetMonths: 3,
      asOfDate: AS_OF,
    });

  it("household/C81 [HH-33] 30,000 on 5,000 a month: 6.0 months", () => {
    // 30,000 / 5,000 = 6.
    expect(months(30_000, 5_000).monthsCovered).toBe(6);
  });

  it("household/C82 [HH-33] 12,500: 2.5 months, below 3", () => {
    // 12,500 / 5,000 = 2.5; against Money Guy's and Ramsey's 3–6 months
    // it's 3 × 5,000 − 12,500 = 2,500 short.
    const r = months(12_500, 5_000);
    expect(r.monthsCovered).toBe(2.5);
    cents(r.neededAfterRepay, 2_500);
  });

  it("household/C83e [HH-33] 15,000: 3.0 months, the bottom of 3–6", () => {
    // 15,000 / 5,000 = 3; nothing more needed for 3 months.
    const r = months(15_000, 5_000);
    expect(r.monthsCovered).toBe(3);
    cents(r.neededAfterRepay, 0);
  });

  it("household/C84 [HH-33] 10,000 with essentials 0: no figure", () => {
    // Decision H6: months on 0 essentials has no value; the screen prompts
    // to set essentials.
    expect(months(10_000, 0).monthsCovered).toBeNull();
  });
});

describe("household: the FI number and progress", () => {
  it("household/C97 [HH-26] expenses 80,000 at 4%: 2,000,000", () => {
    // 80,000 / 0.04 = 2,000,000 (25×).
    cents(netWorth({}).fiTarget, 2_000_000);
  });

  it("household/C98 [HH-26] expenses 80,000 at 3.5%: 2,285,714.29", () => {
    // 80,000 / 0.035 = 2,285,714.2857.
    cents(netWorth({ withdrawalRate: 0.035 }).fiTarget, 2_285_714.29);
  });

  it("household/C99 [HH-26] liquid 500,000 against 2,000,000: 25.00%", () => {
    // 500,000 / 2,000,000 = 25%.
    cents(netWorth({ portfolioTotal: 500_000 }).fiProgress, 0.25, 0.00005);
  });

  it("household/C100 [HH-26] C99's target in 10 years at 3% inflation: 2,687,832.76", () => {
    // 2,000,000 × 1.03^10 = 2,000,000 × 1.3439164 = 2,687,832.76 (S109).
    const target = netWorth({}).fiTarget;
    cents(inflateTarget(target, 2026, 2036, 0.03), 2_687_832.76);
  });

  xfail({
    id: "household/T1 [HH-26]",
    todo: 'v0.11 Household math "One `fiTarget` in `lib/pure`" (decisions H1 and "FI target = (Retirement budget − Social Security) ÷ the FI rate")',
    // Budget 120,000; Retirement budget 90,000; Social Security 40,000; FI
    // rate 4% (its own setting): (90,000 − 40,000) / 0.04 = 1,250,000.
    // Today the caller (`server/services/net-worth/year-end-history.ts`) passes the Budget and
    // the Initial Withdrawal Rate: 120,000 / 0.04 = 3,000,000. The fix
    // gives the FI target its own inputs; this run changes with it.
    run: () =>
      netWorth({ annualExpenses: 120_000, withdrawalRate: 0.04 }).fiTarget,
    expected: 1_250_000,
    today: 3_000_000,
  });

  it.todo(
    'household/FI-FINAL: blocked on v0.11 Household math "One `fiTarget` in `lib/pure`" (a stored FI target per finalized year)',
  );
});

describe("household: the wealth formula (Money Guy)", () => {
  /** Expected net worth = net worth ÷ the score. */
  const expectedNetWorth = (age: number, income: number) => {
    const r = netWorth({
      cash: 100_000,
      averageAge: age,
      effectiveIncome: income,
    });
    return 100_000 / r.aawScoreMarket;
  };

  it("household/C105 [HH-25] age 40 on 50,000: 200,000", () => {
    // (40 × 50,000) / (10 + 0) = 200,000; from 40 on it's the book's
    // age × income ÷ 10.
    cents(expectedNetWorth(40, 50_000), 200_000);
  });

  it("household/C105-30 [HH-25] age 30 on 50,000: 75,000", () => {
    // (30 × 50,000) / (10 + 10) = 75,000: Money Guy's years-until-40 term.
    cents(expectedNetWorth(30, 50_000), 75_000);
  });
});

describe("household: Coast FIRE reads retirement money only", () => {
  /** Age 40, a Roth 401(k) of 100,000 (Retirement) taking 20% of a
   *  100,000 salary, 7% a year, no inflation or Social Security, retiring
   *  at 65 and planned to 95 on 60,000 a year; plus `portfolio` dollars in
   *  a Portfolio brokerage that takes no contributions. */
  function household(portfolio: number): ProjectionInput {
    const accounts = {
      "401k": {
        structure: "roth_traditional" as const,
        traditional: 0,
        roth: 100_000,
      },
      "403b": {
        structure: "roth_traditional" as const,
        traditional: 0,
        roth: 0,
      },
      hsa: { structure: "single_bucket" as const, balance: 0 },
      ira: { structure: "roth_traditional" as const, traditional: 0, roth: 0 },
      brokerage: {
        structure: "basis_tracking" as const,
        balance: portfolio,
        basis: portfolio,
      },
    };
    const balances = {
      preTax: 0,
      taxFree: 100_000,
      afterTax: portfolio,
      afterTaxBasis: portfolio,
      hsa: 0,
    };
    const owner = {
      ownerName: "Owner",
      ownerPersonId: 1,
      ownerBirthYear: 1986,
    };
    return withConsistentStart(
      withCapsAge({
        accumulationDefaults: makeAccumulationDefaults({
          contributionRate: 0.2,
          accountSplits: { "401k": 1, "403b": 0, hsa: 0, ira: 0, brokerage: 0 },
          taxSplits: { "401k": 0, ira: 0 },
        }),
        decumulationDefaults: {
          withdrawalRate: 0.04,
          withdrawalRoutingMode: "waterfall",
          withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
          withdrawalSplits: {
            "401k": 1,
            "403b": 0,
            ira: 0,
            brokerage: 0,
            hsa: 0,
          },
          withdrawalTaxPreference: { "401k": "roth", ira: "roth" },
          distributionTaxRates: {
            ...shippedTaxTables(),
            traditionalFallbackRate: 0,
            roth: 0,
            hsa: 0,
            brokerage: 0,
          },
        },
        accumulationOverrides: [],
        decumulationOverrides: [],
        currentAge: 40,
        retirementYear: 2026 + 25,
        projectionEndYear: 2026 + 55,
        currentSalary: 100_000,
        salaryGrowthRate: 0,
        salaryCap: null,
        salaryOverrides: [],
        budgetOverrides: [],
        irsLimitCaps: capsFromBaseLimits({
          baseLimits: {
            "401k": 10_000_000,
            "403b": 0,
            hsa: 0,
            ira: 0,
            brokerage: 0,
          },
          catchupLimits: {},
          currentAge: 40,
        }),
        limitGrowthRate: 0,
        employerMatchRateByCategory: {
          "401k": 0,
          "403b": 0,
          hsa: 0,
          ira: 0,
          brokerage: 0,
        },
        startingBalances: balances,
        startingAccountBalances: accounts,
        annualExpenses: 60_000,
        inflationRate: 0,
        returnRates: [{ label: "7%", rate: 0.07 }],
        socialSecurityAnnual: 0,
        ssStartAge: 67,
        asOfDate: new Date("2026-01-01T12:00:00Z"),
        individualAccounts: [
          {
            name: "Roth 401k",
            category: "401k",
            taxType: "taxFree",
            startingBalance: 100_000,
            parentCategory: "Retirement",
            ...owner,
          },
          ...(portfolio > 0
            ? [
                {
                  name: "Brokerage",
                  category: "brokerage" as const,
                  taxType: "afterTax",
                  startingBalance: portfolio,
                  startingBasis: portfolio,
                  parentCategory: "Portfolio",
                  ...owner,
                },
              ]
            : []),
        ],
      }),
      { startingBalances: balances, startingAccountBalances: accounts },
    );
  }

  it("household/C154 [ENG-30] 1,000,000 of Portfolio money doesn't move the Coast age", () => {
    // S154: Portfolio money is never retirement money, so the earliest
    // stop age is the same with or without it. The spec's closed-form
    // "year 6" is a different metric from Ledgr's engine-judged
    // Coast age (verdict G9, owner design), so the property is what's
    // asserted, on a household whose Coast age is found, not already met.
    const without = findCoastFireAge(household(0));
    const withPortfolio = findCoastFireAge(household(1_000_000));
    expect(without.status).toBe("found");
    expect(withPortfolio.status).toBe(without.status);
    expect(withPortfolio.coastFireAge).toBe(without.coastFireAge);
  });
});
