/** The Brokerage page's year rows count a planned withdrawal with the goals:
 *  listed under its label, in the year's withdrawals and their tax. */
import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { calculateBrokerageGoals } from "@/lib/pure/savings/brokerage-goals";
import { acct, household } from "../fixtures/two-person-household";

describe("calculateBrokerageGoals with a planned withdrawal", () => {
  it("lists it before the goals and counts it in the year's totals", () => {
    const brokerage = {
      ...acct("Ann brokerage", "brokerage", 100_000, 1, "afterTax"),
      parentCategory: "Portfolio",
      startingBasis: 50_000,
    };
    const goals = [
      {
        id: 1,
        name: "Car",
        targetAmount: 4_000,
        targetYear: 2027,
        priority: 1,
      },
    ];
    const engine = calculateProjection(
      household([acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"), brokerage], {
        retirementYear: 2035,
        currentSalary: 100_000,
        brokerageGoals: goals,
        brokerageWithdrawals: [{ id: "w", year: 2027, amount: 10_000 }],
      }),
    );
    const result = calculateBrokerageGoals({
      asOfDate: new Date("2026-03-07"),
      goals,
      engineYears: engine.projectionByYear,
    });
    const y = result.projectionByYear.find((r) => r.year === 2027)!;
    expect(y.plannedWithdrawals).toEqual([
      {
        name: "Planned withdrawal",
        amount: 10_000,
        basisPortion: 5_000,
        gainsPortion: 5_000,
        taxCost: 750,
      },
    ]);
    expect(y.goalWithdrawals.map((g) => g.amount)).toEqual([4_000]);
    expect(y.totalWithdrawal).toBe(14_000);
    expect(y.totalTaxCost).toBe(1_050);
    expect(y.endBalance).toBe(86_000);
    expect(result.goals[0]).toMatchObject({ funded: true, taxCost: 300 });
  });
});
