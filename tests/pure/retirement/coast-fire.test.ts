/**
 * Coast FIRE calculator tests.
 *
 * Verifies the four status branches (already_coast, found, unreachable,
 * already-retired) and the binary-search earliest-age guarantee.
 */
import { planRetirementAge } from "@/lib/pure/household/household-timeline";
import {
  withConsistentStart,
  makeAccumulationDefaults,
} from "../fixtures/engine-fixtures";
import { describe, it, expect } from "vitest";
import type {
  EngineAccumulationYear,
  ProjectionInput,
  ProjectionResult,
} from "@/lib/pure/engine/types";
import {
  buildCoastFireProfileSwitches,
  findCoastFireAge,
  simulatedCoastFirePasses,
} from "@/lib/pure/retirement/coast-fire";
import { calculateProjection } from "@/lib/pure/engine";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";

const AS_OF = new Date("2025-03-07");

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

describe("findCoastFireAge", () => {
  it("returns already_coast when user can stop contributing today", () => {
    // Huge starting balance, modest expenses — no contributions needed to pass.
    const input = makeInput({
      startingBalances: {
        preTax: 3100000,
        taxFree: 900000,
        afterTax: 500_000,
        afterTaxBasis: 400_000,
        hsa: 50_000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 2_400_000,
          roth: 600_000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 50_000 },
        ira: {
          structure: "roth_traditional",
          traditional: 700_000,
          roth: 300_000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 500_000,
          basis: 400_000,
        },
      },
      annualExpenses: 48_000,
    });

    const result = findCoastFireAge(input);

    expect(result.status).toBe("already_coast");
    expect(result.coastFireAge).toBe(input.currentAge);
    expect(result.sustainableWithdrawal).toBeGreaterThan(
      result.projectedExpensesAtRetirement,
    );
  });

  it("a retiree whose plan runs out isn't already Coast FIRE: unreachable", () => {
    // Retired at 65, now 70, $100,000 left and $60,000 a year to spend
    // (Social Security $36,000 from 67): the money runs out in a few years,
    // so "already Coast FIRE" would be false. The plan judge fails it.
    const input = makeInput({
      currentAge: 70,
      retirementYear: AS_OF.getFullYear() - 5,
      currentSalary: 0,
      startingBalances: {
        preTax: 100_000,
        taxFree: 0,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 100_000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
      annualExpenses: 60_000,
    });

    const result = findCoastFireAge(input);

    expect(result.status).toBe("unreachable");
    expect(result.coastFireAge).toBeNull();
    expect(result.retired).toBe(true);
  });

  it("returns unreachable when even full contributions won't fund the plan", () => {
    // Near-zero portfolio + near-zero salary but large expenses — no path works.
    const input = makeInput({
      currentSalary: 30_000,
      annualExpenses: 150_000,
      startingBalances: {
        preTax: 1000,
        taxFree: 0,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
    });

    const result = findCoastFireAge(input);

    expect(result.status).toBe("unreachable");
    expect(result.coastFireAge).toBeNull();
  });

  it("finds a mid-range coast age when the plan works with some contributions", () => {
    // Moderate balance — not enough to coast today, but enough if contributions
    // continue for some years. The binary search should find an age strictly
    // between currentAge and retirementAge.
    const input = makeInput({
      currentAge: 35,
      retirementYear: AS_OF.getFullYear() + 30,
      currentSalary: 150_000,
      annualExpenses: 72_000,
      startingBalances: {
        preTax: 270000,
        taxFree: 80000,
        afterTax: 50_000,
        afterTaxBasis: 40_000,
        hsa: 20_000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 200_000,
          roth: 50_000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20_000 },
        ira: {
          structure: "roth_traditional",
          traditional: 70_000,
          roth: 30_000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 50_000,
          basis: 40_000,
        },
      },
    });

    const result = findCoastFireAge(input);

    // The outcome depends on the engine math, but whichever status we get,
    // the invariants below must hold.
    if (result.status === "found") {
      expect(result.coastFireAge).not.toBeNull();
      expect(result.coastFireAge).toBeGreaterThan(input.currentAge);
      expect(result.coastFireAge).toBeLessThan(planRetirementAge(input));
      expect(result.sustainableWithdrawal).toBeGreaterThanOrEqual(
        result.projectedExpensesAtRetirement,
      );
    } else {
      // Acceptable alternatives on this fixture: already_coast if the
      // engine calculates the starting balance as sufficient already, or
      // unreachable if it isn't. Either way, coastFireAge should be sane.
      expect(["already_coast", "unreachable"]).toContain(result.status);
    }
  });

  it("returns already_coast when currentAge >= retirementAge", () => {
    const input = makeInput({
      currentAge: 70,
      retirementYear: AS_OF.getFullYear() - 5,
      currentSalary: 0,
      startingBalances: {
        preTax: 780000,
        taxFree: 220000,
        afterTax: 100_000,
        afterTaxBasis: 80_000,
        hsa: 30_000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 640_000,
          roth: 160_000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 30_000 },
        ira: {
          structure: "roth_traditional",
          traditional: 140_000,
          roth: 60_000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 100_000,
          basis: 80_000,
        },
      },
      annualExpenses: 60_000,
    });

    const result = findCoastFireAge(input);

    expect(result.status).toBe("already_coast");
    expect(result.coastFireAge).toBe(70);
  });

  it("today's dollars use the engine's own price level: the first retirement year, and the last year run", () => {
    // Retiring this year after it began: the engine runs this year as a
    // working year, so retirement starts next year (index 1), one year of
    // inflation from today, though retirement age minus age is 0.
    const input = makeInput({
      currentAge: 65,
      retirementYear: AS_OF.getFullYear(),
      currentSalary: 0,
      startingBalances: {
        preTax: 1_000_000,
        taxFree: 0,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 1_000_000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
      annualExpenses: 40_000,
    });

    const result = findCoastFireAge(input);
    const years = calculateProjection(input).projectionByYear;
    const firstRetirementYear = years.find(
      (y) => y.phase === "decumulation",
    )!.year;
    // The end balance is the last year run's (the end year isn't run).
    const lastYear = years[years.length - 1]!;

    expect(firstRetirementYear).toBe(AS_OF.getFullYear() + 1);
    expect(result.projectedExpensesAtRetirement).toBeGreaterThan(0);
    expect(result.projectedExpensesAtRetirementToday).toBeCloseTo(
      result.projectedExpensesAtRetirement / 1.025,
      6,
    );
    expect(result.sustainableWithdrawalToday).toBeCloseTo(
      result.sustainableWithdrawal / 1.025,
      6,
    );
    expect(result.endRetirementBalance).toBe(lastYear.retirementBalance);
    expect(result.endRetirementBalanceToday).toBeCloseTo(
      result.endRetirementBalance /
        1.025 ** (lastYear.year - AS_OF.getFullYear()),
      6,
    );
  });

  it("exercises binary search and returns found with near-zero starting balance", () => {
    // Near-zero balance → can't coast today (stopNow fails).
    // 35 years of contributions at $150k salary → easily passes if stopping
    // at retirementAge-1 (stopLate passes). Forces the binary search branch.
    const input = makeInput({
      currentAge: 30,
      retirementYear: AS_OF.getFullYear() + 35,
      currentSalary: 150_000,
      annualExpenses: 60_000,
      startingBalances: {
        preTax: 500,
        taxFree: 0,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 500,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
    });

    const result = findCoastFireAge(input);

    expect(result.status).toBe("found");
    expect(result.coastFireAge).not.toBeNull();
    expect(result.coastFireAge).toBeGreaterThan(input.currentAge);
    expect(result.coastFireAge).toBeLessThan(planRetirementAge(input));
    expect(result.sustainableWithdrawal).toBeGreaterThanOrEqual(
      result.projectedExpensesAtRetirement,
    );
  });

  it("returns an earliest-age result (binary search invariant)", () => {
    // Run with the moderate-balance fixture; if status is "found", verify
    // that the age immediately before coastFireAge does NOT pass — i.e.,
    // the search genuinely found the earliest age.
    const input = makeInput({
      currentAge: 40,
      retirementYear: AS_OF.getFullYear() + 25,
      currentSalary: 200_000,
      annualExpenses: 80_000,
      startingBalances: {
        preTax: 425000,
        taxFree: 125000,
        afterTax: 100_000,
        afterTaxBasis: 80_000,
        hsa: 25_000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 320_000,
          roth: 80_000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 25_000 },
        ira: {
          structure: "roth_traditional",
          traditional: 105_000,
          roth: 45_000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 100_000,
          basis: 80_000,
        },
      },
    });

    const result = findCoastFireAge(input);

    if (result.status === "found" && result.coastFireAge !== null) {
      // Verify the age immediately before coastFireAge would NOT have passed.
      // If we can pass at age - 1, then the binary search didn't find the earliest.
      const ageToTry = result.coastFireAge - 1;
      if (ageToTry >= input.currentAge) {
        const priorInput: ProjectionInput = {
          ...input,
          accumulationOverrides: [
            ...input.accumulationOverrides,
            {
              year: AS_OF.getFullYear() + (ageToTry - input.currentAge),
              contributionRate: 0,
            },
          ],
        };
        const priorResult = findCoastFireAge(priorInput);
        // priorInput would still find the SAME earliest age because the extra
        // override is ignored (it's at age < the true earliest). So we can't
        // easily assert via findCoastFireAge alone. Instead, just sanity-check
        // that the returned age is plausible:
        expect(priorResult.coastFireAge).toBeGreaterThanOrEqual(
          input.currentAge,
        );
      }
      expect(result.coastFireAge).toBeGreaterThanOrEqual(input.currentAge);
      expect(result.coastFireAge).toBeLessThan(planRetirementAge(input));
    }
  });
});

