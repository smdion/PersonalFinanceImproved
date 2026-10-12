/** Splitting change since a snapshot into money added vs markets. Invented rows. */
import { describe, it, expect } from "vitest";
import {
  accountFlowsSince,
  flowsSince,
  type FlowRow,
} from "@/lib/pure/snapshot-flows";

const row = (over: Partial<FlowRow>): FlowRow => ({
  posted: "2026-06-10",
  kind: "contribution",
  amount: 100,
  pending: false,
  uncertain: false,
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
    ).toEqual({ added: 379.5, uncertainCount: 0 });
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
          row({ uncertain: true, kind: "other", amount: 50 }),
        ],
        "2026-06-01",
      ),
    ).toEqual({ added: 0, uncertainCount: 1 });
  });
});

describe("accountFlowsSince", () => {
  it("splits one account's change into added, moved between accounts, and markets", () => {
    expect(
      accountFlowsSince(
        [
          row({ posted: "2026-03-01", amount: 999 }), // snapshot day: already in it
          row({ posted: "2026-03-05", amount: 300 }),
          row({ posted: "2026-03-06", kind: "transfer", amount: -1000 }),
          row({ posted: "2026-03-07", kind: "dividend", amount: 12 }),
        ],
        "2026-03-01",
        -650,
      ),
    ).toEqual({ added: 300, moved: -1000, markets: 50, uncertainCount: 0 });
  });
});
