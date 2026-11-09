/**
 * Tests for withdrawal-solver.ts's estimateWithdrawalTaxCost — moved here from
 * tax-estimation.test.ts when the function moved files.
 *
 * The 3 "diverges from real routing" describe blocks near the bottom are
 * regression tests for a specific bug class: the estimate previously
 * hand-simulated routing
 * separately from withdrawal-routing/'s real functions and had silently
 * drifted from them in percentage mode, waterfall + rothBracketTarget, and
 * bracket-filling account caps. Now both call routeForMode, so these tests
 * assert the estimate is actually SENSITIVE to the config fields that
 * govern real routing — a config-blind estimate (the old bug) would make
 * these assertions fail.
 */
import { describe, it, expect } from "vitest";
import { estimateWithdrawalTaxCost } from "@/lib/pure/engine/withdrawal-solver";
import { routeForMode } from "@/lib/pure/engine/withdrawal-routing";
import { computeTaxFromSlots } from "@/lib/pure/engine/tax-estimation";
import { getAllCategories, zeroBalance } from "@/lib/config/account-types";
import {
  setBalance,
  setBasis,
  setTraditional,
} from "@/lib/config/account-balance";
import type { AccountBalances } from "@/lib/pure/accounts/account-balances.types";

import {
  makeDecumulationConfig,
  makeAccountBalances,
  makeTaxBuckets,
  TEST_BRACKETS,
} from "../fixtures/engine-fixtures";
import { shippedTaxTables } from "../../helpers/tax-data";

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
      ssSurplus: 0,
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
        ltcgBrackets: shippedTaxTables().ltcgBrackets,
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
      ssSurplus: 0,
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
        ltcgBrackets: shippedTaxTables().ltcgBrackets,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    // Bounds only: an over-withdrawal passes them. The gross-up's equation
    // (W − cost(W) = need, never over) is asserted through the engine in
    // gross-up-delivers-need.test.ts (answer key E1, E1-prop) and
    // answer-key-ledgers.test.ts (engine/H6-2026); a derived case here waits
    // for v0.11 Engine "Tests: NIIT in the gross-up and the 10% penalty
    // survive mutation".
    expect(result.grossUpFactor).toBeGreaterThanOrEqual(1);
    expect(result.grossedUpNeed).toBeGreaterThanOrEqual(60000);
    expect(result.targetWithdrawal).toBeGreaterThanOrEqual(60000);
    expect(result.status).toBe("met");
  });

  it("caps target withdrawal at total balance", () => {
    const result = estimateWithdrawalTaxCost({
      ssSurplus: 0,
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
        ltcgBrackets: shippedTaxTables().ltcgBrackets,
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
    // $400 in the pool can't deliver a $500,000 need: capped, short by
    // most of it.
    expect(result.status).toBe("capped");
    if (result.status === "capped")
      expect(result.shortfall).toBeGreaterThan(499_000);
  });

  it("disables gross-up when grossUpForTaxes is false", () => {
    const result = estimateWithdrawalTaxCost({
      ssSurplus: 0,
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
        ltcgBrackets: shippedTaxTables().ltcgBrackets,
        rothBracketTarget: 0.22,
      },
      balances: makeTaxBuckets(),
      acctBal: makeAccountBalances(),
      totalBalance: 1050000,
    });
    expect(result.grossUpFactor).toBe(1);
    // The need is withdrawn as is and the pool holds it: met.
    expect(result.status).toBe("met");
  });

  it("handles waterfall routing mode", () => {
    const result = estimateWithdrawalTaxCost({
      ssSurplus: 0,
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
        ltcgBrackets: shippedTaxTables().ltcgBrackets,
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
      ssSurplus: 0,
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
        ltcgBrackets: shippedTaxTables().ltcgBrackets,
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
      ssSurplus: 0,
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
        ltcgBrackets: shippedTaxTables().ltcgBrackets,
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
    ltcgBrackets: shippedTaxTables().ltcgBrackets,
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
    setTraditional(acctBal["401k"], 300000);
    setBalance(acctBal.brokerage, 300000);
    setBasis(acctBal.brokerage, 300000); // 0 gains -- isolates the traditional-vs-brokerage tax gap
    const balances = makeTaxBuckets({
      preTax: 300000,
      taxFree: 0,
      hsa: 0,
      afterTax: 300000,
      afterTaxBasis: 300000,
    });

    const mostlyTraditional = estimateWithdrawalTaxCost({
      ssSurplus: 0,
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
      ssSurplus: 0,
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
      ssSurplus: 0,
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
      ssSurplus: 0,
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
    setTraditional(acctBal["401k"], 500000);
    const balances = makeTaxBuckets({
      preTax: 500000,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    });

    const uncapped = estimateWithdrawalTaxCost({
      ssSurplus: 0,
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
      ssSurplus: 0,
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

  it("estimate's implied tax exactly matches calling routeForMode + computeTaxFromSlots directly, evaluated at the CONVERGED withdrawal amount", () => {
    // estimateWithdrawalTaxCost now secant-converges on the
    // withdrawal amount itself (previously a single Picard step that
    // silently under-withdrew whenever cost wasn't proportional to
    // withdrawal size — see
    // tests/pure/engine/penalty-hard-exclusion-both-paths-agree.test.ts
    // for the reproduction). So `est.estimatedTax` is no longer tax evaluated at
    // the raw pre-gross-up `afterTaxNeed` trial -- it's tax at
    // `est.targetWithdrawal`, the amount actually routed. This test still
    // proves the same structural invariant the original was written for
    // (the estimate delegates to the SAME shared routeForMode +
    // computeTaxFromSlots functions, not separate internal math) — just
    // checked at the amount the estimate actually converged to.
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "bracket_filling",
    });
    const acctBal = makeAccountBalances();
    const balances = makeTaxBuckets();

    const est = estimateWithdrawalTaxCost({
      ssSurplus: 0,
      afterTaxNeed: 45000,
      ssIncome: 0,
      filingStatus: null,
      config,
      taxRates,
      balances,
      acctBal,
      totalBalance: 1050000,
    });

    const routeResult = routeForMode(est.targetWithdrawal, config, acctBal, {
      taxBrackets: taxRates.taxBrackets,
      ltcgBrackets: shippedTaxTables().ltcgBrackets,
      rothBracketTarget: taxRates.rothBracketTarget,
      taxableSS: 0,
    });
    const taxResult = computeTaxFromSlots({
      rothTaxableGrowth: 0,
      penaltyCost: 0,
      slots: routeResult.slots,
      taxableSS: 0,
      balances,
      taxRates,
      filingStatus: null,
    });

    expect(est.estTax).toBe(taxResult.taxCost);
  });
});

describe("estimateWithdrawalTaxCost — a fixed gross withdrawal (Social Security on top)", () => {
  const base = {
    afterTaxNeed: 999_999, // ignored when the withdrawal is fixed
    ssIncome: 30000,
    ssSurplus: 0,
    filingStatus: "MFJ" as const,
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
      ltcgBrackets: shippedTaxTables().ltcgBrackets,
      rothBracketTarget: 0.22,
    },
    balances: makeTaxBuckets(),
    acctBal: makeAccountBalances(),
    totalBalance: 1050000,
  };

  it("withdraws exactly the amount, grosses nothing up, and derives the after-tax need it delivers", () => {
    const r = estimateWithdrawalTaxCost({
      ...base,
      fixedGrossWithdrawal: 60000,
    });
    expect(r.targetWithdrawal).toBe(60000);
    expect(r.grossUpFactor).toBe(1);
    expect(r.derivedAfterTaxNeed).toBeCloseTo(
      60000 - r.estTax - r.estPenalty,
      2,
    );
    expect(r.estTax).toBeGreaterThan(0);
    expect(r.status).toBe("met");
  });

  it("never more than the balance", () => {
    const r = estimateWithdrawalTaxCost({
      ...base,
      fixedGrossWithdrawal: 5_000_000,
    });
    expect(r.targetWithdrawal).toBe(1050000);
    expect(r.status).toBe("capped");
  });

  it("the normal path is unchanged without it", () => {
    const r = estimateWithdrawalTaxCost({ ...base, afterTaxNeed: 40000 });
    expect(r.derivedAfterTaxNeed).toBeUndefined();
    expect(r.targetWithdrawal).toBeGreaterThan(40000);
  });
});

describe("estimateWithdrawalTaxCost — met or capped, arm by arm", () => {
  const taxRates = {
    grossUpForTaxes: true,
    traditionalFallbackRate: 0.15,
    roth: 0,
    hsa: 0,
    brokerage: 0.15,
    taxBrackets: TEST_BRACKETS,
    ltcgBrackets: shippedTaxTables().ltcgBrackets,
    rothBracketTarget: 0.22,
  };
  const base = {
    afterTaxNeed: 60000,
    ssIncome: 0,
    ssSurplus: 0,
    filingStatus: "MFJ" as const,
    config: makeDecumulationConfig({
      withdrawalRoutingMode: "bracket_filling",
    }),
    taxRates,
    balances: makeTaxBuckets(),
    acctBal: makeAccountBalances(),
    totalBalance: 1050000,
  };

  it("a fixed withdrawal costing more than itself, every dollar delivered, is met", () => {
    // Tax on $80,000 of Social Security exceeds a $1,000 (or $0)
    // withdrawal; nothing is left behind in the portfolio.
    for (const amount of [1000, 0]) {
      const r = estimateWithdrawalTaxCost({
        ...base,
        filingStatus: null,
        ssIncome: 80000,
        fixedGrossWithdrawal: amount,
      });
      expect(r.estTax, `amount ${amount}`).toBeGreaterThan(amount);
      expect(r.status, `amount ${amount}`).toBe("met");
    }
  });

  it("a fixed withdrawal capped by the balance is short by the gross gap", () => {
    const r = estimateWithdrawalTaxCost({
      ...base,
      fixedGrossWithdrawal: 60000,
      totalBalance: 50000,
    });
    expect(r.targetWithdrawal).toBe(50000);
    expect(r).toMatchObject({ status: "capped", shortfall: 10000 });
  });

  it("a fixed withdrawal capped by the router is short by the routed gap", () => {
    // Only the 401(k) holds money, and its cap lets $1,000 out.
    const acctBal = zeroedBalances();
    setTraditional(acctBal["401k"], 500000);
    const config = makeDecumulationConfig({
      withdrawalRoutingMode: "bracket_filling",
      withdrawalAccountCaps: {
        ...makeDecumulationConfig().withdrawalAccountCaps,
        "401k": 1000,
      },
    });
    const r = estimateWithdrawalTaxCost({
      ...base,
      config,
      acctBal,
      balances: makeTaxBuckets({
        preTax: 500000,
        taxFree: 0,
        hsa: 0,
        afterTax: 0,
        afterTaxBasis: 0,
      }),
      totalBalance: 500000,
      fixedGrossWithdrawal: 50000,
    });
    const routed = routeForMode(50000, config, acctBal, {
      taxBrackets: TEST_BRACKETS,
      ltcgBrackets: shippedTaxTables().ltcgBrackets,
      rothBracketTarget: 0.22,
      taxableSS: 0,
    });
    expect(routed.unmetNeed).toBeGreaterThan(0);
    expect(r).toMatchObject({
      status: "capped",
      shortfall: routed.unmetNeed,
    });
  });

  it("gross-up off: met with the need in the pool or a cent short, capped beyond", () => {
    const off = { ...base, taxRates: { ...taxRates, grossUpForTaxes: false } };
    const at = (totalBalance: number) =>
      estimateWithdrawalTaxCost({ ...off, totalBalance });
    expect(at(60000).status).toBe("met");
    expect(at(59999.99).status).toBe("met");
    expect(at(59999.98)).toMatchObject({ status: "capped", shortfall: 0.02 });
    expect(at(59990)).toMatchObject({ status: "capped", shortfall: 10 });
  });

  it("gross-up on, the pool holding just the need: capped by the tax", () => {
    const r = estimateWithdrawalTaxCost({ ...base, totalBalance: 60000 });
    expect(r.targetWithdrawal).toBe(60000);
    expect(r.estTax).toBeGreaterThan(0);
    expect(r).toMatchObject({
      status: "capped",
      shortfall: Math.round((r.estTax + r.estPenalty) * 100) / 100,
    });
  });
});
