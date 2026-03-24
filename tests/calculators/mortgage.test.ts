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
      // Interest = $280,000 * 6.5%/12 = $1,516.67
      expect(first.interest).toBeCloseTo(1516.67, 0);
      expect(first.principal).toBeLessThan(first.interest);
    });

    it("last month has zero or near-zero balance", () => {
      const schedule = result.loans[0]!.amortizationSchedule;
      const last = schedule[schedule.length - 1]!;
      expect(last.balance).toBe(0);
    });

    it("total interest paid over life is positive", () => {
      const loan = result.loans[0]!;
      expect(loan.totalInterestLife).toBeGreaterThan(0);
    });

    it("total interest paid matches sum of schedule interest entries", () => {
      const loan = result.loans[0]!;
      const scheduleInterest = loan.amortizationSchedule.reduce(
        (s, e) => s + e.interest,
        0,
      );
      expect(loan.totalInterestLife).toBeCloseTo(scheduleInterest, 2);
    });

    it("each month has positive principal and interest", () => {
      const loan = result.loans[0]!;
      for (const entry of loan.amortizationSchedule) {
        expect(entry.principal).toBeGreaterThan(0);
        expect(entry.interest).toBeGreaterThanOrEqual(0);
      }
    });

    it("balance decreases monotonically", () => {
      const loan = result.loans[0]!;
      let prevBalance = loan.amortizationSchedule[0]!.balance;
      for (let i = 1; i < loan.amortizationSchedule.length; i++) {
        const entry = loan.amortizationSchedule[i]!;
        expect(entry.balance).toBeLessThanOrEqual(prevBalance);
        prevBalance = entry.balance;
      }
    });

    it("payoff date is roughly 30 years from start", () => {
      const loan = result.loans[0]!;
      const years =
        (loan.payoffDate.getTime() - baseLoan.startDate.getTime()) /
        (365.25 * 24 * 60 * 60 * 1000);
      expect(years).toBeCloseTo(30, 0);
    });

    it("remainingMonths is positive for in-progress loan", () => {
      const loan = result.loans[0]!;
      expect(loan.remainingMonths).toBeGreaterThan(0);
    });

    it("totalInterestPaid reflects interest up to asOfDate", () => {
      const loan = result.loans[0]!;
      expect(loan.totalInterestPaid).toBeGreaterThan(0);
      expect(loan.totalInterestPaid).toBeLessThan(loan.totalInterestLife);
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

    it("schedule is shorter than 360 months", () => {
      expect(result.loans[0]!.amortizationSchedule.length).toBeLessThan(360);
    });

    it("extra payment months show non-zero extraPayment", () => {
      const schedule = result.loans[0]!.amortizationSchedule;
      const hasExtra = schedule.some((e) => e.extraPayment > 0);
      expect(hasExtra).toBe(true);
    });

    it("lower current balance than no-extras scenario", () => {
      const noExtrasInput: MortgageInput = {
        loans: [baseLoan],
        extraPayments: [],
        whatIfScenarios: [],
        asOfDate: AS_OF_DATE,
      };
      const noExtrasResult = calculateMortgage(noExtrasInput);
      expect(result.loans[0]!.currentBalance).toBeLessThan(
        noExtrasResult.loans[0]!.currentBalance,
      );
    });
  });

  describe("negative extra payment warning", () => {
    const input: MortgageInput = {
      loans: [baseLoan],
      extraPayments: [
        { loanId: 1, date: new Date("2023-06-01"), amount: -100 },
      ],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("warns about negative extra payments", () => {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("negative"))).toBe(true);
    });

    it("ignores negative extra payments in schedule", () => {
      const schedule = result.loans[0]!.amortizationSchedule;
      // No entry should have negative extra payment
      for (const entry of schedule) {
        expect(entry.extraPayment).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("monthly rate warning", () => {
    const lowRateLoan = {
      ...baseLoan,
      interestRate: 0.005, // looks like monthly rate instead of annual
    };
    const input: MortgageInput = {
      loans: [lowRateLoan],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("warns when interest rate looks like a monthly rate", () => {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("monthly rate"))).toBe(
        true,
      );
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

    it("what-if payoff dates are earlier than baseline", () => {
      const baseline = result.loans[0]!;
      for (const wif of result.whatIfResults) {
        expect(wif.payoffDate.getTime()).toBeLessThan(
          baseline.payoffDate.getTime(),
        );
      }
    });

    it("interest saved is positive for all scenarios", () => {
      for (const wif of result.whatIfResults) {
        expect(wif.interestSaved).toBeGreaterThan(0);
      }
    });
  });

  describe("what-if with loanId targeting", () => {
    const loan2 = {
      id: 2,
      name: "Rental Property",
      originalBalance: 200000,
      interestRate: 0.07,
      termMonths: 360,
      startDate: new Date("2023-01-01"),
      monthlyPI: 1330.6,
      isActive: true,
    };

    const input: MortgageInput = {
      loans: [baseLoan, loan2],
      extraPayments: [],
      whatIfScenarios: [
        { label: "Target loan 1", extraMonthlyPrincipal: 200, loanId: 1 },
        { label: "All loans", extraMonthlyPrincipal: 200 },
      ],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("targeted scenario produces one result", () => {
      const targeted = result.whatIfResults.filter((r) =>
        r.label.includes("Target loan 1"),
      );
      expect(targeted).toHaveLength(1);
    });

    it("untargeted scenario produces results for all active loans", () => {
      const untargeted = result.whatIfResults.filter((r) =>
        r.label.includes("All loans"),
      );
      expect(untargeted).toHaveLength(2);
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

    it("historical loan has paidOffDate matching refi start", () => {
      expect(result.historicalLoans).toHaveLength(1);
      const hist = result.historicalLoans[0]!;
      expect(hist.wasRefinanced).toBe(true);
      expect(hist.paidOffDate).toEqual(refiLoan.startDate);
    });

    it("historical loan schedule is truncated at refinance date", () => {
      const hist = result.historicalLoans[0]!;
      const lastEntry =
        hist.amortizationSchedule[hist.amortizationSchedule.length - 1]!;
      expect(lastEntry.date.getTime()).toBeLessThanOrEqual(
        refiLoan.startDate.getTime(),
      );
    });

    it("historical loan has endedBalance", () => {
      const hist = result.historicalLoans[0]!;
      expect(hist.endedBalance).toBeDefined();
      expect(hist.endedBalance).toBeGreaterThan(0);
    });

    it("historical loan has fullTermStandardInterest", () => {
      const hist = result.historicalLoans[0]!;
      expect(hist.fullTermStandardInterest).toBeDefined();
      expect(hist.fullTermStandardInterest).toBeGreaterThan(0);
    });
  });

  describe("historical loan with paidOffDate", () => {
    const paidOff = {
      ...baseLoan,
      id: 1,
      name: "Paid Off Loan",
      isActive: false,
      paidOffDate: new Date("2024-06-01"),
    };

    const input: MortgageInput = {
      loans: [paidOff],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("uses paidOffDate for truncation", () => {
      expect(result.historicalLoans).toHaveLength(1);
      const hist = result.historicalLoans[0]!;
      expect(hist.paidOffDate).toEqual(paidOff.paidOffDate);
    });

    it("no active loans", () => {
      expect(result.loans).toHaveLength(0);
    });
  });

  describe("API balance override", () => {
    const loanWithApi = {
      ...baseLoan,
      apiBalance: 265000,
      apiBalanceDate: new Date("2025-03-01"),
    };
    const input: MortgageInput = {
      loans: [loanWithApi],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: new Date(), // current date for API balance to apply
    };
    const result = calculateMortgage(input);

    it("uses API balance as currentBalance", () => {
      expect(result.loans[0]!.apiBalance).toBe(265000);
      expect(result.loans[0]!.currentBalance).toBe(265000);
    });

    it("provides calculatedBalance for comparison", () => {
      expect(result.loans[0]!.calculatedBalance).toBeDefined();
      expect(result.loans[0]!.calculatedBalance).not.toBe(265000);
    });

    it("provides apiBalanceDate", () => {
      expect(result.loans[0]!.apiBalanceDate).toEqual(new Date("2025-03-01"));
    });
  });

  describe("multi-loan support", () => {
    const loan2 = {
      id: 2,
      name: "Rental Property",
      originalBalance: 200000,
      interestRate: 0.07,
      termMonths: 360,
      startDate: new Date("2023-01-01"),
      monthlyPI: 1330.6,
      isActive: true,
    };

    const input: MortgageInput = {
      loans: [baseLoan, loan2],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("returns results for both active loans", () => {
      expect(result.loans).toHaveLength(2);
    });

    it("each loan amortized independently", () => {
      const primary = result.loans.find((l) => l.name === "Primary Mortgage")!;
      const rental = result.loans.find((l) => l.name === "Rental Property")!;
      expect(primary.amortizationSchedule.length).toBe(360);
      expect(rental.amortizationSchedule.length).toBe(360);
    });

    it("loan history includes all loans", () => {
      expect(result.loanHistory).toHaveLength(2);
    });
  });

  describe("extra payments for specific loan only", () => {
    const loan2 = {
      id: 2,
      name: "Second Loan",
      originalBalance: 150000,
      interestRate: 0.06,
      termMonths: 360,
      startDate: new Date("2023-01-01"),
      monthlyPI: 899.33,
      isActive: true,
    };

    const input: MortgageInput = {
      loans: [baseLoan, loan2],
      extraPayments: [
        { loanId: 2, date: new Date("2023-06-01"), amount: 10000 },
      ],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("only the targeted loan benefits from extra payment", () => {
      const primary = result.loans.find((l) => l.loanId === 1)!;
      const second = result.loans.find((l) => l.loanId === 2)!;
      expect(primary.totalInterestSaved).toBe(0);
      expect(second.totalInterestSaved).toBeGreaterThan(0);
    });
  });

  describe("edge case: zero balance loan", () => {
    const zeroBal = {
      ...baseLoan,
      originalBalance: 0,
    };
    const input: MortgageInput = {
      loans: [zeroBal],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("returns loan with zero balance and empty schedule", () => {
      const loan = result.loans[0]!;
      expect(loan.currentBalance).toBe(0);
      expect(loan.amortizationSchedule).toHaveLength(0);
    });
  });

  describe("edge case: no active loans", () => {
    const input: MortgageInput = {
      loans: [],
      extraPayments: [],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("returns empty arrays", () => {
      expect(result.loans).toHaveLength(0);
      expect(result.historicalLoans).toHaveLength(0);
      expect(result.whatIfResults).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("edge case: multiple extra payments same month", () => {
    const input: MortgageInput = {
      loans: [baseLoan],
      extraPayments: [
        { loanId: 1, date: new Date("2023-06-15"), amount: 2000 },
        { loanId: 1, date: new Date("2023-06-20"), amount: 3000 },
      ],
      whatIfScenarios: [],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("sums extra payments in the same month", () => {
      const schedule = result.loans[0]!.amortizationSchedule;
      // Find the June 2023 entry (roughly month 10)
      const juneEntry = schedule.find(
        (e) => e.date.getUTCMonth() === 5 && e.date.getUTCFullYear() === 2023,
      );
      expect(juneEntry).toBeDefined();
      expect(juneEntry!.extraPayment).toBeCloseTo(5000, 0);
    });
  });

  describe("what-if with no matching baseline", () => {
    // What-if targeting a non-existent loan ID
    const input: MortgageInput = {
      loans: [baseLoan],
      extraPayments: [],
      whatIfScenarios: [
        { label: "Ghost loan", extraMonthlyPrincipal: 200, loanId: 999 },
      ],
      asOfDate: AS_OF_DATE,
    };
    const result = calculateMortgage(input);

    it("produces no results for non-existent loan target", () => {
      expect(result.whatIfResults).toHaveLength(0);
    });
  });
});
