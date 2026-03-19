import { describe, it, expect } from "vitest";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import type { MortgageInput } from "@/lib/calculators/types";
import { AS_OF_DATE } from "./fixtures";

describe("calculateMortgage", () => {
  // Simplified mortgage for testing — a $280,000 loan at 6.5% for 30 years
  const baseLoan = {
    id: 1,
    name: "Primary Mortgage",
    originalBalance: 280000,
    interestRate: 0.065,
    termMonths: 360,
    startDate: new Date("2022-09-01"),
    monthlyPI: 1770.09, // standard 30yr P&I at 6.5%
    isActive: true,
  };

  describe("basic amortization", () => {
    const input: MortgageInput = {
      loans: [baseLoan],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("returns one active loan result", () => {
      expect(result.loans).toHaveLength(1);
    });

    it("computes current balance less than original", () => {
      const loan = result.loans[0]!;
      expect(loan.currentBalance).toBeLessThan(280000);
      expect(loan.currentBalance).toBeGreaterThan(0);
    });

    it("computes payoff percentage", () => {
      const loan = result.loans[0]!;
      // ~2.5 years in, mostly interest, so payoff% is small
      expect(loan.payoffPercent).toBeGreaterThan(0);
      expect(loan.payoffPercent).toBeLessThan(0.1);
    });

    it("generates full amortization schedule", () => {
      const loan = result.loans[0]!;
      // Standard 30yr = 360 months
      expect(loan.amortizationSchedule.length).toBe(360);
    });

    it("first month has mostly interest", () => {
      const first = result.loans[0]!.amortizationSchedule[0]!;
      // Interest = $280,000 × 6.5%/12 = $1,516.67
      expect(first.interest).toBeCloseTo(1516.67, 0);
      expect(first.principal).toBeLessThan(first.interest);
    });

    it("last month has zero or near-zero balance", () => {
      const schedule = result.loans[0]!.amortizationSchedule;
      const last = schedule[schedule.length - 1]!;
      expect(last.balance).toBe(0);
    });
  });

  describe("extra payments", () => {
    const input: MortgageInput = {
      loans: [baseLoan],
      extraPayments: [
        { loanId: 1, date: new Date("2023-06-01"), amount: 5000 },
        { loanId: 1, date: new Date("2024-01-01"), amount: 10000 },
      ],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("reduces total interest compared to no extras", () => {
      expect(result.loans[0]!.totalInterestSaved).toBeGreaterThan(0);
    });

    it("shows months ahead of schedule", () => {
      expect(result.loans[0]!.monthsAheadOfSchedule).toBeGreaterThan(0);
    });
  });

  describe("what-if scenarios", () => {
    const input: MortgageInput = {
      loans: [baseLoan],
      extraPayments: [],
      whatIfScenarios: [
        { label: "+$200/month", extraMonthlyPrincipal: 200 },
        { label: "+$500/month", extraMonthlyPrincipal: 500 },
      ],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("generates one what-if result per scenario per loan", () => {
      expect(result.whatIfResults).toHaveLength(2);
    });

    it("more extra payment saves more interest", () => {
      const small = result.whatIfResults.find((r) => r.label.includes("$200"))!;
      const large = result.whatIfResults.find((r) => r.label.includes("$500"))!;
      expect(large.interestSaved).toBeGreaterThan(small.interestSaved);
      expect(large.monthsSaved).toBeGreaterThan(small.monthsSaved);
    });
  });

  describe("refinance chain", () => {
    const originalLoan = {
      ...baseLoan,
      id: 1,
      name: "Original 30yr",
      isActive: false,
    };
    const refiLoan = {
      id: 2,
      name: "Refi 15yr",
      originalBalance: 260000,
      interestRate: 0.05,
      termMonths: 180,
      startDate: new Date("2024-01-01"),
      monthlyPI: 2056.41,
      refinancedFromId: 1,
      isActive: true,
    };

    const input: MortgageInput = {
      loans: [originalLoan, refiLoan],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("only amortizes active loans", () => {
      expect(result.loans).toHaveLength(1);
      expect(result.loans[0]!.name).toBe("Refi 15yr");
    });

    it("tracks refinance chain in loan history", () => {
      expect(result.loanHistory).toHaveLength(2);
      const original = result.loanHistory.find(
        (l) => l.name === "Original 30yr",
      );
      expect(original?.isActive).toBe(false);
      expect(original?.refinancedInto).toBe("Refi 15yr");
    });
  });
});