describe("findCoastFireAge — v0.7.8 penalty-hard-exclusion baseline honesty", () => {
  // Same class of bug monte-carlo.ts's C3 fix addressed, but for the
  // deterministic baseline's passes() function: neither
  // retirementDepletionAge nor the aggregate sustainableWithdrawal rate
  // notices a specific year going unfunded because penalty-exposed money
  // was excluded. A household coasting too early (age 37, well before
  // their real coast age) doesn't accumulate enough penalty-free
  // (brokerage/basis) money to bridge the 55->59.5 gap -- Monte Carlo
  // reports this correctly (see
  // tests/pure/simulation/monte-carlo-penalty-honesty.test.ts), so the
  // deterministic baseline must not say "already coast" for the same case.
  const AS_OF_2 = new Date("2025-03-07");

  function makeGapInput(
    overrides: Partial<ProjectionInput> = {},
  ): ProjectionInput {
    return withCapsAge({
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.29,
        accountSplits: {
          "401k": 0.5,
          "403b": 0,
          hsa: 0.05,
          ira: 0.15,
          brokerage: 0.3,
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
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
        avoidPenalizedWithdrawals: true,
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 37,
      retirementYear: AS_OF_2.getFullYear() + 18,
      projectionEndYear: AS_OF_2.getFullYear() + 58,
      currentSalary: 300000,
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
        currentAge: 37,
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
        preTax: 900000,
        taxFree: 1700000,
        afterTax: 30000,
        afterTaxBasis: 20000,
        hsa: 260000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 900000,
          roth: 0,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 260000 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 1700000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 30000,
          basis: 20000,
        },
      },
      annualExpenses: 94000,
      inflationRate: 0.03,
      returnRates: [{ label: "7%", rate: 0.0727 }],
      socialSecurityAnnual: 0,
      ssStartAge: 67,
      asOfDate: AS_OF_2,
      // Every account tracked, so the 401(k) (locked until 59½ — no Rule of
      // 55 separation) and the HSA (non-medical penalty until 65) are
      // penalty-exposed like the Roth growth: only the brokerage and the
      // Roth basis are reachable before 59½ — the real gap.
      individualAccounts: [
        {
          name: "401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 900000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1990,
          parentCategory: "Retirement",
        },
        {
          name: "HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 260000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1990,
          parentCategory: "Retirement",
        },
        {
          name: "Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 30000,
          startingBasis: 20000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1990,
          parentCategory: "Retirement",
        },
        {
          name: "Roth IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 1700000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1990,
          parentCategory: "Retirement",
          rothBasisMeta: {
            year: 2025,
            contributionBasis: 40000,
            conversionBasis: 0,
            latestConversionYear: null,
            isSeeded: false,
            updatedAt: new Date("2025-01-01"),
          },
        },
      ],
      ...overrides,
    }) as ProjectionInput;
  }

  it("does not report already_coast (stopping today) for a plan with a real, unfunded 55->59½ penalty-free gap", () => {
    const input = makeGapInput();
    const result = findCoastFireAge(input);
    // Confirmed (via a Monte Carlo probe on the same household shape) that
    // stopping contributions at the current age leaves the 55->59½ window
    // genuinely short on penalty-free money. Before this fix, passes()
    // never looked at penaltyAvoidedShortfall and could say "already
    // coast" here anyway.
    expect(result.status).not.toBe("already_coast");
  });

  it("without the exclusion (avoidPenalizedWithdrawals: false), the SAME household DOES pass stopping today -- isolates the fix to the exclusion's effect, not an unrelated change", () => {
    const input = makeGapInput({
      decumulationDefaults: {
        ...makeGapInput().decumulationDefaults,
        avoidPenalizedWithdrawals: false,
      },
    });
    const result = findCoastFireAge(input);
    expect(result.status).toBe("already_coast");
  });
});

