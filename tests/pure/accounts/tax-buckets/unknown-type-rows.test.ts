import { describe, it, expect } from "vitest";
import type { TaxBucketSnapshotAccount } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import {
  contributionsByType,
  deletedRowUnknownTypeNotes,
  knownCategoryList,
  knownCategoryRecord,
  unknownCategoryNote,
  unknownLumpSumTargetNotes,
  unknownTargetEventNotes,
  unknownTypeContributionNote,
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

describe("contributionsByType", () => {
  it("splits contribution accounts by whether their type is known, in order", () => {
    const rows = [
      { id: 1, accountType: "401k" },
      { id: 2, accountType: "future_type" },
      { id: 3, accountType: "ira" },
    ];
    const { known, unknown } = contributionsByType(rows);
    expect(known.map((r) => r.id)).toEqual([1, 3]);
    expect(unknown.map((r) => r.id)).toEqual([2]);
  });

  it("notes a left-out account's contributions", () => {
    expect(unknownTypeContributionNote("Plan", "future_type")).toBe(
      'Plan is saved as account type "future_type", which this version doesn\'t know, so its contributions are left out. Update Ledgr to a version that knows this type.',
    );
  });
});

describe("knownCategoryList", () => {
  it("keeps the known categories in order and names the rest as stored", () => {
    expect(knownCategoryList(["future_type", "401k", 7, "ira"])).toEqual({
      known: ["401k", "ira"],
      unknown: ["future_type", "7"],
    });
  });

  it("names none when every category is known", () => {
    expect(knownCategoryList(["hsa"])).toEqual({ known: ["hsa"], unknown: [] });
  });
});

describe("knownCategoryRecord", () => {
  it("keeps each known key's value and names the other keys", () => {
    expect(
      knownCategoryRecord({ future_type: 0.3, "401k": 0.7, ira: 0 }),
    ).toEqual({ known: { "401k": 0.7, ira: 0 }, unknown: ["future_type"] });
  });
});

describe("unknown category notes", () => {
  it("names the category and the setting it is left out of", () => {
    expect(unknownCategoryNote("future_type", "withdrawalOrder")).toBe(
      'Account type "future_type", which this version doesn\'t know, is left out of the saved withdrawal order. Update Ledgr or change that setting.',
    );
    expect(unknownCategoryNote("future_type", "withdrawalSplits")).toBe(
      'Account type "future_type", which this version doesn\'t know, is left out of the saved withdrawal splits. Update Ledgr or change that setting.',
    );
    expect(unknownCategoryNote("future_type", { changesByYear: "2040" })).toBe(
      'Account type "future_type", which this version doesn\'t know, is left out of Changes by year for 2040. Update Ledgr or change that setting.',
    );
  });
});

describe("unknownLumpSumTargetNotes", () => {
  const lump = (year: string, amount: unknown, category = "future_type") => ({
    year,
    target: "accountType" as const,
    category,
    amount,
  });

  it("names a parent category apart from an account type of the same name", () => {
    expect(
      unknownLumpSumTargetNotes([
        {
          year: "2040",
          target: "parentCategory",
          category: "Future",
          amount: 40,
        },
        lump("2040", 5, "Future"),
      ]),
    ).toEqual([
      'A lump sum of $40 in Changes by year for 2040 goes to parent category "Future", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
      'A lump sum of $5 in Changes by year for 2040 goes to account type "Future", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
    ]);
  });

  it("names a left-out lump sum's amount, year and target", () => {
    expect(unknownLumpSumTargetNotes([lump("2040", 5000.4)])).toEqual([
      'A lump sum of $5,000 in Changes by year for 2040 goes to account type "future_type", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
    ]);
  });

  it("counts and sums equal lump sums to one target in one year", () => {
    expect(
      unknownLumpSumTargetNotes([
        lump("2040", 5000),
        lump("2041", 5000),
        lump("2040", 5000),
        lump("2040", 7, "other_type"),
      ]),
    ).toEqual([
      '2 lump sums totalling $10,000 in Changes by year for 2040 go to account type "future_type", which this version doesn\'t know, so the projection leaves them out. Update Ledgr or change those lump sums.',
      'A lump sum of $5,000 in Changes by year for 2041 goes to account type "future_type", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
      'A lump sum of $7 in Changes by year for 2040 goes to account type "other_type", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
    ]);
  });

  it("states no amount when one isn't stored as a number, and $0 when it is 0", () => {
    expect(
      unknownLumpSumTargetNotes([
        lump("2040", undefined),
        lump("2041", "5000"),
        lump("2041", 10),
        lump("2042", 0),
      ]),
    ).toEqual([
      'A lump sum in Changes by year for 2040 goes to account type "future_type", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
      '2 lump sums in Changes by year for 2041 go to account type "future_type", which this version doesn\'t know, so the projection leaves them out. Update Ledgr or change those lump sums.',
      'A lump sum of $0 in Changes by year for 2042 goes to account type "future_type", which this version doesn\'t know, so the projection leaves it out. Update Ledgr or change that lump sum.',
    ]);
  });
});

describe("deletedRowUnknownTypeNotes", () => {
  it("names each account type once, then the lump sums counted and summed", () => {
    expect(
      deletedRowUnknownTypeNotes(
        "2040",
        ["future_type", "future_type", "other_type"],
        [
          {
            year: "2040",
            target: "accountType",
            category: "future_type",
            amount: 5000,
          },
          {
            year: "2040",
            target: "accountType",
            category: "future_type",
            amount: 5000,
          },
          {
            year: "2040",
            target: "parentCategory",
            category: "Future",
            amount: "?",
          },
        ],
      ),
    ).toEqual([
      'Deleting Changes by year for 2040 also deleted what it set for account type "future_type", which this version doesn\'t know.',
      'Deleting Changes by year for 2040 also deleted what it set for account type "other_type", which this version doesn\'t know.',
      'Deleting Changes by year for 2040 also deleted its 2 lump sums totalling $10,000 to account type "future_type", which this version doesn\'t know.',
      'Deleting Changes by year for 2040 also deleted its lump sum to parent category "Future", which this version doesn\'t know.',
    ]);
  });
});

describe("unknownTargetEventNotes", () => {
  it("groups a year's events to one type, a withdrawal shown below zero", () => {
    expect(
      unknownTargetEventNotes([
        { year: "2031", category: "future_type", amount: 2500 },
        { year: "2032", category: "future_type", amount: -1000 },
        { year: "2032", category: "future_type", amount: -500 },
      ]),
    ).toEqual([
      'A planned event of $2,500 in 2031 goes to account type "future_type", which this version doesn\'t know, so this page leaves it out and keeps it saved. Update Ledgr to see or change it.',
      '2 planned events totalling -$1,500 in 2032 go to account type "future_type", which this version doesn\'t know, so this page leaves them out and keeps them saved. Update Ledgr to see or change them.',
    ]);
  });
});
