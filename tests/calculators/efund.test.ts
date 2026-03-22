import { describe, it, expect } from "vitest";
import { calculateEFund } from "@/lib/calculators/efund";
import type { EFundInput } from "@/lib/calculators/types";

describe("calculateEFund", () => {
  const input: EFundInput = {
    emergencyFundBalance: 15000,
    outstandingSelfLoans: 0,
    essentialMonthlyExpenses: 5500,
    targetMonths: 4,
    asOfDate: new Date("2025-03-07"),
  };

  it("computes months covered from raw balance", () => {
    const result = calculateEFund(input);
    // $15,000 / $5,500 = 2.727 months
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
    // Current months = raw balance / expenses = 15000 / 5500
    expect(result.monthsCovered).toBeCloseTo(2.727, 2);
    // Repaid months = with-repay / expenses = 18000 / 5500
    expect(result.monthsCoveredWithRepay).toBeCloseTo(3.273, 2);
    // Needed = 22000 - 18000 = 4000
    expect(result.neededAfterRepay).toBeCloseTo(4000, 0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("self-loans"),
    );
  });

  it("matches spreadsheet Income Replacement Snapshot", () => {
    // Real data: $14,961.07 balance, $559.15 self-loan, $3,896.49/mo tight expenses, 4 mo target
    const real: EFundInput = {
      emergencyFundBalance: 14961.07,
      outstandingSelfLoans: 559.15,
      essentialMonthlyExpenses: 3896.49,
      targetMonths: 4,
      asOfDate: new Date("2026-03-21"),
    };
    const result = calculateEFund(real);
    expect(result.rawBalance).toBe(14961.07);
    // With Repay = 14961.07 + 559.15 = 15520.22
    expect(result.balanceWithRepay).toBeCloseTo(15520.22, 2);
    // Current Months = 14961.07 / 3896.49 = 3.84
    expect(result.monthsCovered).toBeCloseTo(3.84, 1);
    // Repaid Months = 15520.22 / 3896.49 = 3.98
    expect(result.monthsCoveredWithRepay).toBeCloseTo(3.98, 1);
    // Target = 4 * 3896.49 = 15585.96
    expect(result.targetAmount).toBeCloseTo(15585.96, 2);
    // Needed = 15585.96 - 15520.22 = 65.74
    expect(result.neededAfterRepay).toBeCloseTo(65.74, 0);
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
    // Current months uses raw balance
    expect(result.monthsCovered).toBeCloseTo(2.727, 2);
    // With repay = 15000 + 20000 = 35000
    expect(result.balanceWithRepay).toBe(35000);
  });
});
