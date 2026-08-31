/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal slot/account fixtures without satisfying every unrelated field of the full engine types */
/**
 * Unit tests for the pure data-driven helpers in
 * src/components/cards/projection/utils.ts. Uses the real
 * @/lib/config/account-types module (as other pure-function tests in this
 * repo do, e.g. tests/calculators/balance-utils.test.ts) rather than mocking
 * it — these helpers are config-driven and their correctness depends on
 * real category/bucket wiring.
 */
import { describe, it, expect } from "vitest";
import {
  isAccumYear,
  itemTaxType,
  colKeyParts,
  colBalance,
  safeDivide,
  colWithdrawal,
  colEngineTaxType,
  slotBucketWithdrawal,
  slotBucketContrib,
  slotsColumnBalanceInflow,
  slotsBucketBalanceInflow,
  filterSpecsForBucket,
  iaBelongsToBucket,
  percentOf,
  proRateMonths,
  specFrac,
  matchFracOf,
  computeColumnChange,
  computeAccountSplits,
  filterYearByParentCategory,
  lumpSumTaxBucket,
  lumpSumsForBucket,
  lumpSumsForCategory,
  lumpSumTotal,
  ALL_CATEGORIES,
  catDisplayLabel,
  bucketSlotMap,
  formatDiscretionaryTierBreakdown,
} from "@/components/cards/projection/utils";
import { accountBalancesFromTaxBuckets } from "@/lib/calculators/engine/balance-utils";
import type { EngineYearProjection } from "@/lib/calculators/types";
import type { LumpSum } from "@/lib/calculators/types/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("ALL_CATEGORIES / catDisplayLabel", () => {
  it("includes the core account categories", () => {
    expect(ALL_CATEGORIES).toContain("401k");
    expect(ALL_CATEGORIES).toContain("ira");
    expect(ALL_CATEGORIES).toContain("hsa");
    expect(ALL_CATEGORIES).toContain("brokerage");
  });

  it("has a display label for every category", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(typeof catDisplayLabel[cat]).toBe("string");
      expect(catDisplayLabel[cat]!.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// isAccumYear
// ---------------------------------------------------------------------------

describe("isAccumYear", () => {
  it("returns true for accumulation-phase years", () => {
    expect(isAccumYear({ phase: "accumulation" } as EngineYearProjection)).toBe(
      true,
    );
  });

  it("returns false for decumulation-phase years", () => {
    expect(isAccumYear({ phase: "decumulation" } as EngineYearProjection)).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// itemTaxType
// ---------------------------------------------------------------------------

describe("itemTaxType", () => {
  it("returns undefined for categories that don't support a roth split", () => {
    expect(itemTaxType("brokerage", "roth")).toBeUndefined();
  });

  it("returns 'roth' for a roth-split category with a roth taxField", () => {
    expect(itemTaxType("401k", "roth")).toBe("roth");
    expect(itemTaxType("401k", "tax_free")).toBe("roth");
  });

  it("returns 'traditional' for a roth-split category with a non-roth taxField", () => {
    expect(itemTaxType("401k", "traditional")).toBe("traditional");
    expect(itemTaxType("401k", undefined)).toBe("traditional");
  });
});

// ---------------------------------------------------------------------------
// colKeyParts
// ---------------------------------------------------------------------------

describe("colKeyParts", () => {
  it("parses a plain category key with no treatment", () => {
    expect(colKeyParts("brokerage")).toEqual({
      category: "brokerage",
      treatment: null,
    });
  });

  it("parses a '_trad' suffix as traditional", () => {
    const result = colKeyParts("401k_trad");
    expect(result.category).toBe("401k");
    expect(result.treatment).toBe("traditional");
  });

  it("parses a '_roth' suffix as roth", () => {
    const result = colKeyParts("401k_roth");
    expect(result.category).toBe("401k");
    expect(result.treatment).toBe("roth");
  });
});

// ---------------------------------------------------------------------------
// colBalance
// ---------------------------------------------------------------------------

describe("colBalance", () => {
  it("returns the total balance for a plain (untreated) column key", () => {
    const ba = accountBalancesFromTaxBuckets({
      preTax: 0,
      taxFree: 0,
      hsa: 15000,
      afterTax: 0,
      afterTaxBasis: 0,
    });
    expect(colBalance(ba, "hsa")).toBe(15000);
  });

  it("returns 0 for a category with no balance entry at all (not just a zero-valued one)", () => {
    // accountBalancesFromTaxBuckets always populates every category (even
    // with a zero-valued structure), so it can't exercise the truly-missing
    // -key branch (`if (!bal) return 0`) — construct a partial object
    // directly to hit that branch specifically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally partial to omit the "hsa" key entirely
    const ba = {} as any;
    expect(colBalance(ba, "hsa")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// safeDivide
// ---------------------------------------------------------------------------

describe("safeDivide", () => {
  it("divides normally when the denominator is nonzero", () => {
    expect(safeDivide(10, 4)).toBe(2.5);
  });

  it("returns 0 when the denominator is exactly 0", () => {
    expect(safeDivide(10, 0)).toBe(0);
  });

  it("returns 0 for 0/0", () => {
    expect(safeDivide(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// colWithdrawal
// ---------------------------------------------------------------------------

describe("colWithdrawal", () => {
  const slots = [
    {
      category: "401k",
      withdrawal: 0,
      rothWithdrawal: 500,
      traditionalWithdrawal: 1000,
    },
    {
      category: "brokerage",
      withdrawal: 200,
      rothWithdrawal: 0,
      traditionalWithdrawal: 0,
    },
  ];

  it("sums the traditional withdrawal for a _trad column", () => {
    expect(colWithdrawal(slots, "401k_trad")).toBe(1000);
  });

  it("sums the roth withdrawal for a _roth column", () => {
    expect(colWithdrawal(slots, "401k_roth")).toBe(500);
  });

  it("sums the plain withdrawal for a single-bucket category", () => {
    expect(colWithdrawal(slots, "brokerage")).toBe(200);
  });

  it("returns 0 when no slot matches the category", () => {
    expect(colWithdrawal(slots, "ira_trad")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// colEngineTaxType
// ---------------------------------------------------------------------------

describe("colEngineTaxType", () => {
  it("maps a _roth column to taxFree", () => {
    expect(colEngineTaxType("401k_roth")).toBe("taxFree");
  });

  it("maps a _trad column to preTax", () => {
    expect(colEngineTaxType("401k_trad")).toBe("preTax");
  });

  it("maps a single-bucket category to its configured tax bucket key", () => {
    expect(colEngineTaxType("hsa")).toBe("hsa");
  });
});

// ---------------------------------------------------------------------------
// slotBucketWithdrawal / slotBucketContrib
// ---------------------------------------------------------------------------

describe("slotBucketWithdrawal", () => {
  it("returns the traditional withdrawal for the preTax bucket", () => {
    const slot = {
      category: "401k",
      withdrawal: 0,
      rothWithdrawal: 0,
      traditionalWithdrawal: 750,
    };
    expect(slotBucketWithdrawal(slot, "preTax")).toBe(750);
  });

  it("returns 0 for an unknown bucket", () => {
    const slot = {
      category: "401k",
      withdrawal: 0,
      rothWithdrawal: 0,
      traditionalWithdrawal: 750,
    };
    expect(slotBucketWithdrawal(slot, "not-a-real-bucket")).toBe(0);
  });

  it("returns 0 when the slot's category doesn't match the bucket's categoryFilter", () => {
    const slot = {
      category: "401k",
      withdrawal: 500,
      rothWithdrawal: 0,
      traditionalWithdrawal: 0,
    };
    // "hsa" bucket has categoryFilter "hsa" — a 401k slot doesn't match
    expect(slotBucketWithdrawal(slot, "hsa")).toBe(0);
  });
});

describe("slotBucketContrib", () => {
  it("returns the traditional contribution for the preTax bucket", () => {
    const slot = {
      category: "401k",
      traditionalContrib: 400,
      rothContrib: 100,
      employeeContrib: 500,
    };
    expect(slotBucketContrib(slot, "preTax")).toBe(400);
  });

  it("returns 0 for single-bucket categories on preTax/taxFree buckets", () => {
    const slot = {
      category: "hsa",
      traditionalContrib: 0,
      rothContrib: 0,
      employeeContrib: 300,
    };
    expect(slotBucketContrib(slot, "preTax")).toBe(0);
  });

  it("returns the employee contribution for a single-bucket category's own bucket", () => {
    const slot = {
      category: "hsa",
      traditionalContrib: 0,
      rothContrib: 0,
      employeeContrib: 300,
    };
    expect(slotBucketContrib(slot, "hsa")).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// slotsColumnBalanceInflow / slotsBucketBalanceInflow
// ---------------------------------------------------------------------------

describe("slotsColumnBalanceInflow", () => {
  const slots = [
    {
      category: "401k",
      traditionalContrib: 500,
      rothContrib: 200,
      employeeContrib: 700,
      employerMatch: 100,
    },
  ] as unknown as Parameters<typeof slotsColumnBalanceInflow>[0];

  it("includes employer match for the traditional column", () => {
    expect(slotsColumnBalanceInflow(slots, "401k_trad")).toBe(600);
  });

  it("excludes employer match for the roth column (match flows to preTax)", () => {
    expect(slotsColumnBalanceInflow(slots, "401k_roth")).toBe(200);
  });

  it("returns 0 when no slot matches the category", () => {
    expect(slotsColumnBalanceInflow(slots, "ira_trad")).toBe(0);
  });
});

describe("slotsBucketBalanceInflow", () => {
  it("routes all employer match to the preTax bucket for roth_traditional categories", () => {
    const slots = [
      {
        category: "401k",
        traditionalContrib: 500,
        rothContrib: 200,
        employeeContrib: 700,
        employerMatch: 100,
      },
    ] as unknown as Parameters<typeof slotsBucketBalanceInflow>[0];
    expect(slotsBucketBalanceInflow(slots, "preTax")).toBe(600);
    expect(slotsBucketBalanceInflow(slots, "taxFree")).toBe(200);
  });

  it("routes employee + match to a single-bucket category's own bucket", () => {
    const slots = [
      {
        category: "hsa",
        traditionalContrib: 0,
        rothContrib: 0,
        employeeContrib: 300,
        employerMatch: 50,
      },
    ] as unknown as Parameters<typeof slotsBucketBalanceInflow>[0];
    expect(slotsBucketBalanceInflow(slots, "hsa")).toBe(350);
  });
});

// ---------------------------------------------------------------------------
// filterSpecsForBucket / iaBelongsToBucket
// ---------------------------------------------------------------------------

describe("filterSpecsForBucket", () => {
  it("filters specs to only the matching category for a category-filtered bucket", () => {
    const specs = [
      { category: "hsa", taxTreatment: "hsa" },
      { category: "401k", taxTreatment: "pre_tax" },
    ];
    expect(filterSpecsForBucket(specs, "hsa")).toEqual([
      { category: "hsa", taxTreatment: "hsa" },
    ]);
  });

  it("excludes single-bucket categories from preTax/taxFree bucket filtering", () => {
    const specs = [
      { category: "hsa", taxTreatment: "hsa" },
      { category: "401k", taxTreatment: "pre_tax" },
    ];
    const result = filterSpecsForBucket(specs, "preTax");
    expect(result.map((s) => s.category)).toEqual(["401k"]);
  });
});

describe("iaBelongsToBucket", () => {
  it("returns true when taxType matches the bucket name", () => {
    expect(iaBelongsToBucket({ taxType: "hsa" }, "hsa")).toBe(true);
  });

  it("returns false when taxType doesn't match", () => {
    expect(iaBelongsToBucket({ taxType: "preTax" }, "hsa")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// percentOf / proRateMonths
// ---------------------------------------------------------------------------

describe("percentOf", () => {
  it("computes a rounded percentage", () => {
    expect(percentOf(25, 100)).toBe(25);
    expect(percentOf(1, 3)).toBe(33);
  });

  it("returns 0 when total is 0", () => {
    expect(percentOf(10, 0)).toBe(0);
  });
});

describe("proRateMonths", () => {
  it("rounds a fraction of the year to whole months", () => {
    expect(proRateMonths(0.5)).toBe(6);
    expect(proRateMonths(1)).toBe(12);
    expect(proRateMonths(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// specFrac / matchFracOf
// ---------------------------------------------------------------------------

describe("specFrac", () => {
  it("divides baseAnnual by specTotal when specTotal > 0", () => {
    expect(specFrac({ baseAnnual: 25, specTotal: 100, specCount: 4 })).toBe(
      0.25,
    );
  });

  it("falls back to 1/specCount when specTotal is 0 but specCount > 0", () => {
    expect(specFrac({ baseAnnual: 0, specTotal: 0, specCount: 4 })).toBe(0.25);
  });

  it("falls back to 1 when both specTotal and specCount are 0", () => {
    expect(specFrac({ baseAnnual: 0, specTotal: 0, specCount: 0 })).toBe(1);
  });
});

describe("matchFracOf", () => {
  it("divides matchAnnual by allMatchAnnual", () => {
    expect(matchFracOf({ matchAnnual: 25, allMatchAnnual: 100 })).toBe(0.25);
  });

  it("returns 0 when allMatchAnnual is 0", () => {
    expect(matchFracOf({ matchAnnual: 25, allMatchAnnual: 0 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeColumnChange
// ---------------------------------------------------------------------------

describe("computeColumnChange", () => {
  const identityDeflate = (v: number) => v;

  it("computes displayChange as contrib + growth when there is no prior year", () => {
    const result = computeColumnChange({
      deflate: identityDeflate,
      bal: 10000,
      year: 2026,
      prev: null,
      splitContrib: 1000,
      splitGrowth: 500,
    });
    expect(result.displayChange).toBe(1500);
    expect(result.displayContrib).toBe(1000);
    expect(result.displayGrowth).toBe(500);
    expect(result.boyBal).toBe(8500);
  });

  it("computes displayChange as the balance delta when there is a prior year", () => {
    const result = computeColumnChange({
      deflate: identityDeflate,
      bal: 12000,
      year: 2027,
      prev: { bal: 10000, year: 2026 },
      splitContrib: 1500,
      splitGrowth: 500,
    });
    expect(result.displayChange).toBe(2000);
    expect(result.boyBal).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// computeAccountSplits
// ---------------------------------------------------------------------------

describe("computeAccountSplits", () => {
  it("aggregates contribution/growth totals and dedupes by name+category+taxType", () => {
    const accounts = [
      {
        name: "My 401k",
        category: "401k",
        taxType: "preTax",
        balance: 10000,
        contribution: 500,
        employerMatch: 100,
        growth: 50,
      },
      {
        name: "My 401k",
        category: "401k",
        taxType: "preTax",
        balance: 10000,
        contribution: 500,
        employerMatch: 100,
        growth: 50,
      },
    ] as unknown as Parameters<typeof computeAccountSplits>[0];
    const result = computeAccountSplits(accounts);
    expect(result.splits).toHaveLength(1);
    expect(result.splits[0]!.contribution).toBe(600);
    expect(result.splitContrib).toBe(600);
    expect(result.splitGrowth).toBe(50);
  });

  it("excludes zero-balance, zero-contribution, zero-growth accounts", () => {
    const accounts = [
      {
        name: "Empty",
        category: "brokerage",
        taxType: "afterTax",
        balance: 0,
        contribution: 0,
        employerMatch: 0,
        growth: 0,
      },
    ] as unknown as Parameters<typeof computeAccountSplits>[0];
    const result = computeAccountSplits(accounts);
    expect(result.splits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filterYearByParentCategory
// ---------------------------------------------------------------------------

describe("filterYearByParentCategory", () => {
  function makeYear(): EngineYearProjection {
    return {
      year: 2026,
      age: 40,
      phase: "accumulation",
      individualAccountBalances: [
        {
          name: "401k A",
          category: "401k",
          taxType: "preTax",
          parentCategory: "Retirement",
          balance: 10000,
          contribution: 0,
          employerMatch: 0,
          growth: 0,
          ownerPersonId: 1,
          ownerName: "Alice",
        },
        {
          name: "Brokerage A",
          category: "brokerage",
          taxType: "afterTax",
          parentCategory: "Portfolio",
          balance: 5000,
          contribution: 0,
          employerMatch: 0,
          growth: 0,
          ownerPersonId: 1,
          ownerName: "Alice",
        },
      ],
      balanceByTaxType: {
        preTax: 10000,
        taxFree: 0,
        hsa: 0,
        afterTax: 5000,
        afterTaxBasis: 3000,
      },
      balanceByAccount: accountBalancesFromTaxBuckets({
        preTax: 10000,
        taxFree: 0,
        hsa: 0,
        afterTax: 5000,
        afterTaxBasis: 3000,
      }),
      endBalance: 15000,
    } as unknown as EngineYearProjection;
  }

  it("filters individualAccountBalances to only the matching parentCategory", () => {
    const result = filterYearByParentCategory(makeYear(), "Retirement");
    expect(result.individualAccountBalances).toHaveLength(1);
    expect(result.individualAccountBalances[0]!.category).toBe("401k");
  });

  it("recomputes balanceByTaxType from the filtered accounts", () => {
    const result = filterYearByParentCategory(makeYear(), "Retirement");
    expect(result.balanceByTaxType.preTax).toBe(10000);
    expect(result.balanceByTaxType.afterTax).toBe(0);
  });

  it("recomputes endBalance to match the filtered totals", () => {
    const result = filterYearByParentCategory(makeYear(), "Retirement");
    expect(result.endBalance).toBe(10000);
  });

  it("does not mutate the original year object", () => {
    const original = makeYear();
    const originalLen = original.individualAccountBalances.length;
    filterYearByParentCategory(original, "Retirement");
    expect(original.individualAccountBalances).toHaveLength(originalLen);
  });

  it("is a no-op when there's no individual-account data to filter by (MC Simple tax mode, live-user finding 2026-08-28)", () => {
    // The Retirement page hardcodes parentCategoryFilter="Retirement" on
    // every load (retirement-content.tsx), so this function runs on every
    // household's every view. When a Simple-tax-mode MC scenario (e.g.
    // Rate-Seeded) supplies a year with individualAccountBalances=[] (no
    // per-account structure left after the collapse), filtering "down to
    // the accounts matching this parent category" must not zero out
    // endBalance/balanceByTaxType for accounts it can't see at all --
    // that's what caused every balance in the table to silently render
    // $0.00 while Sim. Median (a different, unaffected field) stayed
    // healthy.
    const yr = { ...makeYear(), individualAccountBalances: [] };
    const result = filterYearByParentCategory(yr, "Retirement");
    expect(result).toBe(yr);
    expect(result.endBalance).toBe(15000);
    expect(result.balanceByTaxType.afterTax).toBe(5000);
  });

  // Regression coverage for the "balance says $32k, withdrawal says $30k+"
  // report: a decumulation year where most of a category's withdrawal came
  // from a Portfolio-parented account must not leak into the Retirement-
  // filtered slots/totals, or the filtered balance and filtered withdrawal
  // describe two different pools of money.
  function makeDecumYear(): EngineYearProjection {
    return {
      year: 2077,
      age: 88,
      phase: "decumulation",
      individualAccountBalances: [
        {
          name: "Retirement Brokerage (Vanguard)",
          category: "brokerage",
          taxType: "afterTax",
          parentCategory: "Retirement",
          balance: 141113.51,
          withdrawal: 14466.75,
          contribution: 0,
          employerMatch: 0,
          growth: 7356.63,
        },
        {
          name: "Long Term Brokerage (Vanguard)",
          category: "brokerage",
          taxType: "afterTax",
          parentCategory: "Portfolio",
          balance: 1540684.43,
          withdrawal: 157948.73,
          contribution: 31297.79,
          employerMatch: 0,
          growth: 80320.04,
        },
      ],
      balanceByTaxType: {
        preTax: 0,
        taxFree: 0,
        hsa: 0,
        afterTax: 1681797.94,
        afterTaxBasis: 117901.77,
      },
      balanceByAccount: accountBalancesFromTaxBuckets({
        preTax: 0,
        taxFree: 0,
        hsa: 0,
        afterTax: 1681797.94,
        afterTaxBasis: 117901.77,
      }),
      endBalance: 1681797.94,
      slots: [
        {
          category: "brokerage",
          withdrawal: 177209.74,
          rothWithdrawal: 0,
          traditionalWithdrawal: 0,
          cappedByAccount: false,
          cappedByTaxType: false,
          remainingNeed: 0,
          basisPortion: 12751.91,
          gainsPortion: 164457.83,
        },
      ],
      totalWithdrawal: 177209.74,
      totalTraditionalWithdrawal: 0,
      totalRothWithdrawal: 0,
      // Household-wide figures the withdrawal total is compared against
      // (advisor review, 2026-08-29 -- see the two new tests below).
      targetWithdrawal: 200000,
      taxCost: 20000,
      projectedExpenses: 150000,
      rmdAmount: 50000,
    } as unknown as EngineYearProjection;
  }

  it("rescopes decumulation withdrawal slots to the filtered accounts", () => {
    const result = filterYearByParentCategory(makeDecumYear(), "Retirement");
    if (result.phase !== "decumulation")
      throw new Error("expected decumulation");
    const brokSlot = result.slots.find((s) => s.category === "brokerage")!;
    // Only the Retirement-parented account's $14,466.75 — not the
    // Portfolio-parented account's $157,948.73 — should remain.
    expect(brokSlot.withdrawal).toBeCloseTo(14466.75, 2);
    expect(result.totalWithdrawal).toBeCloseTo(14466.75, 2);
  });

  it("keeps the filtered withdrawal consistent with the filtered balance", () => {
    const result = filterYearByParentCategory(makeDecumYear(), "Retirement");
    if (result.phase !== "decumulation")
      throw new Error("expected decumulation");
    const brokSlot = result.slots.find((s) => s.category === "brokerage")!;
    // The filtered balance ($141,113.51) must exceed what the filtered
    // withdrawal took out of it this year — the original bug had the
    // withdrawal (unfiltered, $177,209.74) exceed the filtered balance.
    expect(brokSlot.withdrawal).toBeLessThan(result.balanceByTaxType.afterTax);
  });

  it("prorates basis/gains portions by the same withdrawal ratio", () => {
    const result = filterYearByParentCategory(makeDecumYear(), "Retirement");
    if (result.phase !== "decumulation")
      throw new Error("expected decumulation");
    const brokSlot = result.slots.find((s) => s.category === "brokerage")!;
    const ratio = 14466.75 / 177209.74;
    expect(brokSlot.basisPortion).toBeCloseTo(12751.91 * ratio, 1);
    expect(brokSlot.gainsPortion).toBeCloseTo(164457.83 * ratio, 1);
  });

  // Advisor review, 2026-08-29: targetWithdrawal/taxCost were previously
  // left at their household-wide values while totalWithdrawal was
  // Retirement-scoped -- a fully-funded plan could compare as
  // "underfunded" purely because the comparison basis (targetWithdrawal)
  // never shrank to match. Both must scale by the SAME ratio as the
  // withdrawal itself.
  it("rescopes targetWithdrawal and taxCost by the same ratio as totalWithdrawal", () => {
    const result = filterYearByParentCategory(makeDecumYear(), "Retirement");
    if (result.phase !== "decumulation")
      throw new Error("expected decumulation");
    const ratio = 14466.75 / 177209.74;
    expect(result.targetWithdrawal).toBeCloseTo(200000 * ratio, 1);
    expect(result.taxCost).toBeCloseTo(20000 * ratio, 1);
    // The whole point: filtered totalWithdrawal no longer reads as
    // "underfunded" against its own (also filtered) target.
    expect(result.totalWithdrawal).toBeGreaterThanOrEqual(
      result.targetWithdrawal * 0.75,
    );
  });

  it("leaves projectedExpenses and rmdAmount at their real household-wide values", () => {
    const result = filterYearByParentCategory(makeDecumYear(), "Retirement");
    if (result.phase !== "decumulation")
      throw new Error("expected decumulation");
    // RMD is a real IRS obligation on the FULL Traditional balance
    // regardless of account grouping, and projectedExpenses is the
    // household's real stated spending need -- neither should shrink just
    // because this page's display happens to be scoped to a subset of
    // accounts.
    expect(result.projectedExpenses).toBe(150000);
    expect(result.rmdAmount).toBe(50000);
  });
});

// ---------------------------------------------------------------------------
// Lump sum helpers
// ---------------------------------------------------------------------------

describe("lumpSumTaxBucket", () => {
  it("returns taxFree for a roth-taxType lump sum targeting a roth_traditional account", () => {
    const ls: LumpSum = {
      amount: 1000,
      targetAccount: "401k",
      taxType: "roth",
    };
    expect(lumpSumTaxBucket(ls)).toBe("taxFree");
  });

  it("returns preTax for a traditional-taxType lump sum targeting a roth_traditional account", () => {
    const ls: LumpSum = {
      amount: 1000,
      targetAccount: "401k",
      taxType: "traditional",
    };
    expect(lumpSumTaxBucket(ls)).toBe("preTax");
  });

  it("returns hsa for a single_bucket hsa lump sum", () => {
    const ls: LumpSum = { amount: 1000, targetAccount: "hsa" };
    expect(lumpSumTaxBucket(ls)).toBe("hsa");
  });

  it("returns afterTax for a basis_tracking brokerage lump sum", () => {
    const ls: LumpSum = { amount: 1000, targetAccount: "brokerage" };
    expect(lumpSumTaxBucket(ls)).toBe("afterTax");
  });
});

describe("lumpSumsForBucket / lumpSumsForCategory / lumpSumTotal", () => {
  const lumpSums: LumpSum[] = [
    { amount: 1000, targetAccount: "401k", taxType: "traditional" },
    { amount: 500, targetAccount: "401k", taxType: "roth" },
    { amount: 2000, targetAccount: "brokerage" },
  ];

  it("filters lump sums by resolved tax bucket", () => {
    expect(lumpSumsForBucket(lumpSums, "preTax")).toHaveLength(1);
    expect(lumpSumsForBucket(lumpSums, "taxFree")).toHaveLength(1);
    expect(lumpSumsForBucket(lumpSums, "afterTax")).toHaveLength(1);
  });

  it("filters lump sums by target account category", () => {
    expect(lumpSumsForCategory(lumpSums, "401k")).toHaveLength(2);
    expect(lumpSumsForCategory(lumpSums, "brokerage")).toHaveLength(1);
  });

  it("sums the total lump sum amount", () => {
    expect(lumpSumTotal(lumpSums)).toBe(3500);
  });

  it("sums to 0 for an empty list", () => {
    expect(lumpSumTotal([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// bucketSlotMap sanity (data-driven table shape)
// ---------------------------------------------------------------------------

describe("bucketSlotMap", () => {
  it("has entries for preTax and taxFree", () => {
    expect(bucketSlotMap.preTax).toBeDefined();
    expect(bucketSlotMap.taxFree).toBeDefined();
  });

  it("has an entry for every single-bucket category's tax bucket key", () => {
    // hsa is a known single-bucket category
    expect(bucketSlotMap.hsa).toBeDefined();
    expect(bucketSlotMap.hsa!.categoryFilter).toBe("hsa");
  });
});

// ---------------------------------------------------------------------------
// formatDiscretionaryTierBreakdown — "why was this account used" tooltips
// ---------------------------------------------------------------------------

describe("formatDiscretionaryTierBreakdown", () => {
  it("returns undefined for an empty/missing breakdown", () => {
    expect(formatDiscretionaryTierBreakdown(undefined)).toBeUndefined();
    expect(formatDiscretionaryTierBreakdown([])).toBeUndefined();
  });

  it("labels a 0%-cost tier as 'cheapest available', not free/0% (avoids clashing with a 'taxable' note shown alongside it)", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "brokerage", costRate: 0, amount: 5000 },
    ]);
    expect(result).toContain("cheapest available");
    expect(result).not.toContain("free");
    expect(result).not.toContain("0.0%");
  });

  it("formats a priced tier's rate as a percentage", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "brokerage", costRate: 0.188, amount: 3000 },
    ]);
    expect(result).toContain("18.8%");
  });

  it("joins multiple tiers in draw order with an arrow", () => {
    const result = formatDiscretionaryTierBreakdown([
      { source: "brokerage", costRate: 0, amount: 74100 },
      { source: "roth", costRate: 0, amount: 20000 },
      { source: "brokerage", costRate: 0.15, amount: 15000 },
    ])!;
    const brokerageFreeIdx = result.indexOf("Brokerage (cheapest available)");
    const rothFreeIdx = result.indexOf("Roth (cheapest available)");
    const brokeragePricedIdx = result.indexOf("Brokerage (15.0% marginal tax)");
    expect(brokerageFreeIdx).toBeGreaterThanOrEqual(0);
    expect(rothFreeIdx).toBeGreaterThan(brokerageFreeIdx);
    expect(brokeragePricedIdx).toBeGreaterThan(rothFreeIdx);
  });
});
