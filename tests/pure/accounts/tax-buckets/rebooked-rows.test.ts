import { describe, expect, it } from "vitest";
import {
  newRowRefusals,
  rebookedRowsWarning,
  taxTypeRefusals,
} from "@/lib/pure/accounts/tax-buckets/rebooked-rows";
import type { TaxBucketSnapshotAccount } from "@/lib/pure/accounts/tax-buckets/tax-buckets";

const people = [{ id: 1, name: "Alex" }];

const row = (
  overrides: Partial<TaxBucketSnapshotAccount>,
): TaxBucketSnapshotAccount => ({
  portfolioAccountId: 1,
  institution: "Fidelity",
  taxType: "preTax",
  accountType: "401k",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  amount: 1000,
  ownerPersonId: 1,
  performanceAccountId: 1,
  displayName: null,
  accountLabel: "Alex 401k (Fidelity)",
  ...overrides,
});

describe("rebookedRowsWarning", () => {
  it("names a row whose tax type its account type doesn't hold, and what it counts as", () => {
    const [note, ...rest] = rebookedRowsWarning(
      [row({ taxType: "afterTax" }), row({ taxType: "taxFree" })],
      people,
    );
    expect(rest).toEqual([]);
    expect(note).toMatch(/is saved as After-tax/);
    expect(note).toMatch(
      /for a 401k account, so it counts this balance as Traditional/,
    );
  });

  it("names a mistyped row with no parent: the projection counts it", () => {
    expect(
      rebookedRowsWarning(
        [row({ taxType: "preTax", accountType: "hsa", parentCategory: null })],
        people,
      ),
    ).toEqual([expect.stringMatching(/saved as Traditional.*as HSA/)]);
  });

  it("says nothing when every row fits, or the row isn't projected", () => {
    expect(rebookedRowsWarning([row({})], people)).toEqual([]);
    expect(
      rebookedRowsWarning(
        [row({ taxType: "afterTax", parentCategory: "Elsewhere" })],
        people,
      ),
    ).toEqual([]);
  });

  it("reads a sub-type row by its account's primary type", () => {
    expect(
      rebookedRowsWarning(
        [
          row({}),
          row({
            subType: "Rollover",
            accountType: "brokerage",
            taxType: "preTax",
          }),
        ],
        people,
      ),
    ).toEqual([]);
  });
});

describe("newRowRefusals", () => {
  it("leaves out a row carried over from the previous snapshot, refuses a new one", () => {
    const carried = row({ accountType: "hsa", taxType: "taxFree" });
    const entered = row({
      accountType: "hsa",
      taxType: "taxFree",
      ownerPersonId: 2,
    });
    expect(
      newRowRefusals([carried, entered], [{ ...carried }]).map((r) => r.row),
    ).toEqual([entered]);
  });
});

describe("taxTypeRefusals", () => {
  it("refuses each row its account type doesn't hold, naming what it takes", () => {
    const mistyped = row({ accountType: "hsa", taxType: "taxFree" });
    expect(taxTypeRefusals([row({}), mistyped])).toEqual([
      {
        row: mistyped,
        message: "HSA balances can't be saved as Roth. Choose HSA.",
      },
    ]);
  });
});
