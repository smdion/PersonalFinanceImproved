/**
 * Tests for computeTaxBucketAnalysis — the pure combining layer joining
 * the shared tax-bucket extraction, rothBasis rows, and the early-access
 * (Rule of 55 / Roth ordering) helper.
 */
import { describe, it, expect } from "vitest";
import { computeTaxBucketAnalysis } from "@/lib/pure/tax-bucket-analysis";
import { computeTaxBucketBreakdown } from "@/lib/pure/tax-buckets";
import type { TaxBucketSnapshotAccount } from "@/lib/pure/tax-buckets";

const people = [
  { id: 1, name: "Sean", birthYear: 1987 },
  { id: 2, name: "Joanna", birthYear: 1991 },
];

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

describe("computeTaxBucketAnalysis", () => {
  it("splits a joint Roth IRA into two independently-computed per-person entries", () => {
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
    const breakdown = computeTaxBucketBreakdown({ accounts }, people, []);

    const result = computeTaxBucketAnalysis({
      breakdown,
      performanceAccounts: [
        {
          id: 5,
          accountType: "ira",
          ownerPersonId: null, // joint at the performanceAccounts level
          isActive: true,
          separationDate: null,
          costBasis: 0,
          accountLabel: "IRA (Vanguard)",
          displayName: null,
          institution: "Vanguard",
        },
      ],
      jobLinks: [],
      rothBasisRows: [
        {
          performanceAccountId: 5,
          ownerPersonId: 1,
          contributionBasis: 40000,
          conversionBasis: 0,
          latestConversionYear: null,
          asOfDate: new Date("2026-01-01"),
        },
        {
          performanceAccountId: 5,
          ownerPersonId: 2,
          contributionBasis: 20000,
          conversionBasis: 0,
          latestConversionYear: null,
          asOfDate: new Date("2026-01-01"),
        },
      ],
      people,
      targetRetirementAgeByPerson: { 1: 55, 2: 55 },
      currentDate: new Date("2026-01-01"),
    });

    const sean = result.find((r) => r.ownerPersonId === 1)!;
    const joanna = result.find((r) => r.ownerPersonId === 2)!;
    expect(sean.balance).toBeCloseTo(188268.24, 2);
    expect(
      sean.slices.find((s) => s.label === "Contribution basis")?.amount,
    ).toBe(40000);
    expect(joanna.balance).toBeCloseTo(101817.45, 2);
    expect(
      joanna.slices.find((s) => s.label === "Contribution basis")?.amount,
    ).toBe(20000);
  });

  it("computes Brokerage's age-independent cost-basis split for a jointly-owned (null ownerPersonId) account, but never Rule of 55 (no owner/age to resolve)", () => {
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
    const breakdown = computeTaxBucketBreakdown({ accounts }, people, []);

    const result = computeTaxBucketAnalysis({
      breakdown,
      performanceAccounts: [
        {
          id: 6,
          accountType: "brokerage",
          ownerPersonId: null,
          isActive: true,
          separationDate: null,
          costBasis: 4942.56,
          accountLabel: "Long Term Brokerage (Vanguard)",
          displayName: null,
          institution: "Vanguard",
        },
      ],
      jobLinks: [],
      rothBasisRows: [],
      people,
      currentDate: new Date("2026-01-01"),
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.ownerPersonId).toBeNull();
    expect(result[0]!.costBasis).toBe(4942.56);
    expect(
      result[0]!.slices.find((s) => s.label === "Cost basis")?.amount,
    ).toBe(4942.56);
    expect(
      result[0]!.slices.find((s) => s.label === "Growth")?.amount,
    ).toBeCloseTo(7708.6 - 4942.56, 5);
    expect(result[0]!.ruleOf55).toBeNull();
    expect(result[0]!.ageThresholdStatus).toBeNull();
  });

  it("computes brokerage access from the per-account costBasis for an individually-owned account", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({
        institution: "UBS",
        accountType: "brokerage",
        taxType: "afterTax",
        subType: "ESPP",
        performanceAccountId: 8,
        ownerPersonId: 2,
        amount: 3979.81,
        accountLabel: "Joanna ESPP (UBS)",
      }),
    ];
    const breakdown = computeTaxBucketBreakdown({ accounts }, people, []);

    const result = computeTaxBucketAnalysis({
      breakdown,
      performanceAccounts: [
        {
          id: 8,
          accountType: "brokerage",
          ownerPersonId: 2,
          isActive: true,
          separationDate: null,
          costBasis: 1500,
          accountLabel: "Joanna ESPP (UBS)",
          displayName: null,
          institution: "UBS",
        },
      ],
      jobLinks: [],
      rothBasisRows: [],
      people,
      currentDate: new Date("2026-01-01"),
    });

    const entry = result[0]!;
    expect(entry.costBasis).toBe(1500);
    expect(entry.slices.find((s) => s.label === "Cost basis")?.amount).toBe(
      1500,
    );
    expect(entry.slices.find((s) => s.label === "Growth")?.amount).toBeCloseTo(
      3979.81 - 1500,
      2,
    );
  });

  it("shares one Rule-of-55 resolution between the preTax and taxFree slices of the same 401k, derived from a dormant former employer", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({
        performanceAccountId: 1,
        ownerPersonId: 1,
        taxType: "preTax",
        amount: 200000,
      }),
      account({
        performanceAccountId: 1,
        ownerPersonId: 1,
        taxType: "taxFree",
        amount: 90000,
      }),
    ];
    const breakdown = computeTaxBucketBreakdown({ accounts }, people, []);

    const result = computeTaxBucketAnalysis({
      breakdown,
      performanceAccounts: [
        {
          id: 1,
          accountType: "401k",
          ownerPersonId: 1,
          isActive: true,
          separationDate: null, // no explicit date — derive from job link
          costBasis: 0,
          accountLabel: "Sean 401k (Fidelity)",
          displayName: null,
          institution: "Fidelity",
        },
      ],
      // Dormant former employer: ended long ago, well past 55.
      jobLinks: [
        {
          performanceAccountId: 1,
          endDate: new Date("2043-01-01"), // Sean turns 56 in 2043
          isSpeculative: false,
        },
      ],
      rothBasisRows: [
        {
          performanceAccountId: 1,
          ownerPersonId: 1,
          contributionBasis: 30000,
          conversionBasis: 0,
          latestConversionYear: null,
          asOfDate: new Date("2026-01-01"),
        },
      ],
      people,
      targetRetirementAgeByPerson: { 1: 65 }, // target age irrelevant — real endDate wins
      currentDate: new Date("2050-01-01"), // long after separation — dormant plan
    });

    const preTax = result.find((r) => r.taxType === "preTax")!;
    const taxFree = result.find((r) => r.taxType === "taxFree")!;
    expect(preTax.ruleOf55?.eligible).toBe(true);
    expect(preTax.ruleOf55?.source).toBe("derived");
    expect(taxFree.ruleOf55?.eligible).toBe(true);
    // Both slices share the identical resolution — same separation year.
    expect(preTax.ruleOf55?.separationYear).toBe(
      taxFree.ruleOf55?.separationYear,
    );
    expect(preTax.slices[0]!.penaltyFree).toBe(true);
    expect(
      taxFree.slices.find((s) => s.label.startsWith("Basis"))?.penaltyFree,
    ).toBe(true);
  });

  it("marks Rule of 55 unknown when there's no separation data at all", () => {
    const accounts: TaxBucketSnapshotAccount[] = [
      account({ performanceAccountId: 1, ownerPersonId: 1, amount: 50000 }),
    ];
    const breakdown = computeTaxBucketBreakdown({ accounts }, people, []);

    const result = computeTaxBucketAnalysis({
      breakdown,
      performanceAccounts: [
        {
          id: 1,
          accountType: "401k",
          ownerPersonId: 1,
          isActive: true,
          separationDate: null,
          costBasis: 0,
          accountLabel: "Sean 401k (Fidelity)",
          displayName: null,
          institution: "Fidelity",
        },
      ],
      jobLinks: [], // no linked job at all
      rothBasisRows: [],
      people,
      currentDate: new Date("2026-01-01"),
    });

    expect(result[0]!.ruleOf55).toEqual({
      eligible: null,
      separationYear: null,
      source: "no_data",
      knownFutureSeparationYear: null,
    });
  });
});
