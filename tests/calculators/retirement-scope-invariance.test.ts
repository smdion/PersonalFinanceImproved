/**
 * Retirement answers ignore Portfolio money (v0.8.11 A7 — the gate for the
 * retirement-scope work). Portfolio accounts (savings outside the
 * retirement plan) are never spent in retirement, so adding one — or
 * saving into one — must leave every retirement answer unchanged within
 * $1: yearly retirement balances, the plan verdict, sustainable spending,
 * simulation success / bands / failure ages, Coast FIRE, the Social
 * Security claiming pick and the bracket-target pick.
 *
 * Portfolio Traditional money is left out on purpose: its RMDs are real
 * (the IRS doesn't care how accounts are categorized) — the one documented
 * coupling.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import { assessPlan } from "@/lib/calculators/plan-outcome";
import { findCoastFireAge } from "@/lib/calculators/coast-fire";
import { sweepClaimingAges } from "@/lib/calculators/social-security";
import { optimizeRothBracketTarget } from "@/lib/calculators/withdrawal-bracket-optimizer";
import type {
  ContributionSpec,
  IndividualAccountInput,
  ProjectionInput,
} from "@/lib/calculators/types";
import {
  CORRELATIONS,
  IBBOTSON_CLASSES,
  make5050GlidePath,
  makeMCInput,
  makeStandardInput,
} from "../benchmarks/benchmark-helpers";
import { shippedTaxTables } from "../helpers/tax-data";

const MFJ_BRACKETS = [
  { threshold: 23850, baseWithholding: 0, rate: 0.1 },
  { threshold: 96950, baseWithholding: 2385, rate: 0.12 },
  { threshold: 206700, baseWithholding: 11157, rate: 0.22 },
  { threshold: 394600, baseWithholding: 35302, rate: 0.24 },
  { threshold: 501050, baseWithholding: 61149, rate: 0.32 },
];

const account = (
  name: string,
  category: IndividualAccountInput["category"],
  taxType: string,
  startingBalance: number,
  extra: Partial<IndividualAccountInput> = {},
): IndividualAccountInput => ({
  name,
  category,
  taxType,
  startingBalance,
  ownerPersonId: 1,
  ownerName: "Alex",
  ownerBirthYear: 1990,
  parentCategory: "Retirement",
  ...extra,
});

const spec = (
  name: string,
  category: ContributionSpec["category"],
  annual: number,
  taxTreatment: ContributionSpec["taxTreatment"],
  parentCategory: string,
): ContributionSpec => ({
  name,
  category,
  method: "fixed_monthly",
  value: annual / 12,
  salaryFraction: 1,
  baseAnnual: annual,
  taxTreatment,
  parentCategory,
  personId: 1,
  ownerName: "Alex",
});

/** A working household whose buckets, per-category balances and
 *  individual accounts all describe the same money. */
