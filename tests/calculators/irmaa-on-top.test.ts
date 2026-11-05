/**
 * IRMAA in the budget or on top of it (`irmaaOnTopOfBudget`). In the budget
 * nothing moves; on top, a need-sized year's need rises by the surcharge
 * once the two-year lookback exists. It never enters projectedExpenses or
 * taxCost.
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  EngineDecumulationYear,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { acct, household } from "../pure/fixtures/two-person-household";

// Ann 78 and Bo 75 draw enough Traditional to sit above the first tier.
const input = (
  overrides: Partial<ProjectionInput> = {},
  decumulation: Partial<ProjectionInput["decumulationDefaults"]> = {},
) =>
  household(
    [
      acct("Ann 401k", "401k", 3000000, 1),
      acct("Bo 401k", "401k", 3000000, 2),
      acct("Cash", "brokerage", 500000, 1, "afterTax"),
    ],
    {
      annualExpenses: 400000,
      enableIrmaaAwareness: true,
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
          birthYear: 1951,
          startAge: 70,
          annualAmount: 0,
        },
      ],
      perPersonBirthYears: [1948, 1951],
      ...overrides,
    },
    decumulation,
  );
const years = (i: ProjectionInput) =>
  calculateProjection(i).projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );

describe("IRMAA on top of the budget", () => {
  const inBudget = years(input());
  const onTop = years(input({ irmaaOnTopOfBudget: true }));

  it("in the budget (the default) pays nothing extra", () => {
    expect(inBudget[3]!.irmaaCost).toBeGreaterThan(0);
    expect(inBudget.every((y) => y.irmaaPaid === undefined)).toBe(true);
  });

  it("with the lookback known, the year's need rises by it, and everyone 65+ counts", () => {
    const y = onTop[3]!;
    expect(y.irmaaPaid).toBe(y.irmaaCost);
    expect(y.afterTaxNeed).toBeCloseTo(y.projectedExpenses + y.irmaaCost, 1);
    expect(y.targetWithdrawal).toBeGreaterThan(inBudget[3]!.targetWithdrawal);
    // Spending stays what the budget set; the portfolio paid the surcharge.
    expect(y.projectedExpenses).toBe(inBudget[3]!.projectedExpenses);
    expect(y.spending).toBeCloseTo(y.projectedExpenses, 0);
  });

  it("the first two years have no lookback: it lowers what's spent, not the need", () => {
    const y = onTop[0]!;
    expect(y.irmaaPaid).toBe(y.irmaaCost);
    expect(y.irmaaCost).toBeGreaterThan(0);
    expect(y.afterTaxNeed).toBe(inBudget[0]!.afterTaxNeed);
    expect(y.spending).toBeCloseTo(inBudget[0]!.spending - y.irmaaCost, 0);
  });

  it("stays out of taxCost: the optimizer's netCost can't count it twice", () => {
    const y = onTop[3]!;
    const rate = inBudget[3]!.taxCost / inBudget[3]!.totalWithdrawal;
    expect(y.taxCost / y.totalWithdrawal).toBeLessThan(rate + 0.02);
    expect(y.taxCost).toBeLessThan(y.totalWithdrawal);
    expect(y.taxCost).toBeLessThan(inBudget[3]!.taxCost + y.irmaaCost);
  });

  it("a withdrawal-sized year keeps the strategy's amount; IRMAA comes out of what it delivers", () => {
    const strategy = {
      withdrawalStrategy: "vpw" as const,
      strategyParams: {},
    };
    const fixedIn = years(input({}, strategy))[3]!;
    const fixedOn = years(input({ irmaaOnTopOfBudget: true }, strategy))[3]!;
    expect(fixedIn.withdrawalSized).toBe(true);
    expect(fixedOn.targetWithdrawal).toBe(fixedIn.targetWithdrawal);
    expect(fixedOn.spending).toBeCloseTo(
      fixedIn.spending - fixedOn.irmaaCost,
      0,
    );
    expect(fixedOn.rmdExcessAmount).toBe(fixedIn.rmdExcessAmount);
  });

  it("running out shows as unmet need", () => {
    const short = years(
      household(
        [
          acct("Ann 401k", "401k", 900000, 1),
          acct("Bo 401k", "401k", 900000, 2),
        ],
        {
          annualExpenses: 420000,
          enableIrmaaAwareness: true,
          irmaaOnTopOfBudget: true,
          projectionEndYear: 2041,
          perPersonBirthYears: [1948, 1951],
        },
      ),
    );
    expect(short.some((y) => (y.unmetNeed ?? 0) > 0)).toBe(true);
  });

  it("without awareness the choice does nothing", () => {
    const off = years(
      input({ enableIrmaaAwareness: false, irmaaOnTopOfBudget: true }),
    );
    expect(off[3]!.irmaaPaid).toBeUndefined();
    expect(off[3]!.irmaaCost).toBe(0);
  });
});
