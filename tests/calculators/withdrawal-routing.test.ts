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

  // -------------------------------------------------------------------------
  // v0.7.9 R40 follow-up: cost-aware post-Traditional-cap ranking
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

  it("draws Roth growth instead of brokerage once ordinary income has pushed past the 0%/15% LTCG zones and Roth's marginal rate is cheaper", () => {
    const config = makeDecumulationConfig();
    const balances = makeAccountBalances({
      preTax: 10000,
      taxFree: 100000,
      afterTax: 100000,
      afterTaxBasis: 0, // all gains -- worst case for brokerage's cost
    });
    const result = routeWithdrawalsBracketFilling(60000, config, balances, {
      taxBrackets: TEST_BRACKETS,
      rothBracketTarget: 0.1, // next bracket up is 12% -- cheaper than 20% LTCG
      taxableSS: 700000, // pushes past MFJ's $613,700 15%/20% LTCG threshold
      filingStatus: "MFJ",
      rothBasisAvailable: 0,
      brokerageBasisRatio: 0,
      magiBeforeThisDraw: 0, // keep NIIT out of it
    });
    const rothSlot =
      slotFor(result.slots, "401k") ?? slotFor(result.slots, "ira");
    const brokSlot = slotFor(result.slots, "brokerage")!;
    expect(rothSlot?.rothWithdrawal ?? 0).toBeGreaterThan(0);
    expect(brokSlot.withdrawal).toBe(0);
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
    // No account has the R41 override in this fixture, so "still excluded"
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
    // DESIGN-DECISION-v0.7.8-indbal-reconciliation.md. Before
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
    // DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q3 reverses
    // Group 0 § Q0's soft-lock fallback (explicit user direction,
    // 2026-08-26: "do not take money if it includes a penalty"). This
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
    // penalty-exposed money is reachable at all —
    // DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q4. (The
    // `preferPenaltyFreeSources` flag once proposed alongside it was
    // never wired into routing and was deleted 2026-08-27.)
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
    // exists (DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q2): the
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
