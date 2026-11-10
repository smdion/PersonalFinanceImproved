import { describe, it, expect } from "vitest";
import { buildAccumulationOrder } from "@/lib/pure/contributions/accumulation-order";

describe("buildAccumulationOrder (M1)", () => {
  it("returns empty array for empty input", () => {
    expect(buildAccumulationOrder([])).toEqual([]);
  });

  it("returns categories in allocationPriority order (lower = earlier)", () => {
    const contribs = [
      { accountType: "brokerage", allocationPriority: 40 },
      { accountType: "401k", allocationPriority: 10 },
      { accountType: "hsa", allocationPriority: 20 },
      { accountType: "ira", allocationPriority: 30 },
    ];
    expect(buildAccumulationOrder(contribs)).toEqual([
      "401k",
      "hsa",
      "ira",
      "brokerage",
    ]);
  });

  it("deduplicates categories — multiple accounts of same type collapse", () => {
    const contribs = [
      { accountType: "401k", allocationPriority: 10 },
      { accountType: "401k", allocationPriority: 15 }, // spouse's 401k
      { accountType: "ira", allocationPriority: 20 },
      { accountType: "ira", allocationPriority: 25 }, // spouse's ira
    ];
    expect(buildAccumulationOrder(contribs)).toEqual(["401k", "ira"]);
  });

  it("puts the column's default priority 0 first, ties in input order", () => {
    const contribs = [
      { accountType: "401k", allocationPriority: 10 },
      { accountType: "hsa", allocationPriority: 0 },
      { accountType: "ira", allocationPriority: 0 },
    ];
    // allocation_priority is NOT NULL (default 0), and no active-field entry
    // holds one, so every row has a number.
    expect(buildAccumulationOrder(contribs)).toEqual(["hsa", "ira", "401k"]);
  });
});
