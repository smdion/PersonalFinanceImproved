/**
 * Monte Carlo consumer integration snapshot tests.
 *
 * Exercises the full pipeline: engine input -> calculateMonteCarlo() -> snapshot.
 * Uses a fixed seed for deterministic results.
 * After engine refactoring, these must produce byte-identical results.
 */
import { describe, it, expect } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import type { ProjectionInput, MonteCarloInput } from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid engine input with sensible defaults. */
function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    accumulationDefaults: {
      contributionRate: 0.25,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.15,
        brokerage: 0.35,
      },
      taxSplits: { "401k": 0.5, ira: 1.0 },
    },
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
        traditionalFallbackRate: 0.22,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 35,
    retirementAge: 65,
    projectionEndAge: 90,
    currentSalary: 150000,
    salaryGrowthRate: 0.03,
    salaryCap: null,
    salaryOverrides: [],
    budgetOverrides: [],
    baseLimits: {
      "401k": 23500,
      "403b": 23500,
      hsa: 4300,
      ira: 7000,
      brokerage: 0,
    },
    limitGrowthRate: 0.02,
    catchupLimits: { "401k": 7500, ira: 1000, hsa: 1000, "401k_super": 11250 },
    employerMatchRateByCategory: {
      "401k": 0.03,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: 100000,
      taxFree: 50000,
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
      brokerage: { structure: "basis_tracking", balance: 30000, basis: 20000 },
    },
    annualExpenses: 72000,
    inflationRate: 0.025,
    returnRates: [{ label: "7%", rate: 0.07 }],
    socialSecurityAnnual: 36000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    ...overrides,
  };
}

// Round all numbers in an object to avoid floating-point noise
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function roundDeep(obj: unknown, decimals = 2): any {
  if (typeof obj === "number")
    return Math.round(obj * 10 ** decimals) / 10 ** decimals;
  if (Array.isArray(obj)) return obj.map((v) => roundDeep(v, decimals));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = roundDeep(v, decimals);
    }
    return result;
  }
  return obj;
}

