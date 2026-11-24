import { describe, it, expect } from "vitest";
import type { TaxBucketSnapshotAccount } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import {
  unknownTypeNote,
  unknownTypeRows,
} from "@/lib/pure/accounts/tax-buckets/unknown-type-rows";

const people = [{ id: 1, name: "Alex" }];

const row = (
  portfolioAccountId: number,
  overrides: Partial<TaxBucketSnapshotAccount>,
): TaxBucketSnapshotAccount => ({
  portfolioAccountId,
  institution: "Fidelity",
  taxType: "preTax",
  accountType: "401k",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  amount: 0,
  ownerPersonId: 1,
  performanceAccountId: portfolioAccountId,
  displayName: null,
  accountLabel: null,
  ...overrides,
});

describe("unknownTypeRows", () => {
  it("names each projected row whose category this version doesn't know", () => {
    const rows = [
      row(1, { amount: 1000 }),
      row(2, { amount: 500, accountType: "future_type", displayName: "Plan" }),
      // A sub-type row counts under its primary row's type.
      row(3, { amount: 70, subType: "Rollover", performanceAccountId: 2 }),
      row(4, {
        amount: 9,
        subType: "Rollover",
        accountType: "future_type",
        performanceAccountId: 1,
      }),
      // Not projected at all (a Cash parent), so not named.
      row(5, {
        amount: 40,
        accountType: "future_type",
        parentCategory: "Cash",
      }),
    ];
    expect(unknownTypeRows(rows, people)).toEqual([
      {
        portfolioAccountId: 2,
        name: "Plan",
        accountType: "future_type",
        amount: 500,
      },
      {
        portfolioAccountId: 3,
        name: expect.any(String),
        accountType: "future_type",
        amount: 70,
      },
    ]);
  });

  it("names none when every type is known", () => {
    expect(unknownTypeRows([row(1, { amount: 10 })], people)).toEqual([]);
  });
});

describe("unknownTypeNote", () => {
  it("names the row, its stored type and its amount", () => {
    expect(
      unknownTypeNote({
        portfolioAccountId: 2,
        name: "Plan",
        accountType: "future_type",
        amount: 40000,
      }),
    ).toBe(
      'Plan is saved as account type "future_type", which this version doesn\'t know, so the projection and Tax Buckets leave out its $40,000. Update Ledgr or change its account type.',
    );
  });
});