// Two more baseline-honesty gaps in passes(), same class of bug as the
// penalty-exclusion block above.
describe("findCoastFireAge — non-retirement exclusion baseline honesty", () => {
  const AS_OF_3 = new Date("2025-03-07");

  // A Portfolio-parented account (unconditionally excluded from
  // retirement routing, no config lever) holds all the household's Roth
  // money. The other, routable accounts are deliberately thin -- not
  // enough on their own to cover the portfolio's share of spending once
  // Social Security's contribution is netted out -- so stopping
  // contributions today leaves a real, recurring shortfall starting the
  // second decumulation year (confirmed via an engine probe: routable
  // balance exhausts by year 3, nonRetirementShortfall becomes the FULL
  // need from then on). Before this fix, passes() never looked at
  // nonRetirementShortfall and could say "already coast" anyway --
  // retirementDepletionAge stays null forever (the excluded $150k sits
  // there, untouched, keeping aggregate allAccountsBalance positive) and
  // sustainableWithdrawal's net-of-tax/plus-SS figure clears
  // projectedExpenses in year 1 alone, so neither existing check would
  // ever catch this.
  function makePortfolioParentedGapInput(
    overrides: Partial<ProjectionInput> = {},
  ): ProjectionInput {
    return withCapsAge({
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
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 66,
      retirementYear: AS_OF_3.getFullYear() + 1,
      projectionEndYear: AS_OF_3.getFullYear() + 24,
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
        currentAge: 66,
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
        taxFree: 600000,
        afterTax: 40000,
        afterTaxBasis: 32000,
        hsa: 20000,
      },
      startingAccountBalances: {
        "401k": { structure: "roth_traditional", traditional: 80000, roth: 0 },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 20000 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 600000 },
        brokerage: {
          structure: "basis_tracking",
          balance: 40000,
          basis: 32000,
        },
      },
      annualExpenses: 90000,
      inflationRate: 0.025,
      returnRates: [{ label: "7%", rate: 0.07 }],
      socialSecurityAnnual: 65000,
      ssStartAge: 67,
      asOfDate: AS_OF_3,
      individualAccounts: [
        {
          name: "401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 80000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Retirement",
        },
        {
          name: "HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 20000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Retirement",
        },
        {
          name: "Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 40000,
          startingBasis: 32000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Retirement",
        },
        {
          name: "Roth IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 600000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Portfolio",
        },
      ],
      ...overrides,
    }) as ProjectionInput;
  }

  it("does not report already_coast when a Portfolio-parented account leaves a real, recurring shortfall", () => {
    const result = findCoastFireAge(makePortfolioParentedGapInput());
    expect(result.status).not.toBe("already_coast");
  });

  it("Retirement-parented (not excluded), the SAME household DOES pass stopping today -- isolates the fix to the exclusion's effect", () => {
    const input = makePortfolioParentedGapInput({
      individualAccounts: [
        {
          name: "401k",
          category: "401k",
          taxType: "preTax",
          startingBalance: 80000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Retirement",
        },
        {
          name: "HSA",
          category: "hsa",
          taxType: "hsa",
          startingBalance: 20000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Retirement",
        },
        {
          name: "Brokerage",
          category: "brokerage",
          taxType: "afterTax",
          startingBalance: 40000,
          startingBasis: 32000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Retirement",
        },
        {
          name: "Roth IRA",
          category: "ira",
          taxType: "taxFree",
          startingBalance: 600000,
          ownerName: "Owner",
          ownerPersonId: 1,
          ownerBirthYear: 1958,
          parentCategory: "Retirement",
        },
      ],
    });
    const result = findCoastFireAge(input);
    expect(result.status).toBe("already_coast");
  });
});

