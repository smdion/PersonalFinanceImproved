/**
 * Invented inputs for the Simulation answer key
 * (`tests/calculators/answer-key-simulation.test.ts`,
 * `tests/benchmarks/answer-key-simulation-reference.test.ts`).
 *
 * The household is the review's reference retiree
 * (`.scratch/docs/reviews/2026-11-01/rebuild/simulation_adapter.ts`): one
 * person, 65 and retiring this year, every dollar in one Roth IRA, no
 * Social Security, so tax, penalties and RMDs are zero by construction and
 * a balance moves only by the withdrawal and the return. Spending is drawn
 * at the start of each year (EY-DC-02), as in the spec's reference cases
 * (`specs/simulation.md` § 11.6, § 11.7).
 *
 * `years` is the horizon the case states. The engine stops a year before
 * `projectionEndYear` (engine verdict E7, decision D10), so the end year is
 * padded by one and the run has exactly `years` rows. After D10 the pad
 * goes.
 */
import type { MonteCarloInput } from "@/lib/pure/simulation/monte-carlo.types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import { acct, household } from "../calculators/fixtures/two-person-household";

/** As of noon, January 1 2026: year 0 is a whole year. */
export const SIM_AS_OF = new Date(Date.UTC(2026, 0, 1, 12));
const AGE = 65;
const BIRTH_YEAR = 2026 - AGE;

export interface Retiree {
  /** Roth IRA balance on the as-of date. */
  start: number;
  /** Retirement budget, today's dollars, a year. */
  spend: number;
  /** Rows the run has (the case's horizon). */
  years: number;
  /** The plan's inflation, before and after retirement. */
  inflation: number;
  /** A fixed return every year, unless `returnPath` gives one per year. */
  returnRate?: number;
  /** One return per year from the as-of year (a historical replay). */
  returnPath?: readonly number[];
  /** One inflation shock per year, added to the plan's rate. */
  shocks?: readonly number[];
}

/** The reference retiree as a plain engine input. */
export function retiree(h: Retiree): ProjectionInput {
  const returnRates = h.returnPath
    ? h.returnPath.map((rate, i) => ({ label: `Age ${AGE + i}`, rate }))
    : [{ label: `Age ${AGE}`, rate: h.returnRate ?? 0 }];
  return household(
    [acct("Roth IRA", "ira", h.start, 1, "taxFree")],
    {
      currentAge: AGE,
      birthYear: BIRTH_YEAR,
      retirementYear: 2026,
      projectionEndYear: 2026 + h.years,
      asOfDate: SIM_AS_OF,
      annualExpenses: h.spend,
      decumulationAnnualExpenses: h.spend,
      inflationRate: h.inflation,
      postRetirementInflationRate: h.inflation,
      returnRates,
      ...(h.shocks ? { inflationShocks: h.shocks } : {}),
      socialSecurityEntries: [
        {
          personId: 1,
          personName: "Ann",
          birthYear: BIRTH_YEAR,
          startAge: 70,
          annualAmount: 0,
        },
      ],
      perPersonBirthYears: [BIRTH_YEAR],
      filingStatus: "Single",
    },
    {
      withdrawalStrategy: "fixed",
      withdrawalRate: h.start > 0 ? h.spend / h.start : 0.04,
      withdrawalOrder: ["ira", "brokerage", "401k", "403b", "hsa"],
      withdrawalSplits: { "401k": 0, "403b": 0, ira: 1, brokerage: 0, hsa: 0 },
      withdrawalTaxPreference: { ira: "roth" },
    },
  );
}

type AssetClass = MonteCarloInput["assetClasses"][number];

/** The spec's two classes (§ 11.7, P2-P4): arithmetic mean and deviation
 *  of the simple return. */
export const STOCKS: AssetClass = {
  id: 1,
  name: "Stocks",
  meanReturn: 0.1,
  stdDev: 0.18,
};
export const BONDS: AssetClass = {
  id: 2,
  name: "Bonds",
  meanReturn: 0.05,
  stdDev: 0.07,
};
/** Simple-return correlation 0.05 mapped to normal (log) space, the space
 *  Ledgr's correlations are applied in (§ 8): 0.05037. */
export const STOCK_BOND_CORRELATION = 0.05037;
/** 60/40 at every age. */
export const MIX_60_40: MonteCarloInput["glidePath"] = [
  { age: 0, allocations: { 1: 0.6, 2: 0.4 } },
];
/** One class at every age. */
export const ALL_IN_ONE: MonteCarloInput["glidePath"] = [
  { age: 0, allocations: { 1: 1 } },
];
/** No clamp: the spec's cases have none (a year can't lose more than
 *  everything). */
export const NO_CLAMP = { returnClampMin: -0.999999, returnClampMax: 1000 };

/** P2 (§ 11.7): 60/40, fixed 3% inflation, 4% of the start balance a year
 *  indexed to inflation, 30 years, start 1,000,000. */
export function p2(numTrials: number, seed: number): MonteCarloInput {
  return {
    engineInput: retiree({
      start: 1_000_000,
      spend: 40_000,
      years: 30,
      inflation: 0.03,
    }),
    numTrials,
    seed,
    assetClasses: [STOCKS, BONDS],
    correlations: [
      { classAId: 1, classBId: 2, correlation: STOCK_BOND_CORRELATION },
    ],
    glidePath: MIX_60_40,
    ...NO_CLAMP,
  };
}
