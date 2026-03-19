/**
 * Engine snapshot parity tests.
 *
 * Captures full calculateProjection() output for diverse fixture inputs.
 * After engine refactoring, these must produce byte-identical results.
 * Any difference = test failure (forces investigation before merge).
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  ProjectionInput,
  ContributionSpec,
  AccountCategory,
} from "@/lib/calculators/types";

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

/** Extract key metrics from engine result for snapshot comparison. */
function extractMetrics(result: ReturnType<typeof calculateProjection>) {
  const years = result.projectionByYear;
  const firstYear = years[0];
  const retirementYear = years.find((y) => y.phase === "decumulation");
  const lastYear = years[years.length - 1];

  return roundDeep({
    // Summary metrics
    firstOverflowYear: result.firstOverflowYear,
    firstOverflowAge: result.firstOverflowAge,
    firstOverflowAmount: result.firstOverflowAmount,
    portfolioDepletionYear: result.portfolioDepletionYear,
    portfolioDepletionAge: result.portfolioDepletionAge,
    sustainableWithdrawal: result.sustainableWithdrawal,
    accountDepletions: result.accountDepletions,
    warningCount: result.warnings.length,

    // Year 0 (base year)
    year0: firstYear
      ? {
          phase: firstYear.phase,
          endBalance: firstYear.endBalance,
          ...(firstYear.phase === "accumulation"
            ? {
                totalEmployee: firstYear.totalEmployee,
                totalEmployer: firstYear.totalEmployer,
                projectedSalary: firstYear.projectedSalary,
                slotCount: firstYear.slots?.length ?? 0,
              }
            : {
                projectedExpenses: firstYear.projectedExpenses,
                totalWithdrawal: firstYear.totalWithdrawal,
              }),
        }
      : null,

    // Retirement year (first decumulation year)
    retirementYear:
      retirementYear && retirementYear.phase === "decumulation"
        ? {
            age: retirementYear.age,
            endBalance: retirementYear.endBalance,
            totalWithdrawal: retirementYear.totalWithdrawal,
            projectedExpenses: retirementYear.projectedExpenses,
          }
        : null,

    // Final year
    finalYear: lastYear
      ? {
          age: lastYear.age,
          endBalance: lastYear.endBalance,
        }
      : null,

    // Total years projected
    totalYears: years.length,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("engine snapshot parity", () => {
  it("fixture 1: standard dual-income household", () => {
    const input = makeInput();
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    // Verify structure exists
    expect(result.projectionByYear.length).toBeGreaterThan(0);
    expect(metrics.year0).not.toBeNull();
    expect(metrics.retirementYear).not.toBeNull();
    expect(metrics.finalYear).not.toBeNull();

    // Snapshot the key metrics
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 2: single person, no employer match", () => {
    const input = makeInput({
      currentSalary: 85000,
      employerMatchRateByCategory: {
        "401k": 0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      startingBalances: {
        preTax: 30000,
        taxFree: 10000,
        afterTax: 5000,
        afterTaxBasis: 3000,
        hsa: 5000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 25000,
          roth: 5000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 5000 },
        ira: { structure: "roth_traditional", traditional: 5000, roth: 5000 },
        brokerage: { structure: "basis_tracking", balance: 5000, basis: 3000 },
      },
      annualExpenses: 48000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    expect(metrics).toMatchSnapshot();
  });

  it("fixture 3: all accounts maxed, overflow to brokerage", () => {
    const input = makeInput({
      accumulationDefaults: {
        contributionRate: 0.5, // Very high rate to force overflow
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
      currentSalary: 300000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    // With 50% contribution rate at $300k salary, overflow SHOULD occur
    expect(result.firstOverflowYear).not.toBeNull();
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 4: retirement phase only (age > retirement age)", () => {
    const input = makeInput({
      currentAge: 67,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      startingBalances: {
        preTax: 500000,
        taxFree: 200000,
        afterTax: 150000,
        afterTaxBasis: 80000,
        hsa: 50000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 400000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 50000 },
        ira: {
          structure: "roth_traditional",
          traditional: 150000,
          roth: 50000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 150000,
          basis: 80000,
        },
      },
      annualExpenses: 60000,
      socialSecurityAnnual: 36000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    // Already retired — should be decumulation phase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((metrics as any).year0?.phase).toBe("decumulation");
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 5: zero balances, zero contributions", () => {
    const input = makeInput({
      accumulationDefaults: {
        contributionRate: 0,
        routingMode: "waterfall",
        accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
        accountSplits: { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 },
        taxSplits: { "401k": 0, ira: 0 },
      },
      currentSalary: 100000,
      employerMatchRateByCategory: {
        "401k": 0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      startingBalances: {
        preTax: 0,
        taxFree: 0,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((metrics as any).year0?.totalEmployee ?? 0).toBe(0);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 6: with contribution specs (per-account routing)", () => {
    const specs: ContributionSpec[] = [
      {
        category: "401k" as AccountCategory,
        name: "Traditional 401k",
        method: "percent_of_salary",
        value: 0.1,
        salaryFraction: 1,
        periodsPerYear: 26,
        baseAnnual: 15000,
        taxTreatment: "pre_tax",
        personId: 1,
      },
      {
        category: "401k" as AccountCategory,
        name: "Roth 401k",
        method: "percent_of_salary",
        value: 0.06,
        salaryFraction: 1,
        periodsPerYear: 26,
        baseAnnual: 9000,
        taxTreatment: "tax_free",
        personId: 1,
      },
      {
        category: "hsa" as AccountCategory,
        name: "HSA",
        method: "fixed_per_period",
        value: 165,
        salaryFraction: 1,
        periodsPerYear: 26,
        baseAnnual: 4290,
        taxTreatment: "hsa",
        personId: 1,
      },
      {
        category: "ira" as AccountCategory,
        name: "Roth IRA",
        method: "fixed_monthly",
        value: 583.33,
        salaryFraction: 1,
        periodsPerYear: 12,
        baseAnnual: 7000,
        taxTreatment: "tax_free",
        personId: 1,
      },
      {
        category: "brokerage" as AccountCategory,
        name: "Brokerage",
        method: "fixed_monthly",
        value: 500,
        salaryFraction: 1,
        periodsPerYear: 12,
        baseAnnual: 6000,
        taxTreatment: "after_tax",
        personId: 1,
      },
    ];

    const input = makeInput({
      contributionSpecs: specs,
      baseYearContributions: {
        "401k": 24000,
        "403b": 0,
        hsa: 4290,
        ira: 7000,
        brokerage: 6000,
      },
      baseYearEmployerMatch: {
        "401k": 4500,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    expect(metrics).toMatchSnapshot();
  });

  it("fixture 7: bracket filling routing mode", () => {
    const input = makeInput({
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "bracket_filling",
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
      startingBalances: {
        preTax: 300000,
        taxFree: 150000,
        afterTax: 100000,
        afterTaxBasis: 60000,
        hsa: 40000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 250000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 40000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 50000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 100000,
          basis: 60000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    expect(metrics).toMatchSnapshot();
  });

  // ---------------------------------------------------------------------------
  // Fixtures 8–30: edge cases and advanced scenarios
  // ---------------------------------------------------------------------------

  it("fixture 8: life change overrides — salary and budget mid-projection", () => {
    // Salary doubles at age 40 (year 2030), budget bumps at age 50 (year 2040)
    const input = makeInput({
      salaryOverrides: [{ year: 2030, value: 200000, notes: "Promotion" }],
      budgetOverrides: [
        { year: 2040, value: 8000, notes: "Empty nest — monthly $8k" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 9: decumulation override with reset:true reverts to defaults", () => {
    // Drop withdrawal rate at age 70, then reset to defaults at age 80
    const input = makeInput({
      decumulationOverrides: [
        {
          year: 2060,
          withdrawalRate: 0.03,
          notes: "Conservative early retirement",
        },
        { year: 2070, reset: true, notes: "Revert to defaults" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 10: bracket-filling withdrawal with rothBracketTarget on override", () => {
    // bracket_filling mode at defaults; override sets rothConversionTarget at age 70
    const input = makeInput({
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "bracket_filling",
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
      decumulationOverrides: [
        {
          year: 2060,
          rothConversionTarget: 0.12,
          notes: "Convert up to 12% bracket",
        },
      ],
      startingBalances: {
        preTax: 400000,
        taxFree: 100000,
        afterTax: 80000,
        afterTaxBasis: 50000,
        hsa: 30000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 350000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 30000 },
        ira: { structure: "roth_traditional", traditional: 60000, roth: 20000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 80000,
          basis: 50000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 11: waterfall withdrawal order — brokerage first", () => {
    // Drain taxable brokerage first to defer tax-deferred accounts
    const input = makeInput({
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "ira", "401k", "hsa", "403b"],
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
      startingBalances: {
        preTax: 250000,
        taxFree: 80000,
        afterTax: 200000,
        afterTaxBasis: 120000,
        hsa: 40000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 200000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 40000 },
        ira: { structure: "roth_traditional", traditional: 50000, roth: 30000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 200000,
          basis: 120000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 12: percentage withdrawal mode", () => {
    const input = makeInput({
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "percentage",
        withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
        withdrawalSplits: {
          "401k": 0.4,
          "403b": 0,
          ira: 0.3,
          brokerage: 0.2,
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
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 13: asymmetric retirement ages — early retirement at 55", () => {
    const input = makeInput({
      currentAge: 40,
      retirementAge: 55,
      projectionEndAge: 90,
      currentSalary: 180000,
      annualExpenses: 80000,
      startingBalances: {
        preTax: 300000,
        taxFree: 100000,
        afterTax: 150000,
        afterTaxBasis: 80000,
        hsa: 50000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 250000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 50000 },
        ira: { structure: "roth_traditional", traditional: 70000, roth: 30000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 150000,
          basis: 80000,
        },
      },
      socialSecurityAnnual: 24000,
      ssStartAge: 67,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 14: RMDs — birth year 1955 (RMD start age 73)", () => {
    // Person born 1955, currently age 68 (year 2023), RMDs kick in at 73 = year 2028
    const input = makeInput({
      currentAge: 68,
      retirementAge: 65,
      projectionEndAge: 90,
      birthYear: 1955,
      currentSalary: 0,
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      startingBalances: {
        preTax: 800000,
        taxFree: 100000,
        afterTax: 50000,
        afterTaxBasis: 30000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 700000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 50000,
          basis: 30000,
        },
      },
      annualExpenses: 60000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 15: RMDs — birth year 1965 (RMD start age 75)", () => {
    // Person born 1965, currently age 60 (year 2025), RMDs kick in at 75 = year 2040
    const input = makeInput({
      currentAge: 60,
      retirementAge: 62,
      projectionEndAge: 90,
      birthYear: 1965,
      currentSalary: 0,
      socialSecurityAnnual: 30000,
      ssStartAge: 67,
      startingBalances: {
        preTax: 600000,
        taxFree: 80000,
        afterTax: 40000,
        afterTaxBasis: 25000,
        hsa: 15000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 550000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 15000 },
        ira: { structure: "roth_traditional", traditional: 50000, roth: 30000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 40000,
          basis: 25000,
        },
      },
      annualExpenses: 55000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 16: RMD forces withdrawal above bracket-filling preference", () => {
    // Large traditional balance + bracket_filling mode → RMD overrides routing
    const input = makeInput({
      currentAge: 70,
      retirementAge: 65,
      projectionEndAge: 90,
      birthYear: 1955,
      currentSalary: 0,
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "bracket_filling",
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
      startingBalances: {
        preTax: 1200000,
        taxFree: 50000,
        afterTax: 30000,
        afterTaxBasis: 20000,
        hsa: 10000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1100000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 10000 },
        ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 30000,
          basis: 20000,
        },
      },
      annualExpenses: 50000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 17: RMD + Roth conversion targeting", () => {
    // RMD year with a decumulation override setting rothConversionTarget
    const input = makeInput({
      currentAge: 70,
      retirementAge: 65,
      projectionEndAge: 90,
      birthYear: 1955,
      currentSalary: 0,
      socialSecurityAnnual: 30000,
      ssStartAge: 67,
      decumulationOverrides: [
        {
          year: 2025,
          rothConversionTarget: 0.22,
          notes: "Convert up to 22% bracket",
        },
      ],
      startingBalances: {
        preTax: 900000,
        taxFree: 80000,
        afterTax: 40000,
        afterTaxBasis: 25000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 800000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 40000,
          basis: 25000,
        },
      },
      annualExpenses: 55000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 18: portfolio depletion — very low balance, high expenses", () => {
    const input = makeInput({
      currentAge: 65,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      socialSecurityAnnual: 18000,
      ssStartAge: 67,
      annualExpenses: 80000,
      startingBalances: {
        preTax: 100000,
        taxFree: 20000,
        afterTax: 10000,
        afterTaxBasis: 5000,
        hsa: 5000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 80000,
          roth: 20000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 5000 },
        ira: { structure: "roth_traditional", traditional: 10000, roth: 10000 },
        brokerage: { structure: "basis_tracking", balance: 10000, basis: 5000 },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 19: brokerage-heavy portfolio — goals tracking", () => {
    const input = makeInput({
      currentAge: 35,
      retirementAge: 60,
      projectionEndAge: 90,
      currentSalary: 200000,
      annualExpenses: 90000,
      startingBalances: {
        preTax: 50000,
        taxFree: 20000,
        afterTax: 500000,
        afterTaxBasis: 350000,
        hsa: 10000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 40000,
          roth: 10000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 10000 },
        ira: { structure: "roth_traditional", traditional: 10000, roth: 10000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 500000,
          basis: 350000,
        },
      },
      accumulationDefaults: {
        contributionRate: 0.2,
        routingMode: "waterfall",
        accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
        accountSplits: {
          "401k": 0.1,
          "403b": 0,
          hsa: 0.05,
          ira: 0.1,
          brokerage: 0.75,
        },
        taxSplits: { "401k": 0.5, ira: 1.0 },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 20: catch-up contributions — age 50, 60–63 super catch-up", () => {
    // Starts at age 49, crosses age 50 and 60 during projection
    const input = makeInput({
      currentAge: 49,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 160000,
      catchupLimits: {
        "401k": 7500,
        ira: 1000,
        hsa: 1000,
        "401k_super": 11250,
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 21: SS torpedo — MFJ filing status", () => {
    // With MFJ filing status, SS taxation thresholds differ from Single
    const input = makeInput({
      currentAge: 60,
      retirementAge: 65,
      projectionEndAge: 90,
      filingStatus: "MFJ",
      socialSecurityAnnual: 48000,
      ssStartAge: 67,
      annualExpenses: 70000,
      currentSalary: 0,
      startingBalances: {
        preTax: 600000,
        taxFree: 100000,
        afterTax: 80000,
        afterTaxBasis: 50000,
        hsa: 30000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 500000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 30000 },
        ira: { structure: "roth_traditional", traditional: 80000, roth: 20000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 80000,
          basis: 50000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 22: SS torpedo — Single filing status", () => {
    const input = makeInput({
      currentAge: 60,
      retirementAge: 65,
      projectionEndAge: 90,
      filingStatus: "Single",
      socialSecurityAnnual: 24000,
      ssStartAge: 67,
      annualExpenses: 55000,
      currentSalary: 0,
      startingBalances: {
        preTax: 400000,
        taxFree: 60000,
        afterTax: 40000,
        afterTaxBasis: 25000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 350000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 40000, roth: 20000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 40000,
          basis: 25000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 23: SS income = 0 (no Social Security)", () => {
    const input = makeInput({
      socialSecurityAnnual: 0,
      ssStartAge: 67,
      annualExpenses: 65000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 24: filing status absent — falls back to flat SS taxation", () => {
    // Omit filingStatus entirely; engine should use flat 85% SS inclusion
    const input = makeInput({
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      annualExpenses: 60000,
      // filingStatus intentionally omitted
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 25: LTCG 0% zone — low income retiree stays in 0% bracket", () => {
    // Low annual expenses + modest SS → expect 0% LTCG rate on brokerage withdrawals
    const input = makeInput({
      currentAge: 65,
      retirementAge: 65,
      projectionEndAge: 90,
      filingStatus: "MFJ",
      currentSalary: 0,
      socialSecurityAnnual: 30000,
      ssStartAge: 65,
      annualExpenses: 40000,
      startingBalances: {
        preTax: 100000,
        taxFree: 50000,
        afterTax: 300000,
        afterTaxBasis: 200000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 80000,
          roth: 20000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 20000, roth: 30000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 300000,
          basis: 200000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "ira", "401k", "hsa", "403b"],
        withdrawalSplits: {
          "401k": 0.2,
          "403b": 0,
          ira: 0.2,
          brokerage: 0.5,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        distributionTaxRates: {
          traditionalFallbackRate: 0.12,
          roth: 0,
          hsa: 0,
          brokerage: 0.0,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 26: LTCG 15%/20% zone — higher income retiree", () => {
    const input = makeInput({
      currentAge: 65,
      retirementAge: 65,
      projectionEndAge: 90,
      filingStatus: "MFJ",
      currentSalary: 0,
      socialSecurityAnnual: 48000,
      ssStartAge: 65,
      annualExpenses: 120000,
      startingBalances: {
        preTax: 500000,
        taxFree: 200000,
        afterTax: 800000,
        afterTaxBasis: 400000,
        hsa: 50000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 400000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 50000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 800000,
          basis: 400000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa", "403b"],
        withdrawalSplits: {
          "401k": 0.25,
          "403b": 0,
          ira: 0.2,
          brokerage: 0.45,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        distributionTaxRates: {
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 27: Roth conversion enabled via filingStatus — converts from brokerage proceeds", () => {
    // filingStatus triggers automatic Roth conversion logic in the engine
    const input = makeInput({
      currentAge: 55,
      retirementAge: 65,
      projectionEndAge: 90,
      filingStatus: "MFJ",
      currentSalary: 120000,
      annualExpenses: 70000,
      decumulationOverrides: [
        {
          year: 2035,
          rothConversionTarget: 0.22,
          notes: "Start Roth ladder at 65",
        },
      ],
      startingBalances: {
        preTax: 500000,
        taxFree: 50000,
        afterTax: 100000,
        afterTaxBasis: 60000,
        hsa: 25000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 450000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 25000 },
        ira: { structure: "roth_traditional", traditional: 50000, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 100000,
          basis: 60000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 28: Roth conversion constrained near IRMAA cliff", () => {
    const input = makeInput({
      currentAge: 63,
      retirementAge: 65,
      projectionEndAge: 90,
      filingStatus: "MFJ",
      enableIrmaaAwareness: true,
      currentSalary: 100000,
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      annualExpenses: 65000,
      decumulationOverrides: [
        {
          year: 2027,
          rothConversionTarget: 0.22,
          notes: "Roth conversion up to 22%",
        },
      ],
      startingBalances: {
        preTax: 700000,
        taxFree: 80000,
        afterTax: 60000,
        afterTaxBasis: 35000,
        hsa: 30000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 620000,
          roth: 80000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 30000 },
        ira: { structure: "roth_traditional", traditional: 80000, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 60000,
          basis: 35000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 29: Roth conversion + ACA subsidy window (pre-65)", () => {
    // Early retiree age 55, no SS yet, ACA-sensitive income window
    const input = makeInput({
      currentAge: 50,
      retirementAge: 55,
      projectionEndAge: 90,
      filingStatus: "MFJ",
      currentSalary: 140000,
      socialSecurityAnnual: 28000,
      ssStartAge: 67,
      annualExpenses: 65000,
      decumulationOverrides: [
        {
          year: 2030,
          rothConversionTarget: 0.12,
          notes: "ACA-constrained Roth ladder",
        },
      ],
      startingBalances: {
        preTax: 400000,
        taxFree: 60000,
        afterTax: 120000,
        afterTaxBasis: 70000,
        hsa: 35000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 350000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 35000 },
        ira: { structure: "roth_traditional", traditional: 50000, roth: 10000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 120000,
          basis: 70000,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 30: Roth conversion skipped — zero brokerage balance", () => {
    // No brokerage, all funds in traditional; conversion still possible from cash flow
    const input = makeInput({
      currentAge: 60,
      retirementAge: 65,
      projectionEndAge: 90,
      filingStatus: "Single",
      currentSalary: 80000,
      socialSecurityAnnual: 20000,
      ssStartAge: 67,
      annualExpenses: 50000,
      decumulationOverrides: [
        {
          year: 2030,
          rothConversionTarget: 0.22,
          notes: "Convert when possible",
        },
      ],
      startingBalances: {
        preTax: 350000,
        taxFree: 30000,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 15000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 320000,
          roth: 30000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 15000 },
        ira: { structure: "roth_traditional", traditional: 30000, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  // -------------------------------------------------------------------------
  // Fixtures 31–62: Advanced engine interactions
  // -------------------------------------------------------------------------

  it("fixture 31: RMD + Roth conversion + IRMAA — triple interaction", () => {
    const input = makeInput({
      currentAge: 72,
      retirementAge: 65,
      projectionEndAge: 95,
      birthYear: 1953,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: true,
      socialSecurityAnnual: 42000,
      ssStartAge: 70,
      annualExpenses: 70000,
      startingBalances: {
        preTax: 1200000,
        taxFree: 150000,
        afterTax: 200000,
        afterTaxBasis: 120000,
        hsa: 40000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 900000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 40000 },
        ira: {
          structure: "roth_traditional",
          traditional: 200000,
          roth: 50000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 200000,
          basis: 120000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
          enableRothConversions: true,
          rothConversionTarget: 0.22,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
            { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
          ],
          grossUpForTaxes: true,
          taxMultiplier: 1.0,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 32: Guyton-Klinger — upper guardrail triggers spending increase", () => {
    // Strong returns make currentRate < initialRate × upperGuardrail → spending increases
    const input = makeInput({
      currentAge: 66,
      retirementAge: 65,
      projectionEndAge: 95,
      currentSalary: 0,
      annualExpenses: 60000,
      returnRates: [{ label: "10%", rate: 0.1 }], // strong returns
      startingBalances: {
        preTax: 800000,
        taxFree: 300000,
        afterTax: 200000,
        afterTaxBasis: 120000,
        hsa: 30000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 600000,
          roth: 200000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 30000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 200000,
          basis: 120000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        withdrawalStrategy: "guyton_klinger",
        strategyParams: {
          guyton_klinger: {
            upperGuardrail: 0.8,
            lowerGuardrail: 1.2,
            increasePercent: 0.1,
            decreasePercent: 0.1,
            skipInflationAfterLoss: true,
          },
        },
        distributionTaxRates: {
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 33: Guyton-Klinger — lower guardrail triggers spending decrease", () => {
    // Poor returns make currentRate > initialRate × lowerGuardrail → spending decreases
    const input = makeInput({
      currentAge: 66,
      retirementAge: 65,
      projectionEndAge: 95,
      currentSalary: 0,
      annualExpenses: 80000,
      returnRates: [{ label: "2%", rate: 0.02 }], // poor returns
      startingBalances: {
        preTax: 600000,
        taxFree: 100000,
        afterTax: 100000,
        afterTaxBasis: 60000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 450000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 80000, roth: 20000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 100000,
          basis: 60000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.05,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        withdrawalStrategy: "guyton_klinger",
        strategyParams: {
          guyton_klinger: {
            upperGuardrail: 0.8,
            lowerGuardrail: 1.2,
            increasePercent: 0.1,
            decreasePercent: 0.1,
            skipInflationAfterLoss: true,
          },
        },
        distributionTaxRates: {
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 34: Guyton-Klinger — prosperity rule skips inflation after loss year", () => {
    // skipInflationAfterLoss = true: inflation adjustment skipped when portfolio declined
    const input = makeInput({
      currentAge: 67,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      annualExpenses: 55000,
      inflationRate: 0.03,
      returnRates: [{ label: "1%", rate: 0.01 }], // below inflation = loss in real terms
      startingBalances: {
        preTax: 500000,
        taxFree: 100000,
        afterTax: 80000,
        afterTaxBasis: 50000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 400000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 50000, roth: 50000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 80000,
          basis: 50000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        withdrawalStrategy: "guyton_klinger",
        strategyParams: {
          guyton_klinger: {
            upperGuardrail: 0.8,
            lowerGuardrail: 1.2,
            increasePercent: 0.1,
            decreasePercent: 0.1,
            skipInflationAfterLoss: true,
          },
        },
        distributionTaxRates: {
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 35: G-K with budget override in a loss year", () => {
    const input = makeInput({
      currentAge: 68,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      annualExpenses: 60000,
      returnRates: [{ label: "3%", rate: 0.03 }],
      budgetOverrides: [
        { year: 2028, value: 5500, notes: "Cut budget after market dip" },
      ],
      startingBalances: {
        preTax: 400000,
        taxFree: 100000,
        afterTax: 80000,
        afterTaxBasis: 50000,
        hsa: 15000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 300000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 15000 },
        ira: { structure: "roth_traditional", traditional: 60000, roth: 40000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 80000,
          basis: 50000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        withdrawalStrategy: "guyton_klinger",
        strategyParams: {
          guyton_klinger: {
            upperGuardrail: 0.8,
            lowerGuardrail: 1.2,
            increasePercent: 0.1,
            decreasePercent: 0.1,
            skipInflationAfterLoss: true,
          },
        },
        distributionTaxRates: {
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 36: Year-0 with real YTD contributions (baseYearContributions)", () => {
    const input = makeInput({
      baseYearContributions: {
        "401k": 18000,
        "403b": 0,
        hsa: 3200,
        ira: 5500,
        brokerage: 12000,
      },
      baseYearEmployerMatch: {
        "401k": 4500,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 37: routeFromSpecs with ContributionSpec[] (dominant production path)", () => {
    const specs: ContributionSpec[] = [
      {
        category: "401k",
        name: "401k Traditional",
        method: "percent_of_salary",
        value: 0.1,
        salaryFraction: 1.0,
        baseAnnual: 15000,
        taxTreatment: "pre_tax",
      },
      {
        category: "401k",
        name: "401k Roth",
        method: "percent_of_salary",
        value: 0.05,
        salaryFraction: 1.0,
        baseAnnual: 7500,
        taxTreatment: "tax_free",
      },
      {
        category: "hsa",
        name: "HSA",
        method: "fixed_per_period",
        value: 165.38,
        salaryFraction: 1.0,
        periodsPerYear: 26,
        baseAnnual: 4300,
        taxTreatment: "hsa",
      },
      {
        category: "ira",
        name: "Roth IRA",
        method: "fixed_monthly",
        value: 583.33,
        salaryFraction: 1.0,
        baseAnnual: 7000,
        taxTreatment: "tax_free",
      },
      {
        category: "brokerage",
        name: "Brokerage",
        method: "fixed_monthly",
        value: 1000,
        salaryFraction: 1.0,
        baseAnnual: 12000,
        taxTreatment: "after_tax",
      },
    ];
    const input = makeInput({
      contributionSpecs: specs,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 38: routeFromSpecs with salary-fraction specs + employer match", () => {
    const specs: ContributionSpec[] = [
      {
        category: "401k",
        name: "401k",
        method: "percent_of_salary",
        value: 0.16,
        salaryFraction: 0.6,
        baseAnnual: 14400,
        taxTreatment: "pre_tax",
        personId: 1,
        ownerName: "Person A",
      },
      {
        category: "401k",
        name: "401k Spouse",
        method: "percent_of_salary",
        value: 0.1,
        salaryFraction: 0.4,
        baseAnnual: 6000,
        taxTreatment: "pre_tax",
        personId: 2,
        ownerName: "Person B",
      },
      {
        category: "hsa",
        name: "HSA",
        method: "fixed_per_period",
        value: 165.38,
        salaryFraction: 1.0,
        periodsPerYear: 26,
        baseAnnual: 4300,
        taxTreatment: "hsa",
      },
    ];
    const input = makeInput({
      contributionSpecs: specs,
      employerMatchRateByCategory: {
        "401k": 0.05,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 39: Individual account tracking through full projection", () => {
    const input = makeInput({
      individualAccounts: [
        {
          name: "Alice 401k Trad",
          category: "401k",
          taxType: "preTax",
          startingBalance: 60000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Alice 401k Roth",
          category: "401k",
          taxType: "taxFree",
          startingBalance: 20000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Alice HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 15000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Alice Roth IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 20000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Joint Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 30000,
          ownerName: "Alice",
          parentCategory: "Portfolio",
        },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 40: Simple mode — collapsed single-balance input (no filing status, no tax features)", () => {
    // Minimal input: no filingStatus, no birthYear, no IRMAA, no ACA
    const input = makeInput({
      currentAge: 40,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 100000,
      annualExpenses: 48000,
      returnRates: [{ label: "6%", rate: 0.06 }],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 41: rothConversionTarget override via raw scan", () => {
    const input = makeInput({
      currentAge: 66,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      birthYear: 1959,
      filingStatus: "MFJ",
      annualExpenses: 60000,
      startingBalances: {
        preTax: 800000,
        taxFree: 100000,
        afterTax: 100000,
        afterTaxBasis: 60000,
        hsa: 25000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 600000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 25000 },
        ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
        brokerage: {
          structure: "basis_tracking",
          balance: 100000,
          basis: 60000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
          enableRothConversions: true,
          rothConversionTarget: 0.12,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
          ],
        },
      },
      decumulationOverrides: [
        {
          year: 2030,
          rothConversionTarget: 0.22,
          notes: "Bump target to 22% bracket",
        },
        { year: 2035, rothConversionTarget: 0, notes: "Stop conversions" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 42: Multiple saving + withdrawal + life change overrides in same projection", () => {
    const input = makeInput({
      currentAge: 45,
      retirementAge: 60,
      projectionEndAge: 90,
      currentSalary: 200000,
      accumulationOverrides: [
        { year: 2030, contributionRate: 0.35, notes: "Kids leave home" },
        {
          year: 2035,
          contributionRate: 0.4,
          routingMode: "percentage",
          accountSplits: {
            "401k": 0.5,
            "403b": 0,
            hsa: 0.1,
            ira: 0.15,
            brokerage: 0.25,
          },
          notes: "Max savings push",
        },
      ],
      salaryOverrides: [{ year: 2032, value: 250000, notes: "Promotion" }],
      budgetOverrides: [
        { year: 2030, value: 5000, notes: "Lower budget after kids" },
      ],
      decumulationOverrides: [
        {
          year: 2040,
          withdrawalRate: 0.035,
          notes: "Conservative early retirement",
        },
        { year: 2050, withdrawalRate: 0.045, notes: "Loosen up at 70" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 43: High-income: RMD + SS + LTCG + Roth + IRMAA all active", () => {
    const input = makeInput({
      currentAge: 73,
      retirementAge: 65,
      projectionEndAge: 95,
      birthYear: 1952,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: true,
      socialSecurityAnnual: 48000,
      ssStartAge: 70,
      annualExpenses: 120000,
      startingBalances: {
        preTax: 2500000,
        taxFree: 500000,
        afterTax: 800000,
        afterTaxBasis: 400000,
        hsa: 80000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1800000,
          roth: 200000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 80000 },
        ira: {
          structure: "roth_traditional",
          traditional: 500000,
          roth: 300000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 800000,
          basis: 400000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
          enableRothConversions: true,
          rothConversionTarget: 0.22,
          rothBracketTarget: 0.22,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
            { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
            { threshold: 383900, baseWithholding: 78221, rate: 0.32 },
            { threshold: 487450, baseWithholding: 111357, rate: 0.35 },
            { threshold: 731200, baseWithholding: 196670, rate: 0.37 },
          ],
          grossUpForTaxes: true,
          taxMultiplier: 1.0,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 44: Brokerage ramp contribution across accumulation years", () => {
    const input = makeInput({
      currentAge: 30,
      retirementAge: 60,
      projectionEndAge: 90,
      currentSalary: 120000,
      brokerageContributionRamp: 2000, // +$2k/year ramp to brokerage
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 45: perPersonSalaryOverrides with asymmetric salary changes", () => {
    const input = makeInput({
      currentAge: 40,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 250000,
      salaryByPerson: { 1: 150000, 2: 100000 },
      perPersonSalaryOverrides: [
        { personId: 1, year: 2030, value: 200000 },
        { personId: 2, year: 2032, value: 0 }, // Spouse stops working
        { personId: 2, year: 2038, value: 80000 }, // Spouse returns to work
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 46: Catch-up: super catch-up ages 60-63 only", () => {
    const input = makeInput({
      currentAge: 58,
      retirementAge: 67,
      projectionEndAge: 90,
      currentSalary: 180000,
      catchupLimits: {
        "401k": 7500,
        ira: 1000,
        hsa: 1000,
        "401k_super": 11250,
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 47: Waterfall withdrawal with rothBracketTarget overlay", () => {
    const input = makeInput({
      currentAge: 66,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      filingStatus: "MFJ",
      annualExpenses: 70000,
      startingBalances: {
        preTax: 600000,
        taxFree: 200000,
        afterTax: 150000,
        afterTaxBasis: 80000,
        hsa: 30000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 450000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 30000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 150000,
          basis: 80000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
          rothBracketTarget: 0.12,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
            { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
          ],
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 48: Override: accountCaps + taxTypeCaps active simultaneously", () => {
    const input = makeInput({
      currentAge: 35,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 200000,
      accumulationOverrides: [
        {
          year: 2028,
          accountCaps: { "401k": 15000, ira: 5000 },
          taxTypeCaps: { roth: 20000 },
          notes: "Cap both per-account and cross-account Roth",
        },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 49: Override: reset: true followed by new override in later year", () => {
    const input = makeInput({
      currentAge: 35,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 150000,
      accumulationOverrides: [
        { year: 2028, contributionRate: 0.4, notes: "Aggressive savings" },
        { year: 2032, reset: true, notes: "Revert to defaults" },
        { year: 2035, contributionRate: 0.3, notes: "Moderate post-reset" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 50: HSA with employer match", () => {
    const input = makeInput({
      currentSalary: 120000,
      employerMatchRateByCategory: {
        "401k": 0.03,
        "403b": 0,
        hsa: 0.01,
        ira: 0,
        brokerage: 0,
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 51: Zero-balance account category with active withdrawal routing", () => {
    const input = makeInput({
      currentAge: 67,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      annualExpenses: 50000,
      startingBalances: {
        preTax: 300000,
        taxFree: 100000,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 200000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "hsa", "401k", "ira"],
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
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 52: 3+ individual accounts with unequal balances in same category", () => {
    const input = makeInput({
      individualAccounts: [
        {
          name: "Company 401k Trad",
          category: "401k",
          taxType: "preTax",
          startingBalance: 120000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Old 401k Trad",
          category: "401k",
          taxType: "preTax",
          startingBalance: 45000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Company 401k Roth",
          category: "401k",
          taxType: "taxFree",
          startingBalance: 20000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Trad IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 30000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Roth IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 20000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 15000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 30000,
          ownerName: "Alice",
          parentCategory: "Portfolio",
        },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 53: Waterfall withdrawal with explicit Roth preference + rothBracketTarget", () => {
    const input = makeInput({
      currentAge: 66,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      filingStatus: "MFJ",
      annualExpenses: 65000,
      startingBalances: {
        preTax: 400000,
        taxFree: 300000,
        afterTax: 100000,
        afterTaxBasis: 60000,
        hsa: 25000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 200000,
          roth: 200000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 25000 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 100000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 100000,
          basis: 60000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "roth", ira: "roth" },
        distributionTaxRates: {
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
          rothBracketTarget: 0.12,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
          ],
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 54: IRMAA awareness enabled, income near cliff", () => {
    const input = makeInput({
      currentAge: 66,
      retirementAge: 65,
      projectionEndAge: 90,
      birthYear: 1959,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: true,
      perPersonBirthYears: [1959, 1961],
      socialSecurityAnnual: 44000,
      ssStartAge: 66,
      annualExpenses: 90000,
      startingBalances: {
        preTax: 900000,
        taxFree: 200000,
        afterTax: 300000,
        afterTaxBasis: 180000,
        hsa: 40000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 700000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 40000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 300000,
          basis: 180000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
          enableRothConversions: true,
          rothConversionTarget: 0.22,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
            { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
          ],
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 55: IRMAA awareness disabled, income near cliff", () => {
    // Same as fixture 54 but with IRMAA awareness off — conversions unconstrained
    const input = makeInput({
      currentAge: 66,
      retirementAge: 65,
      projectionEndAge: 90,
      birthYear: 1959,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: false,
      perPersonBirthYears: [1959, 1961],
      socialSecurityAnnual: 44000,
      ssStartAge: 66,
      annualExpenses: 90000,
      startingBalances: {
        preTax: 900000,
        taxFree: 200000,
        afterTax: 300000,
        afterTaxBasis: 180000,
        hsa: 40000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 700000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 40000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 300000,
          basis: 180000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
          enableRothConversions: true,
          rothConversionTarget: 0.22,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
            { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
          ],
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 56: RMD excess above G-K spending (high traditional balance, low spending)", () => {
    // Very large traditional balance → RMD forces withdrawals above G-K spending level
    const input = makeInput({
      currentAge: 75,
      retirementAge: 65,
      projectionEndAge: 95,
      birthYear: 1950,
      currentSalary: 0,
      annualExpenses: 40000,
      socialSecurityAnnual: 30000,
      ssStartAge: 70,
      startingBalances: {
        preTax: 2000000,
        taxFree: 50000,
        afterTax: 50000,
        afterTaxBasis: 30000,
        hsa: 10000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1500000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 10000 },
        ira: {
          structure: "roth_traditional",
          traditional: 500000,
          roth: 50000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 50000,
          basis: 30000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        withdrawalStrategy: "guyton_klinger",
        strategyParams: {
          guyton_klinger: {
            upperGuardrail: 0.8,
            lowerGuardrail: 1.2,
            increasePercent: 0.1,
            decreasePercent: 0.1,
            skipInflationAfterLoss: true,
          },
        },
        distributionTaxRates: {
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 57: RMD forces large withdrawal with G-K active (tests interaction)", () => {
    // Moderate traditional balance but G-K would suggest low spending — RMD overrides
    const input = makeInput({
      currentAge: 76,
      retirementAge: 65,
      projectionEndAge: 95,
      birthYear: 1949,
      currentSalary: 0,
      annualExpenses: 35000,
      socialSecurityAnnual: 25000,
      ssStartAge: 70,
      returnRates: [{ label: "5%", rate: 0.05 }],
      startingBalances: {
        preTax: 1500000,
        taxFree: 30000,
        afterTax: 40000,
        afterTaxBasis: 25000,
        hsa: 8000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1200000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 8000 },
        ira: {
          structure: "roth_traditional",
          traditional: 300000,
          roth: 30000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 40000,
          basis: 25000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.035,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        withdrawalStrategy: "guyton_klinger",
        strategyParams: {
          guyton_klinger: {
            upperGuardrail: 0.8,
            lowerGuardrail: 1.2,
            increasePercent: 0.1,
            decreasePercent: 0.1,
            skipInflationAfterLoss: true,
          },
        },
        distributionTaxRates: {
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 58: Convergence loop with withdrawalAccountCaps active", () => {
    const input = makeInput({
      currentAge: 67,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 0,
      annualExpenses: 80000,
      startingBalances: {
        preTax: 500000,
        taxFree: 200000,
        afterTax: 200000,
        afterTaxBasis: 120000,
        hsa: 30000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 350000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 30000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 200000,
          basis: 120000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
      decumulationOverrides: [
        {
          year: 2028,
          withdrawalAccountCaps: { "401k": 20000, ira: 15000 },
          notes: "Cap traditional withdrawals to manage tax bracket",
        },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 59: decumulationAnnualExpenses + postRetirementInflationRate", () => {
    const input = makeInput({
      currentAge: 50,
      retirementAge: 65,
      projectionEndAge: 95,
      currentSalary: 180000,
      annualExpenses: 72000,
      inflationRate: 0.025,
      postRetirementInflationRate: 0.04, // Higher post-retirement (healthcare etc.)
      decumulationAnnualExpenses: 85000, // Reset expenses at retirement
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 60: traditionalFallbackRate with different accumulation/decumulation expenses", () => {
    const input = makeInput({
      currentAge: 55,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 160000,
      annualExpenses: 60000,
      decumulationAnnualExpenses: 50000, // Lower expenses in retirement
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
        withdrawalSplits: {
          "401k": 0.35,
          "403b": 0,
          ira: 0.25,
          brokerage: 0.3,
          hsa: 0.1,
        },
        withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
        distributionTaxRates: {
          traditionalFallbackRate: 0.15, // Low fallback — person expects low bracket
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 61: Two-person household with age gap crossing 65", () => {
    // Person 1 is 63, Person 2 is 58 — Person 1 hits 65 (Medicare) before Person 2
    const input = makeInput({
      currentAge: 63,
      retirementAge: 65,
      projectionEndAge: 95,
      birthYear: 1962,
      filingStatus: "MFJ",
      currentSalary: 220000,
      salaryByPerson: { 1: 140000, 2: 80000 },
      perPersonBirthYears: [1962, 1967], // 5-year age gap
      enableIrmaaAwareness: true,
      enableAcaAwareness: true,
      householdSize: 2,
      socialSecurityAnnual: 50000,
      ssStartAge: 67,
      startingBalances: {
        preTax: 600000,
        taxFree: 200000,
        afterTax: 150000,
        afterTaxBasis: 90000,
        hsa: 35000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 400000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 35000 },
        ira: {
          structure: "roth_traditional",
          traditional: 100000,
          roth: 100000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 150000,
          basis: 90000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        withdrawalOrder: ["brokerage", "401k", "ira", "hsa"],
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
          enableRothConversions: true,
          rothConversionTarget: 0.12,
          taxBrackets: [
            { threshold: 0, baseWithholding: 0, rate: 0.1 },
            { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
            { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
          ],
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 62: Negative salaryGrowthRate with multi-person household", () => {
    const input = makeInput({
      currentAge: 50,
      retirementAge: 65,
      projectionEndAge: 90,
      currentSalary: 300000,
      salaryGrowthRate: -0.02, // Declining salary (wind-down career)
      salaryByPerson: { 1: 200000, 2: 100000 },
      perPersonSalaryOverrides: [
        { personId: 2, year: 2033, value: 0 }, // Spouse retires early
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });
});
