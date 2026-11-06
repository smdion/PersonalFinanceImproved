/**
 * The withdrawal solver's `met | capped` status agrees with the year's own
 * shortfall, arm by arm, over invented households (advisor A1 F4: the
 * status's first reader). The solver estimates before routing; the year
 * measures after it, so where RMD enforcement forced more out, or costs
 * changed after routing, only the direction is checked.
 */
import { describe, it, expect, vi } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type * as Solver from "@/lib/pure/engine/withdrawal-solver";
import { acct, household } from "../fixtures/two-person-household";

type Call = {
  input: Parameters<typeof Solver.estimateWithdrawalTaxCost>[0];
  result: ReturnType<typeof Solver.estimateWithdrawalTaxCost>;
};
const calls = vi.hoisted((): Call[] => []);

vi.mock("@/lib/pure/engine/withdrawal-solver", async (importOriginal) => {
  const actual = await importOriginal<typeof Solver>();
  return {
    ...actual,
    estimateWithdrawalTaxCost: (input: Call["input"]) => {
      const result = actual.estimateWithdrawalTaxCost(input);
      calls.push({ input, result });
      return result;
    },
  };
});

const CENT = 0.011;
const round = (n: number) => Math.round(n * 100) / 100;

/** A couple retired in 2025, both under RMD age at the start, with
 *  Social Security from 67; `scale` sizes every account. */
function couple(
  scale: number,
  strategy: WithdrawalStrategyType,
  grossUpForTaxes: boolean,
  older = false,
): ProjectionInput {
  const accounts = [
    acct("Ann 401k", "401k", 400000 * scale, 1),
    acct("Bo IRA", "ira", 150000 * scale, 2),
    acct("Ann Roth IRA", "ira", 100000 * scale, 1, "taxFree"),
    acct("Joint brokerage", "brokerage", 200000 * scale, 1, "afterTax"),
  ];
  if (older) return household(accounts, {}, { withdrawalStrategy: strategy });
  const base = household(accounts);
  return household(
    accounts,
    {
      currentAge: 62,
      birthYear: 1964,
      perPersonBirthYears: [1964, 1966],
      retirementYear: 2025,
      projectionEndYear: 2050,
      annualExpenses: 70000,
      socialSecurityEntries: [
        {
          personId: 1,
          personName: "Ann",
          birthYear: 1964,
          startAge: 67,
          annualAmount: 28000,
        },
        {
          personId: 2,
          personName: "Bo",
          birthYear: 1966,
          startAge: 67,
          annualAmount: 18000,
        },
      ],
    },
    {
      withdrawalStrategy: strategy,
      distributionTaxRates: {
        ...base.decumulationDefaults.distributionTaxRates,
        grossUpForTaxes,
      },
    },
  );
}

const CASES: [string, ProjectionInput][] = [
  ["fixed, ample", couple(1, "fixed", true)],
  ["fixed, runs short", couple(0.15, "fixed", true)],
  ["fixed, gross-up off, ample", couple(1, "fixed", false)],
  ["fixed, gross-up off, runs short", couple(0.15, "fixed", false)],
  ["constant percentage, ample", couple(1, "constant_percentage", true)],
  ["constant percentage, small", couple(0.15, "constant_percentage", true)],
  ["endowment, small", couple(0.15, "endowment", true)],
  ["VPW, small", couple(0.15, "vpw", true)],
  ["RMD spending, older couple", couple(1, "rmd_spending", true, true)],
  ["fixed, older couple with RMDs", couple(1, "fixed", true, true)],
];

/** The solver call and the row of each retirement year, in order. */
function years(input: ProjectionInput) {
  calls.length = 0;
  const rows = calculateProjection(input).projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
  expect(calls).toHaveLength(rows.length);
  return rows.map((row, i) => ({ row, ...calls[i]! }));
}

describe("the solver's status agrees with the year's shortfall", () => {
  it.each(CASES)("%s", (_name, input) => {
    const seen = { met: 0, capped: 0 };
    for (const { row, input: est, result } of years(input)) {
      seen[result.status] += 1;
      const shortfall = result.status === "capped" ? result.shortfall : 0;
      const at = `${row.year} (${result.status} ${shortfall})`;
      // RMD enforcement took out more than the solver sized.
      const toppedUp = row.totalWithdrawal > row.targetWithdrawal + CENT;
      const grossGap = (need: number) =>
        round(Math.max(0, need - row.totalWithdrawal));
      if (est.fixedGrossWithdrawal !== undefined) {
        // The year's own measure: the amount that couldn't leave.
        expect(row.withdrawalSized, at).toBe(true);
        const gap = grossGap(est.fixedGrossWithdrawal);
        expect(gap, at).toBeLessThanOrEqual(shortfall + CENT);
        if (!toppedUp) expect(Math.abs(gap - shortfall), at).toBeLessThan(CENT);
      } else if (est.taxRates.grossUpForTaxes === false) {
        // The need is withdrawn as is: the routed gap.
        const gap = grossGap(est.afterTaxNeed);
        expect(gap, at).toBeLessThanOrEqual(shortfall + CENT);
        if (!toppedUp) expect(Math.abs(gap - shortfall), at).toBeLessThan(CENT);
      } else if (est.afterTaxNeed > 0 && !toppedUp) {
        // After tax: costs added after routing only widen the year's gap.
        const funding = round(
          Math.max(0, est.afterTaxNeed - (row.deliveredAfterTax ?? 0)),
        );
        expect(funding, at).toBeGreaterThanOrEqual(shortfall - CENT);
        const added =
          row.taxCost +
          (row.penaltyCost ?? 0) -
          result.estTax -
          result.estPenalty;
        if (Math.abs(added) < CENT)
          expect(Math.abs(funding - shortfall), at).toBeLessThan(CENT);
      }
    }
    expect(seen.met + seen.capped).toBeGreaterThan(0);
  });

  it("the households reach both statuses on every arm", () => {
    const seen = new Set<string>();
    for (const [, input] of CASES)
      for (const { input: est, result } of years(input)) {
        const arm =
          est.fixedGrossWithdrawal !== undefined
            ? "fixed"
            : est.taxRates.grossUpForTaxes === false
              ? "gross-up off"
              : "gross-up on";
        seen.add(`${arm} ${result.status}`);
      }
    expect([...seen].sort()).toEqual([
      "fixed capped",
      "fixed met",
      "gross-up off capped",
      "gross-up off met",
      "gross-up on capped",
      "gross-up on met",
    ]);
  });
});
