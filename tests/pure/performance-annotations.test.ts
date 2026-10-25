/** Stored Performance annotations parse entry by entry. */
import { describe, it, expect } from "vitest";
import {
  acceptedAmounts,
  parseAcceptedChecks,
  parseEstimatedFields,
} from "@/lib/pure/performance-annotations";

describe("parseEstimatedFields", () => {
  it("keeps known fields once, in form order; drops the rest", () => {
    expect(
      parseEstimatedFields(["fees", "nope", "beginningBalance", "fees", 3]),
    ).toEqual(["beginningBalance", "fees"]);
    expect(parseEstimatedFields(null)).toEqual([]);
    expect(parseEstimatedFields({ fees: true })).toEqual([]);
  });
});

describe("parseAcceptedChecks", () => {
  const ok = { amount: 50, note: "on purpose", on: "2030-01-02" };
  it("one bad entry drops only itself", () => {
    expect(
      parseAcceptedChecks({
        unbalanced: ok,
        chain: { amount: 1, note: "", on: "2030-01-02" }, // no reason
        snapshot: { amount: "1", note: "x", on: "2030-01-02" },
        mystery: ok,
      }),
    ).toEqual({ unbalanced: ok });
    expect(parseAcceptedChecks([ok])).toEqual({});
    expect(acceptedAmounts({ unbalanced: ok })).toEqual({ unbalanced: 50 });
  });
});
