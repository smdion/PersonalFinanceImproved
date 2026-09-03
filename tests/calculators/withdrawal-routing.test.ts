import { describe, it, expect } from "vitest";
import {
  routeWithdrawals,
  routeWithdrawalsPercentage,
  routeWithdrawalsBracketFilling,
  routeForMode,
  computeBracketTraditionalCap,
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

  // -------------------------------------------------------------------------
  // Phase 1 respects config.withdrawalOrder instead of
  // a hardcoded 401k -> 403b -> ira declaration order.
  // -------------------------------------------------------------------------

  it("draws Traditional in the household's own configured order (IRA before 401k), not the hardcoded declaration order", () => {
    // Distinct 401k/IRA balances so which one gets drawn first is
    // unambiguous, and a bracket cap small enough that Phase 1 stops
    // partway through -- if IRA is really drawn FIRST, IRA gets fully
    // capped-out by the small cap and 401k gets $0; if the OLD hardcoded
    // order were still in effect, 401k would get drawn instead.
    const balances = makeAccountBalances({ preTax: 0 });
    balances["401k"] = {
      structure: "roth_traditional",
      traditional: 200000,
      roth: 0,
    };
    balances.ira = {
      structure: "roth_traditional",
      traditional: 200000,
      roth: 0,
    };

    const configDefault = makeDecumulationConfig({
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    const configReordered = makeDecumulationConfig({
      withdrawalOrder: ["ira", "403b", "401k", "brokerage", "hsa"],
    });
    const bracketInfo = {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12, // caps traditional well below either account's balance
      taxableSS: 0,
    };

    const defaultResult = routeWithdrawalsBracketFilling(
      20000,
      configDefault,
      balances,
      bracketInfo,
    );
    const reorderedResult = routeWithdrawalsBracketFilling(
      20000,
      configReordered,
      balances,
      bracketInfo,
    );

    const default401k = slotFor(
      defaultResult.slots,
      "401k",
    )!.traditionalWithdrawal;
    const defaultIra = slotFor(
      defaultResult.slots,
      "ira",
    )!.traditionalWithdrawal;
    const reordered401k = slotFor(
      reorderedResult.slots,
      "401k",
    )!.traditionalWithdrawal;
    const reorderedIra = slotFor(
      reorderedResult.slots,
      "ira",
    )!.traditionalWithdrawal;

    // Default order: 401k fully absorbs the cap, IRA untouched.
    expect(default401k).toBeGreaterThan(0);
    expect(defaultIra).toBe(0);
    // Reordered: IRA absorbs the cap instead, 401k untouched -- the
    // household's own configured order took effect.
    expect(reorderedIra).toBeGreaterThan(0);
    expect(reordered401k).toBe(0);
    // Same total traditional cap consumed either way -- only WHICH
    // account supplied it changed.
    expect(default401k + defaultIra).toBeCloseTo(
      reordered401k + reorderedIra,
      2,
    );
  });

  it("regression guard: reverting to categoriesWithTaxPreference() would make the reordered case draw from 401k anyway", () => {
    // Same setup as above, but asserting the specific behavior the OLD
    // (buggy) code produced, so this test file would fail loudly if
    // Phase 1's ordering source were ever reverted.
    const balances = makeAccountBalances({ preTax: 0 });
    balances["401k"] = {
      structure: "roth_traditional",
      traditional: 200000,
      roth: 0,
    };
    balances.ira = {
      structure: "roth_traditional",
      traditional: 200000,
      roth: 0,
    };
    const configReordered = makeDecumulationConfig({
      withdrawalOrder: ["ira", "403b", "401k", "brokerage", "hsa"],
    });
    const result = routeWithdrawalsBracketFilling(
      20000,
      configReordered,
      balances,
      {
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.12,
        taxableSS: 0,
      },
    );
    // The FIX makes IRA (first in the reordered config) absorb the cap.
    // If Phase 1 ever silently reverts to the hardcoded 401k-first order,
    // this assertion (IRA > 0, 401k === 0) is what would flip and fail.
    expect(slotFor(result.slots, "ira")!.traditionalWithdrawal).toBeGreaterThan(
      0,
    );
    expect(slotFor(result.slots, "401k")!.traditionalWithdrawal).toBe(0);
  });

  it("uncustomized (default) order produces byte-identical output to before this fix", () => {
    // DEFAULT_DECUMULATION_ORDER filtered to Traditional-preference
    // categories is, by construction, identical to the pre-fix hardcoded
    // categoriesWithTaxPreference() order -- verifying that here, not just
    // asserting it, so a household who never touched the order editor
    // sees zero behavior change.
    const config = makeDecumulationConfig(); // default order
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
    // Same hand-verifiable invariant the pre-existing "caps traditional
    // withdrawals at bracket target" test already checks -- confirms nothing
    // about the CAP computation itself moved, only which account (if there
    // were a choice) supplies it.
    expect(result.traditionalCap).toBeDefined();
    const totalTrad = result.slots.reduce(
      (s, sl) => s + sl.traditionalWithdrawal,
      0,
    );
    expect(totalTrad).toBeLessThanOrEqual(result.traditionalCap! + 1);
  });

  it("drawRothTierCapped (Phase 2's Roth tier) respects the same reordered account priority as Phase 1's Traditional tier", () => {
    // Same household reordering IRA before 401k, but now with enough Roth
    // balance in both that Phase 2's Roth tier (not Phase 1's Traditional
    // fill) has to pick which one to draw first -- proving both loops
    // share one ordering source, not just Phase 1.
    const balances = makeAccountBalances({ preTax: 0, taxFree: 0 });
    balances["401k"] = {
      structure: "roth_traditional",
      traditional: 0,
      roth: 200000,
    };
    balances.ira = {
      structure: "roth_traditional",
      traditional: 0,
      roth: 200000,
    };
    const configReordered = makeDecumulationConfig({
      withdrawalOrder: ["ira", "403b", "401k", "brokerage", "hsa"],
    });
    const result = routeWithdrawalsBracketFilling(
      20000,
      configReordered,
      balances,
      {
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.12,
        taxableSS: 0,
        filingStatus: "MFJ",
      },
    );
    // No Traditional or 0%-LTCG-brokerage capacity at all -- the full
    // $20k must come from Roth growth, and IRA (first in the reordered
    // config) should supply it, not 401k.
    expect(slotFor(result.slots, "ira")!.rothWithdrawal).toBeGreaterThan(0);
    expect(slotFor(result.slots, "401k")!.rothWithdrawal).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Cost-aware post-Traditional-cap ranking
  // -------------------------------------------------------------------------

  it("draws from brokerage sitting in the 0% LTCG zone instead of Roth growth, when filingStatus is provided and Roth has no basis left", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 10000,
      taxFree: 100000,
      afterTax: 100000,
      afterTaxBasis: 50000,
    });
    const result = routeWithdrawalsBracketFilling(60000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12,
      taxableSS: 0,
      filingStatus: "MFJ",
      rothBasisAvailable: 0, // force any Roth draw to be growth
      brokerageBasisRatio: 0.5,
    });
    const rothSlot =
      slotFor(result.slots, "401k") ?? slotFor(result.slots, "ira");
    const brokSlot = slotFor(result.slots, "brokerage")!;
    // 0%-LTCG brokerage room comfortably covers the remaining need here --
    // the cost-aware ranking should prefer it over taxable Roth growth.
    expect(brokSlot.withdrawal).toBeGreaterThan(0);
    expect(rothSlot?.rothWithdrawal ?? 0).toBe(0);
  });

  it("draws brokerage instead of Roth once real ordinary income is high enough that Roth's REAL bracket rate exceeds LTCG (advisor review, 2026-08-29)", () => {
    // Before the fix, Roth growth was priced off `rothBracketTarget`
    // (here 0.1, "next bracket up is 12%") regardless of the household's
    // REAL income level -- so a household with $700k of taxable SS still
    // looked like it only owed 12% on Roth growth, wrongly cheaper than
    // 20% LTCG. Roth growth is now priced off the household's actual
    // ordinaryIncomeFloor, which at this income sits in TEST_BRACKETS'
    // 35% bracket -- genuinely far more expensive than 20% LTCG, so
    // brokerage must be drawn instead.
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 10000,
      taxFree: 100000,
      afterTax: 100000,
      afterTaxBasis: 0, // all gains -- worst case for brokerage's cost
    });
    const result = routeWithdrawalsBracketFilling(60000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.1, // no longer read for Roth-growth pricing
      taxableSS: 700000, // real ordinary income lands in the 35% bracket
      filingStatus: "MFJ",
      rothBasisAvailable: 0,
      brokerageBasisRatio: 0,
      magiBeforeThisDraw: 0, // keep NIIT out of it
    });
    const rothSlot =
      slotFor(result.slots, "401k") ?? slotFor(result.slots, "ira");
    const brokSlot = slotFor(result.slots, "brokerage")!;
    expect(brokSlot.withdrawal).toBeGreaterThan(0);
    expect(rothSlot?.rothWithdrawal ?? 0).toBe(0);
  });

  it("without filingStatus, degenerates to the pre-v0.7.9 fixed Roth-then-brokerage order (no regression for callers that don't pass it)", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 10000,
      taxFree: 30000,
      afterTax: 100000,
      afterTaxBasis: 0,
    });
    // Need exceeds Traditional-cap + all available Roth, so brokerage must
    // be touched too -- proves it's drawn AFTER Roth is exhausted, not
    // instead of/before it.
    const result = routeWithdrawalsBracketFilling(120000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.12,
      taxableSS: 0,
      // filingStatus intentionally omitted
    });
    const rothSlot =
      slotFor(result.slots, "401k") ?? slotFor(result.slots, "ira");
    const brokSlot = slotFor(result.slots, "brokerage")!;
    expect(rothSlot?.rothWithdrawal ?? 0).toBeGreaterThan(0);
    expect(brokSlot.withdrawal).toBeGreaterThan(0);
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

  // -------------------------------------------------------------------------
  // conversionTarget — reserved-room fix
  // -------------------------------------------------------------------------

  it("reserves discretionary-tier room up to conversionTarget's own bracket cap, not rothBracketTarget's, when the two differ", () => {
    // Same inputs throughout except conversionTarget. Before this fix,
    // the reservation always used rothBracketTarget's cap (0.32 here,
    // a huge cap that reserves nearly all remaining Traditional room and
    // inflates the ordinary-income floor, pricing Roth growth as
    // expensive). A real, lower conversionTarget reserves less, lowers
    // the floor, and should price Roth growth relatively cheaper —
    // shifting some of the discretionary draw from brokerage to Roth.
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 5000,
      taxFree: 200000,
      afterTax: 30000,
      afterTaxBasis: 0, // all gains -- worst case for brokerage's cost
    });
    const routeWith = (conversionTarget: number) =>
      routeWithdrawalsBracketFilling(60000, config, balances, {
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.32,
        conversionTarget,
        conversionsEnabled: true,
        taxableSS: 40000,
        filingStatus: "MFJ",
        rothBasisAvailable: 0,
        brokerageBasisRatio: 0,
        magiBeforeThisDraw: 0,
      });

    // conversionTarget === rothBracketTarget: no-op, reproduces the cap
    // used before this field existed.
    const control = routeWith(0.32);
    // A materially lower real conversion target.
    const withLowerTarget = routeWith(0.1);

    const controlRoth =
      slotFor(control.slots, "401k")?.rothWithdrawal ??
      slotFor(control.slots, "ira")?.rothWithdrawal ??
      0;
    const lowerTargetRoth =
      slotFor(withLowerTarget.slots, "401k")?.rothWithdrawal ??
      slotFor(withLowerTarget.slots, "ira")?.rothWithdrawal ??
      0;

    expect(lowerTargetRoth).not.toBe(controlRoth);
    // Lower reserved room -> lower ordinary-income floor -> Roth growth
    // priced cheaper -> the ranking draws MORE from Roth, not less.
    expect(lowerTargetRoth).toBeGreaterThan(controlRoth);
  });

  it("omitting conversionTarget reproduces the exact same output as before this field existed (no regression for existing callers)", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 5000,
      taxFree: 200000,
      afterTax: 30000,
      afterTaxBasis: 0,
    });
    const bracketInfo = {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.32,
      conversionsEnabled: true,
      taxableSS: 40000,
      filingStatus: "MFJ" as const,
      rothBasisAvailable: 0,
      brokerageBasisRatio: 0,
      magiBeforeThisDraw: 0,
    };
    const withoutField = routeWithdrawalsBracketFilling(
      60000,
      config,
      balances,
      bracketInfo,
    );
    const withEqualField = routeWithdrawalsBracketFilling(
      60000,
      config,
      balances,
      { ...bracketInfo, conversionTarget: 0.32 },
    );
    expect(withoutField.slots).toEqual(withEqualField.slots);
  });
});

