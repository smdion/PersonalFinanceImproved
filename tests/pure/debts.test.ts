import { describe, it, expect } from "vitest";
import { debtPayoffEstimate } from "@/lib/pure/debts";

const loan = {
  balance: 1_000,
  interestRate: 0,
  monthlyPayment: 100,
  balanceAsOf: "2026-03-15",
};

describe("debtPayoffEstimate", () => {
  it("counts forward from the month the balance is as of", () => {
    expect(debtPayoffEstimate(loan, "2026-03-20")).toEqual({
      months: 10,
      payoffMonth: "2027-01",
      never: false,
      stale: false,
    });
  });

  it("unknown without a rate or a payment; never when the payment doesn't cover interest", () => {
    expect(
      debtPayoffEstimate({ ...loan, interestRate: null }, "2026-03-20"),
    ).toMatchObject({ payoffMonth: null, never: false, stale: false });
    expect(
      debtPayoffEstimate({ ...loan, monthlyPayment: null }, "2026-03-20"),
    ).toMatchObject({ payoffMonth: null, never: false });
    expect(
      debtPayoffEstimate(
        { ...loan, interestRate: 0.24, monthlyPayment: 10 },
        "2026-03-20",
      ),
    ).toMatchObject({ payoffMonth: null, never: true });
  });

  it("stale once the estimate is before this month — never a payoff in the past", () => {
    expect(debtPayoffEstimate(loan, "2027-01-31")).toMatchObject({
      payoffMonth: "2027-01",
      stale: false,
    });
    expect(debtPayoffEstimate(loan, "2027-02-01")).toEqual({
      months: null,
      payoffMonth: null,
      never: false,
      stale: true,
    });
  });
});
