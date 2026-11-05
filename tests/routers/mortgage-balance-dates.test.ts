/** computeMortgageBalance is told the real today: a past date never takes
 *  the live balance (a finalized year stores this figure for good). */
import "./setup-mocks";
import { describe, expect, it, vi } from "vitest";
import { computeMortgageBalance } from "@/lib/pure/debts/mortgage-balance";

const loan = {
  id: 1,
  name: "Loan",
  isActive: true,
  refinancedFromId: null,
  paidOffDate: null,
  principalAndInterest: "1264.81",
  interestRate: "0.03",
  termYears: 30,
  originalLoanAmount: "300000",
  firstPaymentDate: "2020-01-01",
  apiBalance: "123456",
  apiBalanceDate: "2026-06-15",
} as never;

describe("computeMortgageBalance", () => {
  it("Dec 31 of last year keeps the schedule's balance", () => {
    vi.useFakeTimers({ now: new Date("2026-11-01T12:00:00Z") });
    try {
      const yearEnd = computeMortgageBalance(
        [loan],
        [],
        new Date("2025-12-31T12:00:00"),
      );
      expect(yearEnd).not.toBe(123456);
      expect(computeMortgageBalance([loan], [])).toBe(123456);
    } finally {
      vi.useRealTimers();
    }
  });
});
