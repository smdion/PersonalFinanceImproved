import { describe, it, expect } from "vitest";
import {
  routeWithdrawals,
  routeWithdrawalsPercentage,
  routeWithdrawalsBracketFilling,
  routeForMode,
} from "@/lib/calculators/engine/withdrawal-routing";
import {
  makeDecumulationConfig,
  makeAccountBalances,
  TEST_BRACKETS,
} from "./fixtures/engine-fixtures";
import { getAllCategories } from "@/lib/config/account-types";
import type { AccountCategory, AccountBalances } from "@/lib/calculators/types";
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";

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

// ---------------------------------------------------------------------------
// routeForMode — Tier B eligibility gate (v0.7.8, PLAN-v0.7.8-v4 Group 2.2)
// ---------------------------------------------------------------------------

/** Balances with the 401k entirely locked (Rule-of-55/59½ not yet met) and
 *  brokerage fully eligible — the plan's own canonical motivating scenario
 *  (retire early, everything in a locked Traditional 401k). */
function lockedBalances(overrides: Partial<AccountBalances> = {}): {
  balances: AccountBalances;
  eligibility: EligibilityRecord;
} {
  const balances: AccountBalances = {
    "401k": { structure: "roth_traditional", traditional: 100000, roth: 0 },
    "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
    ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
    hsa: { structure: "single_bucket", balance: 0 },
    brokerage: { structure: "basis_tracking", balance: 60000, basis: 30000 },
    ...overrides,
  };
  const eligibility: EligibilityRecord = {
    byKey: new Map(),
    totalLocked: 100000,
    lockedTrad: {
      "401k": 100000,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    },
    lockedRoth: { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 },
    lockedTotal: {
      "401k": 100000,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    },
  };
  return { balances, eligibility };
}

describe("routeForMode (Tier B eligibility gate)", () => {
  it("routes entirely away from a locked 401k to eligible brokerage, even though 401k is first in withdrawalOrder", () => {
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      preferPenaltyFreeSources: true,
    });
    const result = routeForMode(
      20000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBe(0);
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(20000);
  });

  it("falls through to the locked 401k once eligible money (brokerage) runs out — soft model, not a hard block", () => {
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      preferPenaltyFreeSources: true,
    });
    // Need ($90k) exceeds brokerage's full balance ($60k) — the remaining
    // $30k must come from the locked 401k, not go unmet.
    const result = routeForMode(
      90000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    expect(result.warnings.some((w) => w.includes("insufficient"))).toBe(false);
    const total =
      (slotFor(result.slots, "401k")?.withdrawal ?? 0) +
      (slotFor(result.slots, "brokerage")?.withdrawal ?? 0);
    expect(total).toBeCloseTo(90000, -1);
    expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBeGreaterThan(0);
  });

  it("preferPenaltyFreeSources: false routes strictly per withdrawalOrder, ignoring eligibility entirely", () => {
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      preferPenaltyFreeSources: false,
    });
    const result = routeForMode(
      20000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    // Configured order wins: 401k (first in withdrawalOrder) drawn from
    // directly, brokerage untouched — identical to passing no eligibility
    // record at all.
    expect(slotFor(result.slots, "401k")?.withdrawal).toBe(20000);
    expect(slotFor(result.slots, "brokerage")?.withdrawal ?? 0).toBe(0);

    const withoutEligibility = routeForMode(20000, config, balances, {
      taxableSS: 0,
    });
    expect(result.slots).toEqual(withoutEligibility.slots);
  });

  it("is a byte-identical no-op when eligibility.totalLocked is 0", () => {
    const { balances, eligibility } = lockedBalances();
    const noLock: EligibilityRecord = { ...eligibility, totalLocked: 0 };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      preferPenaltyFreeSources: true,
    });
    const withRecord = routeForMode(
      20000,
      config,
      balances,
      { taxableSS: 0 },
      noLock,
    );
    const withoutRecord = routeForMode(20000, config, balances, {
      taxableSS: 0,
    });
    expect(withRecord.slots).toEqual(withoutRecord.slots);
  });

  it("decrements pass-2 config so it can't re-spend pass-1's account cap headroom", () => {
    const { balances, eligibility } = lockedBalances();
    // Cap brokerage (the eligible source) at $10k/year — pass 1 can only
    // draw $10k from it even though its balance is $60k, so the $10k
    // residual correctly falls to the locked 401k, not a re-application of
    // the same $10k cap "resetting" in a naive two-pass implementation.
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["brokerage", "401k", "403b", "ira", "hsa"],
      withdrawalAccountCaps: {
        "401k": null,
        "403b": null,
        ira: null,
        hsa: null,
        brokerage: 10000,
      },
      preferPenaltyFreeSources: true,
    });
    const result = routeForMode(
      20000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(10000);
    expect(slotFor(result.slots, "401k")?.withdrawal).toBe(10000);
  });
});
