import { describe, it, expect } from "vitest";
import { dailyMovement } from "@/lib/pure/net-worth/daily-movement";

describe("dailyMovement", () => {
  const sessions = ["2026-10-30", "2026-10-29"];
  const entries = [
    {
      key: "ira",
      name: "Vanguard",
      moves: [
        { day: "2026-10-30", move: -100 },
        { day: "2026-10-29", move: 40 },
      ],
    },
    {
      key: "401k",
      name: "Voya",
      moves: [
        { day: "2026-10-30", move: null }, // its price isn't in yet
        { day: "2026-10-29", move: 10 },
      ],
    },
  ];

  it("adds the known moves per close and names who's missing", () => {
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
      missing: ["Voya"],
    });
    expect(thu).toMatchObject({
      day: "2026-10-29",
      move: 50,
      known: 2,
      total: 2,
      missing: [],
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

describe("money the balances show before it's reported", () => {
  const sessions = ["2026-10-30", "2026-10-29"];
  const entry = (name: string, feedId: number, added: number | null) => ({
    key: name,
    name,
    feedIds: [feedId],
    moves: [
      { day: "2026-10-30", move: -50, added },
      { day: "2026-10-29", move: 10, added: 0 },
    ],
  });

  it("counts a deposit no transaction has been sent for yet", () => {
    const [fri] = dailyMovement({
      sessions,
      entries: [entry("Vanguard", 1, 625), entry("Fidelity", 2, 824.2)],
      flows: [{ day: "2026-10-30", amount: 824.2 }],
      flowsKnown: true,
      shareChanges: [{ feedId: 2, day: "2026-10-30", amount: 824.2 }],
    });
    expect(fri!.flows).toBe(824.2);
    expect(fri!.unreported).toEqual({ amount: 625, names: ["Vanguard"] });
  });

  it("nothing once the transactions arrive", () => {
    const [fri] = dailyMovement({
      sessions,
      entries: [entry("Vanguard", 1, 625)],
      flows: [{ day: "2026-10-30", amount: 625 }],
      flowsKnown: true,
      shareChanges: [{ feedId: 1, day: "2026-10-30", amount: 625 }],
    });
    expect(fri!.unreported).toBeNull();
  });

  it("a reinvested dividend that was reported doesn't count", () => {
    const [fri] = dailyMovement({
      sessions,
      entries: [entry("Vanguard", 1, 120)],
      flows: [],
      flowsKnown: true,
      shareChanges: [{ feedId: 1, day: "2026-10-30", amount: 120 }],
    });
    expect(fri!.unreported).toBeNull();
  });

  it("cents of rounding and unknown entries are ignored", () => {
    const [fri] = dailyMovement({
      sessions,
      entries: [entry("A", 1, 0.02), entry("B", 2, null)],
      flows: [],
      flowsKnown: true,
      shareChanges: [],
    });
    expect(fri!.unreported).toBeNull();
  });
});
