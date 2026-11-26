/**
 * A run with no real account keeps the per-part ledger too: its synthetic
 * parts are drawn, credited and grown, and at every settled point they hold
 * exactly the categories' money and the brokerage's basis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Settled = {
  point: string;
  categories: number;
  parts: number;
  basis: number;
  partsBasis: number;
};
const calls = vi.hoisted(() => [] as Settled[]);
vi.mock(
  "@/lib/pure/engine/projection-year-handlers/settle",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/pure/engine/projection-year-handlers/settle")
      >();
    return {
      ...actual,
      settle: (...args: Parameters<typeof actual.settle>) => {
        const [, state, point] = args;
        actual.settle(...args);
        let categories = 0;
        let basis = 0;
        for (const balance of Object.values(state.accountBalance)) {
          if (balance.structure === "roth_traditional")
            categories += balance.traditional + balance.roth;
          else categories += balance.balance;
          if (balance.structure === "basis_tracking") basis += balance.basis;
        }
        const sum = (m: ReadonlyMap<string, number>) =>
          [...m.values()].reduce((a, v) => a + v, 0);
        calls.push({
          point,
          categories,
          parts: sum(state.indBalance),
          basis,
          partsBasis: sum(state.brokBasis),
        });
      },
    };
  },
);

import { calculateProjection } from "@/lib/pure/engine";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";
import { onePerson } from "../../fixtures/engine-people";
import { engineInput, type FixtureInput } from "../fixtures/engine-input";

const AS_OF = new Date("2025-01-01");
const zeroes = { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 };

/** Simple's shape: no filing status, every rate 0, all the money one
 *  brokerage pot of synthetic parts, saving into it while working. */
function potInput(overrides: Partial<FixtureInput> = {}): ProjectionInput {
  return engineInput(
    withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults({
        accountSplits: { ...zeroes, brokerage: 1 },
      }),
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
        withdrawalSplits: { ...zeroes, brokerage: 1 },
        withdrawalTaxPreference: {},
        distributionTaxRates: {
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0,
          roth: 0,
          hsa: 0,
          brokerage: 0,
        },
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 60,
      people: onePerson(AS_OF.getFullYear() - 60),
      retirementYear: AS_OF.getFullYear() + 3,
      projectionEndYear: AS_OF.getFullYear() + 12,
      currentSalary: 150000,
      salaryGrowthRate: 0.03,
      salaryCap: null,
      salaryOverrides: [],
      budgetOverrides: [],
      irsLimitCaps: capsFromBaseLimits({
        baseLimits: { ...zeroes, "401k": 23500, "403b": 23500, ira: 7000 },
        catchupLimits: { "401k": 7500, ira: 1000, hsa: 1000 },
        currentAge: 60,
      }),
      limitGrowthRate: 0.02,
      employerMatchRateByCategory: zeroes,
      startingBalances: {
        preTax: 0,
        taxFree: 0,
        afterTax: 500000,
        afterTaxBasis: 500000,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 500000,
          basis: 500000,
        },
      },
      annualExpenses: 60000,
      decumulationAnnualExpenses: 60000,
      inflationRate: 0.025,
      returnRates: [{ label: "6%", rate: 0.06 }],
      socialSecurityAnnual: 0,
      ssStartAge: 70,
      asOfDate: AS_OF,
      ...overrides,
    }),
  );
}

describe("a run with no real account", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("keeps its synthetic parts equal to the categories' money and basis at every settled point", () => {
    const result = calculateProjection(potInput());
    expect(
      result.projectionByYear.some((y) => y.phase === "decumulation"),
    ).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    // the parts move: credited while working, grown, drawn once retired
    expect(new Set(calls.map((c) => Math.round(c.parts))).size).toBeGreaterThan(
      2,
    );
    for (const c of calls) {
      expect(Math.round(c.parts * 100), c.point).toBe(
        Math.round(c.categories * 100),
      );
      expect(Math.round(c.partsBasis * 100), c.point).toBe(
        Math.round(c.basis * 100),
      );
    }
    // no real account: no per-account rows, no owner's RMD
    for (const y of result.projectionByYear) {
      expect(y.individualAccountBalances ?? []).toEqual([]);
      if (y.phase === "decumulation") expect(y.rmdByPerson).toBeUndefined();
    }
  });

  it("funds a goal from Portfolio brokerage money as before when nothing overflows", () => {
    const year = AS_OF.getFullYear() + 2;
    const withGoal = (targetAmount: number) =>
      calculateProjection(
        potInput({
          syntheticParents: { brokerage: "Portfolio" },
          accumulationDefaults: makeAccumulationDefaults({
            contributionRate: 0,
          }),
          brokerageGoals: [
            { id: 1, name: "Car", targetAmount, targetYear: year, priority: 1 },
          ],
        }),
      ).projectionByYear.find((y) => y.year === year)!;
    const row = withGoal(20000);
    if (row.phase !== "accumulation") throw new Error("a working year");
    expect(row.brokerageGoalWithdrawals.map((w) => w.amount)).toEqual([20000]);
  });

  it("draws nothing for a goal when none of its money is Portfolio's, as a plan with accounts does", () => {
    const year = AS_OF.getFullYear() + 2;
    const noSaving = makeAccumulationDefaults({ contributionRate: 0 });
    const run = (withGoal: boolean) =>
      calculateProjection(
        potInput({
          accumulationDefaults: noSaving,
          brokerageGoals: withGoal
            ? [
                {
                  id: 1,
                  name: "Car",
                  targetAmount: 20000,
                  targetYear: year,
                  priority: 1,
                },
              ]
            : [],
        }),
      );
    const result = run(true);
    const row = result.projectionByYear.find((y) => y.year === year)!;
    if (row.phase !== "accumulation") throw new Error("a working year");
    expect(row.brokerageGoalWithdrawals.map((w) => w.amount)).toEqual([0]);
    expect(row.warnings).toContain(
      'Brokerage goal "Car" unfunded — insufficient balance',
    );
    // the money stays retirement money
    expect(result.projectionByYear.map((y) => y.retirementBalance)).toEqual(
      run(false).projectionByYear.map((y) => y.retirementBalance),
    );
  });
});
