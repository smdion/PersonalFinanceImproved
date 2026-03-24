import { describe, it, expect } from "vitest";
import {
  routeWithdrawals,
  routeWithdrawalsPercentage,
  routeWithdrawalsBracketFilling,
} from "@/lib/calculators/engine/withdrawal-routing";
import {
  makeDecumulationConfig,
  makeAccountBalances,
  TEST_BRACKETS,
} from "./fixtures/engine-fixtures";
import { getAllCategories } from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/calculators/types";

function slotFor(
  slots: { category: string; withdrawal: number }[],
  cat: string,
) {
  return slots.find((s) => s.category === cat);
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

describe("routeWithdrawals (waterfall)", () => {
  it("drains accounts in withdrawal order", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    const balances = makeAccountBalances({
      preTax: 100000,
      taxFree: 50000,
      hsa: 20000,
      afterTax: 80000,
      afterTaxBasis: 40000,
    });
    const { slots, warnings } = routeWithdrawals(30000, config, balances);
    // Should draw from 401k first
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.withdrawal).toBeGreaterThan(0);
    expect(warnings).toHaveLength(0);
  });

  it("respects account caps and overflows to next account", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["401k", "ira", "brokerage", "hsa"],
      withdrawalAccountCaps: {
        "401k": 10000,
        "403b": null,
        ira: null,
        hsa: null,
        brokerage: null,
      },
    });
    const balances = makeAccountBalances({ preTax: 200000 });
    const { slots, warnings } = routeWithdrawals(25000, config, balances);
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.withdrawal).toBe(10000);
    expect(s401k.cappedByAccount).toBe(true);
    // Remaining should go to IRA
    const sIra = slotFor(slots, "ira")!;
    expect(sIra.withdrawal).toBe(15000);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("draws traditional first when tax preference is traditional", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["401k"],
      withdrawalTaxPreference: {
        "401k": "traditional",
        "403b": null,
        ira: null,
        hsa: null,
        brokerage: null,
      } as Record<AccountCategory, "traditional" | "roth" | null>,
    });
    const balances = makeAccountBalances({
      preTax: 100000,
      taxFree: 100000,
    });
    const { slots } = routeWithdrawals(30000, config, balances);
    const s = slotFor(slots, "401k")!;
    expect(s.traditionalWithdrawal).toBeGreaterThan(0);
    expect(s.traditionalWithdrawal).toBeGreaterThanOrEqual(s.rothWithdrawal);
  });

  it("draws roth first when tax preference is roth", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["401k"],
      withdrawalTaxPreference: {
        "401k": "roth",
        "403b": null,
        ira: null,
        hsa: null,
        brokerage: null,
      } as Record<AccountCategory, "traditional" | "roth" | null>,
    });
    const balances = makeAccountBalances({
      preTax: 100000,
      taxFree: 100000,
    });
    const { slots } = routeWithdrawals(30000, config, balances);
    const s = slotFor(slots, "401k")!;
    expect(s.rothWithdrawal).toBeGreaterThan(0);
    expect(s.rothWithdrawal).toBeGreaterThanOrEqual(s.traditionalWithdrawal);
  });

  it("applies cross-account traditional withdrawal cap", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["401k", "ira", "brokerage", "hsa"],
      withdrawalTaxTypeCaps: { traditional: 20000, roth: null },
    });
    const balances = makeAccountBalances({
      preTax: 300000,
      taxFree: 200000,
    });
    const { slots } = routeWithdrawals(60000, config, balances);
    const totalTrad = slots.reduce((s, sl) => s + sl.traditionalWithdrawal, 0);
    expect(totalTrad).toBeLessThanOrEqual(20000);
  });

  it("warns when withdrawal need is unmet", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["401k"],
    });
    const balances = makeAccountBalances({
      preTax: 5000,
      taxFree: 5000,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    });
    const { warnings } = routeWithdrawals(100000, config, balances);
    expect(warnings.some((w) => w.includes("unmet"))).toBe(true);
  });

  it("handles zero withdrawal target", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances();
    const { slots } = routeWithdrawals(0, config, balances);
    expect(slots.every((s) => s.withdrawal === 0)).toBe(true);
  });

  it("handles HSA as single_bucket (pre-tax for tax purposes)", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["hsa"],
    });
    const balances = makeAccountBalances({ hsa: 10000 });
    const { slots } = routeWithdrawals(5000, config, balances);
    const sHsa = slotFor(slots, "hsa")!;
    expect(sHsa.withdrawal).toBe(5000);
    expect(sHsa.traditionalWithdrawal).toBe(5000); // HSA is "traditional" for tax
    expect(sHsa.rothWithdrawal).toBe(0);
  });

  it("handles brokerage as overflow target (neither roth nor traditional)", () => {
    const config = makeDecumulationConfig({
      withdrawalOrder: ["brokerage"],
    });
    const balances = makeAccountBalances({ afterTax: 50000 });
    const { slots } = routeWithdrawals(10000, config, balances);
    const sBrok = slotFor(slots, "brokerage")!;
    expect(sBrok.withdrawal).toBe(10000);
    expect(sBrok.traditionalWithdrawal).toBe(0);
    expect(sBrok.rothWithdrawal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Percentage
// ---------------------------------------------------------------------------

describe("routeWithdrawalsPercentage", () => {
  it("splits withdrawal by configured percentages", () => {
    const config = makeDecumulationConfig({
      withdrawalSplits: {
        "401k": 0.4,
        "403b": 0,
        hsa: 0.1,
        ira: 0.2,
        brokerage: 0.3,
      },
    });
    const balances = makeAccountBalances({
      preTax: 500000,
      taxFree: 200000,
      hsa: 50000,
      afterTax: 300000,
      afterTaxBasis: 100000,
    });
    const { slots } = routeWithdrawalsPercentage(100000, config, balances);
    // 401k should get ~40% of 100000
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.withdrawal).toBeCloseTo(40000, -2);
    const sBrok = slotFor(slots, "brokerage")!;
    expect(sBrok.withdrawal).toBeCloseTo(30000, -2);
  });

  it("redistributes excess from empty accounts", () => {
    const config = makeDecumulationConfig({
      withdrawalSplits: {
        "401k": 0.5,
        "403b": 0,
        hsa: 0.5,
        ira: 0,
        brokerage: 0,
      },
    });
    const balances = makeAccountBalances({
      preTax: 500000,
      taxFree: 200000,
      hsa: 5000,
      afterTax: 0,
      afterTaxBasis: 0,
    });
    const { slots } = routeWithdrawalsPercentage(100000, config, balances);
    const sHsa = slotFor(slots, "hsa")!;
    // HSA only has 5000, so it can't provide 50000
    expect(sHsa.withdrawal).toBeLessThanOrEqual(5000);
    // Total withdrawn should still be close to 100000 (redistributed to 401k)
    const totalWithdrawn = slots.reduce((s, sl) => s + sl.withdrawal, 0);
    expect(totalWithdrawn).toBeCloseTo(100000, -2);
  });

  it("warns when insufficient funds across all accounts", () => {
    const config = makeDecumulationConfig({
      withdrawalSplits: {
        "401k": 1.0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
    });
    const balances = makeAccountBalances({
      preTax: 1000,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    });
    const { warnings } = routeWithdrawalsPercentage(100000, config, balances);
    expect(warnings.some((w) => w.includes("unmet"))).toBe(true);
  });

  it("returns slots for all categories", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances();
    const { slots } = routeWithdrawalsPercentage(50000, config, balances);
    for (const cat of getAllCategories()) {
      expect(slotFor(slots, cat)).toBeDefined();
    }
  });

  it("respects account caps in percentage mode", () => {
    const config = makeDecumulationConfig({
      withdrawalSplits: {
        "401k": 1.0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      withdrawalAccountCaps: {
        "401k": 5000,
        "403b": null,
        ira: null,
        hsa: null,
        brokerage: null,
      },
    });
    const balances = makeAccountBalances({ preTax: 500000 });
    const { slots } = routeWithdrawalsPercentage(50000, config, balances);
    const s401k = slotFor(slots, "401k")!;
    expect(s401k.withdrawal).toBeLessThanOrEqual(5000);
  });
});

// ---------------------------------------------------------------------------
// Bracket Filling
// ---------------------------------------------------------------------------

describe("routeWithdrawalsBracketFilling", () => {
  it("falls back to waterfall when no brackets provided", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances();
    const result = routeWithdrawalsBracketFilling(50000, config, balances, {
      taxBrackets: undefined,
      rothBracketTarget: 0.12,
      taxableSS: 0,
    });
    // Should produce valid slots (waterfall fallback)
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.traditionalCap).toBeUndefined();
  });

  it("falls back to waterfall when no rothBracketTarget", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances();
    const result = routeWithdrawalsBracketFilling(50000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: undefined,
      taxableSS: 0,
    });
    expect(result.traditionalCap).toBeUndefined();
  });

  it("caps traditional withdrawals at bracket target", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 500000,
      taxFree: 300000,
      afterTax: 200000,
      afterTaxBasis: 100000,
    });
    const result = routeWithdrawalsBracketFilling(100000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12,
      taxableSS: 5000,
    });
    expect(result.traditionalCap).toBeDefined();
    // Traditional cap should be bracket threshold minus taxable SS
    const totalTrad = result.slots.reduce(
      (s, sl) => s + sl.traditionalWithdrawal,
      0,
    );
    expect(totalTrad).toBeLessThanOrEqual(result.traditionalCap! + 1); // +1 for rounding
  });

  it("fills Roth after traditional cap is reached", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 500000,
      taxFree: 300000,
    });
    const result = routeWithdrawalsBracketFilling(200000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12,
      taxableSS: 0,
    });
    const totalRoth = result.slots.reduce((s, sl) => s + sl.rothWithdrawal, 0);
    expect(totalRoth).toBeGreaterThan(0);
  });

  it("uses brokerage as phase 3 overflow", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 10000,
      taxFree: 10000,
      afterTax: 200000,
      afterTaxBasis: 100000,
    });
    const result = routeWithdrawalsBracketFilling(100000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12,
      taxableSS: 0,
    });
    const sBrok = slotFor(result.slots, "brokerage")!;
    expect(sBrok.withdrawal).toBeGreaterThan(0);
  });

  it("uses HSA as last resort (phase 4)", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 5000,
      taxFree: 5000,
      hsa: 50000,
      afterTax: 5000,
      afterTaxBasis: 2500,
    });
    const result = routeWithdrawalsBracketFilling(60000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12,
      taxableSS: 0,
    });
    const sHsa = slotFor(result.slots, "hsa")!;
    expect(sHsa.withdrawal).toBeGreaterThan(0);
  });

  it("includes slots for all categories", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances();
    const result = routeWithdrawalsBracketFilling(50000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.22,
      taxableSS: 0,
    });
    for (const cat of getAllCategories()) {
      expect(slotFor(result.slots, cat)).toBeDefined();
    }
  });

  it("adjusts traditional cap for taxable SS", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({ preTax: 500000 });
    const noSS = routeWithdrawalsBracketFilling(50000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.22,
      taxableSS: 0,
    });
    const withSS = routeWithdrawalsBracketFilling(50000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.22,
      taxableSS: 20000,
    });
    // More SS means less traditional cap room
    expect(withSS.traditionalCap!).toBeLessThan(noSS.traditionalCap!);
  });

  it("warns when need is unmet", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 1000,
      taxFree: 1000,
      hsa: 1000,
      afterTax: 1000,
      afterTaxBasis: 500,
    });
    const result = routeWithdrawalsBracketFilling(100000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12,
      taxableSS: 0,
    });
    expect(result.unmetNeed).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("unmet"))).toBe(true);
  });

  it("merges traditional and roth slots for the same category", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 50000,
      taxFree: 50000,
    });
    const result = routeWithdrawalsBracketFilling(80000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.1,
      taxableSS: 0,
    });
    // 401k should have both trad and roth in same slot (merged)
    const s401k = slotFor(result.slots, "401k")!;
    if (s401k.traditionalWithdrawal > 0 && s401k.rothWithdrawal > 0) {
      expect(s401k.withdrawal).toBe(
        s401k.traditionalWithdrawal + s401k.rothWithdrawal,
      );
    }
  });
});
