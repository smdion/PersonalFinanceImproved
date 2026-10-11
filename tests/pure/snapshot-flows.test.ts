/** Splitting change since a snapshot into money added vs markets. Invented rows. */
import { describe, it, expect } from "vitest";
import { flowsSince, type FlowRow } from "@/lib/pure/snapshot-flows";

const row = (over: Partial<FlowRow>): FlowRow => ({
  posted: "2026-06-10",
  kind: "contribution",
  amount: 100,
  pending: false,
  needsReview: false,
  ...over,
});

describe("flowsSince", () => {
  it("nets contributions and withdrawals after the snapshot day", () => {
    expect(
      flowsSince(
        [
          row({ amount: 500 }),
          row({ kind: "withdrawal", amount: -120.5 }),
          row({ posted: "2026-06-01", amount: 999 }), // the snapshot day itself
          row({ posted: "2026-05-20", amount: 999 }), // before
        ],
        "2026-06-01",
      ),
    ).toEqual({ added: 379.5, reviewCount: 0 });
  });

  it("leaves dividends, fees, trades and sweeps to the markets side", () => {
    expect(
      flowsSince(
        [
          row({ kind: "dividend", amount: 40 }),
          row({ kind: "fee", amount: -3 }),
          row({ kind: "trade", amount: -500 }),
          row({ kind: "sweep", amount: 500 }),
        ],
        "2026-06-01",
      ).added,
    ).toBe(0);
  });

  it("skips pending rows and counts rows awaiting review", () => {
    expect(
      flowsSince(
        [
          row({ pending: true, amount: 300 }),
          row({ needsReview: true, kind: "other", amount: 50 }),
        ],
        "2026-06-01",
      ),
    ).toEqual({ added: 0, reviewCount: 1 });
  });
});
