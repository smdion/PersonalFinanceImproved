/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal engine-year fixtures without satisfying every unrelated field of the full engine types */
/**
 * Tests for useProjectionDerived — the memoized derived-data layer of the
 * projection card (person filtering, visible columns, deflation, milestone
 * filtering, FI cache write-back). Uses real @/lib/config/account-types (as
 * other pure/derived-data tests in this repo do) and hand-rolled engine year
 * fixtures rather than the full calculator fixtures, since only a subset of
 * fields is read by this hook.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type {
  EngineYearProjection,
  EngineAccumulationYear,
  EngineDecumulationYear,
} from "@/lib/calculators/types";
import { accountBalancesFromTaxBuckets } from "@/lib/calculators/engine/balance-utils";
import type { UseProjectionStateProps } from "@/components/cards/projection/use-projection-state";
import type { ProjectionFormState } from "@/components/cards/projection/use-projection-form-state";
import type { ProjectionQueries } from "@/components/cards/projection/use-projection-queries";

let isInScenario = false;
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ isInScenario }),
}));

const writeFICache = vi.fn();
let isLivePlanInputResult = true;
vi.mock("@/lib/hooks/use-fi-cache", () => ({
  useFICache: () => [null, writeFICache],
  deriveFI: vi.fn(() => ({
    fiYear: 2050,
    fiAge: 65,
    inputKey: "test-key",
  })),
  isLivePlanInput: () => isLivePlanInputResult,
}));

beforeEach(() => {
  isInScenario = false;
  isLivePlanInputResult = true;
  writeFICache.mockClear();
});

async function importHook() {
  const mod =
    await import("@/components/cards/projection/use-projection-derived");
  return mod.useProjectionDerived;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIndividualAccount(
  overrides: Partial<{
    name: string;
    category: string;
    taxType: string;
    parentCategory: string;
    balance: number;
    contribution: number;
    employerMatch: number;
    growth: number;
    ownerPersonId: number;
    ownerName: string;
  }> = {},
) {
  return {
    name: "401k A",
    category: "401k",
    taxType: "preTax",
    parentCategory: "Retirement",
    balance: 10000,
    contribution: 1000,
    employerMatch: 100,
    growth: 500,
    ownerPersonId: 1,
    ownerName: "Alice",
    ...overrides,
  };
}

function makeAccumYear(
  overrides: Partial<EngineAccumulationYear> = {},
): EngineAccumulationYear {
  const buckets = {
    preTax: 10000,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
  };
  return {
    year: 2026,
    age: 40,
    phase: "accumulation",
    projectedSalary: 100000,
    projectedExpenses: 50000,
    hasSalaryOverride: false,
    hasBudgetOverride: false,
    proRateFraction: null,
    targetContribution: 10000,
    config: { contributionRate: 0.1 } as EngineAccumulationYear["config"],
    slots: [],
    totalEmployee: 1000,
    totalEmployer: 100,
    totalRoth: 0,
    totalTraditional: 1000,
    rateCeilingScale: null,
    overflowToBrokerage: 0,
    brokerageRampContribution: 0,
    totalTaxAdvSpace: 23000,
    brokerageGoalWithdrawals: [],
    endBalance: 10000,
    balanceByTaxType: buckets,
    balanceByAccount: accountBalancesFromTaxBuckets(buckets),
    individualAccountBalances: [makeIndividualAccount()],
    returnRate: 0.07,
    annualizedReturnRate: 0.07,
    warnings: [],
    ...overrides,
  } as EngineAccumulationYear;
}

function makeDecumYear(
  overrides: Partial<EngineDecumulationYear> = {},
): EngineDecumulationYear {
  const buckets = {
    preTax: 5000,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
  };
  return {
    year: 2060,
    age: 65,
    phase: "decumulation",
    projectedExpenses: 40000,
    hasBudgetOverride: false,
    brokerageContribution: 0,
    brokerageRampContribution: 0,
    targetWithdrawal: 4000,
    endBalance: 5000,
    balanceByTaxType: buckets,
    balanceByAccount: accountBalancesFromTaxBuckets(buckets),
    individualAccountBalances: [
      makeIndividualAccount({
        name: "401k A",
        balance: 5000,
        contribution: 0,
        employerMatch: 0,
        growth: 0,
      }),
    ],
    returnRate: 0.05,
    annualizedReturnRate: 0.05,
    warnings: [],
    ...overrides,
  } as unknown as EngineDecumulationYear;
}

function makeEngineData(
  years: EngineYearProjection[],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    result: { projectionByYear: years },
    combinedSalary: 150000,
    people: [
      { id: 1, name: "Alice", birthYear: 1986 },
      { id: 2, name: "Bob", birthYear: 1988 },
    ],
    realDefaults: {},
    dbSalaryOverrides: [
      { personId: 1, year: 2027, salary: 110000 },
      { personId: 2, year: 2027, salary: 90000 },
    ],
    dbBudgetOverrides: [],
    primaryPersonId: 1,
    salaryByPerson: { 1: 100000, 2: 90000 },
    settings: { withdrawalRate: "0.04", retirementAge: 65 },
    annualExpenses: 90000,
    decumulationExpenses: 80000,
    budgetProfileSummaries: [],
    contributionSpecs: [],
    accountBreakdownByCategory: {
      "401k": [
        { name: "401k A", ownerPersonId: 1, parentCategory: "Retirement" },
      ],
    },
    ...overrides,
  };
}

function makeQueries(
  overrides: Partial<Record<string, unknown>> = {},
): ProjectionQueries {
  return {
    engineQuery: {
      data: undefined,
      isLoading: false,
      isFetching: false,
    },
    contribProfilesQuery: { data: undefined },
    salaryProfilesQuery: { data: undefined },
    coastFireMcResult: undefined,
    ...overrides,
  } as unknown as ProjectionQueries;
}

function makeForm(
  overrides: Partial<Record<string, unknown>> = {},
): ProjectionFormState {
  return {
    accumOverrides: [],
    decumOverrides: [],
    dollarMode: "nominal",
    showAllYears: false,
    personFilter: "all",
    isPersonFiltered: false,
    scenarioView: "baseline",
    ...overrides,
  } as unknown as ProjectionFormState;
}

function makeProps(
  overrides: Partial<UseProjectionStateProps> = {},
): UseProjectionStateProps {
  return {
    withdrawalRate: 0.04,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProjectionDerived", () => {
  it("returns rawResult/result as null when there is no engine data", async () => {
    const useProjectionDerived = await importHook();
    const { result } = renderHook(() =>
      useProjectionDerived(makeForm(), makeQueries(), makeProps()),
    );
    expect(result.current.rawResult).toBeNull();
    expect(result.current.result).toBeNull();
  });

  it("passes through engineQuery.data.result when no parentCategoryFilter is set", async () => {
    const useProjectionDerived = await importHook();
    const years = [makeAccumYear()];
    const engineData = makeEngineData(years);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    expect(result.current.result?.projectionByYear).toHaveLength(1);
    expect(result.current.combinedSalary).toBe(150000);
  });

  it("swaps rawResult to the Coast FIRE MC deterministic projection when scenarioView is coastFire", async () => {
    const useProjectionDerived = await importHook();
    const baselineYears = [makeAccumYear({ year: 2026 })];
    const coastYears = [makeAccumYear({ year: 2099 })];
    const engineData = makeEngineData(baselineYears);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm({ scenarioView: "coastFire" }),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
          // The hook now reads the ALREADY-selected `activeAltMcResult` off
          // queries (computed once in use-projection-queries.ts, generalized
          // 2026-08-28 to also cover the Rate-Seeded scenario alongside
          // Coast FIRE) instead of re-deriving it from
          // `coastFireMcResult`/`coastFireTodayMcResult` itself (code
          // review, 2026-08-27 — that re-derivation used to happen
          // independently in 3 places). Set all three so this mock matches
          // what the real hook would have produced for scenarioView
          // "coastFire".
          coastFireMcResult: {
            deterministicProjection: { projectionByYear: coastYears },
          },
          activeCoastFireMcResult: {
            deterministicProjection: { projectionByYear: coastYears },
          },
          activeAltMcResult: {
            deterministicProjection: { projectionByYear: coastYears },
          },
        }),
        makeProps(),
      ),
    );
    expect(result.current.rawResult?.projectionByYear[0]?.year).toBe(2099);
  });

  it("filters individualAccountBalances by parentCategoryFilter when set", async () => {
    const useProjectionDerived = await importHook();
    const years = [
      makeAccumYear({
        individualAccountBalances: [
          makeIndividualAccount({ parentCategory: "Retirement" }),
          makeIndividualAccount({
            name: "Brokerage A",
            category: "brokerage",
            taxType: "afterTax",
            parentCategory: "Portfolio",
          }),
        ],
      }),
    ];
    const engineData = makeEngineData(years);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps({ parentCategoryFilter: "Retirement" }),
      ),
    );
    const filteredYear = result.current.result?.projectionByYear[0];
    expect(filteredYear?.individualAccountBalances).toHaveLength(1);
    expect(filteredYear?.individualAccountBalances[0]?.category).toBe("401k");
  });

  it("filters dbSalaryOverrides to the active personFilter when isPersonFiltered", async () => {
    const useProjectionDerived = await importHook();
    const years = [makeAccumYear()];
    const engineData = makeEngineData(years);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm({ personFilter: 2, isPersonFiltered: true }),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    expect(result.current.dbSalaryOverrides).toHaveLength(1);
    expect(result.current.dbSalaryOverrides?.[0]?.personId).toBe(2);
    expect(result.current.salaryOverridePersonId).toBe(2);
  });

  it("getPersonYearTotals returns null when not person-filtered", async () => {
    const useProjectionDerived = await importHook();
    const years = [makeAccumYear()];
    const engineData = makeEngineData(years);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    expect(result.current.getPersonYearTotals(years[0]!)).toBeNull();
  });

  it("getPersonYearTotals aggregates balance/contribution/growth for the filtered person", async () => {
    const useProjectionDerived = await importHook();
    const years = [
      makeAccumYear({
        individualAccountBalances: [
          makeIndividualAccount({
            ownerPersonId: 1,
            balance: 10000,
            contribution: 1000,
            employerMatch: 100,
            growth: 500,
          }),
          makeIndividualAccount({
            ownerPersonId: 2,
            balance: 5000,
            contribution: 500,
            employerMatch: 50,
            growth: 250,
          }),
        ],
      }),
    ];
    const engineData = makeEngineData(years);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm({ personFilter: 1, isPersonFiltered: true }),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    const totals = result.current.getPersonYearTotals(years[0]!);
    expect(totals).not.toBeNull();
    expect(totals!.balance).toBe(10000);
    expect(totals!.contribution).toBe(1100); // contribution + employerMatch
    expect(totals!.growth).toBe(500);
  });

  it("personDepletionInfo finds the first decumulation year where the filtered person's balance hits zero", async () => {
    const useProjectionDerived = await importHook();
    const years: EngineYearProjection[] = [
      makeDecumYear({
        year: 2060,
        age: 65,
        individualAccountBalances: [
          makeIndividualAccount({ ownerPersonId: 1, balance: 1000 }),
        ],
      }),
      makeDecumYear({
        year: 2061,
        age: 66,
        individualAccountBalances: [
          makeIndividualAccount({ ownerPersonId: 1, balance: 0 }),
        ],
      }),
    ];
    const engineData = makeEngineData(years);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm({ personFilter: 1, isPersonFiltered: true }),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    expect(result.current.personDepletionInfo).toEqual({ year: 2061, age: 66 });
  });

  it("avgBirthYear and displayAge derive from the people list", async () => {
    const useProjectionDerived = await importHook();
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries(),
        makeProps({
          people: [
            { id: 1, name: "Alice", birthYear: 1980 },
            { id: 2, name: "Bob", birthYear: 1990 },
          ],
        }),
      ),
    );
    expect(result.current.avgBirthYear).toBe(1985);
    expect(result.current.displayAge(2025)).toBe(40);
  });

  it("displayAge returns null when there are no people", async () => {
    const useProjectionDerived = await importHook();
    const { result } = renderHook(() =>
      useProjectionDerived(makeForm(), makeQueries(), makeProps()),
    );
    expect(result.current.avgBirthYear).toBeNull();
    expect(result.current.displayAge(2025)).toBeNull();
  });

  it("getFilteredYears returns all years unchanged when showAllYears is true", async () => {
    const useProjectionDerived = await importHook();
    const years = [
      makeAccumYear({ year: 2026, age: 40 }),
      makeAccumYear({ year: 2027, age: 41 }),
      makeAccumYear({ year: 2028, age: 42 }),
    ];
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm({ showAllYears: true }),
        makeQueries(),
        makeProps(),
      ),
    );
    expect(result.current.getFilteredYears(years)).toHaveLength(3);
  });

  it("getFilteredYears reduces to milestone years (first, last, phase change, every 5th age) when showAllYears is false", async () => {
    const useProjectionDerived = await importHook();
    const years = [
      makeAccumYear({ year: 2026, age: 41 }),
      makeAccumYear({ year: 2027, age: 42 }),
      makeAccumYear({ year: 2028, age: 43 }),
      { ...makeDecumYear({ year: 2029, age: 44 }) },
    ];
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm({ showAllYears: false }),
        makeQueries(),
        makeProps(),
      ),
    );
    const filtered = result.current.getFilteredYears(years);
    const filteredYears = filtered.map((y) => y.year);
    // First and last years are always included
    expect(filteredYears).toContain(2026);
    expect(filteredYears).toContain(2029);
    // Phase change from accumulation -> decumulation at 2029 is a milestone
    expect(filteredYears).toContain(2029);
  });

  it("getFilteredYears always includes years present in accumOverrides/decumOverrides", async () => {
    const useProjectionDerived = await importHook();
    const years = [
      makeAccumYear({ year: 2026, age: 41 }),
      makeAccumYear({ year: 2027, age: 42 }),
      makeAccumYear({ year: 2028, age: 43 }),
    ];
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm({
          showAllYears: false,
          accumOverrides: [{ year: 2027, contributionRate: 0.3 }],
        }),
        makeQueries(),
        makeProps(),
      ),
    );
    const filteredYears = result.current
      .getFilteredYears(years)
      .map((y) => y.year);
    expect(filteredYears).toContain(2027);
  });

  it("individualAccountNames only includes retirement-parent accounts from the first year", async () => {
    const useProjectionDerived = await importHook();
    const years = [
      makeAccumYear({
        individualAccountBalances: [
          makeIndividualAccount({
            name: "401k A",
            parentCategory: "Retirement",
          }),
          makeIndividualAccount({
            name: "Brokerage A",
            category: "brokerage",
            parentCategory: "Portfolio",
          }),
        ],
      }),
    ];
    const engineData = makeEngineData(years);
    const { result } = renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    expect(result.current.individualAccountNames).toEqual([
      {
        name: "401k A",
        category: "401k",
        taxType: "preTax",
        ownerName: "Alice",
      },
    ]);
  });

  it("writes to the FI cache when the projection represents a live, no-override plan", async () => {
    const useProjectionDerived = await importHook();
    const years = [makeAccumYear()];
    const engineData = makeEngineData(years);
    isLivePlanInputResult = true;
    renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    expect(writeFICache).toHaveBeenCalledWith(
      expect.objectContaining({
        fiYear: 2050,
        fiAge: 65,
        inputKey: "test-key",
      }),
    );
  });

  it("does not write to the FI cache when the plan is not a live, no-override plan (e.g. in a scenario)", async () => {
    const useProjectionDerived = await importHook();
    const years = [makeAccumYear()];
    const engineData = makeEngineData(years);
    isLivePlanInputResult = false;
    renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries({
          engineQuery: {
            data: engineData,
            isLoading: false,
            isFetching: false,
          },
        }),
        makeProps(),
      ),
    );
    expect(writeFICache).not.toHaveBeenCalled();
  });

  it("does not write to the FI cache while the engine query is still loading", async () => {
    const useProjectionDerived = await importHook();
    const years = [makeAccumYear()];
    const engineData = makeEngineData(years);
    renderHook(() =>
      useProjectionDerived(
        makeForm(),
        makeQueries({
          engineQuery: { data: engineData, isLoading: true, isFetching: false },
        }),
        makeProps(),
      ),
    );
    expect(writeFICache).not.toHaveBeenCalled();
  });
});
