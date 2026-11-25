/**
 * A brokerage draw takes out of its category exactly the basis its accounts
 * gave up: the gap between the categories' basis and their accounts' basis
 * doesn't move across a flow that draws or reinvests brokerage money.
 */
import { describe, it, expect, vi } from "vitest";

type Point = { point: string; year: number; basis: number; gap: number };
const points = vi.hoisted(() => [] as Point[]);
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
        let basis = 0;
        for (const balance of Object.values(state.accountBalance))
          if (balance.structure === "basis_tracking") basis += balance.basis;
        let gap = basis;
        for (const held of state.brokBasis.values()) gap -= held;
        points.push({
          point,
          year: state.projectionByYear.length,
          basis,
          gap: Math.round(gap * 100),
        });
      },
    };
  },
);

import { calculateProjection } from "@/lib/pure/engine";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";
import { onePerson } from "../../fixtures/engine-people";
import { engineInput, type FixtureInput } from "../fixtures/engine-input";
import { household } from "../fixtures/two-person-household";

const AS_OF = new Date("2025-03-07");
const owner = {
  ownerName: "Alice",
  ownerPersonId: 1,
  parentCategory: "Retirement",
};

/** Four Retirement brokerages at basis ratios from 0 to about 1.67, drawn
 *  every retired year, so each account's basis out rounds on its own. */
function accounts(): IndividualAccountInput[] {
  return [
    {
      name: "401k",
      category: "401k",
      taxType: "preTax",
      startingBalance: 80000,
      ...owner,
    },
    {
      name: "HSA",
      category: "hsa",
      taxType: "hsa",
      startingBalance: 15000,
      ...owner,
    },
    {
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
      startingBalance: 150000,
      ...owner,
    },
    ...[
      [100003.37, 100003.37],
      [99996.63, 0],
      [50000.01, 16666.67],
      [49999.99, 83329.96],
    ].map(([startingBalance, startingBasis], i) => ({
      name: `Brokerage ${i + 1}`,
      category: "brokerage" as const,
      taxType: "afterTax" as const,
      startingBalance: startingBalance!,
      startingBasis: startingBasis!,
      ...owner,
    })),
  ];
}

function makeInput(overrides: Partial<FixtureInput> = {}): ProjectionInput {
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
        withdrawalRoutingMode: "percentage",
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
      retirementYear: AS_OF.getFullYear() + 1,
      projectionEndYear: AS_OF.getFullYear() + 15,
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
        preTax: 80000,
        taxFree: 150000,
        afterTax: 300000,
        afterTaxBasis: 200000,
        hsa: 15000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 80000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 15000 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 150000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 300000,
          basis: 200000,
        },
      },
      annualExpenses: 72000,
      decumulationAnnualExpenses: 72000,
      inflationRate: 0.025,
      returnRates: [{ label: "7%", rate: 0.07 }],
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      asOfDate: AS_OF,
      individualAccounts: accounts(),
      ...overrides,
    }),
  );
}

/** Odd-cent brokerages at basis ratios from 0 to about 1.67. */
function brokerages(
  parentCategory: string,
  owners: number[],
): IndividualAccountInput[] {
  return [
    [40000.03, 40000.03],
    [29999.99, 0],
    [33333.33, 11111.12],
    [20000.01, 33329.98],
  ].map(([startingBalance, startingBasis], i) => ({
    name: `${parentCategory} brokerage ${i + 1}`,
    category: "brokerage" as const,
    taxType: "afterTax" as const,
    startingBalance: startingBalance!,
    startingBasis: startingBasis!,
    ownerName: owners[i % owners.length] === 2 ? "Bo" : "Alice",
    ownerPersonId: owners[i % owners.length],
    parentCategory,
  }));
}

/** Four years of brokerage goals drawn from four Portfolio brokerages while
 *  Alice works. */
function goalInput(scale: number): ProjectionInput {
  const year = AS_OF.getFullYear();
  return makeInput({
    retirementYear: year + 6,
    individualAccounts: [...accounts(), ...brokerages("Portfolio", [1])],
    brokerageGoals: [1, 2, 3, 4].map((k) => ({
      id: k,
      name: `Goal ${k}`,
      targetAmount: Math.round((7000 + k * 1234.57) * scale * 100) / 100,
      targetYear: year + k,
      priority: 1,
    })),
  });
}

/** Ann retires in 2030, Bo works to 2035: five gap years drawn from four
 *  Retirement brokerages. */
function gapInput(expenses: number): ProjectionInput {
  return household(brokerages("Retirement", [1, 2]), {
    asOfDate: new Date("2026-01-01"),
    currentAge: 50,
    birthYear: 1976,
    perPersonBirthYears: [1976, 1976],
    socialSecurityEntries: [1, 2].map((personId) => ({
      personId,
      personName: personId === 1 ? "Ann" : "Bo",
      birthYear: 1976,
      startAge: 70,
      annualAmount: 0,
    })),
    retirementYear: 2035,
    retirementYearByPerson: { 1: 2030, 2: 2035 },
    projectionEndYear: 2040,
    salaryByPerson: { 1: 100000, 2: 60000 },
    currentSalary: 160000,
    salaryGrowthRate: 0,
    annualExpenses: expenses,
    decumulationAnnualExpenses: expenses,
    inflationRate: 0,
    returnRates: [{ label: "5%", rate: 0.05 }],
  });
}

/** The settled points ending at `end` across one projection: how many moved
 *  the categories' basis, and each one that moved the gap. */
function across(input: ProjectionInput, end: string) {
  points.length = 0;
  calculateProjection(input);
  const windows = points
    .map((p, i) => ({ p, before: points[i - 1] }))
    .filter(({ p }) => p.point === end);
  return {
    sold: windows.filter(({ p, before }) => p.basis !== before?.basis).length,
    moved: windows
      .filter(({ p, before }) => p.gap !== before?.gap)
      .map(({ p, before }) => [p.year, before?.gap, p.gap]),
  };
}

describe("a brokerage draw's basis out is its accounts' basis out", () => {
  it("the categories' and accounts' basis gap doesn't move across the year's draws", () => {
    points.length = 0;
    calculateProjection(makeInput());
    const draws = points
      .map((p, i) => ({ p, before: points[i - 1] }))
      .filter(({ p }) => p.point === "decumulation.draws");
    const sold = draws.filter(({ p, before }) => p.basis < before!.basis);
    expect(sold.length).toBeGreaterThan(5);
    const moved = draws.filter(({ p, before }) => p.gap !== before?.gap);
    expect(moved.map(({ p, before }) => [p.year, before?.gap, p.gap])).toEqual(
      [],
    );
  });

  // Odd-cent sizes, so the accounts' basis out rounds apart from the draw's.
  const SCALES = [1, 1.0137, 1.2911, 1.5503, 1.7759, 2.0321, 2.4467, 2.9973];

  it("a gap year's draw takes its accounts' basis out of the category", () => {
    const runs = SCALES.map((s) =>
      across(
        gapInput(Math.round(90000 * s * 100) / 100),
        "accumulation.gapDraw",
      ),
    );
    expect(runs.reduce((n, r) => n + r.sold, 0)).toBeGreaterThan(15);
    expect(runs.flatMap((r) => r.moved)).toEqual([]);
  });

  it("a brokerage goal's draw takes its accounts' basis out of the category", () => {
    const runs = SCALES.map((s) =>
      across(goalInput(s), "accumulation.goalDraws"),
    );
    expect(runs.reduce((n, r) => n + r.sold, 0)).toBeGreaterThan(20);
    expect(runs.flatMap((r) => r.moved)).toEqual([]);
  });
});
