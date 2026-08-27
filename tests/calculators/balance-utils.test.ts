import { describe, it, expect } from "vitest";
import {
  accountBalancesFromTaxBuckets,
  cloneAccountBalances,
  subtractPenaltyExposed,
} from "@/lib/calculators/engine/balance-utils";
import type { AccountBalances, TaxBuckets } from "@/lib/calculators/types";
import type { EligibilityRecord } from "@/lib/pure/withdrawal-eligibility";
import {
  getAllCategories,
  getTotalBalance,
  getBasis,
} from "@/lib/config/account-types";

function makeBuckets(overrides: Partial<TaxBuckets> = {}): TaxBuckets {
  return {
    preTax: 0,
    taxFree: 0,
    hsa: 0,
    afterTax: 0,
    afterTaxBasis: 0,
    ...overrides,
  };
}

describe("accountBalancesFromTaxBuckets", () => {
  it("returns entries for all categories", () => {
    const result = accountBalancesFromTaxBuckets(makeBuckets());
    const keys = Object.keys(result);
    for (const cat of getAllCategories()) {
      expect(keys).toContain(cat);
    }
  });

  it("assigns hsa bucket to single_bucket category", () => {
    const result = accountBalancesFromTaxBuckets(makeBuckets({ hsa: 15000 }));
    expect(getTotalBalance(result.hsa)).toBe(15000);
  });

  it("assigns afterTax to brokerage balance and afterTaxBasis to basis", () => {
    const result = accountBalancesFromTaxBuckets(
      makeBuckets({ afterTax: 50000, afterTaxBasis: 30000 }),
    );
    expect(getTotalBalance(result.brokerage)).toBe(50000);
    expect(getBasis(result.brokerage)).toBe(30000);
  });

  it("splits preTax across roth_traditional limit groups", () => {
    const result = accountBalancesFromTaxBuckets(
      makeBuckets({ preTax: 100000 }),
    );
    // 401k and 403b share the "401k" limit group; ira has its own "ira" group
    // 2 groups total → each gets 50000
    // Both 401k and 403b get the same fraction since they're in the same group
    const trad401k = result["401k"].traditional;
    const trad403b = result["403b"].traditional;
    const tradIra = result.ira.traditional;

    // Each limit group gets 1/2 of 100000 = 50000
    expect(trad401k).toBe(50000);
    expect(trad403b).toBe(50000);
    expect(tradIra).toBe(50000);
  });

  it("splits taxFree across roth balances", () => {
    const result = accountBalancesFromTaxBuckets(
      makeBuckets({ taxFree: 60000 }),
    );
    const roth401k = result["401k"].roth;
    const rothIra = result.ira.roth;

    // 2 groups → each gets 30000
    expect(roth401k).toBe(30000);
    expect(rothIra).toBe(30000);
  });

  it("returns all zeros for zero buckets", () => {
    const result = accountBalancesFromTaxBuckets(makeBuckets());
    for (const cat of getAllCategories()) {
      expect(getTotalBalance(result[cat])).toBe(0);
    }
  });

  it("handles all non-zero buckets simultaneously", () => {
    const result = accountBalancesFromTaxBuckets(
      makeBuckets({
        preTax: 200000,
        taxFree: 100000,
        hsa: 25000,
        afterTax: 80000,
        afterTaxBasis: 40000,
      }),
    );
    expect(getTotalBalance(result.hsa)).toBe(25000);
    expect(getTotalBalance(result.brokerage)).toBe(80000);
    expect(getBasis(result.brokerage)).toBe(40000);
    // preTax split across 2 groups: 100000 each
    expect(result["401k"].traditional).toBe(100000);
    expect(result.ira.traditional).toBe(100000);
    // taxFree split across 2 groups: 50000 each
    expect(result["401k"].roth).toBe(50000);
    expect(result.ira.roth).toBe(50000);
  });
});

describe("cloneAccountBalances", () => {
  it("produces an equal copy", () => {
    const original = accountBalancesFromTaxBuckets(
      makeBuckets({
        preTax: 100000,
        taxFree: 50000,
        hsa: 10000,
        afterTax: 30000,
        afterTaxBasis: 15000,
      }),
    );
    const cloned = cloneAccountBalances(original);

    for (const cat of getAllCategories()) {
      expect(getTotalBalance(cloned[cat])).toBe(getTotalBalance(original[cat]));
    }
  });

  it("mutations to clone do not affect original", () => {
    const original = accountBalancesFromTaxBuckets(
      makeBuckets({ hsa: 10000, afterTax: 20000 }),
    );
    const cloned = cloneAccountBalances(original);

    // Mutate the clone
    (cloned.hsa as { balance: number }).balance = 99999;
    (cloned.brokerage as { balance: number }).balance = 99999;

    // Original unchanged
    expect(getTotalBalance(original.hsa)).toBe(10000);
    expect(getTotalBalance(original.brokerage)).toBe(20000);
  });
});

