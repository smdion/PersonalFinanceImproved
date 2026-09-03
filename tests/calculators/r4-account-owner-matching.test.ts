/**
 * The decumulation-phase "Portfolio contribution continues after
 * retirement" block in decumulation-year.ts
 * used to match a contribution spec to its individual account by
 * `ia.name === spec.accountName` ALONE. Two household members with an
 * identically-named account (a common real pattern — "Long Term Brokerage"
 * is a natural name both spouses might independently choose) would silently
 * collide: whichever account happened to come first in `indAccts` absorbed
 * BOTH people's continuing contributions.
 *
 * Fixed by reusing `state.specToAccount` — the same owner-aware
 * category+owner+taxType+parentCategory cascade `buildSpecToAccountMapping`
 * already builds once per year for the accumulation phase (single
 * computation path, RULES.md) — instead of re-deriving a second, weaker
 * name-only match.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  ProjectionInput,
  IndividualAccountInput,
  ContributionSpec,
} from "@/lib/calculators/types";

const AS_OF = new Date("2025-03-07");

function makeInput(): ProjectionInput {
  const individualAccounts: IndividualAccountInput[] = [
    {
      name: "Long Term Brokerage",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 200000,
      ownerName: "Sean",
      ownerPersonId: 1,
      parentCategory: "Portfolio",
    },
    {
      name: "Long Term Brokerage", // deliberately identical name, different owner
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 150000,
      ownerName: "Joanna",
      ownerPersonId: 2,
      parentCategory: "Portfolio",
    },
  ];

  const contributionSpecs: ContributionSpec[] = [
    {
      category: "brokerage",
      name: "Long Term Brokerage",
      accountName: "Long Term Brokerage",
      method: "fixed_monthly",
      value: 500, // $500/mo -> $6,000/yr
      salaryFraction: 1,
      baseAnnual: 6000,
      taxTreatment: "after_tax",
      personId: 1,
      ownerName: "Sean",
      parentCategory: "Portfolio",
      retirementBehavior: "continues_after_retirement",
    },
    {
      category: "brokerage",
      name: "Long Term Brokerage",
      accountName: "Long Term Brokerage",
      method: "fixed_monthly",
      value: 300, // $300/mo -> $3,600/yr, deliberately DIFFERENT from Sean's
      salaryFraction: 1,
      baseAnnual: 3600,
      taxTreatment: "after_tax",
      personId: 2,
      ownerName: "Joanna",
      parentCategory: "Portfolio",
      retirementBehavior: "continues_after_retirement",
    },
  ];

  return {
    accumulationDefaults: {
      contributionRate: 0.2,
      routingMode: "waterfall",
      accountOrder: ["401k", "403b", "hsa", "ira", "brokerage"],
      accountSplits: {
        "401k": 0.7,
        "403b": 0,
        hsa: 0.05,
        ira: 0.05,
        brokerage: 0.2,
      },
      taxSplits: { "401k": 0.9, ira: 1.0 },
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
    currentAge: 65,
    retirementAge: 65, // retire immediately -> decumulation from year 0
    projectionEndAge: 70,
    currentSalary: 0,
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
      preTax: 900000,
      taxFree: 100000,
      afterTax: 350000, // 200k + 150k, matching the two individual accounts
      afterTaxBasis: 300000,
      hsa: 30000,
    },
    startingAccountBalances: {
      "401k": {
        structure: "roth_traditional",
        traditional: 900000,
        roth: 100000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 30000 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      brokerage: {
        structure: "basis_tracking",
        balance: 350000,
        basis: 300000,
      },
    },
    annualExpenses: 60000,
    decumulationAnnualExpenses: 60000,
    inflationRate: 0.025,
    returnRates: [{ label: "6%", rate: 0.06 }],
    socialSecurityAnnual: 30000,
    ssStartAge: 67,
    asOfDate: AS_OF,
    individualAccounts,
    contributionSpecs,
  } as ProjectionInput;
}

describe("R4 — decumulation Portfolio-continuing-contributions matches by owner, not name alone", () => {
  it("routes each person's continuing contribution to THEIR OWN identically-named account", () => {
    const result = calculateProjection(makeInput());
    const firstDecumYear = result.projectionByYear.find(
      (y) => y.phase === "decumulation",
    )!;
    expect(firstDecumYear).toBeDefined();

    const seanAcct = firstDecumYear.individualAccountBalances.find(
      (a) => a.name === "Long Term Brokerage" && a.ownerName === "Sean",
    )!;
    const joannaAcct = firstDecumYear.individualAccountBalances.find(
      (a) => a.name === "Long Term Brokerage" && a.ownerName === "Joanna",
    )!;
    expect(seanAcct).toBeDefined();
    expect(joannaAcct).toBeDefined();

    // Each person's own contribution landed on THEIR account, not the
    // other's — allowing for limitGrowthRate's per-year growth factor
    // (baseAnnual x (1+limitGrowthRate)^yearIndex), not asserting the exact
    // un-grown baseAnnual. The two amounts are genuinely different (proving
    // this isn't accidentally passing via both being equal/zero) and each
    // is close to its OWN spec's baseAnnual, not the other spec's.
    expect(seanAcct.contribution).toBeGreaterThan(5900);
    expect(seanAcct.contribution).toBeLessThan(6300);
    expect(joannaAcct.contribution).toBeGreaterThan(3500);
    expect(joannaAcct.contribution).toBeLessThan(3800);

    // Sanity: total attributed contribution equals the sum of both specs —
    // nothing silently dropped, nothing double-counted onto one account.
    expect(seanAcct.contribution + joannaAcct.contribution).toBeGreaterThan(
      9400,
    );
    expect(seanAcct.contribution + joannaAcct.contribution).toBeLessThan(10100);
  });
});
