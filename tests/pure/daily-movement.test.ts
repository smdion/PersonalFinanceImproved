import { describe, it, expect } from "vitest";
import {
  balancesByClose,
  feedMovement,
  movementByClose,
} from "@/lib/pure/daily-movement";

describe("daily movement by market close", () => {
  it("a close reported twice keeps its last report", () => {
    expect(
      balancesByClose([
        { day: "2026-10-28", balance: 100 },
        { day: "2026-10-29", balance: 110 },
        { day: "2026-10-29", balance: 111 },
      ]),
    ).toEqual([
      { day: "2026-10-28", balance: 100 },
      { day: "2026-10-29", balance: 111 },
    ]);
  });

  it("the move is the latest close against the close before it, with money in split out", () => {
    expect(
      feedMovement({
        feedId: 1,
        reports: [
          { day: "2026-10-28", balance: 1_000 },
          { day: "2026-10-29", balance: 1_050 },
        ],
        latestDay: "2026-10-30",
        latestBalance: 1_700,
        flows: [
          { day: "2026-10-29", amount: 999 }, // before the window
          { day: "2026-10-30", amount: 625 },
        ],
      }),
    ).toEqual({
      feedId: 1,
      day: "2026-10-30",
      fromDay: "2026-10-29",
      move: 650,
      flows: 625,
    });
  });

  it("nothing earlier: no move; no transactions: flows unknown", () => {
    expect(
      feedMovement({
        feedId: 1,
        reports: [{ day: "2026-10-30", balance: 1 }],
        latestDay: "2026-10-30",
        latestBalance: 1,
        flows: null,
      }),
    ).toBeNull();
  });

  it("feeds on different closes stay apart, latest first", () => {
    const m = (
      feedId: number,
      day: string,
      move: number,
      flows: number | null,
    ) => ({
      feedId,
      day,
      fromDay: "x",
      move,
      flows,
    });
    expect(
      movementByClose([
        m(1, "2026-10-30", -100, 0),
        m(2, "2026-10-29", -50, null),
        m(3, "2026-10-30", -25, 625),
      ]),
    ).toEqual([
      { day: "2026-10-30", move: -125, flows: 625, feedIds: [1, 3] },
      { day: "2026-10-29", move: -50, flows: null, feedIds: [2] },
    ]);
  });
});