describe("subtractPenaltyExposed", () => {
  function zeroByCat() {
    return Object.fromEntries(getAllCategories().map((c) => [c, 0])) as Record<
      ReturnType<typeof getAllCategories>[number],
      number
    >;
  }

  it("no-flags-set case (no account has the R41 override): identical to subtracting the plain aggregates", () => {
    const balances: AccountBalances = accountBalancesFromTaxBuckets(
      makeBuckets({ hsa: 20000, afterTax: 50000 }),
    );
    // accountBalancesFromTaxBuckets splits preTax proportionally across
    // every roth_traditional category's limit group — pin "401k" directly
    // to a known value instead, same pattern withdrawal-routing.test.ts's
    // lockedBalances() helper uses.
    balances["401k"] = {
      structure: "roth_traditional",
      traditional: 100000,
      roth: 0,
    };
    const trad = zeroByCat();
    trad["401k"] = 40000;
    const total = zeroByCat();
    total["401k"] = 40000;
    total.hsa = 20000;
    const record: EligibilityRecord = {
      byKey: new Map(),
      totalPenaltyExposed: 60000,
      penaltyExposedTrad: trad,
      penaltyExposedRoth: zeroByCat(),
      penaltyExposedTotal: total,
      // Nothing allowed — "still excluded" is byte-identical to the plain
      // aggregates above.
      penaltyExposedTradStillExcluded: trad,
      penaltyExposedRothStillExcluded: zeroByCat(),
      penaltyExposedTotalStillExcluded: total,
      totalPenaltyExposedStillExcluded: 60000,
    };
    const result = subtractPenaltyExposed(balances, record);
    expect(getTotalBalance(result["401k"])).toBe(60000); // 100000 - 40000
    expect(getTotalBalance(result.hsa)).toBe(0); // 20000 - 20000, HSA (single_bucket)
    expect(getTotalBalance(result.brokerage)).toBe(50000); // untouched
  });

  it("HSA (single_bucket structure): an allowed HSA's exposed dollars stay in the pool, a disallowed one's don't", () => {
    // Two households worth of HSA balance combined into one category total
    // (subtractPenaltyExposed operates at category grain) — $12k allowed,
    // $8k not.
    const balances: AccountBalances = accountBalancesFromTaxBuckets(
      makeBuckets({ hsa: 20000 }),
    );
    const total = zeroByCat();
    total.hsa = 20000; // blind total: both accounts' exposure
    const stillExcludedTotal = zeroByCat();
    stillExcludedTotal.hsa = 8000; // only the disallowed account's exposure
    const record: EligibilityRecord = {
      byKey: new Map(),
      totalPenaltyExposed: 20000,
      penaltyExposedTrad: zeroByCat(),
      penaltyExposedRoth: zeroByCat(),
      penaltyExposedTotal: total,
      penaltyExposedTradStillExcluded: zeroByCat(),
      penaltyExposedRothStillExcluded: zeroByCat(),
      penaltyExposedTotalStillExcluded: stillExcludedTotal,
      totalPenaltyExposedStillExcluded: 8000,
    };
    const result = subtractPenaltyExposed(balances, record);
    // Only the disallowed $8k is excluded; the allowed $12k stays reachable.
    expect(getTotalBalance(result.hsa)).toBe(12000);
  });

  it("roth_traditional structure: subtracts the Trad/Roth StillExcluded aggregates separately, not the blind ones", () => {
    const balances: AccountBalances =
      accountBalancesFromTaxBuckets(makeBuckets());
    balances["401k"] = {
      structure: "roth_traditional",
      traditional: 100000,
      roth: 50000,
    };
    const trad = zeroByCat();
    trad["401k"] = 60000; // blind: both a disallowed and an allowed account
    const roth = zeroByCat();
    roth["401k"] = 30000;
    const tradStillExcluded = zeroByCat();
    tradStillExcluded["401k"] = 20000; // only the disallowed account's trad exposure
    const rothStillExcluded = zeroByCat();
    rothStillExcluded["401k"] = 10000; // only the disallowed account's roth exposure
    const record: EligibilityRecord = {
      byKey: new Map(),
      totalPenaltyExposed: 90000,
      penaltyExposedTrad: trad,
      penaltyExposedRoth: roth,
      penaltyExposedTotal: zeroByCat(),
      penaltyExposedTradStillExcluded: tradStillExcluded,
      penaltyExposedRothStillExcluded: rothStillExcluded,
      penaltyExposedTotalStillExcluded: zeroByCat(),
      totalPenaltyExposedStillExcluded: 30000,
    };
    const result = subtractPenaltyExposed(balances, record);
    expect(
      result["401k"].structure === "roth_traditional"
        ? result["401k"].traditional
        : NaN,
    ).toBe(80000); // 100000 - 20000, NOT 100000 - 60000
    expect(
      result["401k"].structure === "roth_traditional"
        ? result["401k"].roth
        : NaN,
    ).toBe(40000); // 50000 - 10000, NOT 50000 - 30000
  });
});
