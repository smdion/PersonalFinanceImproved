/** The Brokerage page's planned events as its projection reads them: a
 *  deposit is a Portfolio lump sum, a withdrawal leaves the brokerage. */
import { describe, expect, it } from "vitest";
import {
  plannedEventFlows,
  plannedWithdrawalNotes,
} from "@/app/(dashboard)/brokerage/planned-event-flows";
import type { LumpSumEvent } from "@/components/retirement-projection/types";
import { calculateProjection } from "@/lib/pure/engine";
import { acct, household } from "../../pure/fixtures/two-person-household";

const event = (changes: Partial<LumpSumEvent>): LumpSumEvent => ({
  id: "e1",
  year: "2030",
  amount: "5000",
  targetAccount: "brokerage",
  targetAccountName: "Long Term Brokerage",
  targetOwnerName: "",
  taxType: "",
  label: "",
  targetPerformanceAccountId: 7,
  targetOwnerPersonId: null,
  ...changes,
});

describe("plannedEventFlows", () => {
  it("sends a withdrawal as a withdrawal of its size, never as a deposit", () => {
    const flows = plannedEventFlows([
      event({ id: "w", amount: "-20000", label: "Down payment" }),
    ]);
    expect(flows.accumulationOverrides).toEqual([]);
    expect(flows.withdrawals).toEqual([
      { id: "w", year: 2030, amount: 20_000, label: "Down payment" },
    ]);
  });

  it("sends a deposit as a Portfolio lump sum in its year", () => {
    const flows = plannedEventFlows([event({ label: "Bonus" })]);
    expect(flows.withdrawals).toEqual([]);
    expect(flows.accumulationOverrides).toEqual([
      {
        year: 2030,
        lumpSums: [
          {
            id: "e1",
            amount: 5000,
            targetAccount: "brokerage",
            targetParentCategory: "Portfolio",
            targetAccountName: "Long Term Brokerage",
            targetPerformanceAccountId: 7,
            targetOwnerPersonId: null,
            label: "Bonus",
          },
        ],
      },
    ]);
  });

  it("orders years and leaves out an empty or zero event", () => {
    const flows = plannedEventFlows([
      event({ id: "a", year: "2032" }),
      event({ id: "b", year: "2031" }),
      event({ id: "c", amount: "0" }),
      event({ id: "d", amount: "" }),
      event({ id: "e", year: "", amount: "-10" }),
    ]);
    expect(flows.accumulationOverrides.map((o) => o.year)).toEqual([
      2031, 2032,
    ]);
    expect(flows.withdrawals).toEqual([]);
  });
});

describe("plannedWithdrawalNotes", () => {
  it("names a withdrawal drawn in part and one in a retirement year", () => {
    const brokerage = {
      ...acct("Ann brokerage", "brokerage", 100_000, 1, "afterTax"),
      parentCategory: "Portfolio",
      startingBasis: 50_000,
    };
    const result = calculateProjection(
      household([acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"), brokerage], {
        retirementYear: 2035,
        currentSalary: 100_000,
        projectionEndYear: 2040,
        brokerageWithdrawals: [
          { id: "a", year: 2027, amount: 150_000, label: "House" },
          { id: "b", year: 2038, amount: 10_000 },
        ],
      }),
    );
    expect(plannedWithdrawalNotes(result)).toEqual([
      'Planned withdrawal "House" in 2027: $100,000.00 of $150,000.00 drawn, all the Portfolio brokerages hold.',
      "A planned withdrawal of $10,000.00 in 2038 isn't drawn: only a projected year before retirement draws one.",
    ]);
  });

  it("has nothing to say when every withdrawal is drawn in full", () => {
    const result = calculateProjection(
      household(
        [
          {
            ...acct("Ann brokerage", "brokerage", 100_000, 1, "afterTax"),
            parentCategory: "Portfolio",
          },
        ],
        {
          retirementYear: 2035,
          currentSalary: 100_000,
          brokerageWithdrawals: [{ id: "a", year: 2027, amount: 1_000 }],
        },
      ),
    );
    expect(plannedWithdrawalNotes(result)).toEqual([]);
  });
});