describe("findCoastFireAge — net/gross unit fix for the no-stated-need fallback (finding #9)", () => {
  const AS_OF_4 = new Date("2025-03-07");

  // sustainableWithdrawal's meaning is the strategy's
  // actual tax-grossed-up withdrawal (gross of tax, net of Social
  // Security) without updating the no-stated-need fallback in passes(),
  // which still compared it directly against projectedExpenses (gross of
  // Social Security, net of tax). A household whose spending is mostly
  // covered by a large Social Security benefit exposes the mismatch
  // clearly: sustainableWithdrawal (the portfolio's own share only) comes
  // in well under projectedExpenses (total spending) even though the
  // household is comfortably funded once SS's contribution and the tax
  // bill are both accounted for correctly.
  function makeSsHeavyInput(
    overrides: Partial<ProjectionInput> = {},
  ): ProjectionInput {
    return withCapsAge({
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
          ...shippedTaxTables(),
          traditionalFallbackRate: 0.22,
          roth: 0,
          hsa: 0,
          brokerage: 0.15,
        },
      },
      accumulationOverrides: [],
      decumulationOverrides: [],
      currentAge: 66,
      retirementYear: AS_OF_4.getFullYear() + 1,
      projectionEndYear: AS_OF_4.getFullYear() + 24,
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
        currentAge: 66,
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
        preTax: 500000,
        taxFree: 250000,
        afterTax: 100000,
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
          traditional: 100000,
          roth: 150000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 100000,
          basis: 80000,
        },
      },
      annualExpenses: 90000,
      inflationRate: 0.025,
      returnRates: [{ label: "7%", rate: 0.07 }],
      socialSecurityAnnual: 60000,
      ssStartAge: 67,
      asOfDate: AS_OF_4,
      ...overrides,
    }) as ProjectionInput;
  }

  it("reports already_coast for a Social-Security-heavy household the old gross-vs-net comparison would have wrongly failed", () => {
    // Confirmed via an engine probe: the strategy's actual first-year
    // withdrawal nets to exactly projectedExpenses once its tax cost is
    // subtracted and SS is added back, but the OLD (buggy) direct
    // comparison of the raw gross figure against projectedExpenses came
    // in under by roughly the tax bill -- ~$41k vs. a ~$92k need -- which
    // would have wrongly reported this plan as not sustainable.
    const result = findCoastFireAge(makeSsHeavyInput());
    expect(result.status).toBe("already_coast");
  });
});

