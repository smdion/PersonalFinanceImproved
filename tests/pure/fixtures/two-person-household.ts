/** A two-person household (Ann 78, Bo 65) with owned accounts, for the
 *  per-person RMD and Medicare tests. */
import type { IndividualAccountInput } from "@/lib/pure/types/shared";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { capsFromBaseLimits, withCapsAge } from "../../helpers/irs-limit-caps";
import { shippedTaxTables } from "../../helpers/tax-data";
import {
  withConsistentStart,
  makeAccumulationDefaults,
} from "./engine-fixtures";

const AS_OF = new Date("2026-03-07");

export const acct = (
  name: string,
  category: IndividualAccountInput["category"],
  startingBalance: number,
  ownerPersonId: number | undefined,
  taxType: IndividualAccountInput["taxType"] = "preTax",
): IndividualAccountInput => ({
  name,
  category,
  taxType,
  startingBalance,
  ownerName: ownerPersonId === 2 ? "Bo" : "Ann",
  ownerPersonId,
});

/** Ann is 78, Bo 65; flat returns and no Social Security, so balances read
 *  straight. */
export function household(
  accounts: IndividualAccountInput[],
  overrides: Partial<ProjectionInput> = {},
  decumulation: Partial<ProjectionInput["decumulationDefaults"]> = {},
): ProjectionInput {
  const sum = (cat: string, type: string) =>
    accounts
      .filter((a) => a.category === cat && a.taxType === type)
      .reduce((s, a) => s + a.startingBalance, 0);
  const rothTrad = (cat: string) => ({
    structure: "roth_traditional" as const,
    traditional: sum(cat, "preTax"),
    roth: sum(cat, "taxFree"),
  });
  const afterTax = sum("brokerage", "afterTax");
  const input: Partial<ProjectionInput> = {
    accumulationDefaults: makeAccumulationDefaults({
      contributionRate: 0,
      accountSplits: { "401k": 1, "403b": 0, hsa: 0, ira: 0, brokerage: 0 },
      taxSplits: { "401k": 1, ira: 1 },
    }),
    decumulationDefaults: {
      withdrawalRate: 0.04,
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      withdrawalSplits: { "401k": 1, "403b": 0, ira: 0, brokerage: 0, hsa: 0 },
      withdrawalTaxPreference: { "401k": "traditional", ira: "traditional" },
      distributionTaxRates: {
        ...shippedTaxTables(),
        traditionalFallbackRate: 0.2,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
      },
      ...decumulation,
    },
    accumulationOverrides: [],
    decumulationOverrides: [],
    currentAge: 78,
    retirementYear: AS_OF.getFullYear() - 13,
    projectionEndYear: AS_OF.getFullYear() + 4,
    birthYear: 1948,
    currentSalary: 0,
    salaryGrowthRate: 0,
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
      currentAge: 78,
    }),
    limitGrowthRate: 0,
    employerMatchRateByCategory: {
      "401k": 0,
      "403b": 0,
      hsa: 0,
      ira: 0,
      brokerage: 0,
    },
    startingBalances: {
      preTax: sum("401k", "preTax") + sum("ira", "preTax"),
      taxFree: sum("401k", "taxFree") + sum("ira", "taxFree"),
      afterTax,
      afterTaxBasis: afterTax,
      hsa: 0,
    },
    startingAccountBalances: {
      "401k": rothTrad("401k"),
      "403b": rothTrad("403b"),
      hsa: { structure: "single_bucket", balance: 0 },
      ira: rothTrad("ira"),
      brokerage: {
        structure: "basis_tracking",
        balance: afterTax,
        basis: afterTax,
      },
    },
    annualExpenses: 40000,
    inflationRate: 0,
    returnRates: [{ label: "0%", rate: 0 }],
    socialSecurityAnnual: 0,
    ssStartAge: 70,
    socialSecurityEntries: [
      {
        personId: 1,
        personName: "Ann",
        birthYear: 1948,
        startAge: 70,
        annualAmount: 0,
      },
      {
        personId: 2,
        personName: "Bo",
        birthYear: 1961,
        startAge: 70,
        annualAmount: 0,
      },
    ],
    perPersonBirthYears: [1948, 1961],
    primaryPersonId: 1,
    individualAccounts: accounts,
    asOfDate: AS_OF,
    filingStatus: "MFJ",
    ...overrides,
  };
  return withConsistentStart(
    withCapsAge(input as ProjectionInput),
    input,
  ) as ProjectionInput;
}
