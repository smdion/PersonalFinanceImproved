/** Whether to use a suggested stand-in fund. Invented figures only. */
import { describe, it, expect } from "vitest";
import { adviseStandIn, STANDIN_COVERAGE_OK } from "@/lib/pure/standin-advice";

const preview = (coverage: number | null) => ({
  coverage,
  mix: null,
  expenseRatio: 0.003,
  asOf: "2026-06-30",
  checkedAt: "2026-10-01T00:00:00Z",
});

describe("adviseStandIn", () => {
  it("waits for the stand-in's filings to be checked (or re-checked after a failure)", () => {
    expect(adviseStandIn(null)).toEqual({ mix: "checking" });
    expect(
      adviseStandIn({ ...preview(null), error: "SEC unreachable" }),
    ).toEqual({
      mix: "checking",
    });
  });
  it("trusts the mix when the filings explain most of the fund", () => {
    expect(adviseStandIn(preview(STANDIN_COVERAGE_OK))).toEqual({
      mix: "use",
      coverage: 0.9,
    });
  });
  it("points to the plan's own documents when they don't", () => {
    expect(adviseStandIn(preview(0.4))).toEqual({
      mix: "enter",
      coverage: 0.4,
    });
    expect(adviseStandIn(preview(null))).toEqual({
      mix: "enter",
      coverage: null,
    });
  });
});