/** Extract a compact summary from Monte Carlo results for snapshot comparison. */
function extractSummary(result: ReturnType<typeof calculateMonteCarlo>) {
  const bands = result.percentileBands;
  return roundDeep({
    successRate: result.successRate,
    medianEndBalance: result.medianEndBalance,
    meanEndBalance: result.meanEndBalance,
    worstCase: result.worstCase,
    numTrials: result.numTrials,
    warningCount: result.warnings.length,
    distributions: result.distributions,
    // Band bookends: first and last year only (full array is too large for snapshots)
    firstBand: bands.length > 0 ? bands[0] : null,
    lastBand: bands.length > 0 ? bands[bands.length - 1] : null,
    totalBands: bands.length,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("monte carlo integration", () => {
  it("fixture 1: basic monte carlo — 2 asset classes, simple glide path", () => {
    const engineInput = makeInput();

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 35, allocations: { 1: 0.8, 2: 0.2 } },
        { age: 65, allocations: { 1: 0.4, 2: 0.6 } },
      ],
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    expect(result.percentileBands.length).toBeGreaterThan(0);
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
    // Explicit value assertions (seeded, so
    // deterministic; matches the T13 convention engine-snapshot.test.ts
    // uses for financial content that otherwise relies on
    // toMatchSnapshot() alone).
    expect(result.successRate).toBe(1);
    expect(result.medianEndBalance).toBeCloseTo(25352863.62, 1);

    expect(extractSummary(result)).toMatchSnapshot();
  });

  it("fixture 2: with inflation risk — adds inflation randomization", () => {
    const engineInput = makeInput();

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 35, allocations: { 1: 0.8, 2: 0.2 } },
        { age: 65, allocations: { 1: 0.4, 2: 0.6 } },
      ],
      inflationRisk: {
        meanRate: 0.03,
        stdDev: 0.015,
      },
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    expect(result.successRate).toBe(1);
    expect(result.medianEndBalance).toBe(22504931.93);
    expect(extractSummary(result)).toMatchSnapshot();
  });

  it("fixture 3: conservative allocation — heavy bond weighting", () => {
    const engineInput = makeInput({
      currentSalary: 120000,
      annualExpenses: 55000,
    });

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 35, allocations: { 1: 0.4, 2: 0.6 } },
        { age: 65, allocations: { 1: 0.2, 2: 0.8 } },
      ],
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    expect(result.successRate).toBe(1);
    expect(result.medianEndBalance).toBe(8880321.81);
    expect(extractSummary(result)).toMatchSnapshot();
  });

  it("fixture 4: near-retirement — older person with short projection", () => {
    const engineInput = makeInput({
      currentAge: 60,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 180000,
      startingBalances: {
        preTax: 800000,
        taxFree: 300000,
        afterTax: 200000,
        afterTaxBasis: 120000,
        hsa: 60000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 600000,
          roth: 200000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 60000 },
        ira: {
          structure: "roth_traditional",
          traditional: 200000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 200000,
          basis: 120000,
        },
      },
      annualExpenses: 80000,
    });

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 50,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 60, allocations: { 1: 0.5, 2: 0.5 } },
        { age: 65, allocations: { 1: 0.35, 2: 0.65 } },
        { age: 80, allocations: { 1: 0.2, 2: 0.8 } },
      ],
    };

    const result = calculateMonteCarlo(mcInput);

    expect(result.numTrials).toBe(50);
    // Near-retirement with large balances should have high success rate
    expect(result.successRate).toBeGreaterThan(0);
    expect(result.successRate).toBe(0.94);
    expect(result.medianEndBalance).toBe(3136622.95);
    expect(extractSummary(result)).toMatchSnapshot();
  });

  it("fixture 4 (R47): rmdSmoothingEnabled — each trial reads its own returnRates schedule, not a shared/leaked one", () => {
    // monte-carlo.ts builds a fresh trialInput (with that trial's own
    // trialReturnRates) and calls calculateProjection(trialInput) per
    // trial -- calculateProjection's context.ts builds returnRateMap fresh
    // from input.returnRates on every call, with no module-level state, so
    // rmd-smoothing.ts's forward projection (which reads ctx.returnRateMap)
    // cannot see another trial's schedule. This is a black-box proof of
    // that architectural guarantee: same seed -> byte-identical results
    // (nothing leaking IN from a prior run), different seed -> different
    // results (each trial's own randomized schedule genuinely drives the
    // smoothing computation, it isn't ignored/short-circuited).
    const engineInput = makeInput({
      currentAge: 65,
      retirementAge: 65,
      projectionEndAge: 80,
      birthYear: 1960,
      currentSalary: 0,
      annualExpenses: 90000,
      socialSecurityAnnual: 24000,
      ssStartAge: 67,
      socialSecurityEntries: [
        {
          personId: 1,
          personName: "Alice",
          birthYear: 1960,
          startAge: 67,
          annualAmount: 24000,
        },
      ],
      individualAccounts: [
        {
          name: "Alice 401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 1500000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 1000000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 300000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
      ],
      startingBalances: {
        preTax: 2500000,
        taxFree: 0,
        afterTax: 300000,
        afterTaxBasis: 200000,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1500000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 1000000, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 300000,
          basis: 200000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["401k", "ira", "brokerage", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        distributionTaxRates: {
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
            { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
            { threshold: 383900, baseWithholding: 78221, rate: 0.32 },
            { threshold: 693750, baseWithholding: 175136, rate: 0.37 },
          ],
        },
        rmdSmoothingEnabled: true,
        rmdSmoothingMaxBracketTarget: 0.32,
      },
    });

    const baseMcInput: Omit<MonteCarloInput, "seed"> = {
      engineInput,
      numTrials: 30,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.1, stdDev: 0.18 },
        { id: 2, name: "US Bonds", meanReturn: 0.04, stdDev: 0.06 },
      ],
      correlations: [{ classAId: 1, classBId: 2, correlation: 0.2 }],
      glidePath: [
        { age: 65, allocations: { 1: 0.5, 2: 0.5 } },
        { age: 80, allocations: { 1: 0.3, 2: 0.7 } },
      ],
    };

    const seed42Run1 = calculateMonteCarlo({ ...baseMcInput, seed: 42 });
    const seed42Run2 = calculateMonteCarlo({ ...baseMcInput, seed: 42 });
    const seed7Run = calculateMonteCarlo({ ...baseMcInput, seed: 7 });

    expect(Number.isFinite(seed42Run1.medianEndBalance)).toBe(true);
    expect(seed42Run1.successRate).toBeGreaterThanOrEqual(0);
    expect(seed42Run1.successRate).toBeLessThanOrEqual(1);

    // Same seed, same input -> byte-identical (nothing leaked IN from
    // module-level state left over by a prior run's trials).
    expect(seed42Run2.medianEndBalance).toBe(seed42Run1.medianEndBalance);
    expect(seed42Run2.successRate).toBe(seed42Run1.successRate);

    // Different seed -> genuinely different trial schedules actually
    // drive the result (smoothing isn't silently ignoring returnRateMap).
    expect(seed7Run.medianEndBalance).not.toBe(seed42Run1.medianEndBalance);
  });

  it("Simple tax mode (collapsed startingBalances) does not report bogus per-account balances, in either accumulation or decumulation (live-user finding + advisor review, 2026-08-28)", () => {
    // Reproduces monte-carlo.ts's "Simple" tax-mode transform by hand:
    // startingBalances/startingAccountBalances collapsed into one after-tax
    // bucket for the AGGREGATE engine math. The fix is that
    // computeMonteCarloProjection also empties `individualAccounts` in this
    // mode (below) -- a first attempt instead kept individualAccounts real
    // and skipped the yearly indBal/acctBal reconciliation, which stopped
    // the reconciliation from bleeding real balances into the fake bucket
    // in ACCUMULATION years, but in DECUMULATION years silently caused the
    // opposite failure: withdrawals only ever route against the collapsed
    // brokerage category, so a real Traditional/IRA account never gets
    // drawn down while the real brokerage account gets exhausted, and the
    // per-account total ends up OVERSTATING the real portfolio (not
    // visible from a warnings-string check alone -- hence this test
    // asserts on the actual balance numbers).
    const totalBalance = 1500000 + 1000000 + 300000; // 401k + IRA + brokerage
    const engineInput = makeInput({
      currentAge: 60,
      retirementAge: 65,
      projectionEndAge: 70,
      annualExpenses: 120000,
      individualAccounts: [
        {
          name: "Alice 401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 1500000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 1000000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 300000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
      ],
      // Simple tax mode's collapse: real per-category money forced into one
      // fictional after-tax bucket for the aggregate engine's tax math.
      startingBalances: {
        preTax: 0,
        taxFree: 0,
        afterTax: totalBalance,
        afterTaxBasis: totalBalance,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: totalBalance,
          basis: totalBalance,
        },
      },
    });

    const mcInput: MonteCarloInput = {
      // The real fix: Simple tax mode collapses individualAccounts to
      // empty too, matching what monte-carlo.ts now does. Also set
      // rateSeededDecumulationYear1 (Rate-Seeded's own flag) since that's
      // the exact combination the live bug report was under.
      engineInput: {
        ...engineInput,
        individualAccounts: [],
        rateSeededDecumulationYear1: true,
      },
      numTrials: 5,
      seed: 42,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.07, stdDev: 0.1 },
      ],
      correlations: [],
      glidePath: [{ age: 60, allocations: { 1: 1.0 } }],
    };

    const result = calculateMonteCarlo(mcInput);
    const years = result.deterministicProjection.projectionByYear;
    const year1 = years[0]!;
    const lastDecYear = years[years.length - 1]!;

    // No individual-account data at all -- nothing for a per-account
    // table/chart to render, honestly reflecting Simple mode's collapse
    // rather than a corrupted-looking number.
    expect(year1.individualAccountBalances ?? []).toEqual([]);
    expect(lastDecYear.individualAccountBalances ?? []).toEqual([]);

    // No reconciliation/shortfall diagnostics fire in either phase.
    for (const y of years) {
      const badWarnings = y.warnings.filter(
        (w) =>
          w.includes("indBal/acctBal reconciliation") ||
          w.includes("Individual-account shortfall"),
      );
      expect(badWarnings).toEqual([]);
    }

    // The aggregate (the only representation left) stays internally
    // consistent with itself year over year -- endBalance tracks the real
    // starting total, not a phantom inflated/deflated figure.
    expect(year1.endBalance).toBeGreaterThan(totalBalance * 0.9);
    expect(year1.endBalance).toBeLessThan(totalBalance * 1.3);

    // Regression guard: WITHOUT the fix (real individualAccounts left in
    // place under a collapsed aggregate -- i.e. monte-carlo.ts's Simple-mode
    // block stops emptying individualAccounts), the SAME household produces
    // real "indBal/acctBal reconciliation" diagnostics as the reconciliation
    // bleeds real per-account money into the fake collapsed bucket -- proving
    // this test would actually catch that regression, not just assert a
    // tautology.
    const brokenResult = calculateMonteCarlo({ ...mcInput, engineInput });
    const brokenReconcileWarnings =
      brokenResult.deterministicProjection.projectionByYear
        .flatMap((y) => y.warnings)
        .filter((w) => w.includes("indBal/acctBal reconciliation"));
    expect(brokenReconcileWarnings.length).toBeGreaterThan(0);
  });

  it("budget stability isn't fooled by a guardrail-mutated baseline (advisor review, 2026-08-29)", () => {
    // A high initial withdrawal rate (~10% of a $2M balance against
    // $200k/yr) with Guyton-Klinger under real volatility -- guardrails
    // cut spending hard for most trials well before full depletion.
    // budgetStabilityRate must measure against the REAL, un-mutated
    // household budget (y.budgetOnlyExpenses), not Guyton-Klinger's own
    // already-cut target (y.projectedExpenses) -- the latter tracks
    // whatever GK actually withdrew by construction, so it would trivially
    // read every surviving trial as "budget-stable" no matter how far
    // guardrails cut real spending below the stated budget.
    const engineInput = makeInput({
      currentAge: 64,
      retirementAge: 65,
      projectionEndAge: 95,
      currentSalary: 0,
      annualExpenses: 200000,
      decumulationAnnualExpenses: 200000,
      startingBalances: {
        preTax: 2000000,
        taxFree: 0,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 2000000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
      socialSecurityAnnual: 0,
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
        withdrawalTaxPreference: { "401k": "traditional" },
        withdrawalStrategy: "guyton_klinger",
        distributionTaxRates: {
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });

    const mcInput: MonteCarloInput = {
      engineInput,
      numTrials: 40,
      seed: 7,
      assetClasses: [
        { id: 1, name: "US Stocks", meanReturn: 0.06, stdDev: 0.22 },
      ],
      correlations: [],
      glidePath: [{ age: 64, allocations: { 1: 1.0 } }],
    };

    const result = calculateMonteCarlo(mcInput);
    // With the bug (baseline =
    // y.projectedExpenses, which Guyton-Klinger overwrites to match its
    // own already-cut target every year), budgetStabilityRate sits at
    // successRate itself (0.2) -- the guardrail-mutated "budget" tracks
    // the guardrail-mutated withdrawal by construction, so every
    // surviving trial trivially reads as "budget-stable" regardless of
    // how far the real budget was actually cut. With the fix (baseline =
    // y.budgetOnlyExpenses, the real inflation-only budget line no
    // strategy ever mutates), it correctly drops to ~0.025 -- almost none
    // of even the surviving trials kept spending within 75% of the real
    // stated budget.
    expect(result.successRate).toBeCloseTo(0.175, 5);
    expect(result.budgetStabilityRate).not.toBeNull();
    expect(result.budgetStabilityRate!).toBeLessThan(0.1);
    expect(result.budgetStabilityRate!).toBeLessThan(result.successRate);
  });
});