function household(): ProjectionInput {
  const base = makeStandardInput({ currentAge: 35, retirementAge: 60 });
  return {
    ...base,
    birthYear: 1990,
    filingStatus: "MFJ",
    socialSecurityEntries: [
      {
        personId: 1,
        personName: "Alex",
        annualAmount: 36000,
        startAge: 67,
        birthYear: 1990,
      },
    ],
    decumulationDefaults: {
      ...base.decumulationDefaults,
      withdrawalRoutingMode: "bracket_filling",
      distributionTaxRates: {
        ...shippedTaxTables(),
        ...base.decumulationDefaults.distributionTaxRates,
        rothBracketTarget: 0.12,
        taxBrackets: MFJ_BRACKETS,
      },
    },
    startingBalances: {
      preTax: 110000,
      taxFree: 40000,
      hsa: 15000,
      afterTax: 30000,
      afterTaxBasis: 20000,
    },
    individualAccounts: [
      account("401k", "401k", "preTax", 80000),
      account("401k", "401k", "taxFree", 20000),
      account("IRA", "ira", "preTax", 30000),
      account("IRA", "ira", "taxFree", 20000),
      account("HSA", "hsa", "hsa", 15000),
      account("Retirement brokerage", "brokerage", "afterTax", 30000, {
        startingBasis: 20000,
      }),
    ],
    contributionSpecs: [spec("401k", "401k", 20000, "pre_tax", "Retirement")],
    baseYearContributions: {
      "401k": 20000,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
  };
}

/** The same household plus a $1M Portfolio brokerage. */
function withPortfolioBrokerage(input: ProjectionInput): ProjectionInput {
  const amount = 1_000_000;
  const basis = 600_000;
  return {
    ...input,
    startingBalances: {
      ...input.startingBalances,
      afterTax: input.startingBalances.afterTax + amount,
      afterTaxBasis: input.startingBalances.afterTaxBasis + basis,
    },
    startingAccountBalances: {
      ...input.startingAccountBalances!,
      brokerage: {
        structure: "basis_tracking",
        balance: getBrokerage(input) + amount,
        basis: getBrokerageBasis(input) + basis,
      },
    },
    individualAccounts: [
      ...input.individualAccounts!,
      account("Long-term brokerage", "brokerage", "afterTax", amount, {
        startingBasis: basis,
        parentCategory: "Portfolio",
      }),
    ],
  };
}

/** …and saving $12k a year into it (the rate ceiling doesn't bind). */
function withPortfolioSavings(input: ProjectionInput): ProjectionInput {
  const p = withPortfolioBrokerage(input);
  return {
    ...p,
    contributionSpecs: [
      ...p.contributionSpecs!,
      spec("Long-term brokerage", "brokerage", 12000, "after_tax", "Portfolio"),
    ],
    baseYearContributions: { ...p.baseYearContributions!, brokerage: 12000 },
  };
}

function getBrokerage(input: ProjectionInput): number {
  const b = input.startingAccountBalances!.brokerage;
  return b.structure === "basis_tracking" ? b.balance : 0;
}
function getBrokerageBasis(input: ProjectionInput): number {
  const b = input.startingAccountBalances!.brokerage;
  return b.structure === "basis_tracking" ? b.basis : 0;
}

const variants: [string, (i: ProjectionInput) => ProjectionInput][] = [
  ["a $1M Portfolio brokerage", withPortfolioBrokerage],
  ["saving into a Portfolio brokerage", withPortfolioSavings],
];

describe.each(variants)("retirement answers ignore %s", (_, addPortfolio) => {
  const base = household();
  const portfolio = addPortfolio(base);

  it("yearly retirement balances, the verdict and sustainable spending", () => {
    const a = calculateProjection(base);
    const b = calculateProjection(portfolio);
    expect(b.projectionByYear).toHaveLength(a.projectionByYear.length);
    a.projectionByYear.forEach((y, i) =>
      expect(
        Math.abs(
          b.projectionByYear[i]!.retirementBalance - y.retirementBalance,
        ),
        `${y.year}`,
      ).toBeLessThan(1),
    );
    expect(assessPlan(b)).toEqual(assessPlan(a));
    expect(b.sustainableWithdrawal).toBeCloseTo(a.sustainableWithdrawal, 0);
    expect(b.retirementDepletionAge).toBe(a.retirementDepletionAge);
  });

  it("simulation success, bands and failure ages", () => {
    const mc = (input: ProjectionInput) =>
      calculateMonteCarlo(
        makeMCInput(input, {
          numTrials: 60,
          seed: 7,
          assetClasses: IBBOTSON_CLASSES,
          correlations: CORRELATIONS,
          glidePath: make5050GlidePath(),
        }),
      );
    const a = mc(base);
    const b = mc(portfolio);
    expect(b.successRate).toBe(a.successRate);
    expect(b.failureReasonRates).toEqual(a.failureReasonRates);
    expect(b.distributions.failureAge).toEqual(a.distributions.failureAge);
    a.percentileBands.forEach((band, i) =>
      expect(
        Math.abs(b.percentileBands[i]!.p50 - band.p50),
        `age ${band.age}`,
      ).toBeLessThan(1),
    );
  });

  it("Coast FIRE, the claiming-age pick and the bracket-target pick", () => {
    const coastA = findCoastFireAge(base);
    const coastB = findCoastFireAge(portfolio);
    expect(coastB.coastFireAge).toBe(coastA.coastFireAge);
    expect(coastB.status).toBe(coastA.status);

    const claim = (input: ProjectionInput) =>
      sweepClaimingAges({
        input: { ...input, socialSecurityEntries: undefined },
        personId: 1,
        pia: 30000,
        birthYear: 1990,
        ages: [62, 67, 70],
      }).recommendedAge;
    expect(claim(portfolio)).toBe(claim(base));

    expect(optimizeRothBracketTarget(portfolio).recommendedTarget).toBe(
      optimizeRothBracketTarget(base).recommendedTarget,
    );
  });
});
