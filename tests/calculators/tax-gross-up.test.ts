/**
 * Tests for tax-gross-up.ts's estimateWithdrawalTaxCost — moved here from
 * tax-estimation.test.ts when the function moved files (Phase 5 item 5.3).
 *
 * The 3 "diverges from real routing" describe blocks near the bottom are
 * regression tests for the specific bugs the advisor design review found
 * (Batch 2 Finding 10): the estimate previously hand-simulated routing
 * separately from withdrawal-routing.ts's real functions and had silently
 * drifted from them in percentage mode, waterfall + rothBracketTarget, and
 * bracket-filling account caps. Now both call routeForMode, so these tests
 * assert the estimate is actually SENSITIVE to the config fields that
 * govern real routing — a config-blind estimate (the old bug) would make
 * these assertions fail.
 */
import { describe, it, expect } from "vitest";
import { estimateWithdrawalTaxCost } from "@/lib/calculators/engine/tax-gross-up";
import { routeForMode } from "@/lib/calculators/engine/withdrawal-routing";
import { computeTaxFromSlots } from "@/lib/calculators/engine/tax-estimation";
import { getAllCategories, zeroBalance } from "@/lib/config/account-types";
import type { AccountBalances } from "@/lib/calculators/types";

import {
  makeDecumulationConfig,
  makeAccountBalances,
  makeTaxBuckets,
  TEST_BRACKETS,
} from "./fixtures/engine-fixtures";

/**
 * makeAccountBalances (from a single aggregate TaxBuckets) splits preTax
 * EVENLY across every roth_traditional category in the same limit group
 * (401k/403b/ira) — it can't express "only this one account is funded".
 * These regression tests need that precision (to prove an account cap on
 * ONE account actually binds, with no sibling account able to cover the
 * shortfall), so they build a zeroed AccountBalances directly and set only
 * the specific categories under test.
 */
function zeroedBalances(): AccountBalances {
  return Object.fromEntries(
    getAllCategories().map((cat) => [cat, zeroBalance(cat)]),
  ) as AccountBalances;
}

describe("estimateWithdrawalTaxCost", () => {
  it("returns zero tax for zero after-tax need", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 0,
      ssIncome: 20000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    expect(result.estTax).toBe(0);
    expect(result.effectiveTaxRate).toBe(0);
    expect(result.grossUpFactor).toBe(1);
    expect(result.targetWithdrawal).toBe(0);
  });

  it("computes gross-up factor for bracket_filling mode", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 24000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    expect(result.grossUpFactor).toBeGreaterThanOrEqual(1);
    expect(result.grossedUpNeed).toBeGreaterThanOrEqual(60000);
    expect(result.targetWithdrawal).toBeGreaterThanOrEqual(60000);
  });

  it("caps target withdrawal at total balance", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 500000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets({
        preTax: 100,
        taxFree: 100,
        hsa: 100,
        afterTax: 100,
        afterTaxBasis: 50,
      }),
      acctBal: makeAccountBalances({
        preTax: 100,
        taxFree: 100,
        hsa: 100,
        afterTax: 100,
        afterTaxBasis: 50,
      }),
      totalBalance: 400,
    });
    expect(result.targetWithdrawal).toBeLessThanOrEqual(400);
  });

  it("disables gross-up when grossUpForTaxes is false", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 0,
      filingStatus: null,
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: false,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    expect(result.grossUpFactor).toBe(1);
  });

  it("handles waterfall routing mode", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 24000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({ withdrawalRoutingMode: "waterfall" }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    expect(result.grossUpFactor).toBeGreaterThanOrEqual(1);
    expect(result.targetWithdrawal).toBeGreaterThan(0);
  });

  it("handles percentage routing mode", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 24000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({ withdrawalRoutingMode: "percentage" }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    expect(result.grossUpFactor).toBeGreaterThanOrEqual(1);
  });

  it("runs SS convergence with filing status and SS income", () => {
    const result = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 30000,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates: {
        grossUpForTaxes: true,
        traditionalFallbackRate: 0.15,
        roth: 0,
        hsa: 0,
        brokerage: 0.15,
        taxBrackets: TEST_BRACKETS,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    // taxableSS should be computed via IRS formula (not flat 85%)
    expect(result.taxableSS).toBeGreaterThanOrEqual(0);
    expect(result.taxableSS).toBeLessThanOrEqual(30000 * 0.85);
  });
});

