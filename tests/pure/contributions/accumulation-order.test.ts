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

  it("treats null/undefined allocationPriority as 0 (highest priority)", () => {
    const contribs = [
      { accountType: "401k", allocationPriority: 10 },
      { accountType: "hsa", allocationPriority: null },
      { accountType: "ira" },
    ];
    // Both hsa (null → 0) and ira (undefined → 0) are ordered before 401k.
    // Stable sort preserves original order between equal keys, so hsa
    // comes before ira.
    const result = buildAccumulationOrder(contribs);
    expect(result.indexOf("hsa")).toBeLessThan(result.indexOf("401k"));
    expect(result.indexOf("ira")).toBeLessThan(result.indexOf("401k"));
  });
});