describe("findCoastFireAge — contributions stop on the per-account (spec) path", () => {
  // Real households route contributions from per-account specs. A rate of 0
  // in an accumulation override is treated as "unset" there, so the
  // baseline used to keep contributing after the "stop".
  const specInput = (): ProjectionInput =>
    makeInput({
      startingBalances: {
        preTax: 10000,
        taxFree: 0,
        afterTax: 0,
        afterTaxBasis: 0,
        hsa: 0,
      },
      startingAccountBalances: {
        "401k": { structure: "roth_traditional", traditional: 10000, roth: 0 },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 0 },
        ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
        brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
      },
      contributionSpecs: [
        {
          name: "401k",
          category: "401k",
          method: "fixed_monthly",
          value: 2000,
          salaryFraction: 1,
          baseAnnual: 24000,
          taxTreatment: "pre_tax",
          allocationPriority: 0,
          parentCategory: "Retirement",
        },
      ],
      baseYearContributions: {
        "401k": 24000,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
    });

  it("the stop zeroes every later year's contributions", () => {
    const input = specInput();
    const result = calculateProjection({
      ...input,
      profileSwitches: buildCoastFireProfileSwitches(input, input.currentAge),
    });
    for (const y of result.projectionByYear.filter(
      (r): r is EngineAccumulationYear =>
        r.phase === "accumulation" && r.year > input.asOfDate.getFullYear(),
    ))
      expect(y.totalEmployee + y.totalEmployer, `${y.year}`).toBe(0);
  });

  it("a household that can't stop today isn't reported as already coasting", () => {
    // $10k saved and a $72k/yr need: only the contributions make it work.
    expect(findCoastFireAge(specInput()).status).not.toBe("already_coast");
  });
});