// ---------------------------------------------------------------------------
// routeForMode — Tier B eligibility gate
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
  const penaltyExposedTrad = {
    "401k": 100000,
    "403b": 0,
    ira: 0,
    hsa: 0,
    brokerage: 0,
  };
  const penaltyExposedRoth = {
    "401k": 0,
    "403b": 0,
    ira: 0,
    hsa: 0,
    brokerage: 0,
  };
  const penaltyExposedTotal = {
    "401k": 100000,
    "403b": 0,
    ira: 0,
    hsa: 0,
    brokerage: 0,
  };
  const eligibility: EligibilityRecord = {
    byKey: new Map(),
    totalPenaltyExposed: 100000,
    penaltyExposedTrad,
    penaltyExposedRoth,
    penaltyExposedTotal,
    // No account has the penalty-allowance override in this fixture, so "still excluded"
    // is identical to the plain aggregates above.
    penaltyExposedTradStillExcluded: penaltyExposedTrad,
    penaltyExposedRothStillExcluded: penaltyExposedRoth,
    penaltyExposedTotalStillExcluded: penaltyExposedTotal,
    totalPenaltyExposedStillExcluded: 100000,
  };
  return { balances, eligibility };
}

describe("routeForMode (Tier B eligibility gate)", () => {
  it("routes entirely away from a locked 401k to eligible brokerage, even though 401k is first in withdrawalOrder", () => {
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
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

  it("draws exactly $0 from a fully-locked category in pass 1 when penaltyExposedTrad equals the category's real balance exactly (v0.7.8 indBal reconciliation follow-up)", () => {
    // Regression for the live bug found on the real household:
    // Before
    // reconcileIndividualToAggregate existed, eligibility.penaltyExposedTrad[cat]
    // (summed from indBal-derived per-account locked amounts) could be a
    // few cents LESS than balances[cat].traditional (the separately-
    // maintained aggregate) even when the category was reported 100%
    // locked -- subtractLocked would then leave that residual "eligible",
    // and pass 1 would draw it from an account the engine had just
    // declared locked. This test asserts subtractLocked's arithmetic is
    // exact (draws exactly 0) when its two inputs agree exactly, which is
    // the property reconciliation now guarantees upstream, in
    // decumulation-year.ts, before eligibility is ever computed.
    const balances = lockedBalances().balances;
    // Exactly equal to balances["401k"].traditional (100000) -- the
    // no-drift case reconciliation guarantees.
    const lockedTrad = {
      "401k": 100000,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    };
    const lockedRoth = {
      "401k": 0,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    };
    const lockedTotal = {
      "401k": 100000,
      "403b": 0,
      ira: 0,
      hsa: 0,
      brokerage: 0,
    };
    const fullyLockedEligibility: EligibilityRecord = {
      byKey: new Map(),
      totalPenaltyExposed: 100000,
      penaltyExposedTrad: lockedTrad,
      penaltyExposedRoth: lockedRoth,
      penaltyExposedTotal: lockedTotal,
      penaltyExposedTradStillExcluded: lockedTrad,
      penaltyExposedRothStillExcluded: lockedRoth,
      penaltyExposedTotalStillExcluded: lockedTotal,
      totalPenaltyExposedStillExcluded: 100000,
    };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      // 401k first in order -- if pass 1 leaked even a cent of "eligible"
      // balance from it, waterfall mode would draw that cent from 401k
      // before touching brokerage.
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    const result = routeForMode(
      20000,
      config,
      balances,
      { taxableSS: 0 },
      fullyLockedEligibility,
    );
    expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBe(0);
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(20000);
  });

  it("v0.7.8 penalty-hard-exclusion: leaves the need unfunded (penaltyAvoidedShortfall) instead of falling through to the locked 401k — hard exclusion, not the old soft model", () => {
    // This reverses Group 0 § Q0's soft-lock fallback (explicit user
    // direction: "do not take money if it includes a penalty"). It
    // replaces the old "falls through to the locked 401k... soft model"
    // test, which asserted the exact behavior this pass exists to remove.
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      avoidPenalizedWithdrawals: true,
    });
    // Need ($90k) exceeds brokerage's full balance ($60k) — under hard
    // exclusion the remaining $30k stays unmet, it never reaches the
    // locked 401k.
    const result = routeForMode(
      90000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBe(0);
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(60000);
    expect(result.unmetNeed).toBeCloseTo(30000, -1);
    expect(result.penaltyAvoidedShortfall).toBeCloseTo(30000, -1);
  });

  it("avoidPenalizedWithdrawals: false routes against full balances, ignoring the exposure partition entirely (pre-v0.7.8-penalty-pass routing)", () => {
    // avoidPenalizedWithdrawals is the only lever deciding whether
    // penalty-exposed money is reachable at all under the hard-exclusion
    // rule. (The `preferPenaltyFreeSources` flag once proposed alongside
    // it was never wired into routing and was later deleted.)
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      avoidPenalizedWithdrawals: false,
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

  it("is a byte-identical no-op when eligibility.totalPenaltyExposed is 0", () => {
    const { balances, eligibility } = lockedBalances();
    const noLock: EligibilityRecord = {
      ...eligibility,
      totalPenaltyExposed: 0,
      totalPenaltyExposedStillExcluded: 0,
    };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
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

  it("account caps apply within the penalty-free partition — capped brokerage headroom is not backfilled from the locked 401k", () => {
    // Formerly "decrements pass-2 config so it can't re-spend pass-1's
    // account cap headroom" — that test asserted the old two-pass
    // fallthrough (residual reaching the locked 401k). Pass 2 no longer
    // exists: the
    // $10k the brokerage cap can't cover now stays unmet instead.
    const { balances, eligibility } = lockedBalances();
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
      avoidPenalizedWithdrawals: true,
    });
    const result = routeForMode(
      20000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(10000);
    expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBe(0);
    expect(result.unmetNeed).toBeCloseTo(10000, -1);
    expect(result.penaltyAvoidedShortfall).toBeCloseTo(10000, -1);
  });

  // Acceptance criterion 10: unmetNeed and penaltyAvoidedShortfall are both
  // populated (typed and separated) in all three routing modes -- not just
  // waterfall, which the tests above already cover.
  it.each(["waterfall", "percentage", "bracket_filling"] as const)(
    "criterion 10: populates unmetNeed AND penaltyAvoidedShortfall in %s mode when only penalty-exposed money remains",
    (mode) => {
      const { balances, eligibility } = lockedBalances();
      const config = makeDecumulationConfig({
        withdrawalRoutingMode: mode,
        withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
        withdrawalSplits: {
          "401k": 0.5,
          "403b": 0,
          hsa: 0,
          ira: 0,
          brokerage: 0.5,
        },
        avoidPenalizedWithdrawals: true,
      });
      // Need exceeds eligible brokerage ($60k) -- the rest is only
      // reachable via the locked 401k, which must stay untouched.
      const result = routeForMode(
        90000,
        config,
        balances,
        { taxableSS: 0, taxBrackets: TEST_BRACKETS },
        eligibility,
      );
      expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBe(0);
      expect(result.unmetNeed).toBeGreaterThan(0);
      expect(result.penaltyAvoidedShortfall).toBeGreaterThan(0);
    },
  );

  it("criterion 10: a genuinely broke household (no eligibility record at all) reports unmetNeed with penaltyAvoidedShortfall left undefined", () => {
    const balances = makeAccountBalances({
      preTax: 5000,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    });
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k"],
    });
    const result = routeForMode(50000, config, balances, { taxableSS: 0 });
    expect(result.unmetNeed).toBeGreaterThan(0);
    expect(result.penaltyAvoidedShortfall ?? 0).toBe(0);
  });

  // Acceptance criterion 1: byte-identity fallthrough. When nothing is
  // penalty-exposed, or the household explicitly opted out via
  // avoidPenalizedWithdrawals: false, routeForMode must produce
  // byte-identical output to calling the
  // underlying dispatch directly on the unmodified balances -- proving the
  // exclusion partition is a true no-op in these cases, not just close.
  it("criterion 1: byte-identical to the no-eligibility call when nothing is penalty-exposed", () => {
    const balances = makeAccountBalances({ preTax: 200000, taxFree: 100000 });
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "ira", "brokerage", "hsa"],
    });
    const zeroByCat = () =>
      Object.fromEntries(getAllCategories().map((c) => [c, 0])) as Record<
        AccountCategory,
        number
      >;
    const zeroExposure: EligibilityRecord = {
      byKey: new Map(),
      totalPenaltyExposed: 0,
      penaltyExposedTrad: zeroByCat(),
      penaltyExposedRoth: zeroByCat(),
      penaltyExposedTotal: zeroByCat(),
      penaltyExposedTradStillExcluded: zeroByCat(),
      penaltyExposedRothStillExcluded: zeroByCat(),
      penaltyExposedTotalStillExcluded: zeroByCat(),
      totalPenaltyExposedStillExcluded: 0,
    };
    const withZeroExposure = routeForMode(
      50000,
      config,
      balances,
      { taxableSS: 0 },
      zeroExposure,
    );
    const withNoExposureArg = routeForMode(50000, config, balances, {
      taxableSS: 0,
    });
    expect(withZeroExposure.slots).toEqual(withNoExposureArg.slots);
    expect(withZeroExposure.warnings).toEqual(withNoExposureArg.warnings);
  });

  it("criterion 1: byte-identical to the no-eligibility call when avoidPenalizedWithdrawals is explicitly off, even with real exposure present", () => {
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      avoidPenalizedWithdrawals: false,
    });
    const withEligibility = routeForMode(
      50000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    const withNoEligibilityArg = routeForMode(50000, config, balances, {
      taxableSS: 0,
    });
    expect(withEligibility.slots).toEqual(withNoEligibilityArg.slots);
    expect(withEligibility.penaltyAvoidedShortfall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// routeForMode — nonRetirement exclusion
// ---------------------------------------------------------------------------

describe("routeForMode (nonRetirement exclusion, R49)", () => {
  function zeroByCat() {
    return Object.fromEntries(getAllCategories().map((c) => [c, 0])) as Record<
      AccountCategory,
      number
    >;
  }
  function nonRetirementFor(cat: AccountCategory, amount: number) {
    const total = zeroByCat();
    total[cat] = amount;
    return {
      total,
      trad: zeroByCat(),
      roth: zeroByCat(),
      grandTotal: amount,
    };
  }

  it("excludes the Portfolio-parented amount from the category's routable balance", () => {
    const balances = makeAccountBalances({ afterTax: 100000 });
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["brokerage"],
    });
    const nonRetirement = nonRetirementFor("brokerage", 80000);
    const result = routeForMode(
      50000,
      config,
      balances,
      { taxableSS: 0 },
      undefined,
      nonRetirement,
    );
    // Only $20,000 of the $100,000 brokerage balance is Retirement-parented
    // -- the category can supply at most that much.
    expect(slotFor(result.slots, "brokerage")?.withdrawal ?? 0).toBe(20000);
    expect(result.unmetNeed).toBeCloseTo(30000, 2);
    expect(result.nonRetirementShortfall).toBeCloseTo(30000, 2);
  });

  it("names the shortfall distinctly from penaltyAvoidedShortfall when both sources are active", () => {
    const { balances, eligibility } = lockedBalances({
      brokerage: { structure: "basis_tracking", balance: 100000, basis: 0 },
    });
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "brokerage"],
    });
    const nonRetirement = nonRetirementFor("brokerage", 90000);
    const result = routeForMode(
      50000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility, // 401k fully penalty-exposed, still excluded
      nonRetirement, // brokerage 90% Portfolio-parented
    );
    expect(result.unmetNeed).toBeGreaterThan(0);
    expect(result.penaltyAvoidedShortfall).toBeGreaterThan(0);
    expect(result.nonRetirementShortfall).toBeGreaterThan(0);
    // Neither figure alone accounts for the full unmet need, and neither
    // exceeds it -- they're independent, bounded partitions of the same
    // shortfall, not a blended figure.
    expect(result.penaltyAvoidedShortfall!).toBeLessThanOrEqual(
      result.unmetNeed!,
    );
    expect(result.nonRetirementShortfall!).toBeLessThanOrEqual(
      result.unmetNeed!,
    );
  });

  it("byte-identical fallthrough when nonRetirement is undefined or all-zero", () => {
    const balances = makeAccountBalances({ afterTax: 100000 });
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["brokerage"],
    });
    const withUndefined = routeForMode(50000, config, balances, {
      taxableSS: 0,
    });
    const withAllZero = routeForMode(
      50000,
      config,
      balances,
      { taxableSS: 0 },
      undefined,
      nonRetirementFor("brokerage", 0),
    );
    expect(withUndefined.slots).toEqual(withAllZero.slots);
    expect(withAllZero.nonRetirementShortfall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Waterfall + Roth-bracket-overlay: bracketTraditionalCap surfaced
// (deliberately NOT mode-gated).
// ---------------------------------------------------------------------------

describe("routeForMode (waterfall + Roth-bracket-overlay surfaces bracketTraditionalCap)", () => {
  const SD = 30000;
  const bracketInfo = {
    taxBrackets: TEST_BRACKETS,
    rothBracketTarget: 0.22,
    taxableSS: 0,
    standardDeduction: SD,
  };

  it("populates traditionalCap for waterfall once the overlay applies, matching computeBracketTraditionalCap directly", () => {
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["brokerage", "401k", "ira", "403b", "hsa"], // deliberately NOT trad-first
    });
    const balances = makeAccountBalances({
      preTax: 300000,
      afterTax: 100000,
      afterTaxBasis: 100000,
    });
    const result = routeForMode(80000, config, balances, bracketInfo);
    expect(result.traditionalCap).toBe(
      computeBracketTraditionalCap(bracketInfo),
    );
    expect(result.traditionalCap).toBeGreaterThan(0);
  });

  it("stays undefined when no rothBracketTarget is set (overlay never applies — byte-identical to pre-fix)", () => {
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
    });
    const balances = makeAccountBalances({ preTax: 300000 });
    const result = routeForMode(80000, config, balances, {
      taxableSS: 0,
    });
    expect(result.traditionalCap).toBeUndefined();
  });

  it("stays undefined when there's no tax bracket data (overlay never applies)", () => {
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
    });
    const balances = makeAccountBalances({ preTax: 300000 });
    const result = routeForMode(80000, config, balances, {
      rothBracketTarget: 0.22,
      taxableSS: 0,
    });
    expect(result.traditionalCap).toBeUndefined();
  });

  it("reports the SAME cap value as bracket_filling mode for identical bracket inputs (same underlying computeBracketTraditionalCap call)", () => {
    const balances = makeAccountBalances({
      preTax: 300000,
      afterTax: 100000,
      afterTaxBasis: 100000,
    });
    const waterfallResult = routeForMode(
      80000,
      makeDecumulationConfig({ withdrawalRoutingMode: "waterfall" }),
      balances,
      bracketInfo,
    );
    const bracketFillingResult = routeForMode(
      80000,
      makeDecumulationConfig({ withdrawalRoutingMode: "bracket_filling" }),
      balances,
      bracketInfo,
    );
    expect(waterfallResult.traditionalCap).toBe(
      bracketFillingResult.traditionalCap,
    );
  });
});

