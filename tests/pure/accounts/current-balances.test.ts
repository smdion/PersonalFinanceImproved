import { describe, it, expect } from "vitest";
import {
  changeSinceSnapshot,
  currentBalance,
  addedIntoClose,
  moveIntoClose,
  pairFeedsWithParts,
  snapshotDataDay,
  summarizeCurrentBalances,
  type CurrentBalanceInput,
} from "@/lib/pure/accounts/current-balances";

/** The close balances are brought to. */
const T = "2026-10-30";

const account = (
  over: Partial<CurrentBalanceInput> = {},
): CurrentBalanceInput => ({
  key: "a",
  performanceAccountId: 1,
  label: "IRA",
  account: "IRA",
  reported: 105_000,
  reportedDay: "2026-10-29",
  snapshot: 100_000,
  positions: [],
  ...over,
});

describe("currentBalance", () => {
  it("a feed from a later close than the snapshot is the balance, and compares", () => {
    const b = currentBalance(account(), "2026-10-28", T);
    expect(b).toMatchObject({
      source: "reported",
      current: 105_000,
      comparable: true,
    });
  });

  it("on the snapshot's own close the snapshot wins — the household's figures beat a feed", () => {
    const b = currentBalance(account(), "2026-10-29", T);
    expect(b).toMatchObject({
      source: "snapshot",
      current: 100_000,
      comparable: false,
    });
  });

  it("a snapshot newer than the feed wins, and the gap isn't a change", () => {
    const b = currentBalance(account(), "2026-10-30", T);
    expect(b).toMatchObject({
      source: "snapshot",
      current: 100_000,
      comparable: false,
    });
  });

  const close = (c: number, adj = c) => ({ close: c, adjClose: adj });

  it("rolls forward by the shares' moves from the base's own day", () => {
    const closes = new Map([
      ["2026-10-29", close(100)],
      ["2026-10-30", close(102)],
    ]);
    const b = currentBalance(
      account({
        positions: [{ shares: 500, closes, feedDay: "2026-10-29" }],
      }),
      "2026-10-28",
      T,
    );
    expect(b).toMatchObject({
      base: 105_000,
      rolledForward: 1_000,
      rolledTo: "2026-10-30",
      current: 106_000,
      partialRoll: false,
    });
  });

  it("each feed rolls from its own day, not the entry's oldest", () => {
    const closes = new Map([
      ["2026-10-28", close(100)],
      ["2026-10-29", close(101)],
      ["2026-10-30", close(102)],
    ]);
    const b = currentBalance(
      account({
        reportedDay: "2026-10-28",
        positions: [
          { shares: 10, closes, feedDay: "2026-10-28" },
          { shares: 10, closes, feedDay: "2026-10-29" },
        ],
      }),
      "2026-10-27",
      T,
    );
    expect(b.rolledForward).toBeCloseTo(20 + 10.1, 0);
  });

  it("a distribution isn't a loss: the roll follows the adjusted close", () => {
    const closes = new Map([
      ["2026-10-29", close(100, 100)],
      ["2026-10-30", close(95, 100)], // ex-distribution, nothing lost
    ]);
    const b = currentBalance(
      account({
        positions: [{ shares: 10, closes, feedDay: "2026-10-29" }],
      }),
      "2026-10-29",
      T,
    );
    expect(b.rolledForward).toBe(0);
  });

  it("a feed whose date can't be told gives way to the snapshot", () => {
    const b = currentBalance(account({ reportedDay: null }), "2026-10-29", T);
    expect(b).toMatchObject({ source: "snapshot", comparable: false });
  });

  it("unpriced funds and a base day with no close stay at the base", () => {
    const b = currentBalance(
      account({
        positions: [
          { shares: 500, closes: null, feedDay: "2026-10-29" },
          {
            shares: 10,
            closes: new Map([["2026-10-30", close(5)]]),
            feedDay: "2026-10-29",
          },
        ],
      }),
      "2026-10-29",
      T,
    );
    expect(b.rolledForward).toBe(0);
    expect(b.rolledTo).toBeNull();
  });

  it("no feed: the snapshot", () => {
    const b = currentBalance(
      account({ reported: null, reportedDay: null }),
      "2026-10-29",
      T,
    );
    expect(b).toMatchObject({ source: "snapshot", comparable: false });
  });
});

