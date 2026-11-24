/**
 * The settled-point hook: every year calls it once at each of its phase's
 * settled points, in the year's order, and it leaves each tax bucket equal to
 * the sum of the categories' cents in it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AccountBalances,
  TaxBuckets,
} from "@/lib/pure/accounts/account-balances.types";

type Settled = {
  point: string;
  year: number;
  balances: TaxBuckets;
  accountBalance: AccountBalances;
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
        const [state, point] = args;
        actual.settle(...args);
        calls.push({
          point,
          year: state.projectionByYear.length,
          balances: { ...state.balances },
          accountBalance: structuredClone(state.accountBalance),
        });
      },
    };
  },
);

import { getAllCategories } from "@/lib/config/account-types";
import { taxTypeOnSide } from "@/lib/config/tax-treatment-buckets";
import { calculateProjection } from "@/lib/pure/engine";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";
import { onePerson } from "../../fixtures/engine-people";
import { engineInput } from "../fixtures/engine-input";

const AS_OF = new Date("2025-01-01");

function makeInput(): ProjectionInput {
  return engineInput(
    withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults({
        accountSplits: {
          "401k": 0.4,
          "403b": 0,
          hsa: 0.1,
          ira: 0.15,
          brokerage: 0.35,
        },
      }),
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        distributionTaxRates: {
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 60,
      people: onePerson(AS_OF.getFullYear() - 60),
      retirementYear: AS_OF.getFullYear() + 3,
      projectionEndYear: AS_OF.getFullYear() + 8,
      currentSalary: 150000,
      salaryGrowthRate: 0.03,
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
        catchupLimits: {
          "401k": 7500,
          ira: 1000,
          hsa: 1000,
          "401k_super": 11250,
        },
        currentAge: 60,
      }),
      limitGrowthRate: 0.02,
      employerMatchRateByCategory: {
        "401k": 0.03,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      startingBalances: {
        preTax: 110000,
        taxFree: 40000,
        afterTax: 30000,
        afterTaxBasis: 20000,
        hsa: 15000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 80000,
          roth: 20000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 15000 },
        ira: { structure: "roth_traditional", traditional: 30000, roth: 20000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 30000,
          basis: 20000,
        },
      },
      annualExpenses: 72000,
      decumulationAnnualExpenses: 72000,
      inflationRate: 0.025,
      returnRates: [{ label: "7%", rate: 0.07 }],
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      asOfDate: AS_OF,
    }),
  );
}

const ACCUMULATION = [
  "accumulation.contributions",
  "accumulation.gapDraw",
  "accumulation.growth",
  "accumulation.goalDraws",
  "accumulation.beforeReconcile",
];
const DECUMULATION = [
  "decumulation.qcd",
  "decumulation.draws",
  "decumulation.conversion",
  "decumulation.portfolioContributions",
  "decumulation.growth",
  "decumulation.beforeReconcile",
];

describe("settle", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("is called once at each settled point of every year, in the year's order", () => {
    const result = calculateProjection(makeInput());
    const years = result.projectionByYear;
    expect(years.some((y) => y.phase === "accumulation")).toBe(true);
    expect(years.some((y) => y.phase === "decumulation")).toBe(true);
    years.forEach((y, index) => {
      expect(
        calls.filter((c) => c.year === index).map((c) => c.point),
        `${y.year} (${y.phase})`,
      ).toEqual(y.phase === "accumulation" ? ACCUMULATION : DECUMULATION);
    });
    expect(calls).toHaveLength(
      years.reduce(
        (n, y) =>
          n + (y.phase === "accumulation" ? ACCUMULATION : DECUMULATION).length,
        0,
      ),
    );
  });

  it("leaves each tax bucket equal to the sum of the categories' cents in it, at every settled point", () => {
    // At 6.37% the parts' growth rounds to a cent the buckets' own growth
    // doesn't (a Traditional and a Roth cent in the third year).
    calculateProjection({
      ...makeInput(),
      returnRates: [{ label: "Age 60", rate: 0.0637 }],
    });
    expect(calls.length).toBeGreaterThan(0);
    const drifted = calls.flatMap((c) => {
      const held = cents(c.accountBalance);
      return (Object.keys(held) as (keyof TaxBuckets)[])
        .filter(
          (bucket) => Math.round(c.balances[bucket] * 100) !== held[bucket],
        )
        .map(
          (bucket) =>
            `${c.year} ${c.point} ${bucket}: ${c.balances[bucket]} vs ${held[bucket] / 100}`,
        );
    });
    expect(drifted).toEqual([]);
  });
});

/** Each bucket's cents: the sum of what the categories hold in it, rounded
 *  once. */
function cents(
  accountBalance: AccountBalances,
): Record<keyof TaxBuckets, number> {
  const sum = { preTax: 0, taxFree: 0, hsa: 0, afterTax: 0, afterTaxBasis: 0 };
  for (const category of getAllCategories()) {
    const balance = accountBalance[category];
    if (balance.structure === "roth_traditional") {
      sum[taxTypeOnSide(category, "traditional")] += balance.traditional;
      sum[taxTypeOnSide(category, "roth")] += balance.roth;
      continue;
    }
    sum[taxTypeOnSide(category, undefined)] += balance.balance;
    if (balance.structure === "basis_tracking")
      sum.afterTaxBasis += balance.basis;
  }
  for (const bucket of Object.keys(sum) as (keyof TaxBuckets)[])
    sum[bucket] = Math.round(sum[bucket] * 100);
  return sum;
}