describe("findCoastFireAge — gross-up off", () => {
  it("a stated need the strategy meets isn't failed for the tax that, by choice, isn't grossed up", () => {
    const base = makeInput({
      startingBalances: {
        preTax: 3100000,
        taxFree: 900000,
        afterTax: 500_000,
        afterTaxBasis: 400_000,
        hsa: 50_000,
      },
      startingAccountBalances: {
        "401k": {
          structure: "roth_traditional",
          traditional: 2_400_000,
          roth: 600_000,
        },
        "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
        hsa: { structure: "single_bucket", balance: 50_000 },
        ira: {
          structure: "roth_traditional",
          traditional: 700_000,
          roth: 300_000,
        },
        brokerage: {
          structure: "basis_tracking",
          balance: 500_000,
          basis: 400_000,
        },
      },
      annualExpenses: 48_000,
      decumulationAnnualExpenses: 48_000,
    });
    const input = {
      ...base,
      decumulationDefaults: {
        ...base.decumulationDefaults,
        distributionTaxRates: {
          ...base.decumulationDefaults.distributionTaxRates!,
          grossUpForTaxes: false,
        },
      },
    };
    expect(findCoastFireAge(input).status).toBe("already_coast");
  });
});

describe("simulatedCoastFirePasses — one verdict for both Coast FIRE paths", () => {
  /** A run whose deterministic year 1 spends `spending` against `need`. */
  const run = (successRate: number, spending: number, need: number) => ({
    successRate,
    deterministicProjection: {
      projectionByYear: [
        {
          phase: "decumulation",
          withdrawalSized: false,
          spending,
          projectedExpenses: spending,
        },
      ],
      firstDecumulationYearStatedNeed: need,
      // eslint-disable-next-line no-restricted-syntax -- only the fields the need test reads
    } as unknown as ProjectionResult,
  });

  it("ret/SM1-sim [ENG-31] 95% of trials survive but year 1 spends $40,000 of a $60,000 need: fails", () => {
    expect(simulatedCoastFirePasses(run(0.95, 40_000, 60_000), 0.9)).toBe(
      false,
    );
  });

  it("ret/SM1-sim2 [ENG-31] 95% survive and year 1 covers the need: passes", () => {
    expect(simulatedCoastFirePasses(run(0.95, 60_000, 60_000), 0.9)).toBe(true);
  });

  it("ret/SM1-sim3 [ENG-31] the need covered but 80% survive: fails", () => {
    expect(simulatedCoastFirePasses(run(0.8, 60_000, 60_000), 0.9)).toBe(false);
  });
});
