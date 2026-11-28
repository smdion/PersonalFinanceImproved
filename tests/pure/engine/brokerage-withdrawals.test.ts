/**
 * A planned brokerage withdrawal leaves the Portfolio brokerages in its
 * working year with its gain's tax, drawn as a brokerage goal is and before
 * the year's goals. Household: tests/pure/fixtures/two-person-household.ts
 * (flat 0% returns, brokerage gains at 15%), working until 2035. The figures
 * worked by hand are engine/BW1 in answer-key-behaviors.test.ts.
 */
import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  EngineAccumulationYear,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { acct, household } from "../fixtures/two-person-household";

const WORKING = { retirementYear: 2035, currentSalary: 100_000 };

function portfolioBrokerage(balance: number, basis: number) {
  return {
    ...acct("Ann brokerage", "brokerage", balance, 1, "afterTax"),
    parentCategory: "Portfolio",
    startingBasis: basis,
  };
}

function run(
  changes: Partial<ProjectionInput>,
  brokerage = portfolioBrokerage(100_000, 50_000),
) {
  const input = household(
    [acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"), brokerage],
    { ...WORKING, ...changes },
  );
  return calculateProjection(input).projectionByYear;
}

function row(changes: Partial<ProjectionInput>, year: number) {
  const found = run(changes).find((y) => y.year === year);
  expect(found?.phase).toBe("accumulation");
  return found as EngineAccumulationYear;
}

const goal = (targetAmount: number) => ({
  id: 1,
  name: "Car",
  targetAmount,
  targetYear: 2027,
  priority: 1,
});

describe("planned brokerage withdrawals", () => {
  it("draws as a goal of the same amount does", () => {
    const planned = row(
      {
        brokerageWithdrawals: [
          { id: "w1", year: 2027, amount: 10_000, label: "Roof" },
        ],
      },
      2027,
    );
    const asGoal = row({ brokerageGoals: [goal(10_000)] }, 2027);
    const {
      goalId: _id,
      name: _name,
      ...goalDraw
    } = asGoal.brokerageGoalWithdrawals[0]!;
    expect(planned.brokerageWithdrawals).toEqual([
      { id: "w1", label: "Roof", requested: 10_000, ...goalDraw },
    ]);
    expect(planned.balanceByTaxType).toEqual(asGoal.balanceByTaxType);
    expect(planned.individualAccountBalances).toEqual(
      asGoal.individualAccountBalances,
    );
  });

  it("is drawn before the year's goals", () => {
    const y = row(
      {
        brokerageGoals: [goal(10_000)],
        brokerageWithdrawals: [{ id: "w1", year: 2027, amount: 95_000 }],
      },
      2027,
    );
    expect(y.brokerageWithdrawals![0]!.amount).toBe(95_000);
    expect(y.brokerageGoalWithdrawals[0]!.amount).toBe(5_000);
  });

  it("draws at most what the brokerages hold, beside what it asked for", () => {
    const y = row(
      {
        brokerageWithdrawals: [
          { id: "w1", year: 2027, amount: 150_000, label: "House" },
        ],
      },
      2027,
    );
    expect(y.brokerageWithdrawals![0]).toMatchObject({
      amount: 100_000,
      requested: 150_000,
    });
    expect(y.balanceByTaxType.afterTax).toBeCloseTo(0, 2);
  });

  it("leaves Retirement brokerages alone", () => {
    const retirement = {
      ...portfolioBrokerage(100_000, 50_000),
      parentCategory: "Retirement",
    };
    const ys = run(
      { brokerageWithdrawals: [{ id: "w1", year: 2027, amount: 10_000 }] },
      retirement,
    );
    const y = ys.find((r) => r.year === 2027) as EngineAccumulationYear;
    expect(y.brokerageWithdrawals![0]!.amount).toBe(0);
    expect(y.balanceByTaxType.afterTax).toBeCloseTo(100_000, 2);
  });

  it("lists one dated in a retirement year, which isn't drawn", () => {
    const input = household(
      [
        acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"),
        portfolioBrokerage(100_000, 50_000),
      ],
      {
        ...WORKING,
        projectionEndYear: 2040,
        brokerageWithdrawals: [
          { id: "w1", year: 2038, amount: 10_000, label: "Boat" },
        ],
      },
    );
    const result = calculateProjection(input);
    expect(result.undrawnBrokerageWithdrawals).toEqual([
      { id: "w1", year: 2038, amount: 10_000, label: "Boat" },
    ]);
    expect(
      result.projectionByYear.some(
        (y) => y.phase === "accumulation" && y.brokerageWithdrawals,
      ),
    ).toBe(false);
  });

  it("adds nothing to a year without one", () => {
    const y = row(
      { brokerageWithdrawals: [{ id: "w1", year: 2028, amount: 10_000 }] },
      2027,
    );
    expect("brokerageWithdrawals" in y).toBe(false);
  });

  it("lists none when every withdrawal falls in a working year", () => {
    const result = calculateProjection(
      household(
        [
          acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"),
          portfolioBrokerage(100_000, 50_000),
        ],
        {
          ...WORKING,
          brokerageWithdrawals: [{ id: "w1", year: 2027, amount: 10_000 }],
        },
      ),
    );
    expect("undrawnBrokerageWithdrawals" in result).toBe(false);
  });
});
