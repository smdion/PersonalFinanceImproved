/**
 * The engine's property-test households: one fixed engine input and the
 * fast-check arbitraries built on it (a working household, a retired one,
 * one past its RMD age), plus the two reshapes that give a household named
 * accounts with their own specs, and Roth conversions.
 */
import fc from "fast-check";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { AccountCategory } from "@/lib/config/account-types";
import { openingTotals } from "@/lib/pure/engine/opening-parts";
import {
  consistentStart,
  makeAccumulationDefaults,
  paysInto,
} from "./engine-fixtures";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import { onePerson } from "../../fixtures/engine-people";
import { engineInput, withAccountIds, type FixtureInput } from "./engine-input";

export const AS_OF = new Date("2025-03-07");

/** Build a minimal valid engine input with sensible defaults. */
export function makeInput(
  overrides: Partial<FixtureInput> = {},
): ProjectionInput {
  return engineInput(makeFixture(overrides));
}

/** `makeInput` as the fixture writes it (buckets and categories), for tests
 *  that reshape the money. */
export function makeFixture(
  overrides: Partial<FixtureInput> = {},
): FixtureInput {
  // The one person is the age the fixture states.
  const currentAge = overrides.currentAge ?? 35;
  return consistentStart(
    withCapsAge({
      budgetContributionLines: 0,
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.15,
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
      currentAge,
      people: onePerson(AS_OF.getFullYear() - currentAge),
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
      decumulationAnnualExpenses: 72000,
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

/** Arbitrary for a valid ProjectionInput with randomized core fields. */
export function arbitraryInput(): fc.Arbitrary<ProjectionInput> {
  return fc
    .record({
      currentAge: fc.integer({ min: 25, max: 60 }),
      yearsToRetirement: fc.integer({ min: 5, max: 20 }),
      yearsInRetirement: fc.integer({ min: 15, max: 35 }),
      salary: fc.integer({ min: 30000, max: 500000 }),
      salaryGrowthRate: fc.double({ min: -0.02, max: 0.06, noNaN: true }),
      annualExpenses: fc.integer({ min: 20000, max: 200000 }),
      decumulationAnnualExpenses: fc.integer({ min: 20000, max: 200000 }),
      returnRate: fc.double({ min: 0.03, max: 0.1, noNaN: true }),
      contributionRate: fc.double({ min: 0.0, max: 0.4, noNaN: true }),
      preTaxBalance: fc.integer({ min: 0, max: 500000 }),
      rothBalance: fc.integer({ min: 0, max: 200000 }),
      brokerageBalance: fc.integer({ min: 0, max: 200000 }),
      hsaBalance: fc.integer({ min: 0, max: 50000 }),
      ssAnnual: fc.integer({ min: 0, max: 48000 }),
      inflationRate: fc.double({ min: 0.01, max: 0.05, noNaN: true }),
    })
    .map((r) => {
      const retirementAge = r.currentAge + r.yearsToRetirement;
      const projectionEndAge = retirementAge + r.yearsInRetirement;
      const ssStartAge = Math.min(Math.max(retirementAge, 62), 70);
      const brokerBasis = Math.floor(r.brokerageBalance * 0.6);

      return makeInput({
        currentAge: r.currentAge,
        retirementYear: AS_OF.getFullYear() + r.yearsToRetirement,
        projectionEndYear:
          AS_OF.getFullYear() + projectionEndAge - r.currentAge,
        currentSalary: r.salary,
        salaryGrowthRate: r.salaryGrowthRate,
        annualExpenses: Math.min(r.annualExpenses, r.salary),
        decumulationAnnualExpenses: Math.min(r.annualExpenses, r.salary),
        returnRates: [{ label: `Age ${r.currentAge}`, rate: r.returnRate }],
        accumulationDefaults: makeAccumulationDefaults({
          contributionRate: r.contributionRate,
          accountSplits: {
            "401k": 0.5,
            "403b": 0,
            hsa: 0.1,
            ira: 0.1,
            brokerage: 0.3,
          },
        }),
        startingBalances: {
          preTax: r.preTaxBalance,
          taxFree: r.rothBalance,
          afterTax: r.brokerageBalance,
          afterTaxBasis: brokerBasis,
          hsa: r.hsaBalance,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: Math.floor(r.preTaxBalance * 0.7),
            roth: Math.floor(r.rothBalance * 0.3),
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: r.hsaBalance },
          ira: {
            structure: "roth_traditional",
            traditional: r.preTaxBalance - Math.floor(r.preTaxBalance * 0.7),
            roth: r.rothBalance - Math.floor(r.rothBalance * 0.3),
          },
          brokerage: {
            structure: "basis_tracking",
            balance: r.brokerageBalance,
            basis: brokerBasis,
          },
        },
        socialSecurityAnnual: r.ssAnnual,
        ssStartAge,
        inflationRate: r.inflationRate,
      });
    });
}

/** Arbitrary for an input where the person is already retired (decumulation-only). */
export function arbitraryRetiredInput(): fc.Arbitrary<ProjectionInput> {
  return fc
    .record({
      currentAge: fc.integer({ min: 66, max: 75 }),
      yearsRemaining: fc.integer({ min: 10, max: 25 }),
      preTaxBalance: fc.integer({ min: 100000, max: 1000000 }),
      rothBalance: fc.integer({ min: 50000, max: 400000 }),
      brokerageBalance: fc.integer({ min: 20000, max: 300000 }),
      hsaBalance: fc.integer({ min: 0, max: 80000 }),
      annualExpenses: fc.integer({ min: 30000, max: 120000 }),
      decumulationAnnualExpenses: fc.integer({ min: 30000, max: 120000 }),
      returnRate: fc.double({ min: 0.03, max: 0.09, noNaN: true }),
    })
    .map((r) => {
      const brokerBasis = Math.floor(r.brokerageBalance * 0.5);
      return makeInput({
        currentAge: r.currentAge,
        retirementYear: AS_OF.getFullYear() - 1, // already retired
        projectionEndYear: AS_OF.getFullYear() + r.yearsRemaining,
        currentSalary: 0,
        annualExpenses: r.annualExpenses,
        decumulationAnnualExpenses: r.annualExpenses,
        returnRates: [{ label: `Age ${r.currentAge}`, rate: r.returnRate }],
        startingBalances: {
          preTax: r.preTaxBalance,
          taxFree: r.rothBalance,
          afterTax: r.brokerageBalance,
          afterTaxBasis: brokerBasis,
          hsa: r.hsaBalance,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: Math.floor(r.preTaxBalance * 0.8),
            roth: Math.floor(r.rothBalance * 0.2),
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: r.hsaBalance },
          ira: {
            structure: "roth_traditional",
            traditional: r.preTaxBalance - Math.floor(r.preTaxBalance * 0.8),
            roth: r.rothBalance - Math.floor(r.rothBalance * 0.2),
          },
          brokerage: {
            structure: "basis_tracking",
            balance: r.brokerageBalance,
            basis: brokerBasis,
          },
        },
        socialSecurityAnnual: 24000,
        ssStartAge: Math.min(r.currentAge, 70),
      });
    });
}

/** Arbitrary for an input with a birthYear so RMD applies. */
export function arbitraryRmdInput(): fc.Arbitrary<ProjectionInput> {
  return fc
    .record({
      currentAge: fc.integer({ min: 68, max: 76 }),
      yearsRemaining: fc.integer({ min: 10, max: 20 }),
      preTaxBalance: fc.integer({ min: 200000, max: 800000 }),
      returnRate: fc.double({ min: 0.03, max: 0.08, noNaN: true }),
    })
    .map((r) => {
      const birthYear = AS_OF.getFullYear() - r.currentAge;
      return makeInput({
        currentAge: r.currentAge,
        retirementYear: AS_OF.getFullYear() + (r.currentAge - 1) - r.currentAge,
        projectionEndYear:
          AS_OF.getFullYear() +
          (r.currentAge + r.yearsRemaining) -
          r.currentAge,
        currentSalary: 0,
        returnRates: [{ label: `Age ${r.currentAge}`, rate: r.returnRate }],
        birthYear,
        startingBalances: {
          preTax: r.preTaxBalance,
          taxFree: 50000,
          afterTax: 30000,
          afterTaxBasis: 15000,
          hsa: 10000,
        },
        startingAccountBalances: {
          "401k": {
            structure: "roth_traditional",
            traditional: r.preTaxBalance - 30000,
            roth: 30000,
          },
          "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
          hsa: { structure: "single_bucket", balance: 10000 },
          ira: {
            structure: "roth_traditional",
            traditional: 30000,
            roth: 20000,
          },
          brokerage: {
            structure: "basis_tracking",
            balance: 30000,
            basis: 15000,
          },
        },
        socialSecurityAnnual: 30000,
        ssStartAge: r.currentAge,
      });
    });
}

/** The input's starting money as six named accounts (zero balances
 *  included, so every contribution has its own account) plus one
 *  percent-of-pay contribution spec per account, so the per-account track
 *  carries every flow the aggregate does. */
export function withAccountsAndSpecs(input: ProjectionInput): ProjectionInput {
  const start = openingTotals(input.individualAccounts).accountBalance;
  const k = start["401k"] as { traditional: number; roth: number };
  const ira = start.ira as { traditional: number; roth: number };
  const hsa = start.hsa as { balance: number };
  const brokerage = start.brokerage as { balance: number; basis: number };
  const accounts: IndividualAccountInput[] = (
    [
      ["401k", "401k", "preTax", k.traditional],
      ["401k", "401k", "taxFree", k.roth],
      ["IRA", "ira", "preTax", ira.traditional],
      ["IRA", "ira", "taxFree", ira.roth],
      ["HSA", "hsa", "hsa", hsa.balance],
      ["Brokerage", "brokerage", "afterTax", brokerage.balance],
    ] as const
  ).map(([name, category, taxType, startingBalance]) => ({
    name,
    category,
    taxType,
    startingBalance,
    parentCategory: "Retirement",
    ...(category === "brokerage" ? { startingBasis: brokerage.basis } : {}),
  }));
  const rate = input.accumulationDefaults.contributionRate;
  const held = withAccountIds(accounts);
  // Each spec pays the account of its name.
  const accountNamed = (name: string) =>
    paysInto(held.find((ia) => ia.name === name)!);
  const specs = (
    [
      ["401k", "401k", 0.6, "pre_tax"],
      ["401k", "401k", 0.1, "tax_free"],
      ["IRA", "ira", 0.1, "tax_free"],
      ["HSA", "hsa", 0.05, "hsa"],
      ["Brokerage", "brokerage", 0.15, "after_tax"],
    ] as const
  ).map(([name, category, share, taxTreatment], i) => ({
    name,
    category,
    method: "percent_of_salary" as const,
    value: rate * share,
    salaryFraction: 1,
    baseAnnual: input.currentSalary * rate * share,
    taxTreatment,
    allocationPriority: 0,
    parentCategory: "Retirement",
    contributionAccountId: i + 1,
    account: accountNamed(name),
  }));
  const base = (c: AccountCategory) =>
    specs
      .filter((sp) => sp.category === c)
      .reduce((t, sp) => t + sp.baseAnnual, 0);
  return {
    ...input,
    individualAccounts: held,
    contributionSpecs: specs,
    baseYearContributions: {
      "401k": base("401k"),
      "403b": 0,
      hsa: base("hsa"),
      ira: base("ira"),
      brokerage: base("brokerage"),
    },
  };
}

/** Roth conversions on: a 22% conversion ceiling over a bracket table. */
export function withRothConversions(input: ProjectionInput): ProjectionInput {
  const rates = input.decumulationDefaults.distributionTaxRates;
  return {
    ...input,
    filingStatus: "MFJ",
    decumulationDefaults: {
      ...input.decumulationDefaults,
      distributionTaxRates: {
        ...rates,
        enableRothConversions: true,
        rothConversionTarget: 0.22,
        taxBrackets: [
          { threshold: 0, baseWithholding: 0, rate: 0.1 },
          { threshold: 23200, baseWithholding: 2320, rate: 0.12 },
          { threshold: 94300, baseWithholding: 10852, rate: 0.22 },
          { threshold: 201050, baseWithholding: 34337, rate: 0.24 },
          { threshold: 383900, baseWithholding: 78221, rate: 0.32 },
        ],
      },
    },
  };
}