describe("moveIntoClose", () => {
  const close = (c: number, adj = c) => ({ close: c, adjClose: adj });
  const closes = new Map([
    ["2026-10-28", close(100)],
    ["2026-10-29", close(101)],
    ["2026-10-30", close(99)],
  ]);

  it("each close's move uses the shares held at the close before it", () => {
    const p = {
      shares: 20,
      sharesByDay: [
        { day: "2026-10-28", shares: 10 },
        { day: "2026-10-29", shares: 20 }, // a deposit bought 10 more
      ],
      closes,
      feedDay: "2026-10-29",
    };
    // The deposit is not a market move: 10 shares × +1, then 20 × −2.
    expect(moveIntoClose([p], "2026-10-29")).toBe(10);
    expect(moveIntoClose([p], "2026-10-30")).toBe(-40);
  });

  it("the daily moves add up to the roll over the same closes", () => {
    const p = { shares: 10, closes, feedDay: "2026-10-28" };
    const rolled = currentBalance(
      account({ reportedDay: "2026-10-28", positions: [p] }),
      "2026-10-27",
      "2026-10-30",
    ).rolledForward;
    expect(
      moveIntoClose([p], "2026-10-29")! + moveIntoClose([p], "2026-10-30")!,
    ).toBeCloseTo(rolled, 2);
  });

  it("cash never moves; a fund without both closes leaves the move unknown", () => {
    const cash = { shares: 500, closes: null, cash: true, feedDay: null };
    expect(moveIntoClose([cash], "2026-10-30")).toBe(0);
    const missing = {
      shares: 1,
      closes: new Map([["2026-10-30", close(5)]]),
      feedDay: null,
    };
    expect(moveIntoClose([cash, missing], "2026-10-30")).toBeNull();
    expect(moveIntoClose([], "2026-10-30")).toBeNull();
  });

  it("a distribution isn't a loss", () => {
    const p = {
      shares: 10,
      closes: new Map([
        ["2026-10-29", close(100, 100)],
        ["2026-10-30", close(95, 100)],
      ]),
      feedDay: null,
    };
    expect(moveIntoClose([p], "2026-10-30")).toBe(0);
  });
});

describe("summarizeCurrentBalances", () => {
  const close = (c: number) => ({ close: c, adjClose: c });
  const rolled = (key: string, to: string, partial = false) =>
    currentBalance(
      account({
        key,
        positions: [
          {
            shares: 1,
            closes: new Map([
              ["2026-10-29", close(100)],
              [to, close(101)],
            ]),
            feedDay: "2026-10-29",
          },
          ...(partial
            ? [{ shares: 1, closes: null, feedDay: "2026-10-29" }]
            : []),
        ],
      }),
      "2026-10-29",
      to,
    );

  it("counts sources and compares only caught-up accounts", () => {
    const s = summarizeCurrentBalances([
      currentBalance(account({ key: "a" }), "2026-10-28", T),
      currentBalance(
        account({ key: "b", reportedDay: "2026-10-28", reported: 90_000 }),
        "2026-10-29",
        T,
      ),
    ]);
    expect(s).toMatchObject({
      total: 205_000,
      reportedTotal: 195_000,
      behindCount: 1,
      comparedCount: 1,
      estimatedTo: null,
    });
  });

  it("the estimate's day comes only from what was rolled — never a bank's Saturday", () => {
    const bank = currentBalance(
      account({ key: "bank", reportedDay: "2026-10-31" }),
      "2026-10-29",
      T,
    );
    const s = summarizeCurrentBalances([bank, rolled("a", "2026-10-30")]);
    expect(s.estimatedTo).toBe("2026-10-30");
    expect(s.estimateIsPartial).toBe(false);
  });

  it("a partial roll says so", () => {
    expect(
      summarizeCurrentBalances([rolled("a", "2026-10-30", true)])
        .estimateIsPartial,
    ).toBe(true);
  });
});

describe("changeSinceSnapshot", () => {
  it("money the snapshot never held isn't a change", () => {
    expect(
      changeSinceSnapshot([
        currentBalance(account(), "2026-10-28", T),
        currentBalance(
          account({ key: "x", noSnapshot: true, snapshot: 0 }),
          "2026-10-29",
          T,
        ),
      ]),
    ).toBe(5_000);
  });
});