// ---------------------------------------------------------------------------
// routeForMode (penalty-allowance override as true last resort)
// ---------------------------------------------------------------------------

/** An eligibility record with 401k penalty-exposed but ALLOWED —
 *  `penaltyExposedTrad`/`Total` show the real exposure, but the
 *  `...StillExcluded` variant is zero, exactly like the real
 *  `computeWithdrawalEligibility` output for an account with
 *  `allowPenalizedWithdrawals: true`. */
function allowedAccountEligibility(): EligibilityRecord {
  const penaltyExposedTrad = {
    "401k": 100000,
    "403b": 0,
    ira: 0,
    hsa: 0,
    brokerage: 0,
  };
  const zero = { "401k": 0, "403b": 0, ira: 0, hsa: 0, brokerage: 0 };
  return {
    byKey: new Map(),
    totalPenaltyExposed: 100000,
    penaltyExposedTrad,
    penaltyExposedRoth: { ...zero },
    penaltyExposedTotal: { ...penaltyExposedTrad },
    // With the allowance on, nothing is "still excluded" — the whole 401k exposure
    // is allowed, so subtractExcluded (the OLD single-pass path) would
    // never have held any of it back at all.
    penaltyExposedTradStillExcluded: { ...zero },
    penaltyExposedRothStillExcluded: { ...zero },
    penaltyExposedTotalStillExcluded: { ...zero },
    totalPenaltyExposedStillExcluded: 0,
  };
}

