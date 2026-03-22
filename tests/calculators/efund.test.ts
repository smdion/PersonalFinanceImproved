import { describe, it, expect } from "vitest";
import { calculateEFund } from "@/lib/calculators/efund";
import type { EFundInput } from "@/lib/calculators/types";

describe("calculateEFund", () => {
  const input: EFundInput = {
    emergencyFundBalance: 15000,
    outstandingSelfLoans: 0,
    pendingReimbursements: 0,
    essentialMonthlyExpenses: 5500,
    targetMonths: 4,
    asOfDate: new Date("2025-03-07"),
  };

  it("computes months covered from true balance", () => {
    const result = calculateEFund(input);
    // $15,000 / $5,500 = 2.727 months (no deductions)
    expect(result.monthsCovered).toBeCloseTo(2.727, 2);
    expect(result.rawBalance).toBe(15000);
  });

  it("computes target amount in dollars", () => {
    const result = calculateEFund(input);
    // 4 months × $5,500 = $22,000
    expect(result.targetAmount).toBe(22000);
  });

  it("computes progress toward target (with repay view)", () => {
    const result = calculateEFund(input);
    // No loans, so monthsCoveredWithRepay = monthsCovered = 2.727
    // 2.727 / 4 = 0.682
    expect(result.progress).toBeCloseTo(0.682, 2);
  });

  it("tracks self-loans and computes with-repay balance", () => {
    const withLoans: EFundInput = { ...input, outstandingSelfLoans: 3000 };
    const result = calculateEFund(withLoans);
    expect(result.rawBalance).toBe(15000);
    expect(result.trueBalance).toBe(12000);
    expect(result.outstandingSelfLoans).toBe(3000);
    expect(result.balanceWithRepay).toBe(18000); // 15000 + 3000
    // Current months = true balance / expenses = 12000 / 5500
    expect(result.monthsCovered).toBeCloseTo(2.182, 2);
    // Repaid months = with-repay / expenses = 18000 / 5500
    expect(result.monthsCoveredWithRepay).toBeCloseTo(3.273, 2);
    // Needed = 22000 - 18000 = 4000
    expect(result.neededAfterRepay).toBeCloseTo(4000, 0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("self-loans"),
    );
  });

  it("subtracts pending reimbursements from true balance and months", () => {
    const withReimb: EFundInput = { ...input, pendingReimbursements: 500 };
    const result = calculateEFund(withReimb);
    expect(result.rawBalance).toBe(15000);
    expect(result.trueBalance).toBe(14500); // 15000 - 500
    // Months from true balance: 14500 / 5500 = 2.636
    expect(result.monthsCovered).toBeCloseTo(2.636, 2);
    // With repay still subtracts reimbursements: 15000 + 0 - 500 = 14500
    expect(result.balanceWithRepay).toBe(14500);
    // Needed = 22000 - 14500 = 7500
    expect(result.neededAfterRepay).toBeCloseTo(7500, 0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("reimbursements"),
    );
  });

  it("combines self-loans and reimbursements", () => {
    const combined: EFundInput = {
      ...input,
      outstandingSelfLoans: 2000,
      pendingReimbursements: 500,
    };
    const result = calculateEFund(combined);
    expect(result.trueBalance).toBe(12500); // 15000 - 2000 - 500
    // With repay = 15000 + 2000 - 500 = 16500
    expect(result.balanceWithRepay).toBe(16500);
    expect(result.monthsCovered).toBeCloseTo(12500 / 5500, 2);
  });

  it("caps progress at 100%", () => {
    const overTarget: EFundInput = { ...input, emergencyFundBalance: 50000 };
    const result = calculateEFund(overTarget);
    // 50000/5500 = 9.09 months, but progress capped at 1.0
    expect(result.progress).toBe(1);
    expect(result.monthsCovered).toBeGreaterThan(4);
    expect(result.neededAfterRepay).toBeLessThan(0); // ahead of target
  });

  it("returns null months when no essential expenses", () => {
    const noExpenses: EFundInput = { ...input, essentialMonthlyExpenses: 0 };
    const result = calculateEFund(noExpenses);
    expect(result.monthsCovered).toBeNull();
    expect(result.monthsCoveredWithRepay).toBeNull();
    expect(result.progress).toBe(0);
    expect(result.targetAmount).toBe(0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("No essential expenses"),
    );
  });

  it("handles zero balance", () => {
    const zeroBal: EFundInput = { ...input, emergencyFundBalance: 0 };
    const result = calculateEFund(zeroBal);
    expect(result.trueBalance).toBe(0);
    expect(result.rawBalance).toBe(0);
    expect(result.monthsCovered).toBe(0);
    expect(result.progress).toBe(0);
    expect(result.neededAfterRepay).toBe(22000);
  });

  it("clamps true balance to zero when loans exceed balance", () => {
    const overLoaned: EFundInput = { ...input, outstandingSelfLoans: 20000 };
    const result = calculateEFund(overLoaned);
    expect(result.trueBalance).toBe(0);
    expect(result.rawBalance).toBe(15000);
    // Current months uses true balance (clamped to 0)
    expect(result.monthsCovered).toBe(0);
    // With repay = 15000 + 20000 = 35000
    expect(result.balanceWithRepay).toBe(35000);
  });
});
