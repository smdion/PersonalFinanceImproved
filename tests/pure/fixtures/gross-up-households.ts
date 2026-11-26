/**
 * Fictional retired households across the gross-up's matrix: one person
 * (Single, HOH) or two (MFJ); every routing mode; Social Security on or off
 * for each person, starting at any claiming age; Traditional, Roth and
 * brokerage money; ages before and after RMDs start.
 */
import fc from "fast-check";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { acct, household } from "./two-person-household";
import { shippedTaxTables } from "../../helpers/tax-data";

const householdShape = fc.record({
  twoPeople: fc.boolean(),
  singleFiling: fc.constantFrom("Single", "HOH") as fc.Arbitrary<
    "Single" | "HOH"
  >,
  routing: fc.constantFrom("waterfall", "bracket_filling", "percentage"),
  annAge: fc.integer({ min: 60, max: 80 }),
  boAge: fc.integer({ min: 60, max: 80 }),
  annSs: fc.integer({ min: 0, max: 45000 }),
  boSs: fc.integer({ min: 0, max: 30000 }),
  annSsStart: fc.integer({ min: 62, max: 70 }),
  boSsStart: fc.integer({ min: 62, max: 70 }),
  annTraditional: fc.integer({ min: 0, max: 1_500_000 }),
  annRoth: fc.integer({ min: 0, max: 400_000 }),
  brokerage: fc.integer({ min: 0, max: 400_000 }),
  boTraditional: fc.integer({ min: 0, max: 800_000 }),
  iraPreference: fc.constantFrom("roth", "traditional"),
  bracketCeiling: fc.constantFrom(0.1, 0.12, 0.22, 0.24),
  expenses: fc.integer({ min: 20000, max: 160000 }),
  inflation: fc.double({ min: 0, max: 0.04, noNaN: true }),
  returnRate: fc.double({ min: 0, max: 0.08, noNaN: true }),
});
export type Shape =
  typeof householdShape extends fc.Arbitrary<infer T> ? T : never;

export function buildHousehold(r: Shape): ProjectionInput {
  const year = 2026;
  const annBirth = year - r.annAge;
  const boBirth = year - r.boAge;
  const accounts: IndividualAccountInput[] = [
    acct("Ann 401k", "401k", r.annTraditional, 1),
    acct("Ann Roth IRA", "ira", r.annRoth, 1, "taxFree"),
    acct("Brokerage", "brokerage", r.brokerage, 1, "afterTax"),
    ...(r.twoPeople ? [acct("Bo IRA", "ira", r.boTraditional, 2)] : []),
  ].filter((a) => a.startingBalance > 0);
  const ss = [
    {
      personId: 1,
      personName: "Ann",
      birthYear: annBirth,
      startAge: r.annSsStart,
      annualAmount: r.annSs,
    },
    ...(r.twoPeople
      ? [
          {
            personId: 2,
            personName: "Bo",
            birthYear: boBirth,
            startAge: r.boSsStart,
            annualAmount: r.boSs,
          },
        ]
      : []),
  ];
  return household(
    accounts,
    {
      currentAge: r.annAge,
      birthYear: annBirth,
      perPersonBirthYears: r.twoPeople ? [annBirth, boBirth] : [annBirth],
      retirementYear: year - 1,
      projectionEndYear: year + 20,
      filingStatus: r.twoPeople ? "MFJ" : r.singleFiling,
      annualExpenses: r.expenses,
      decumulationAnnualExpenses: r.expenses,
      inflationRate: r.inflation,
      returnRates: [{ label: "Age 0", rate: r.returnRate }],
      socialSecurityAnnual: ss.reduce((s, e) => s + e.annualAmount, 0),
      ssStartAge: r.annSsStart,
      socialSecurityEntries: ss,
    },
    {
      withdrawalRoutingMode: r.routing,
      withdrawalSplits: {
        "401k": 0.5,
        "403b": 0,
        ira: 0.3,
        brokerage: 0.2,
        hsa: 0,
      },
      withdrawalTaxPreference: {
        "401k": "traditional",
        ira: r.iraPreference,
      },
      withdrawalStrategy: "fixed",
      distributionTaxRates: {
        rothBracketOverlay: true,
        ...shippedTaxTables(),
        traditionalFallbackRate: 0.2,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        grossUpForTaxes: true,
        rothBracketTarget: r.bracketCeiling,
      },
    },
  );
}

/** A household from the matrix, built. */
export const arbitraryHousehold = householdShape.map(buildHousehold);