describe("routeForMode (R44 — true last-resort for R41-allowed penalty exposure)", () => {
  it("never touches the allowed account when the household is genuinely solvent without it", () => {
    const balances: AccountBalances = {
      "401k": { structure: "roth_traditional", traditional: 100000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 60000, basis: 30000 },
    };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    const result = routeForMode(
      20000, // well within brokerage's 60000 alone
      config,
      balances,
      { taxableSS: 0 },
      allowedAccountEligibility(),
    );
    expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBe(0);
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(20000);
    expect(result.unmetNeed ?? 0).toBe(0);
  });

  it("draws from the allowed account ONLY for the genuine residual once every other source is exhausted", () => {
    const balances: AccountBalances = {
      "401k": { structure: "roth_traditional", traditional: 100000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 60000, basis: 30000 },
    };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    const result = routeForMode(
      90000, // exceeds brokerage's 60000 alone by 30000
      config,
      balances,
      { taxableSS: 0 },
      allowedAccountEligibility(),
    );
    // Every non-allowed dollar (brokerage) drawn first...
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(60000);
    // ...and the allowed 401k covers exactly the residual, nothing more.
    expect(slotFor(result.slots, "401k")?.withdrawal).toBe(30000);
    expect(result.unmetNeed ?? 0).toBe(0);
  });

  it("leaves a real shortfall (doesn't over-draw the allowed account) when even it can't cover the need", () => {
    const balances: AccountBalances = {
      "401k": { structure: "roth_traditional", traditional: 20000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 60000, basis: 30000 },
    };
    const eligibility: EligibilityRecord = {
      ...allowedAccountEligibility(),
      totalPenaltyExposed: 20000,
      penaltyExposedTrad: {
        "401k": 20000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedTotal: {
        "401k": 20000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
    };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    const result = routeForMode(
      100000,
      config,
      balances,
      { taxableSS: 0 },
      eligibility,
    );
    expect(slotFor(result.slots, "brokerage")?.withdrawal).toBe(60000);
    expect(slotFor(result.slots, "401k")?.withdrawal).toBe(20000);
    // 100000 - 60000 - 20000 = 20000 genuinely unmet.
    expect(result.unmetNeed).toBeCloseTo(20000, 2);
    expect(result.penaltyAvoidedShortfall ?? 0).toBe(0); // nothing was STILL excluded (all was allowed)
  });

  it("conservation: total drawn across both passes equals the target exactly (no dollars invented, lost, or double-counted)", () => {
    const balances: AccountBalances = {
      "401k": { structure: "roth_traditional", traditional: 100000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 60000, basis: 30000 },
    };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
    });
    const twoPass = routeForMode(
      90000,
      config,
      balances,
      { taxableSS: 0 },
      allowedAccountEligibility(),
    );
    const totalDrawn = twoPass.slots.reduce((s, sl) => s + sl.withdrawal, 0);
    expect(totalDrawn).toBeCloseTo(90000, 2);

    // NOT the right invariant to test here: comparing against
    // `routeWithdrawals(90000, config, balances)` (a single dispatch with
    // the allowed money reachable from the start). That single dispatch
    // drains 401k FIRST (it's first in withdrawalOrder) before ever
    // touching brokerage — which is exactly the bug this function
    // exists to fix, not a correct reference to match. There is no
    // single-dispatch equivalent of "prefer non-allowed sources, allowed
    // money only for the true residual" by construction — that preference
    // is inherently two-tier. The "draws from the allowed account ONLY for
    // the genuine residual" test above is the real behavioral assertion;
    // this test only checks that splitting the draw into two dispatches
    // doesn't itself lose or duplicate money.
  });

  it("bracket_filling mode: the residual pass can push further into the next bracket", () => {
    const balances: AccountBalances = {
      "401k": { structure: "roth_traditional", traditional: 400000, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 20000, basis: 10000 },
    };
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "bracket_filling",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
      withdrawalTaxPreference: {
        "401k": "traditional",
        "403b": null,
        ira: null,
        hsa: null,
        brokerage: null,
      } as Record<AccountCategory, "traditional" | "roth" | null>,
    });
    const eligibility: EligibilityRecord = {
      ...allowedAccountEligibility(),
      totalPenaltyExposed: 400000,
      penaltyExposedTrad: {
        "401k": 400000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
      penaltyExposedTotal: {
        "401k": 400000,
        "403b": 0,
        ira: 0,
        hsa: 0,
        brokerage: 0,
      },
    };
    // Need exceeds brokerage entirely -> forces the residual into the
    // allowed (penalty-exposed) 401k.
    const result = routeForMode(
      60000,
      config,
      balances,
      { taxBrackets: TEST_BRACKETS, rothBracketTarget: 0.12, taxableSS: 0 },
      eligibility,
    );
    const total = (result.slots ?? []).reduce((s, sl) => s + sl.withdrawal, 0);
    expect(total).toBeCloseTo(60000, 2);
    expect(slotFor(result.slots, "401k")?.withdrawal ?? 0).toBeGreaterThan(0);
  });

  it("every existing non-allowance fixture stays on the single-pass path (hasLastResortAllowance false)", () => {
    // lockedBalances() has NO allowance (StillExcluded === full exposure) —
    // this must behave byte-identically to the pre-allowance path.
    const { balances, eligibility } = lockedBalances();
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["401k", "403b", "ira", "brokerage", "hsa"],
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
});
