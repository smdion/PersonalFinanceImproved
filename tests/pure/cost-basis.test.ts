/** Suggested cost basis from reported average cost. Invented figures only. */
import { describe, it, expect } from "vitest";
import { suggestCostBasis } from "@/lib/pure/cost-basis";

describe("suggestCostBasis", () => {
  it("sums shares × average cost, counting a $1 fund at its value", () => {
    expect(
      suggestCostBasis([
        { shares: 10, avgCostPerShare: 400, reportedMarketValue: 5000 },
        { shares: 250.5, avgCostPerShare: null, reportedMarketValue: 250.5 },
      ]),
    ).toEqual({ suggested: 4250.5, unknownValue: 0, complete: true });
  });

  it("reports holdings with no known cost instead of guessing", () => {
    expect(
      suggestCostBasis([
        { shares: 10, avgCostPerShare: 400, reportedMarketValue: 5000 },
        { shares: 3, avgCostPerShare: null, reportedMarketValue: 900 },
      ]),
    ).toEqual({ suggested: 4000, unknownValue: 900, complete: false });
  });

  it("has nothing to suggest without any known cost", () => {
    expect(
      suggestCostBasis([
        { shares: 3, avgCostPerShare: null, reportedMarketValue: 900 },
      ]),
    ).toBeNull();
    expect(suggestCostBasis([])).toBeNull();
  });
});
