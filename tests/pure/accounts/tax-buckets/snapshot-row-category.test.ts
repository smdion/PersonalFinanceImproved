import { describe, expect, it } from "vitest";
import { withRowCategories } from "@/lib/pure/accounts/tax-buckets/snapshot-row-category";

describe("withRowCategories", () => {
  it("a sub-type row counts under its account's primary row's type; others under their own", () => {
    const rows = [
      { performanceAccountId: 1, subType: "Rollover", accountType: "ira" },
      { performanceAccountId: 1, subType: null, accountType: "401k" },
      { performanceAccountId: null, subType: "Rollover", accountType: "ira" },
      { performanceAccountId: 2, subType: "Rollover", accountType: "hsa" },
    ] as const;
    expect(withRowCategories(rows).map((r) => r.category)).toEqual([
      "401k",
      "401k",
      "ira",
      "hsa",
    ]);
  });

  it("keeps each row with its category, in order", () => {
    const row = {
      performanceAccountId: 3,
      subType: null,
      accountType: "brokerage" as const,
    };
    expect(withRowCategories([row])).toEqual([{ row, category: "brokerage" }]);
  });
});
