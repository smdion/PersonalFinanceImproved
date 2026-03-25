import { describe, it, expect, vi } from "vitest";

// Mock DB schema and imports to avoid pg driver
vi.mock("@/lib/db/schema", () => ({
  mortgageLoans: {},
  mortgageExtraPayments: {},
}));
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  buildMortgageInputs,
  computeMortgageBalance,
} from "@/server/helpers/mortgage";

// Minimal DB row factories matching schema.$inferSelect shape
function makeLoanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Primary",
    originalLoanAmount: "280000",
    interestRate: "0.065",
    termYears: 30,
    firstPaymentDate: "2022-09-01",
    principalAndInterest: "1770.09",
    refinancedFromId: null,
    isActive: true,
    paidOffDate: null,
    apiBalance: null,
    apiBalanceDate: null,
    pmi: "0",
    insuranceAndTaxes: "0",
    totalEscrow: "0",
    propertyValuePurchase: "350000",
    propertyValueEstimated: null,
    usePurchaseOrEstimated: "purchase",
    ...overrides,
  };
}

function makeExtraPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    loanId: 1,
    paymentDate: null,
    startDate: null,
    endDate: null,
    amount: "500",
    isActual: false,
    notes: null,
    ...overrides,
  };
}

describe("buildMortgageInputs", () => {
  it("converts a single loan row to calculator input", () => {
    const { loanInputs, extras } = buildMortgageInputs(
      [makeLoanRow()] as never,
      [],
    );
    expect(loanInputs).toHaveLength(1);
    expect(extras).toHaveLength(0);

    const loan = loanInputs[0]!;
    expect(loan.id).toBe(1);
    expect(loan.name).toBe("Primary");
    expect(loan.originalBalance).toBe(280000);
    expect(loan.interestRate).toBe(0.065);
    expect(loan.termMonths).toBe(360); // 30 * 12
    expect(loan.startDate).toBeInstanceOf(Date);
    expect(loan.monthlyPI).toBe(1770.09);
    expect(loan.isActive).toBe(true);
    expect(loan.refinancedFromId).toBeUndefined();
    expect(loan.paidOffDate).toBeUndefined();
    expect(loan.apiBalance).toBeUndefined();
    expect(loan.apiBalanceDate).toBeUndefined();
  });

  it("converts refinancedFromId and paidOffDate when present", () => {
    const { loanInputs } = buildMortgageInputs(
      [
        makeLoanRow({
          refinancedFromId: 5,
          paidOffDate: "2024-06-01",
        }),
      ] as never,
      [],
    );
    const loan = loanInputs[0]!;
    expect(loan.refinancedFromId).toBe(5);
    expect(loan.paidOffDate).toBeInstanceOf(Date);
  });

  it("converts apiBalance and apiBalanceDate when present", () => {
    const { loanInputs } = buildMortgageInputs(
      [
        makeLoanRow({
          apiBalance: "245000.50",
          apiBalanceDate: "2025-01-15",
        }),
      ] as never,
      [],
    );
    const loan = loanInputs[0]!;
    expect(loan.apiBalance).toBe(245000.5);
    expect(loan.apiBalanceDate).toBeInstanceOf(Date);
  });

  it("handles one-time extra payment (paymentDate set)", () => {
    const { extras } = buildMortgageInputs(
      [makeLoanRow()] as never,
      [
        makeExtraPaymentRow({
          paymentDate: "2025-03-01",
          amount: "1000",
        }),
      ] as never,
    );
    expect(extras).toHaveLength(1);
    expect(extras[0]!.loanId).toBe(1);
    expect(extras[0]!.date).toBeInstanceOf(Date);
    expect(extras[0]!.amount).toBe(1000);
  });

  it("expands recurring extra payments into monthly entries", () => {
    const { extras } = buildMortgageInputs(
      [makeLoanRow()] as never,
      [
        makeExtraPaymentRow({
          paymentDate: null,
          startDate: "2025-01-15",
          endDate: "2025-03-15",
          amount: "200",
        }),
      ] as never,
    );
    // Jan 15, Feb 15, Mar 15 = 3 months
    expect(extras).toHaveLength(3);
    expect(extras.every((e) => e.amount === 200)).toBe(true);
    expect(extras.every((e) => e.loanId === 1)).toBe(true);
  });

  it("skips extra payment with neither paymentDate nor startDate/endDate", () => {
    const { extras } = buildMortgageInputs(
      [makeLoanRow()] as never,
      [makeExtraPaymentRow()] as never,
    );
    expect(extras).toHaveLength(0);
  });

  it("handles multiple loans", () => {
    const { loanInputs } = buildMortgageInputs(
      [
        makeLoanRow({ id: 1, name: "Primary" }),
        makeLoanRow({
          id: 2,
          name: "Refi",
          originalLoanAmount: "250000",
          interestRate: "0.055",
          refinancedFromId: 1,
          isActive: true,
        }),
      ] as never,
      [],
    );
    expect(loanInputs).toHaveLength(2);
    expect(loanInputs[0]!.originalBalance).toBe(280000);
    expect(loanInputs[1]!.originalBalance).toBe(250000);
    expect(loanInputs[1]!.refinancedFromId).toBe(1);
  });

  it("handles empty inputs", () => {
    const { loanInputs, extras } = buildMortgageInputs([], []);
    expect(loanInputs).toEqual([]);
    expect(extras).toEqual([]);
  });
});

describe("computeMortgageBalance", () => {
  it("returns 0 for no loans", () => {
    const balance = computeMortgageBalance([], [], new Date("2025-03-07"));
    expect(balance).toBe(0);
  });

  it("returns a positive balance for an active loan", () => {
    const balance = computeMortgageBalance(
      [makeLoanRow()] as never,
      [],
      new Date("2025-03-07"),
    );
    expect(balance).toBeGreaterThan(0);
    expect(balance).toBeLessThan(280000);
  });

  it("returns lower balance with extra payments", () => {
    const asOf = new Date("2025-03-07");
    const balanceNoExtras = computeMortgageBalance(
      [makeLoanRow()] as never,
      [],
      asOf,
    );
    const balanceWithExtras = computeMortgageBalance(
      [makeLoanRow()] as never,
      [
        makeExtraPaymentRow({
          paymentDate: "2023-01-01",
          amount: "5000",
        }),
        makeExtraPaymentRow({
          id: 2,
          paymentDate: "2024-01-01",
          amount: "5000",
        }),
      ] as never,
      asOf,
    );
    expect(balanceWithExtras).toBeLessThan(balanceNoExtras);
  });
});
