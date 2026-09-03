/**
 * Tests for computeTaxBucketBreakdown — extracted from
 * build-engine-payload.ts so the Retirement engine and the Tax Buckets
 * analysis tool share one bucket-aggregation implementation.
 */
import { describe, it, expect } from "vitest";
import {
  computeTaxBucketBreakdown,
  type TaxBucketSnapshotAccount,
} from "@/lib/pure/tax-buckets";

const people = [
  { id: 1, name: "Sean" },
  { id: 2, name: "Joanna" },
];

// Shaped after real household data verified live this session: a 401k with
// preTax rows split across Rollover/Employer Match sub-types plus a Roth
// (taxFree) sub-election in the same account, a joint Roth IRA split into
// two owner-scoped rows, and a jointly-owned (null ownerPersonId) brokerage.
function account(
  overrides: Partial<TaxBucketSnapshotAccount>,
): TaxBucketSnapshotAccount {
  return {
    institution: "Fidelity",
    taxType: "preTax",
    accountType: "401k",
    subType: null,
    label: null,
    parentCategory: "Retirement",
    amount: 0,
    ownerPersonId: 1,
    performanceAccountId: 1,
    displayName: null,
    accountLabel: "Sean 401k (Fidelity)",
    ...overrides,
  };
}

describe("computeTaxBucketBreakdown", () => {
  it("sums preTax sub-type rows and the Roth sub-election into the right buckets", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({ amount: 595.46 }),
      account({ subType: "Rollover", amount: 92769.74 }),
      account({ subType: "Employer Match", amount: 24327.08 }),
      account({ taxType: "taxFree", amount: 92992.68 }),
    ];
    const result = computeTaxBucketBreakdown({ accounts }, people, []);

    expect(result.portfolioByTaxType.preTax).toBeCloseTo(
      595.46 + 92769.74 + 24327.08,
      2,
    );
    expect(result.portfolioByTaxType.taxFree).toBeCloseTo(92992.68, 2);
    // Sub-type rows merge under the parent's category in the breakdown, same
    // display-name-based merge as before extraction.
    expect(result.accountBreakdownByCategory["401k"]).toHaveLength(2); // one preTax entry (3 rows merged), one taxFree entry
  });

  it("splits a joint Roth IRA into two owner-scoped rollup entries", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({
        institution: "Vanguard",
        accountType: "ira",
        taxType: "taxFree",
        performanceAccountId: 5,
        ownerPersonId: 1,
        amount: 188268.24,
        accountLabel: "IRA (Vanguard)",
      }),
      account({
        institution: "Vanguard",
        accountType: "ira",
        taxType: "taxFree",
        performanceAccountId: 5,
        ownerPersonId: 2,
        amount: 101817.45,
        accountLabel: "IRA (Vanguard)",
      }),
    ];
    const result = computeTaxBucketBreakdown({ accounts }, people, []);

    expect(result.portfolioByTaxType.taxFree).toBeCloseTo(290085.69, 2);
    const rollup = result.accountRollup;
    expect(rollup).toHaveLength(2);
    const sean = rollup.find((r) => r.ownerPersonId === 1)!;
    const joanna = rollup.find((r) => r.ownerPersonId === 2)!;
    expect(sean.amount).toBeCloseTo(188268.24, 2);
    expect(sean.performanceAccountId).toBe(5);
    expect(joanna.amount).toBeCloseTo(101817.45, 2);

    // accountBreakdownByCategory used to merge on (name, taxType) only, so
    // these two identically-labeled
    // "IRA (Vanguard)" rows from different owners collapsed into ONE entry,
    // silently keeping only Sean's ownerPersonId — this feeds
    // build-engine-payload.ts's individualAccounts directly (the engine's
    // per-owner eligibility data), so a wrong owner here means Rule of 55 /
    // 59½ gating resolves the wrong person's access for Joanna's half of the
    // money. Owner is now part of the merge key: two separate entries.
    const breakdown = result.accountBreakdownByCategory["ira"];
    expect(breakdown).toHaveLength(2);
    const seanEntry = breakdown!.find((e) => e.ownerPersonId === 1)!;
    const joannaEntry = breakdown!.find((e) => e.ownerPersonId === 2)!;
    expect(seanEntry.amount).toBeCloseTo(188268.24, 2);
    expect(joannaEntry.amount).toBeCloseTo(101817.45, 2);
  });

  it("keeps a jointly-owned (null ownerPersonId) account in the rollup without a person attribution", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({
        institution: "Vanguard",
        accountType: "brokerage",
        taxType: "afterTax",
        performanceAccountId: 6,
        ownerPersonId: null,
        amount: 7708.6,
        accountLabel: "Long Term Brokerage (Vanguard)",
      }),
    ];
    const result = computeTaxBucketBreakdown({ accounts }, people, []);

    expect(result.portfolioByTaxType.afterTax).toBeCloseTo(7708.6, 2);
    expect(result.accountRollup).toHaveLength(1);
    expect(result.accountRollup[0]!.ownerPersonId).toBeNull();
    // Joint balance still attributed to both people equally for ownership fractions.
    expect(result.ownershipByPerson.Sean?.brokerage).toBeCloseTo(0.5, 5);
    expect(result.ownershipByPerson.Joanna?.brokerage).toBeCloseTo(0.5, 5);
  });

  it("fills afterTaxBasis from active performance accounts that track cost basis", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({
        accountType: "brokerage",
        taxType: "afterTax",
        performanceAccountId: 7,
        amount: 12009.11,
      }),
    ];
    const perfAccounts = [
      { isActive: true, accountType: "brokerage", costBasis: "5177.68" },
      // Inactive accounts don't count toward basis.
      { isActive: false, accountType: "brokerage", costBasis: "999" },
      // Non-basis-tracking category doesn't count either.
      { isActive: true, accountType: "401k", costBasis: "111" },
    ];
    const result = computeTaxBucketBreakdown(
      { accounts },
      people,
      perfAccounts,
    );

    expect(result.portfolioByTaxType.afterTaxBasis).toBeCloseTo(5177.68, 2);
    expect(result.portfolioByAccount.brokerage.structure).toBe(
      "basis_tracking",
    );
  });

  it("excludes accounts outside the engine-relevant parentCategory set", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({ amount: 1000, parentCategory: "SomeOtherCategory" }),
    ];
    const result = computeTaxBucketBreakdown({ accounts }, people, []);
    expect(result.portfolioByTaxType.preTax).toBe(0);
  });

  it("returns all-zero buckets for a null snapshot", () => {
    const result = computeTaxBucketBreakdown(null, people, []);
    expect(result.portfolioByTaxType).toEqual({
      preTax: 0,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    });
    expect(result.accountRollup).toEqual([]);
  });
});
