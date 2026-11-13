/**
 * Engine snapshots for the withdrawal strategies that had none.
 *
 * Behavior baseline (v0.10.0): before this file only Guyton-Klinger had
 * engine-snapshot fixtures (engine-snapshot.test.ts, fixtures 32-35 and
 * others), and Fixed Real runs in every fixture that sets no strategy. The
 * seven strategies below ran through the engine nowhere a snapshot could
 * see them. Each test here PINS CURRENT BEHAVIOR, bugs included (the
 * strategy audit's G4, N1 and N2 among them): the snapshot records what
 * the engine produces today, not a checked answer. A change that moves a
 * figure here must say why in its commit; correctness lives in
 * answer-key-strategies.test.ts.
 *
 * One invented household for every strategy, so the snapshots differ only
 * by strategy: a single retiree, 66 in 2026 (born 1960, so RMDs start at
 * 75 in 2035), retired the year before, Social Security of $30,000 from
 * 67, $70,000 a year of spending, 29 projected years (to 2054), a return path
 * with loss years (68, 72-73, 81, 88) so the strategies that react to a
 * loss or a falling balance do. Each strategy runs on its default
 * parameters (no `strategyParams`), so a changed default shows here too.
 *
 * Kept apart from engine-snapshot.test.ts, which is over the file-size
 * limit.
 */
import { describe, expect, it } from "vitest";
import { calculateProjection as runEngine } from "@/lib/pure/engine";
import { recordDrift } from "../fixtures/drift";
import type { AccountBalances } from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import {
  TEST_BRACKETS,
  makeAccountBalances,
  makeAccumulationDefaults,
  makeDecumulationDefaults,
  makeTaxBuckets,
  startingBalanceGaps,
  withConsistentStart,
} from "../fixtures/engine-fixtures";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";

/** Every projection here is checked for indBalance/accountBalance drift (end of file). */
const drift = recordDrift(runEngine);
const calculateProjection = drift.calculate;

const AS_OF = new Date("2026-01-15");
const CURRENT_AGE = 66;

/** Real-looking nominal returns by age, with loss years. */
const RETURN_BY_AGE: Record<number, number> = {
  68: -0.14,
  72: -0.09,
  73: -0.06,
  81: -0.18,
  88: -0.04,
};
const returnRates = Array.from({ length: 31 }, (_, i) => {
  const age = CURRENT_AGE + i;
  return { label: `Age ${age}`, rate: RETURN_BY_AGE[age] ?? 0.065 };
});

/** The household, running `strategy` on its default parameters. */
function retiree(strategy: WithdrawalStrategyType): ProjectionInput {
  // Per-account money written out; the tax buckets follow from it
  // (withConsistentStart).
  const overrides = {
    startingAccountBalances: {
      ...makeAccountBalances(),
      "401k": {
        structure: "roth_traditional",
        traditional: 700000,
        roth: 150000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 200000, roth: 100000 },
      hsa: { structure: "single_bucket", balance: 40000 },
      brokerage: {
        structure: "basis_tracking",
        balance: 300000,
        basis: 180000,
      },
    } satisfies AccountBalances,
  };
  return withConsistentStart(
    withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults(),
      decumulationDefaults: makeDecumulationDefaults({
        withdrawalRoutingMode: "waterfall",
        withdrawalStrategy: strategy,
        distributionTaxRates: {
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          taxBrackets: TEST_BRACKETS,
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      }),
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: CURRENT_AGE,
      birthYear: 1960,
      filingStatus: "Single",
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 29,
      currentSalary: 0,
      salaryGrowthRate: 0,
      salaryCap: null,
      salaryOverrides: [],
      budgetOverrides: [],
      irsLimitCaps: capsFromBaseLimits({
        baseLimits: {
          "401k": 23500,
          "403b": 23500,
          hsa: 4300,
          ira: 7000,
          brokerage: 0,
        },
        currentAge: CURRENT_AGE,
      }),
      limitGrowthRate: 0.02,
      employerMatchRateByCategory: {
        "401k": 0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      startingBalances: makeTaxBuckets(),
      ...overrides,
      annualExpenses: 70000,
      decumulationAnnualExpenses: 70000,
      inflationRate: 0.025,
      returnRates,
      socialSecurityAnnual: 30000,
      ssStartAge: 67,
      asOfDate: AS_OF,
    }),
    overrides,
  );
}

const money = (n: number) => n.toFixed(2);

/** One line per year, so a review reads the whole path at a glance. */
function strategyPath(input: ProjectionInput) {
  const result = calculateProjection(input);
  // The household's starting money agrees with itself.
  expect(startingBalanceGaps(result)).toEqual([]);
  const years = result.projectionByYear.map((y) => {
    const end = `end ${money(y.allAccountsBalance)}`;
    if (y.phase !== "decumulation") return `${y.year} age ${y.age} ${end}`;
    return [
      `${y.year} age ${y.age}`,
      `expenses ${money(y.projectedExpenses)}`,
      `spending ${money(y.spending)}`,
      `withdrawal ${money(y.totalWithdrawal)}`,
      `tax ${money(y.taxCost)}`,
      `ss ${money(y.ssIncome)}`,
      `rmd ${money(y.rmdAmount)}`,
      `action ${y.strategyAction ?? "-"}`,
      end,
    ].join(" | ");
  });
  return {
    sustainableWithdrawal: result.sustainableWithdrawal,
    retirementDepletionYear: result.retirementDepletionYear,
    accountDepletions: result.accountDepletions,
    warningCount: result.warnings.length,
    years,
  };
}

const STRATEGIES: WithdrawalStrategyType[] = [
  "forgo_inflation_after_loss",
  "rmd_spending",
  "spending_decline",
  "constant_percentage",
  "endowment",
  "vanguard_dynamic",
  "vpw",
];

describe("engine snapshots by withdrawal strategy (pins current behavior)", () => {
  it.each(STRATEGIES)("%s: pins current behavior", (strategy) => {
    const path = strategyPath(retiree(strategy));
    // Every year projected, none empty or not a number.
    expect(path.years).toHaveLength(29); // 2026 to the year before 2055
    for (const line of path.years) expect(line).not.toMatch(/NaN|undefined/);
    expect(path).toMatchSnapshot();
  });

  it("each strategy's path differs from Fixed Real's", () => {
    const fixed = strategyPath(retiree("fixed")).years;
    for (const strategy of STRATEGIES)
      expect(strategyPath(retiree(strategy)).years, strategy).not.toEqual(
        fixed,
      );
  });
});

describe("the two balance tracks agree", () => {
  it("no projection above drifts by more than $1 (indBal vs acctBal)", () => {
    expect(drift.byTest.size).toBeGreaterThan(0);
    expect(drift.drifting()).toEqual([]);
  });
});