describe("estimateWithdrawalTaxCost matches real routing (regression for Batch 2 Finding 10)", () => {
  const taxRates = {
    grossUpForTaxes: true,
    traditionalFallbackRate: 0.15,
    roth: 0,
    hsa: 0,
    brokerage: 0.15,
    taxBrackets: TEST_BRACKETS,
    rothBracketTarget: 0.22,
  };

  it("percentage mode: estimate is sensitive to config.withdrawalSplits, not just portfolio balance weights", () => {
    // Balances are the SAME in both calls -- only withdrawalSplits differs.
    // The old hand-sim used portfolio-balance weights and would produce an
    // IDENTICAL result regardless of withdrawalSplits, since it never read
    // that field. The real router (routeWithdrawalsPercentage) uses
    // withdrawalSplits directly, so a config-driven estimate must differ.
    // Both 401k and brokerage need real balance so redistribution (when one
    // target is unfunded) can't mask the split's effect.
    const acctBal = zeroedBalances();
    acctBal["401k"].traditional = 300000;
    acctBal.brokerage.balance = 300000;
    acctBal.brokerage.basis = 300000; // 0 gains -- isolates the traditional-vs-brokerage tax gap
    const balances = makeTaxBuckets({
      preTax: 300000,
      taxFree: 0,
      hsa: 0,
      afterTax: 300000,
      afterTaxBasis: 300000,
    });

    const mostlyTraditional = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "percentage",
        withdrawalSplits: {
          "401k": 0.9,
          "403b": 0,
          ira: 0,
          hsa: 0,
          brokerage: 0.1,
        },
      }),
      taxRates,
      balances,
      acctBal,
      totalBalance: 1000000,
    });

    const mostlyRoth = estimateWithdrawalTaxCost({
      afterTaxNeed: 60000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "percentage",
        withdrawalSplits: {
          "401k": 0.1,
          "403b": 0,
          ira: 0,
          hsa: 0,
          brokerage: 0.9,
        },
      }),
      taxRates,
      balances,
      acctBal,
      totalBalance: 1000000,
    });

    // 401k here is 100% traditional (per withdrawalTaxPreference default),
    // brokerage is untaxed in this fixture (0 gains) -- so weighting more
    // toward 401k must cost more tax than weighting toward brokerage.
    expect(mostlyTraditional.estTax).toBeGreaterThan(mostlyRoth.estTax);
  });

  it("waterfall + rothBracketTarget: estimate reflects the real overlay's forced-traditional preference", () => {
    // ira has no explicit tax preference (null) in the base fixture, so the
    // Roth-bracket overlay should force it to traditional when a
    // rothBracketTarget is configured. Compare against the SAME setup with
    // no rothBracketTarget -- the overlay must actually change the result.
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "waterfall",
      withdrawalOrder: ["ira", "401k", "403b", "brokerage", "hsa"],
    });

    const withOverlay = estimateWithdrawalTaxCost({
      afterTaxNeed: 40000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config,
      taxRates: { ...taxRates, rothBracketTarget: 0.1 },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });

    const withoutOverlay = estimateWithdrawalTaxCost({
      afterTaxNeed: 40000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config,
      taxRates: { ...taxRates, rothBracketTarget: undefined },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });

    // The overlay caps traditional withdrawals at a low bracket target,
    // which must change the estimated tax relative to no cap at all.
    expect(withOverlay.estTax).not.toBeCloseTo(withoutOverlay.estTax, 0);
  });

  it("bracket_filling: estimate respects withdrawalAccountCaps", () => {
    // Only 401k funded (via zeroedBalances + direct assignment) so a cap on
    // it can't be silently backfilled by a sibling traditional account --
    // makeAccountBalances' even 401k/403b/ira split would mask that.
    const acctBal = zeroedBalances();
    acctBal["401k"].traditional = 500000;
    const balances = makeTaxBuckets({
      preTax: 500000,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    });

    const uncapped = estimateWithdrawalTaxCost({
      afterTaxNeed: 50000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
      }),
      taxRates,
      balances,
      acctBal,
      totalBalance: 500000,
    });

    const capped = estimateWithdrawalTaxCost({
      afterTaxNeed: 50000,
      ssIncome: 0,
      filingStatus: "MFJ",
      config: makeDecumulationConfig({
        withdrawalRoutingMode: "bracket_filling",
        withdrawalAccountCaps: {
          ...makeDecumulationConfig().withdrawalAccountCaps,
          "401k": 1000,
        },
      }),
      taxRates,
      balances,
      acctBal,
      totalBalance: 500000,
    });

    // With 401k (the only funded account) capped to $1000, far less of the
    // withdrawal can come from traditional -- the old hand-sim ignored
    // withdrawalAccountCaps entirely and would show no difference.
    expect(capped.targetWithdrawal).not.toBeCloseTo(
      uncapped.targetWithdrawal,
      0,
    );
  });

  it("estimate's implied tax exactly matches calling routeForMode + computeTaxFromSlots directly (single-pass case)", () => {
    // No SS/filingStatus -> exactly 1 iteration, so this is a strict
    // equality check that estimateWithdrawalTaxCost really does delegate
    // to the shared functions rather than any separate internal math.
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "bracket_filling",
    });
    const acctBal = makeAccountBalances();
    const balances = makeTaxBuckets();

    const est = estimateWithdrawalTaxCost({
      afterTaxNeed: 45000,
      ssIncome: 0,
      filingStatus: null,
      config,
      taxRates,
      balances,
      acctBal,
      totalBalance: 1050000,
    });

    const routeResult = routeForMode(45000, config, acctBal, {
      taxBrackets: taxRates.taxBrackets,
      rothBracketTarget: taxRates.rothBracketTarget,
      taxableSS: 0,
    });
    const taxResult = computeTaxFromSlots({
      slots: routeResult.slots,
      taxableSS: 0,
      balances,
      taxRates,
      filingStatus: null,
    });

    expect(est.estTax).toBe(taxResult.taxCost);
  });
});
