import { describe, it, expect } from "vitest";
import {
  calculateLoanMonthlyPayment,
  loanPayoffMonths,
} from "@/lib/utils/math";

describe("loanPayoffMonths", () => {
  it("is the inverse of calculateLoanMonthlyPayment", () => {
    const payment = calculateLoanMonthlyPayment(20000, 0.055, 10);
    expect(loanPayoffMonths(20000, 0.055, payment)).toBe(120);
  });

  it("no interest: balance over payment, rounded up", () => {
    expect(loanPayoffMonths(1000, 0, 300)).toBe(4);
  });

  it("unknown when no rate is entered (not treated as 0%)", () => {
    expect(loanPayoffMonths(900, null, 300)).toBeUndefined();
  });

  it("never when the payment doesn't cover the interest; unknown with no payment", () => {
    // 22% on $5,000 is ~$91.67 a month of interest.
    expect(loanPayoffMonths(5000, 0.22, 90)).toBeNull();
    expect(loanPayoffMonths(5000, 0.22, null)).toBeUndefined();
    expect(loanPayoffMonths(5000, 0.22, 0)).toBeUndefined();
  });

  it("a paid-off balance is zero months", () => {
    expect(loanPayoffMonths(0, 0.05, null)).toBe(0);
  });
});