describe("pairFeedsWithParts", () => {
  const part = (key: string, amount: number) => ({
    key,
    performanceAccountId: 1,
    label: key,
    account: key,
    amount,
  });
  const feed = (id: number, subKey: string | null, balance: number) => ({
    id,
    performanceAccountId: 1 as number | null,
    subKey,
    balance,
    dataDay: "2026-10-29" as string | null,
  });
  const pair = (
    feeds: ReturnType<typeof feed>[],
    parts: ReturnType<typeof part>[],
  ) =>
    pairFeedsWithParts({
      feeds,
      parts,
      accountName: () => "IRA",
      feedName: () => "Feed",
      positionsOf: () => [],
    });

  it("a feed per part stays per part; a part with no feed is the snapshot's", () => {
    const r = pair(
      [feed(1, "roth", 100)],
      [part("roth", 90), part("trad", 50)],
    );
    expect(r.map((e) => [e.key, e.reported, e.snapshot])).toEqual([
      ["roth", 100, 90],
      ["trad", null, 50],
    ]);
  });

  it("a whole-account feed compares with the whole account", () => {
    const r = pair([feed(1, null, 150)], [part("roth", 90), part("trad", 50)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ reported: 150, snapshot: 140 });
  });

  it("a feed whose part is gone counts for the whole account, never twice", () => {
    const r = pair([feed(1, "old-key", 150)], [part("new-key", 140)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ reported: 150, snapshot: 140 });
    expect(r[0]!.noSnapshot).toBe(false);
  });

  it("no parts, or no tracked account: counted, with nothing to compare", () => {
    const r = pair(
      [
        feed(1, null, 100),
        { ...feed(2, null, 25), performanceAccountId: null },
      ],
      [],
    );
    expect(r.map((e) => e.noSnapshot)).toEqual([true, true]);
    expect(r.map((e) => e.reported).sort()).toEqual([100, 25].sort());
  });
});

describe("snapshotDataDay", () => {
  const et = (day: string, hour: number) =>
    new Date(`${day}T${String(hour).padStart(2, "0")}:00:00-04:00`);
  it("saved on its date: after the close that close, before it the prior one", () => {
    expect(snapshotDataDay("2026-10-29", et("2026-10-29", 18))).toBe(
      "2026-10-29",
    );
    expect(snapshotDataDay("2026-10-29", et("2026-10-29", 10))).toBe(
      "2026-10-28",
    );
  });
  it("never a close later than the save", () => {
    expect(snapshotDataDay("2026-10-30", et("2026-10-29", 18))).toBe(
      "2026-10-29",
    );
  });
  it("backdated: that date's close, on a trading day", () => {
    expect(snapshotDataDay("2026-10-25", et("2026-10-29", 18))).toBe(
      "2026-10-23",
    );
  });
});

describe("addedIntoClose", () => {
  const close = (c: number) => ({ close: c, adjClose: c });
  const closes = new Map([
    ["2026-10-28", close(100)],
    ["2026-10-29", close(101)],
  ]);

  it("shares bought into a close, at its price", () => {
    const p = {
      shares: 20,
      sharesByDay: [
        { day: "2026-10-28", shares: 10 },
        { day: "2026-10-29", shares: 20 },
      ],
      closes,
      feedDay: "2026-10-29",
    };
    expect(addedIntoClose([p], "2026-10-29")).toBe(1010);
  });

  it("cash counts at face value", () => {
    const p = {
      shares: 625,
      sharesByDay: [
        { day: "2026-10-28", shares: 0 },
        { day: "2026-10-29", shares: 625 },
      ],
      closes: null,
      cash: true,
      feedDay: "2026-10-29",
    };
    expect(addedIntoClose([p], "2026-10-29")).toBe(625);
  });

  it("unknown when a fund has no report for the close yet", () => {
    const p = {
      shares: 10,
      sharesByDay: [{ day: "2026-10-28", shares: 10 }],
      closes,
      feedDay: "2026-10-28",
    };
    expect(addedIntoClose([p], "2026-10-29")).toBeNull();
  });
});
