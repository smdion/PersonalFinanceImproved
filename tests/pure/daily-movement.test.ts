import { describe, it, expect } from "vitest";
import { dailyMovement } from "@/lib/pure/daily-movement";

describe("dailyMovement", () => {
  const sessions = ["2026-10-30", "2026-10-29"];
  const entries = [
    {
      key: "ira",
      moves: [
        { day: "2026-10-30", move: -100 },
        { day: "2026-10-29", move: 40 },
      ],
    },
    {
      key: "401k",
      moves: [
        { day: "2026-10-30", move: null }, // its price isn't in yet
        { day: "2026-10-29", move: 10 },
      ],
    },
  ];

  it("adds the known moves per close and counts what's pending", () => {
    const [fri, thu] = dailyMovement({
      sessions,
      entries,
      flows: [],
      flowsKnown: true,
    });
    expect(fri).toMatchObject({
      day: "2026-10-30",
      move: -100,
      known: 1,
      total: 2,
    });
    expect(thu).toMatchObject({
      day: "2026-10-29",
      move: 50,
      known: 2,
      total: 2,
    });
  });

  it("money paid in sits beside the close it landed before, never in the move", () => {
    const [fri, thu] = dailyMovement({
      sessions,
      entries,
      flows: [
        { day: "2026-10-30", amount: 625 },
        { day: "2026-10-29", amount: -140 },
        { day: "2026-10-31", amount: 999 }, // after the latest close
      ],
      flowsKnown: true,
    });
    expect(fri).toMatchObject({ move: -100, flows: 625 });
    expect(thu).toMatchObject({ move: 50, flows: -140 });
  });

  it("a weekend's money counts toward Monday", () => {
    const [mon] = dailyMovement({
      sessions: ["2026-11-02"],
      entries: [],
      flows: [{ day: "2026-10-31", amount: 100 }],
      flowsKnown: true,
    });
    expect(mon!.flows).toBe(100);
  });

  it("flows unknown when some account sends no transactions", () => {
    const [fri] = dailyMovement({
      sessions,
      entries,
      flows: [],
      flowsKnown: false,
    });
    expect(fri!.flows).toBeNull();
  });
});
