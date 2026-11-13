/**
 * Engine regression pins.
 *
 * Captures calculateProjection() output for diverse fixture inputs, so a
 * refactor that changes any of it fails here and has to be explained.
 * These are regression pins, not reviewed answers: each records what the
 * code produced when it was written (its `toBe` figures included), and a
 * re-record only says the new output was accepted. The reviewed fixtures,
 * worked by hand and tied to their inputs by `reviewed.json`, are in
 * `engine-golden.test.ts`; a figure that has to be right belongs there or
 * in an answer-key file.
 */
import {
  startingBalanceGaps,
  withConsistentStart,
  makeAccumulationDefaults,
} from "../fixtures/engine-fixtures";
import { expectFirstRmdAndClaimYears } from "../fixtures/retirement-milestones";
import { describe, it, expect } from "vitest";
import { calculateProjection as runEngine } from "@/lib/pure/engine";
import { recordDrift } from "../fixtures/drift";

import type {
  ProjectionInput,
  ContributionSpec,
} from "@/lib/pure/engine/types";
import type { AccountCategory } from "@/lib/config/account-types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";

/** Every projection here is checked for indBalance/accountBalance drift (end of file). */
const drift = recordDrift(runEngine);
const calculateProjection = drift.calculate;

const AS_OF = new Date("2025-03-07");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid engine input with sensible defaults. */
function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return withConsistentStart(
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
      currentAge: 35,
      retirementYear: AS_OF.getFullYear() + 30,
      projectionEndYear: AS_OF.getFullYear() + 55,
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
        currentAge: 35,
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
      inflationRate: 0.025,
      returnRates: [{ label: "7%", rate: 0.07 }],
      socialSecurityAnnual: 36000,
      ssStartAge: 67,
      asOfDate: AS_OF,
      ...overrides,
    }),
    overrides,
  );
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
  // Every fixture's starting money agrees with itself.
  expect(startingBalanceGaps(result)).toEqual([]);
  const years = result.projectionByYear;
  const firstYear = years[0];
  const retirementYear = years.find((y) => y.phase === "decumulation");
  const lastYear = years[years.length - 1];

  return roundDeep({
    // Summary metrics
    firstOverflowYear: result.firstOverflowYear,
    firstOverflowAge: result.firstOverflowAge,
    firstOverflowAmount: result.firstOverflowAmount,
    retirementDepletionYear: result.retirementDepletionYear,
    retirementDepletionAge: result.retirementDepletionAge,
    sustainableWithdrawal: result.sustainableWithdrawal,
    accountDepletions: result.accountDepletions,
    warningCount: result.warnings.length,

    // Year 0 (base year)
    year0: firstYear
      ? {
          phase: firstYear.phase,
          allAccountsBalance: firstYear.allAccountsBalance,
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
            allAccountsBalance: retirementYear.allAccountsBalance,
            totalWithdrawal: retirementYear.totalWithdrawal,
            projectedExpenses: retirementYear.projectedExpenses,
          }
        : null,

    // Final year
    finalYear: lastYear
      ? {
          age: lastYear.age,
          allAccountsBalance: lastYear.allAccountsBalance,
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

    // T13: explicit numeric assertions on the key financial values, so a
    // failing diff reads as "sustainable withdrawal changed from X to Y"
    // instead of an opaque snapshot blob. Pinned, not reviewed (see the
    // file header).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(result.retirementDepletionYear).toBeNull();
    expect(metrics.finalYear?.allAccountsBalance).toBe(28676679.19);

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

    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(129081.08);
    expect(metrics.finalYear?.allAccountsBalance).toBe(12767930.04);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 3: all accounts maxed, overflow to brokerage", () => {
    const input = makeInput({
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.5,
        accountSplits: {
          "401k": 0.4,
          "403b": 0,
          hsa: 0.1,
          ira: 0.15,
          brokerage: 0.35,
        },
      }),
      currentSalary: 300000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    // With 50% contribution rate at $300k salary, overflow SHOULD occur
    expect(result.firstOverflowYear).not.toBeNull();
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(115900782.22);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 4: retirement phase only (age > retirement age)", () => {
    const input = makeInput({
      currentAge: 67,
      retirementYear: AS_OF.getFullYear() - 2,
      projectionEndYear: AS_OF.getFullYear() + 23,
      currentSalary: 0,
      startingBalances: {
        preTax: 550000,
        taxFree: 150000,
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
    // T13: explicit numeric assertions (see fixture 1 comment) — added
    // 2026-08-27, code review (this fixture previously relied on
    // toMatchSnapshot() alone for its financial content).
    expect(result.sustainableWithdrawal).toBe(39400);
    expect(metrics.finalYear?.allAccountsBalance).toBe(1612210.78);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 5: zero balances, zero contributions", () => {
    const input = makeInput({
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0,
        accountSplits: { "401k": 0, "403b": 0, hsa: 0, ira: 0, brokerage: 0 },
        taxSplits: { "401k": 0, ira: 0 },
      }),
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
        allocationPriority: 0,
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
        allocationPriority: 0,
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
        allocationPriority: 0,
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
        allocationPriority: 0,
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
        allocationPriority: 0,
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

    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(28805701.76);
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
      startingBalances: {
        preTax: 350000,
        taxFree: 100000,
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

    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(44813112.3);
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(178252.08);
    expect(metrics.finalYear?.allAccountsBalance).toBe(33520846.18);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 9: decumulation override with reset:true reverts to defaults", () => {
    // Drop withdrawal rate at age 70, then reset to defaults at age 80
    const input = makeInput({
      decumulationOverrides: [
        {
          year: 2060,
          notes: "Conservative early retirement",
        },
        { year: 2070, reset: true, notes: "Revert to defaults" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(28676679.19);
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
        preTax: 410000,
        taxFree: 70000,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(44813111.57);
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(173766.76);
    expect(metrics.finalYear?.allAccountsBalance).toBe(44998922.74);
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(188641.9);
    // Age 73 was $24.7k short of spending: the tax gross-up now funds what
    // routing delivers, and the percentage router places the excess of an
    // emptied account instead of dropping it — no year falls short.
    expect(metrics.finalYear?.allAccountsBalance).toBe(29395542.46);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 13: asymmetric retirement ages — early retirement at 55", () => {
    const input = makeInput({
      currentAge: 40,
      retirementYear: AS_OF.getFullYear() + 15,
      projectionEndYear: AS_OF.getFullYear() + 50,
      currentSalary: 180000,
      annualExpenses: 80000,
      startingBalances: {
        preTax: 320000,
        taxFree: 80000,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(148543.4);
    expect(metrics.finalYear?.allAccountsBalance).toBe(10962418.99);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 14: RMDs — birth year 1955 (RMD start age 73)", () => {
    // Person born 1955, currently age 68 (year 2023), RMDs kick in at 73 = year 2028
    const input = makeInput({
      currentAge: 68,
      retirementYear: AS_OF.getFullYear() - 3,
      projectionEndYear: AS_OF.getFullYear() + 22,
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

    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(39400);
    expect(result.retirementDepletionYear).toBeNull();
    expect(metrics.finalYear?.allAccountsBalance).toBe(1751834.61);

    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 15: RMDs — birth year 1965 (RMD start age 75)", () => {
    // Person born 1965, currently age 60 (year 2025), RMDs kick in at 75 = year 2040
    const input = makeInput({
      currentAge: 60,
      retirementYear: AS_OF.getFullYear() + 2,
      projectionEndYear: AS_OF.getFullYear() + 30,
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

    // T13: explicit numeric assertions (see fixture 1 comment). This
    // fixture ran out at 87 until Social Security got its COLA (v0.9.5):
    // the benefit keeping pace with spending now carries it through.
    expect(result.sustainableWithdrawal).toBe(74082.52);
    expect(result.retirementDepletionYear).toBeNull();
    expect(result.retirementDepletionAge).toBeNull();
    expect(metrics.finalYear?.allAccountsBalance).toBeGreaterThan(0);

    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 16: RMD forces withdrawal above bracket-filling preference", () => {
    // Large traditional balance + bracket_filling mode → RMD overrides routing
    const input = makeInput({
      currentAge: 70,
      retirementYear: AS_OF.getFullYear() - 5,
      projectionEndYear: AS_OF.getFullYear() + 20,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
      startingBalances: {
        preTax: 1200000,
        taxFree: 100000,
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

    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(26579.49);
    expect(result.retirementDepletionYear).toBeNull();
    expect(metrics.finalYear?.allAccountsBalance).toBe(3436611.41);

    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 17: RMD + Roth conversion targeting", () => {
    // RMD year with a decumulation override setting rothConversionTarget
    const input = makeInput({
      currentAge: 70,
      retirementYear: AS_OF.getFullYear() - 5,
      projectionEndYear: AS_OF.getFullYear() + 20,
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
        taxFree: 100000,
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

    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(39243.59);
    expect(result.retirementDepletionYear).toBeNull();
    expect(metrics.finalYear?.allAccountsBalance).toBe(1968430.08);

    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 18: portfolio depletion — very low balance, high expenses", () => {
    const input = makeInput({
      currentAge: 65,
      retirementYear: AS_OF.getFullYear() + 0,
      projectionEndYear: AS_OF.getFullYear() + 25,
      currentSalary: 0,
      socialSecurityAnnual: 18000,
      ssStartAge: 67,
      annualExpenses: 80000,
      startingBalances: {
        preTax: 90000,
        taxFree: 30000,
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

    // T13: explicit numeric assertions (see fixture 1 comment). $145k
    // against an $80k spend with $18k of Social Security runs out in the
    // second year.
    expect(result.sustainableWithdrawal).toBe(100620.84);
    expect(result.retirementDepletionYear).toBe(2027);
    expect(metrics.finalYear?.allAccountsBalance).toBe(0);

    expect(metrics).toMatchSnapshot();
  });

  it("fixture 19: brokerage-heavy portfolio — goals tracking", () => {
    const input = makeInput({
      currentAge: 35,
      retirementYear: AS_OF.getFullYear() + 25,
      projectionEndYear: AS_OF.getFullYear() + 55,
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
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.2,
        accountSplits: {
          "401k": 0.1,
          "403b": 0,
          hsa: 0.05,
          ira: 0.1,
          brokerage: 0.75,
        },
      }),
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(213916.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(34295569.56);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 20: catch-up contributions — age 50, 60–63 super catch-up", () => {
    // Starts at age 49, crosses age 50 and 60 during projection
    const input = makeInput({
      currentAge: 49,
      retirementYear: AS_OF.getFullYear() + 16,
      projectionEndYear: AS_OF.getFullYear() + 41,
      currentSalary: 160000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);

    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(137031.28);
    expect(result.retirementDepletionYear).toBeNull();
    expect(metrics.finalYear?.allAccountsBalance).toBe(4766541.35);

    expect(metrics).toMatchSnapshot();
  });

  it("fixture 21: SS torpedo — MFJ filing status", () => {
    // With MFJ filing status, SS taxation thresholds differ from Single
    const input = makeInput({
      currentAge: 60,
      retirementYear: AS_OF.getFullYear() + 5,
      projectionEndYear: AS_OF.getFullYear() + 30,
      filingStatus: "MFJ",
      socialSecurityAnnual: 48000,
      ssStartAge: 67,
      annualExpenses: 70000,
      currentSalary: 0,
      startingBalances: {
        preTax: 580000,
        taxFree: 120000,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(101536.63);
    expect(metrics.finalYear?.allAccountsBalance).toBe(2092232.62);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 22: SS torpedo — Single filing status", () => {
    const input = makeInput({
      currentAge: 60,
      retirementYear: AS_OF.getFullYear() + 5,
      projectionEndYear: AS_OF.getFullYear() + 30,
      filingStatus: "Single",
      socialSecurityAnnual: 24000,
      ssStartAge: 67,
      annualExpenses: 55000,
      currentSalary: 0,
      startingBalances: {
        preTax: 390000,
        taxFree: 70000,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(79778.79);
    expect(metrics.finalYear?.allAccountsBalance).toBe(+0);
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(174797.29);
    expect(metrics.finalYear?.allAccountsBalance).toBe(24424845.4);
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(161351.35);
    expect(metrics.finalYear?.allAccountsBalance).toBe(31418671.61);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 25: LTCG 0% zone — low income retiree stays in 0% bracket", () => {
    // Low annual expenses + modest SS → expect 0% LTCG rate on brokerage withdrawals
    const input = makeInput({
      currentAge: 65,
      retirementYear: AS_OF.getFullYear() + 0,
      projectionEndYear: AS_OF.getFullYear() + 25,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.12,
          roth: 0,
          hsa: 0,
          brokerage: 0.0,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(10250);
    expect(metrics.finalYear?.allAccountsBalance).toBe(1722197.59);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 26: LTCG 15%/20% zone — higher income retiree", () => {
    const input = makeInput({
      currentAge: 65,
      retirementYear: AS_OF.getFullYear() + 0,
      projectionEndYear: AS_OF.getFullYear() + 25,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(79876.46);
    expect(metrics.finalYear?.allAccountsBalance).toBe(1285511.21);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 27: Roth conversion enabled via filingStatus — converts from brokerage proceeds", () => {
    // filingStatus triggers automatic Roth conversion logic in the engine
    const input = makeInput({
      currentAge: 55,
      retirementYear: AS_OF.getFullYear() + 10,
      projectionEndYear: AS_OF.getFullYear() + 35,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(114879.39);
    expect(metrics.finalYear?.allAccountsBalance).toBe(3912631.22);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 28: Roth conversion constrained near IRMAA cliff", () => {
    const input = makeInput({
      currentAge: 63,
      retirementYear: AS_OF.getFullYear() + 2,
      projectionEndYear: AS_OF.getFullYear() + 27,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(87552.1);
    expect(metrics.finalYear?.allAccountsBalance).toBe(1363923.28);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 29: Roth conversion + ACA subsidy window (pre-65)", () => {
    // Early retiree age 55, no SS yet, ACA-sensitive income window
    const input = makeInput({
      currentAge: 50,
      retirementYear: AS_OF.getFullYear() + 5,
      projectionEndYear: AS_OF.getFullYear() + 40,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(94284.02);
    expect(result.retirementDepletionYear).toBe(2051);
    expect(result.retirementDepletionAge).toBe(76);
    expect(metrics.finalYear?.allAccountsBalance).toBe(0);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 30: Roth conversion skipped — zero brokerage balance", () => {
    // No brokerage, all funds in traditional; conversion still possible from cash flow
    const input = makeInput({
      currentAge: 60,
      retirementYear: AS_OF.getFullYear() + 5,
      projectionEndYear: AS_OF.getFullYear() + 30,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(72526.17);
    expect(result.retirementDepletionYear).toBe(2050);
    expect(result.retirementDepletionAge).toBe(85);
    expect(metrics.finalYear?.allAccountsBalance).toBe(0);
    expect(metrics).toMatchSnapshot();
  });

  // -------------------------------------------------------------------------
  // Fixtures 31–62: Advanced engine interactions
  // -------------------------------------------------------------------------

  it("fixture 31: RMD + Roth conversion + IRMAA — triple interaction", () => {
    const input = makeInput({
      currentAge: 72,
      retirementYear: AS_OF.getFullYear() - 7,
      projectionEndYear: AS_OF.getFullYear() + 23,
      birthYear: 1953,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: true,
      socialSecurityAnnual: 42000,
      ssStartAge: 70,
      annualExpenses: 70000,
      startingBalances: {
        preTax: 1100000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(28010.2);
    // rmd-enforcement.ts's rounding-
    // residual fallback no longer force-feeds a genuine capacity shortfall
    // past an account's real remaining room.
    // No `taxDataYear` here, so no table grows (one rule for every table,
    // v0.9.0) -- IRMAA alone used to grow from a built-in 2026. This
    // fixture's conversions are IRMAA-cliff-aware, so that moved the final
    // balance. Growth itself is covered in bracket-growth.test.ts.
    // v0.9.2: the shipped 2026 IRMAA table was corrected to CMS's (it held
    // 2024 thresholds and estimated surcharges) — cliffs moved up, surcharges
    // too.
    expect(metrics.finalYear?.allAccountsBalance).toBe(4132183.48);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 32: Guyton-Klinger — upper guardrail triggers spending increase", () => {
    // Strong returns make currentRate < initialRate × upperGuardrail → spending increases
    const input = makeInput({
      currentAge: 66,
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 29,
      currentSalary: 0,
      annualExpenses: 60000,
      returnRates: [{ label: "10%", rate: 0.1 }], // strong returns
      startingBalances: {
        preTax: 700000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    // The guardrail this fixture is named for still fires.
    expect(
      result.projectionByYear.some(
        (y) => y.phase === "decumulation" && y.strategyAction === "increase",
      ),
    ).toBe(true);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(63829.79);
    expect(metrics.finalYear?.allAccountsBalance).toBe(9258527.09);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 33: Guyton-Klinger — lower guardrail triggers spending decrease", () => {
    // Poor returns make currentRate > initialRate × lowerGuardrail → spending decreases.
    // Each cut is 10% of the portfolio draw (Guyton-Klinger's rule), which
    // at 2% returns doesn't stop the drain — the plan runs out (final 0).
    // Cutting 10% of all spending, Social Security's share included, used
    // to over-cut and leave $331k.
    const input = makeInput({
      currentAge: 66,
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 29,
      currentSalary: 0,
      annualExpenses: 80000,
      returnRates: [{ label: "2%", rate: 0.02 }], // poor returns
      startingBalances: {
        preTax: 530000,
        taxFree: 70000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    // The guardrail this fixture is named for still fires.
    expect(
      result.projectionByYear.some(
        (y) => y.phase === "decumulation" && y.strategyAction === "decrease",
      ),
    ).toBe(true);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(85106.38);
    expect(metrics.finalYear?.allAccountsBalance).toBe(0);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 34: Guyton-Klinger — prosperity rule skips inflation after loss year", () => {
    // skipInflationAfterLoss = true: inflation adjustment skipped when portfolio declined
    const input = makeInput({
      currentAge: 67,
      retirementYear: AS_OF.getFullYear() - 2,
      projectionEndYear: AS_OF.getFullYear() + 23,
      currentSalary: 0,
      annualExpenses: 55000,
      inflationRate: 0.03,
      returnRates: [{ label: "1%", rate: 0.01 }], // below inflation = loss in real terms
      startingBalances: {
        preTax: 450000,
        taxFree: 150000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(27265.69);
    expect(metrics.finalYear?.allAccountsBalance).toBe(169286.9);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 35: G-K with budget override in a loss year", () => {
    const input = makeInput({
      currentAge: 68,
      retirementYear: AS_OF.getFullYear() - 3,
      projectionEndYear: AS_OF.getFullYear() + 22,
      currentSalary: 0,
      annualExpenses: 60000,
      returnRates: [{ label: "3%", rate: 0.03 }],
      budgetOverrides: [
        { year: 2028, value: 5500, notes: "Cut budget after market dip" },
      ],
      startingBalances: {
        preTax: 360000,
        taxFree: 140000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(32563.71);
    expect(metrics.finalYear?.allAccountsBalance).toBe(157559.07);
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(28717530.67);
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
        allocationPriority: 0,
      },
      {
        category: "401k",
        name: "401k Roth",
        method: "percent_of_salary",
        value: 0.05,
        salaryFraction: 1.0,
        baseAnnual: 7500,
        taxTreatment: "tax_free",
        allocationPriority: 0,
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
        allocationPriority: 0,
      },
      {
        category: "ira",
        name: "Roth IRA",
        method: "fixed_monthly",
        value: 583.33,
        salaryFraction: 1.0,
        baseAnnual: 7000,
        taxTreatment: "tax_free",
        allocationPriority: 0,
      },
      {
        category: "brokerage",
        name: "Brokerage",
        method: "fixed_monthly",
        value: 1000,
        salaryFraction: 1.0,
        baseAnnual: 12000,
        taxTreatment: "after_tax",
        allocationPriority: 0,
      },
    ];
    const input = makeInput({
      contributionSpecs: specs,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(28676678.8);
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
        allocationPriority: 0,
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
        allocationPriority: 0,
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
        allocationPriority: 0,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(21030941.12);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 39: Individual account tracking through full projection", () => {
    const input = makeInput({
      individualAccounts: [
        {
          name: "Alice 401k Trad",
          category: "401k",
          taxType: "preTax",
          startingBalance: 80000,
          ownerName: "Alice",
          parentCategory: "Retirement",
        },
        {
          name: "Alice Trad IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 30000,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(28676679.19);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 40: Simple mode — collapsed single-balance input (no filing status, no tax features)", () => {
    // Minimal input: no filingStatus, no birthYear, no IRMAA, no ACA
    const input = makeInput({
      currentAge: 40,
      retirementYear: AS_OF.getFullYear() + 25,
      projectionEndYear: AS_OF.getFullYear() + 50,
      currentSalary: 100000,
      annualExpenses: 48000,
      returnRates: [{ label: "6%", rate: 0.06 }],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(114088.87);
    expect(metrics.finalYear?.allAccountsBalance).toBe(8925786.96);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 41: rothConversionTarget override via raw scan", () => {
    const input = makeInput({
      currentAge: 66,
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 24,
      currentSalary: 0,
      birthYear: 1959,
      filingStatus: "MFJ",
      annualExpenses: 60000,
      startingBalances: {
        preTax: 700000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(60000);
    expect(metrics.finalYear?.allAccountsBalance).toBe(2199785.15);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 42: Multiple saving + withdrawal + life change overrides in same projection", () => {
    const input = makeInput({
      currentAge: 45,
      retirementYear: AS_OF.getFullYear() + 15,
      projectionEndYear: AS_OF.getFullYear() + 45,
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
          notes: "Conservative early retirement",
        },
        { year: 2050, notes: "Loosen up at 70" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(98468.03);
    expect(metrics.finalYear?.allAccountsBalance).toBe(13400949.96);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 43: High-income: RMD + SS + LTCG + Roth + IRMAA all active", () => {
    const input = makeInput({
      currentAge: 73,
      retirementYear: AS_OF.getFullYear() - 8,
      projectionEndYear: AS_OF.getFullYear() + 22,
      birthYear: 1952,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: true,
      socialSecurityAnnual: 48000,
      ssStartAge: 70,
      annualExpenses: 120000,
      startingBalances: {
        preTax: 2300000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(91130.77);
    expect(metrics.finalYear?.allAccountsBalance).toBe(9764296.08);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 44: Brokerage ramp contribution across accumulation years", () => {
    const input = makeInput({
      currentAge: 30,
      retirementYear: AS_OF.getFullYear() + 30,
      projectionEndYear: AS_OF.getFullYear() + 60,
      currentSalary: 120000,
      brokerageContributionRamp: 2000, // +$2k/year ramp to brokerage
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(42537701.82);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 45: perPersonSalaryOverrides with asymmetric salary changes", () => {
    const input = makeInput({
      currentAge: 40,
      retirementYear: AS_OF.getFullYear() + 25,
      projectionEndYear: AS_OF.getFullYear() + 50,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(171133.3);
    expect(metrics.finalYear?.allAccountsBalance).toBe(26317859.17);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 46: Catch-up: super catch-up ages 60-63 only", () => {
    const input = makeInput({
      currentAge: 58,
      retirementYear: AS_OF.getFullYear() + 9,
      projectionEndYear: AS_OF.getFullYear() + 32,
      currentSalary: 180000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(68418.48);
    expect(metrics.finalYear?.allAccountsBalance).toBe(700960.74);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 47: Waterfall withdrawal with rothBracketTarget overlay", () => {
    const input = makeInput({
      currentAge: 66,
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 24,
      currentSalary: 0,
      filingStatus: "MFJ",
      annualExpenses: 70000,
      startingBalances: {
        preTax: 550000,
        taxFree: 150000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(79018.18);
    expect(metrics.finalYear?.allAccountsBalance).toBe(1165937.4);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 48: Override: accountCaps + taxTypeCaps active simultaneously", () => {
    const input = makeInput({
      currentAge: 35,
      retirementYear: AS_OF.getFullYear() + 30,
      projectionEndYear: AS_OF.getFullYear() + 55,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(39113750.44);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 49: Override: reset: true followed by new override in later year", () => {
    const input = makeInput({
      currentAge: 35,
      retirementYear: AS_OF.getFullYear() + 30,
      projectionEndYear: AS_OF.getFullYear() + 55,
      currentSalary: 150000,
      accumulationOverrides: [
        { year: 2028, contributionRate: 0.4, notes: "Aggressive savings" },
        { year: 2032, reset: true, notes: "Revert to defaults" },
        { year: 2035, contributionRate: 0.3, notes: "Moderate post-reset" },
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(34831773.84);
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(23309040.67);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 51: Zero-balance account category with active withdrawal routing", () => {
    const input = makeInput({
      currentAge: 67,
      retirementYear: AS_OF.getFullYear() - 2,
      projectionEndYear: AS_OF.getFullYear() + 23,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(26579.49);
    expect(metrics.finalYear?.allAccountsBalance).toBe(149134.86);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 52: 3+ individual accounts with unequal balances in same category", () => {
    const input = makeInput({
      // The 401(k) category holds what its three accounts add up to.
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 165000,
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(193621.62);
    expect(metrics.finalYear?.allAccountsBalance).toBe(32149076.27);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 53: Waterfall withdrawal with explicit Roth preference + rothBracketTarget", () => {
    const input = makeInput({
      currentAge: 66,
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 24,
      currentSalary: 0,
      filingStatus: "MFJ",
      annualExpenses: 65000,
      startingBalances: {
        preTax: 200000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(65000);
    expect(metrics.finalYear?.allAccountsBalance).toBe(552170.59);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 54: IRMAA awareness enabled, income near cliff", () => {
    const input = makeInput({
      currentAge: 66,
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 24,
      birthYear: 1959,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: true,
      perPersonBirthYears: [1959, 1961],
      socialSecurityAnnual: 44000,
      ssStartAge: 66,
      annualExpenses: 90000,
      startingBalances: {
        preTax: 800000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(46428.57);
    // Same rmd-enforcement.ts residual fix
    // as fixture 31.
    // No `taxDataYear`, so IRMAA stays flat like every other table (it
    // alone used to grow from a built-in 2026; v0.9.0). v0.9.2: the
    // corrected 2026 IRMAA table, as fixture 31.
    expect(metrics.finalYear?.allAccountsBalance).toBe(2508447.2);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 55: IRMAA awareness disabled, income near cliff", () => {
    // Same as fixture 54 but with IRMAA awareness off — conversions unconstrained
    const input = makeInput({
      currentAge: 66,
      retirementYear: AS_OF.getFullYear() - 1,
      projectionEndYear: AS_OF.getFullYear() + 24,
      birthYear: 1959,
      filingStatus: "MFJ",
      currentSalary: 0,
      enableIrmaaAwareness: false,
      perPersonBirthYears: [1959, 1961],
      socialSecurityAnnual: 44000,
      ssStartAge: 66,
      annualExpenses: 90000,
      startingBalances: {
        preTax: 800000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(46428.57);
    // Same rmd-enforcement.ts residual fix
    // as fixture 31.
    expect(metrics.finalYear?.allAccountsBalance).toBe(2502570.34);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 56: RMD excess above G-K spending (high traditional balance, low spending)", () => {
    // Very large traditional balance → RMD forces withdrawals above G-K spending level
    const input = makeInput({
      currentAge: 75,
      retirementYear: AS_OF.getFullYear() - 10,
      projectionEndYear: AS_OF.getFullYear() + 20,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(17148.94);
    expect(metrics.finalYear?.allAccountsBalance).toBe(5843935.86);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 57: RMD forces large withdrawal with G-K active (tests interaction)", () => {
    // Moderate traditional balance but G-K would suggest low spending — RMD overrides
    const input = makeInput({
      currentAge: 76,
      retirementYear: AS_OF.getFullYear() - 11,
      projectionEndYear: AS_OF.getFullYear() + 19,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(15549.67);
    expect(metrics.finalYear?.allAccountsBalance).toBe(2786319.24);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 58: Convergence loop with withdrawalAccountCaps active", () => {
    const input = makeInput({
      currentAge: 67,
      retirementYear: AS_OF.getFullYear() - 2,
      projectionEndYear: AS_OF.getFullYear() + 23,
      currentSalary: 0,
      annualExpenses: 80000,
      startingBalances: {
        preTax: 450000,
        taxFree: 150000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(53970.21);
    expect(metrics.finalYear?.allAccountsBalance).toBe(1419653.05);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 59: decumulationAnnualExpenses + postRetirementInflationRate", () => {
    const input = makeInput({
      currentAge: 50,
      retirementYear: AS_OF.getFullYear() + 15,
      projectionEndYear: AS_OF.getFullYear() + 45,
      currentSalary: 180000,
      annualExpenses: 72000,
      inflationRate: 0.025,
      postRetirementInflationRate: 0.04, // Higher post-retirement (healthcare etc.)
      decumulationAnnualExpenses: 85000, // Reset expenses at retirement
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(157827.36);
    expect(metrics.finalYear?.allAccountsBalance).toBe(+0);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 60: traditionalFallbackRate with different accumulation/decumulation expenses", () => {
    const input = makeInput({
      currentAge: 55,
      retirementYear: AS_OF.getFullYear() + 10,
      projectionEndYear: AS_OF.getFullYear() + 35,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.15, // Low fallback — person expects low bracket
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(71769.68);
    expect(metrics.finalYear?.allAccountsBalance).toBe(3165727.32);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 61: Two-person household with age gap crossing 65", () => {
    // Person 1 is 63, Person 2 is 58 — Person 1 hits 65 (Medicare) before Person 2
    const input = makeInput({
      currentAge: 63,
      retirementYear: AS_OF.getFullYear() + 2,
      projectionEndYear: AS_OF.getFullYear() + 32,
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
        preTax: 500000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(75645);
    expect(metrics.finalYear?.allAccountsBalance).toBe(3976345.2);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 62: Negative salaryGrowthRate with multi-person household", () => {
    const input = makeInput({
      currentAge: 50,
      retirementYear: AS_OF.getFullYear() + 15,
      projectionEndYear: AS_OF.getFullYear() + 40,
      currentSalary: 300000,
      salaryGrowthRate: -0.02, // Declining salary (wind-down career)
      salaryByPerson: { 1: 200000, 2: 100000 },
      perPersonSalaryOverrides: [
        { personId: 2, year: 2033, value: 0 }, // Spouse retires early
      ],
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(133689.06);
    expect(metrics.finalYear?.allAccountsBalance).toBe(6723408.22);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 63: high-income single earner $250k (single-filer thresholds)", () => {
    // Exercises single-filer code paths at high income: 32% federal bracket,
    // single-filer standard deduction, single SS torpedo thresholds, IRMAA
    // cliffs at the single-filer half-size levels, ACA household-of-1 caps.
    // Complements fixture 2 ($85k single) at the opposite end of the income curve.
    const input = makeInput({
      currentAge: 40,
      retirementYear: AS_OF.getFullYear() + 25,
      projectionEndYear: AS_OF.getFullYear() + 50,
      currentSalary: 250000,
      filingStatus: "Single",
      householdSize: 1,
      enableIrmaaAwareness: true,
      enableAcaAwareness: true,
      startingBalances: {
        preTax: 240000,
        taxFree: 110000,
        afterTax: 80000,
        afterTaxBasis: 60000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 200000,
          roth: 50000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 40000, roth: 60000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 80000,
          basis: 60000,
        },
      },
      annualExpenses: 120000,
      socialSecurityAnnual: 42000,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment).
    expect(result.sustainableWithdrawal).toBe(285222.17);
    expect(metrics.finalYear?.allAccountsBalance).toBe(29171675);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 64: pre-retiree age 60 at the accumulation→decumulation cusp", () => {
    // Exercises the 5-year-to-retirement window with a near-peak portfolio:
    // super catch-up at ages 60-63, return-dominated growth (short horizon),
    // and the transition into decumulation at 65. Complements fixture 20
    // (catch-up at 50) and fixture 4 (already retired at 67).
    const input = makeInput({
      currentAge: 60,
      retirementYear: AS_OF.getFullYear() + 5,
      projectionEndYear: AS_OF.getFullYear() + 30,
      currentSalary: 180000,
      filingStatus: "MFJ",
      birthYear: 1966,
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.3,
        accountSplits: {
          "401k": 0.4,
          "403b": 0,
          hsa: 0.1,
          ira: 0.15,
          brokerage: 0.35,
        },
      }),
      startingBalances: {
        preTax: 800000,
        taxFree: 150000,
        afterTax: 200000,
        afterTaxBasis: 150000,
        hsa: 50000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 600000,
          roth: 100000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 50000 },
        ira: {
          structure: "roth_traditional",
          traditional: 200000,
          roth: 50000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 200000,
          basis: 150000,
        },
      },
      annualExpenses: 80000,
      ssStartAge: 67,
    });
    const result = calculateProjection(input);
    const metrics = extractMetrics(result);
    // T13: explicit numeric assertions (see fixture 1 comment) — added
    // 2026-08-27, code review (this fixture previously relied on
    // toMatchSnapshot() alone for its financial content).
    expect(result.sustainableWithdrawal).toBe(116041.87);
    expect(metrics.finalYear?.allAccountsBalance).toBe(4549937.43);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  // QCD + rmdExcessHandling fixtures. All three share the same
  // household shape (per-person RMD tracking via individualAccounts +
  // socialSecurityEntries, required for qcdMaximize to take effect —
  // see qcd.ts's docblock) so the only variable between them is the QCD
  // settings themselves.
  /** Fixture 65's household (one QCD-eligible IRA owner at 75). */
  const qcdHousehold = () =>
    makeInput({
      currentAge: 75,
      retirementYear: AS_OF.getFullYear() - 10,
      projectionEndYear: AS_OF.getFullYear() + 10,
      birthYear: 1950,
      currentSalary: 0,
      annualExpenses: 40000,
      socialSecurityAnnual: 30000,
      ssStartAge: 70,
      socialSecurityEntries: [
        {
          personId: 1,
          personName: "Alice",
          birthYear: 1950,
          startAge: 70,
          annualAmount: 30000,
        },
      ],
      individualAccounts: [
        {
          name: "Alice 401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 1200000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 800000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice IRA Roth",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 50000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 10000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 50000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
      ],
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
          traditional: 1200000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 10000 },
        ira: {
          structure: "roth_traditional",
          traditional: 800000,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
        qcdMaximize: true,
        rmdExcessHandling: "reinvest",
      },
    });

  it("fixture 65: qcdMaximize fully covers a modest RMD (no taxable distribution forced)", () => {
    const input = qcdHousehold();
    const result = calculateProjection(input);
    const decYears = result.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    // RMD ($81,300.81 at age 75) is well under the IRA Traditional
    // balance ($800k), and QCD is no longer capped at the RMD amount
    // (a QCD can legally exceed the RMD, up to the annual per-person limit,
    // $111k for 2026 — IRS Notice 2025-67) — so QCD maximizes to the limit
    // itself, still comfortably covering the RMD with room to spare,
    // so no taxable Traditional distribution is forced and there's no
    // leftover excess to reinvest.
    expect(decYears[0]?.rmdAmount).toBe(81300.81);
    expect(decYears[0]?.qcdAmount).toBe(111000);
    expect(decYears[0]?.totalTraditionalWithdrawal).toBe(0);
    expect(decYears[0]?.rmdExcessAmount).toBe(0);
    const metrics = extractMetrics(result);
    // The QCD debit now applies directly
    // to the IRA's individual-account balance instead of being deferred to
    // reconcileIndividualToAggregate — the withdrawal fan-out now correctly
    // sees the post-QCD capacity mid-year instead of a stale pre-QCD figure,
    // so it can no longer over-draw the account for spending need before
    // reconcile silently "fixes" the balance at year-end.
    // Lower than before the QCD-cap fix (was 2499086.87) — the extra
    // ~$33.7k/yr now going out as QCD (maximized to the cap instead of
    // stopping at the RMD) never gets to compound in the account across
    // the remaining 10-year horizon, same direction the allAccountsBalance drop
    // in fixture 66/67 shows.
    expect(metrics.finalYear?.allAccountsBalance).toBe(2242061.03);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("the QCD limit grows with inflation from its tax year", () => {
    // Not a snapshot: a projection with tax years threaded (as production
    // always does) grows the per-person limit like the standard deduction.
    const base = qcdHousehold();
    const input = {
      ...base,
      decumulationDefaults: {
        ...base.decumulationDefaults,
        distributionTaxRates: {
          ...base.decumulationDefaults.distributionTaxRates,
          taxDataYear: 2026,
        },
      },
    };
    const decYears = calculateProjection(input).projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    for (const y of decYears.slice(0, 4)) {
      const limit =
        111000 * Math.pow(1 + input.inflationRate, Math.max(0, y.year - 2026));
      expect(y.qcdAmount, String(y.year)).toBeCloseTo(limit, 1);
    }
  });

  it("fixture 66: qcdMaximize capped below a large RMD — remainder still forces a taxable distribution + reinvested excess", () => {
    const input = makeInput({
      currentAge: 75,
      retirementYear: AS_OF.getFullYear() - 10,
      projectionEndYear: AS_OF.getFullYear() + 3,
      birthYear: 1950,
      currentSalary: 0,
      annualExpenses: 40000,
      socialSecurityAnnual: 30000,
      ssStartAge: 70,
      socialSecurityEntries: [
        {
          personId: 1,
          personName: "Alice",
          birthYear: 1950,
          startAge: 70,
          annualAmount: 30000,
        },
      ],
      individualAccounts: [
        {
          name: "Alice 401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 3200000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 2800000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 50000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
      ],
      startingBalances: {
        preTax: 6000000,
        taxFree: 0,
        afterTax: 50000,
        afterTaxBasis: 30000,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 3200000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: {
          structure: "roth_traditional",
          traditional: 2800000,
          roth: 0,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
        qcdMaximize: true,
        rmdExcessHandling: "reinvest",
      },
    });
    const result = calculateProjection(input);
    const decYears = result.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    // RMD ($243,902.44 at age 75) exceeds the per-person QCD limit ($111k
    // for 2026, from the tax data) — QCD caps at exactly $111,000, and
    // enforceRmd still forces the remaining $132,902.44 through as a real
    // taxable Traditional distribution.
    expect(decYears[0]?.rmdAmount).toBe(243902.44);
    expect(decYears[0]?.qcdAmount).toBe(111000);
    expect(decYears[0]?.totalTraditionalWithdrawal).toBe(132902.44);
    const metrics = extractMetrics(result);
    // Same fix as fixture 65. Lower
    // than before the QCD-cap fix (was 6893089.39) — the extra $10k/yr
    // QCD (cap raised 105k->115k) leaves the account as charity instead
    // of compounding.
    expect(metrics.finalYear?.allAccountsBalance).toBe(6848515.19);
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 67: same as fixture 66 but rmdExcessHandling='spend' — lower end balance, by design", () => {
    const input = makeInput({
      currentAge: 75,
      retirementYear: AS_OF.getFullYear() - 10,
      projectionEndYear: AS_OF.getFullYear() + 3,
      birthYear: 1950,
      currentSalary: 0,
      annualExpenses: 40000,
      socialSecurityAnnual: 30000,
      ssStartAge: 70,
      socialSecurityEntries: [
        {
          personId: 1,
          personName: "Alice",
          birthYear: 1950,
          startAge: 70,
          annualAmount: 30000,
        },
      ],
      individualAccounts: [
        {
          name: "Alice 401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 3200000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice IRA",
          category: "ira",
          taxType: "preTax",
          startingBalance: 2800000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
        {
          name: "Alice Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 50000,
          ownerName: "Alice",
          ownerPersonId: 1,
        },
      ],
      startingBalances: {
        preTax: 6000000,
        taxFree: 0,
        afterTax: 50000,
        afterTaxBasis: 30000,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 3200000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: {
          structure: "roth_traditional",
          traditional: 2800000,
          roth: 0,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
        qcdMaximize: true,
        rmdExcessHandling: "spend",
      },
    });
    const result = calculateProjection(input);
    const decYears = result.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    // Same RMD/QCD/excess amounts as fixture 66 — only the DESTINATION of
    // the excess differs (spent, not reinvested), so end balance is lower.
    expect(decYears[0]?.rmdAmount).toBe(243902.44);
    expect(decYears[0]?.qcdAmount).toBe(111000);
    expect(decYears[0]?.rmdExcessAmount).toBe(101005.85);
    const metrics = extractMetrics(result);
    // Same fix as fixture 65. Unchanged
    // from before the QCD-cap fix -- with rmdExcessHandling="spend", the
    // extra $10k/yr QCD (cap raised 105k->115k) reduces what's left to
    // spend as "excess" by the same amount, so the portfolio's own
    // trajectory nets out the same either way.
    expect(metrics.finalYear?.allAccountsBalance).toBe(6459482.7);
    expect(metrics.finalYear?.allAccountsBalance).toBeLessThan(6877392.31); // vs. fixture 66's "reinvest"
    expectFirstRmdAndClaimYears(result, input); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  // RMD smoothing fixtures. Both share one household shape (a single
  // large pre-tax balance, well past the point where the projected future
  // RMD would exceed spending need — same scale as rmd-smoothing.test.ts's
  // "produces a positive target" case) so the only variable is
  // rmdSmoothingEnabled itself. Neither sets enableRothConversions,
  // proving smoothing is a fully self-contained activation path (see
  // rmd-handling.tsx's docblock).
  const r47HouseholdInput = (rmdSmoothingEnabled: boolean) =>
    makeInput({
      currentAge: 65,
      retirementYear: AS_OF.getFullYear() + 0,
      projectionEndYear: AS_OF.getFullYear() + 15,
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
        ira: {
          structure: "roth_traditional",
          traditional: 1000000,
          roth: 0,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 300000,
          basis: 200000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.04,
        withdrawalRoutingMode: "waterfall",
        // Traditional-first (not brokerage-first, unlike most other
        // fixtures in this file) -- deliberately so this household draws
        // down Traditional from year one, matching the "actively drawing
        // down Traditional pre-RMD" population the smoothing feature targets, and so the
        // brokerage balance survives to fund conversion tax costs instead
        // of being exhausted covering ordinary spending first.
        withdrawalOrder: ["401k", "ira", "brokerage", "hsa"],
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
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
        rmdSmoothingEnabled,
        rmdSmoothingMaxBracketTarget: 0.32,
      },
    });

  it("fixture 68: rmdSmoothingEnabled converts pre-RMD without enableRothConversions set (self-contained toggle)", () => {
    const result = calculateProjection(r47HouseholdInput(true));
    const decYears = result.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    // Pre-RMD years (birthYear 1960 -> RMD starts at 75, SECURE 2.0) should
    // show real conversions even though
    // enableRothConversions was never set -- rmdSmoothingEnabled alone is
    // sufficient, same self-contained pattern as the QCD fixtures' qcdMaximize/
    // rmdExcessHandling.
    const preRmdYears = decYears.filter((y) => y.age < 75);
    expect(preRmdYears.length).toBeGreaterThan(0);
    expect(preRmdYears.some((y) => (y.rothConversionAmount ?? 0) > 0)).toBe(
      true,
    );
    const metrics = extractMetrics(result);
    expectFirstRmdAndClaimYears(result, r47HouseholdInput(true)); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 69: same household with rmdSmoothingEnabled=false — no pre-RMD conversions, and a measurably LARGER RMD at age 75 than fixture 68", () => {
    const smoothedResult = calculateProjection(r47HouseholdInput(true));
    const unsmoothedResult = calculateProjection(r47HouseholdInput(false));
    const smoothedDecYears = smoothedResult.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    const unsmoothedDecYears = unsmoothedResult.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    // Control: no conversions at all pre-RMD without the toggle.
    const unsmoothedPreRmdYears = unsmoothedDecYears.filter((y) => y.age < 75);
    expect(
      unsmoothedPreRmdYears.every((y) => (y.rothConversionAmount ?? 0) === 0),
    ).toBe(true);
    // The claim this test proves: shrinking the pre-RMD Traditional
    // balance via smoothing produces a measurably SMALLER forced RMD at
    // age 75 than the same household that never smoothed.
    const smoothedRmdAt75 = smoothedDecYears.find(
      (y) => y.age === 75,
    )?.rmdAmount;
    const unsmoothedRmdAt75 = unsmoothedDecYears.find(
      (y) => y.age === 75,
    )?.rmdAmount;
    expect(smoothedRmdAt75).toBeGreaterThan(0);
    expect(unsmoothedRmdAt75).toBeGreaterThan(0);
    expect(smoothedRmdAt75!).toBeLessThan(unsmoothedRmdAt75!);
    const metrics = extractMetrics(unsmoothedResult);
    expectFirstRmdAndClaimYears(unsmoothedResult, r47HouseholdInput(false)); // pins current behavior
    expect(metrics).toMatchSnapshot();
  });

  // rateSeededDecumulationYear1.
  // Guyton-Klinger household with a stated budget deliberately far from
  // what withdrawalRate x balance would produce, so the two runs' year-1
  // spending provably differs when the flag is set.
  const rateSeededHouseholdInput = (rateSeeded: boolean) =>
    makeInput({
      currentAge: 60,
      retirementYear: AS_OF.getFullYear() + 5,
      projectionEndYear: AS_OF.getFullYear() + 15,
      currentSalary: 0,
      annualExpenses: 85000,
      decumulationAnnualExpenses: 85000,
      startingBalances: {
        preTax: 1000000,
        taxFree: 500000,
        afterTax: 300000,
        afterTaxBasis: 200000,
        hsa: 200000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1000000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 200000 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 500000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 300000,
          basis: 200000,
        },
      },
      decumulationDefaults: {
        withdrawalRate: 0.05,
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
          rothBracketOverlay: true,
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.24,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
      ...(rateSeeded ? { rateSeededDecumulationYear1: true } : {}),
    });

  it("fixture 70: rateSeededDecumulationYear1 seeds year 1 from withdrawalRate x balance, ignoring the stated budget", () => {
    const result = calculateProjection(rateSeededHouseholdInput(true));
    const decYears = result.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    const year1 = decYears[0]!;
    // Year 1's target/spending is driven by 5% of the actual (grown) year-1
    // balance, NOT the stated $85k budget -- close to $100k (5% of the
    // $2M starting balance, before 5 years of pre-retirement growth), well
    // above the budget the run otherwise ignores entirely.
    expect(year1.projectedExpenses).toBeGreaterThan(90000);
    expect(year1.projectedExpenses).not.toBe(85000);
    const metrics = extractMetrics(result);
    expect(metrics).toMatchSnapshot();
  });

  it("fixture 71: rateSeededDecumulationYear1 omitted is byte-identical to today's budget-seeded behavior", () => {
    const withFlagOmitted = calculateProjection(
      rateSeededHouseholdInput(false),
    );
    const explicitlyFalse = calculateProjection({
      ...rateSeededHouseholdInput(false),
      rateSeededDecumulationYear1: false,
    });
    expect(explicitlyFalse).toEqual(withFlagOmitted);
    const decYears = withFlagOmitted.projectionByYear.filter(
      (y): y is Extract<typeof y, { phase: "decumulation" }> =>
        y.phase === "decumulation",
    );
    // Budget-seeded year 1 (today's only behavior, still the default) DOES
    // start from the stated $85k budget (inflated to the retirement year).
    expect(decYears[0]!.projectedExpenses).toBeGreaterThan(85000);
    expect(decYears[0]!.projectedExpenses).toBeLessThan(100000);
    const metrics = extractMetrics(withFlagOmitted);
    expect(metrics).toMatchSnapshot();
  });
});

/** Fixtures whose two balance tracks drift today. */
const KNOWN_DRIFT = [
  "fixture 39: Individual account tracking through full projection",
  "fixture 52: 3+ individual accounts with unequal balances in same category",
  // A conversion credits no Roth part, so the declared Roth part can't take
  // the converted money (RULES § Known Gaps).
  "fixture 68: rmdSmoothingEnabled converts pre-RMD without enableRothConversions set (self-contained toggle)",
  "fixture 69: same household with rmdSmoothingEnabled=false — no pre-RMD conversions, and a measurably LARGER RMD at age 75 than fixture 68",
];

describe("the two balance tracks agree", () => {
  const warningsOf = (fixture: string) =>
    [...drift.byTest].filter(([name]) => name.endsWith(fixture));

  it("no other projection above drifts by more than $1 (indBal vs acctBal)", () => {
    expect(drift.byTest.size).toBeGreaterThan(0);
    const unknown = drift
      .drifting()
      .map(([name]) => name)
      .filter((name) => !KNOWN_DRIFT.some((k) => name.endsWith(k)));
    expect(unknown).toEqual([]);
  });

  for (const fixture of KNOWN_DRIFT)
    it.fails(
      `${fixture}: no drift (v0.11 Engine: two balance tracks become one)`,
      () => {
        const ran = warningsOf(fixture);
        expect(ran).toHaveLength(1);
        expect(ran[0]![1]).toEqual([]);
      },
    );
});
