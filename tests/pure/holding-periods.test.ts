import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountSplits,
  deriveObservedPeriods,
  historyHolders,
  isOrphaned,
  partKeyOf,
  partSharesOn,
  periodOn,
  validateHoldingPeriod,
  type DailyPosition,
} from "@/lib/pure/holding-periods";

const day = (
  d: string,
  values: Record<number, number>,
  account = 1,
  subKey: string | null = null,
  feedId = 0,
): DailyPosition[] =>
  Object.entries(values).map(([id, value]) => ({
    performanceAccountId: account,
    subKey,
    feedId,
    day: d,
    securityId: Number(id),
    value,
  }));

describe("deriveObservedPeriods", () => {
  const latest = new Map([
    [1, "2026-10-19"],
    [2, "2026-10-12"],
  ]);
  it("price moves stay one period; a fund change starts a new one; still held when it reaches the latest feed day", () => {
    const p = deriveObservedPeriods(
      [
        ...day("2026-10-12", { 1: 600, 2: 400 }),
        ...day("2026-10-13", { 1: 400, 2: 400 }), // a sell-off, not a trade
        ...day("2026-10-16", { 1: 620, 2: 390 }),
        ...day("2026-10-19", { 1: 500, 3: 500 }), // fund 2 sold, 3 bought
      ],
      latest,
    );
    expect(p.map((x) => [x.start, x.end, Object.keys(x.weights)])).toEqual([
      ["2026-10-12", "2026-10-16", ["1", "2"]],
      ["2026-10-19", null, ["1", "3"]],
    ]);
    expect(p[0]!.weights[1]).toBeCloseTo(0.6, 6);
  });

  it("a gap of more than a few trading days splits (a weekend doesn't)", () => {
    const gap = deriveObservedPeriods(
      [...day("2026-10-01", { 1: 100 }), ...day("2026-10-19", { 1: 100 })],
      latest,
    );
    expect(gap.map((x) => [x.start, x.end])).toEqual([
      ["2026-10-01", "2026-10-01"],
      ["2026-10-19", null],
    ]);
  });

  it("a feed that stopped reporting closes its last period", () => {
    const p = deriveObservedPeriods([...day("2026-10-09", { 1: 100 })], latest);
    expect(p[0]!.end).toBe("2026-10-09");
  });

  it("two feeds of one account reporting on different days don't split periods", () => {
    const feed = (d: string, values: Record<number, number>, feedId: number) =>
      day(d, values).map((p) => ({ ...p, feedId }));
    const p = deriveObservedPeriods(
      [
        ...feed("2026-10-12", { 1: 100 }, 7), // Mon, feed A
        ...feed("2026-10-13", { 2: 100 }, 8), // Tue, feed B
        ...feed("2026-10-14", { 1: 101 }, 7),
        ...feed("2026-10-15", { 2: 99 }, 8),
      ],
      new Map([[1, "2026-10-15"]]),
    );
    expect(p.map((x) => [x.start, x.end])).toEqual([
      ["2026-10-12", "2026-10-12"],
      ["2026-10-13", null],
    ]);
    expect(Object.keys(p[1]!.weights)).toEqual(["1", "2"]);
  });

  it("accounts are separate; feeds of one account on a day add up", () => {
    const p = deriveObservedPeriods(
      [
        ...day("2026-10-12", { 1: 100 }, 1),
        ...day("2026-10-12", { 1: 100 }, 1), // a second feed, same fund
        ...day("2026-10-12", { 2: 50 }, 2),
      ],
      latest,
    );
    expect(p).toHaveLength(2);
    expect(p[0]!.weights).toEqual({ 1: 1 });
    expect(p[1]!.end).toBeNull(); // account 2's latest feed day
  });
});

describe("validateHoldingPeriod", () => {
  const ok = {
    id: null,
    start: "2020-01-01",
    end: "2020-12-31",
    weights: [
      { securityId: 1, weight: 0.6 },
      { securityId: 2, weight: 0.4 },
    ],
  };
  it("accepts a clean period", () => {
    expect(validateHoldingPeriod(ok, [])).toEqual([]);
  });
  it("flags sums, bad weights, dates and overlaps", () => {
    expect(
      validateHoldingPeriod(
        { ...ok, weights: [{ securityId: 1, weight: 0.6 }] },
        [],
      ),
    ).toEqual(["weightsDontSum"]);
    expect(
      validateHoldingPeriod(
        { ...ok, weights: [{ securityId: 1, weight: 1.2 }] },
        [],
      ),
    ).toContain("badWeight");
    expect(validateHoldingPeriod({ ...ok, end: "2019-01-01" }, [])).toEqual([
      "endBeforeStart",
    ]);
    expect(
      validateHoldingPeriod(ok, [{ id: 5, start: "2020-06-01", end: null }]),
    ).toEqual(["overlapsEntered"]);
    // Editing itself isn't an overlap.
    expect(
      validateHoldingPeriod({ ...ok, id: 5 }, [
        { id: 5, start: "2020-01-01", end: null },
      ]),
    ).toEqual([]);
    expect(validateHoldingPeriod({ ...ok, weights: [] }, [])).toEqual([
      "noFunds",
    ]);
  });
});

describe("periodOn", () => {
  it("observed wins over entered over inferred; nothing outside any period", () => {
    const base = {
      id: null,
      performanceAccountId: 1,
      subKey: null,
      weights: {},
    };
    const periods = [
      { ...base, basis: "inferred" as const, start: "2026-01-01", end: null },
      {
        ...base,
        basis: "user" as const,
        start: "2026-01-01",
        end: "2026-12-31",
      },
      { ...base, basis: "observed" as const, start: "2026-10-12", end: null },
    ];
    expect(periodOn(periods, 1, null, "2026-11-01")!.basis).toBe("observed");
    expect(periodOn(periods, 1, null, "2026-05-01")!.basis).toBe("user");
    expect(periodOn(periods, 1, null, "2025-05-01")).toBeNull();
  });

  it("a part's period applies only to that part", () => {
    const p = {
      id: 1,
      performanceAccountId: 5,
      subKey: "5_taxFree__1",
      basis: "user" as const,
      start: "2020-01-01",
      end: null,
      weights: { 1: 1 },
    };
    expect(periodOn([p], 5, "5_taxFree__1", "2021-01-01")).toBe(p);
    expect(periodOn([p], 5, "5_taxFree__2", "2021-01-01")).toBeNull();
    expect(periodOn([p], 5, null, "2021-01-01")).toBeNull();
  });
});

// A joint IRA reported per part (one feed per person) vs a 401(k) whose
// parts share one whole-account feed (fictional accounts).
const SEAN_ROTH = "5_taxFree__1";
const JO_ROTH = "5_taxFree__2";

describe("holding history per part", () => {
  it("each part of a split account gets its own observed periods — never a pooled mix", () => {
    const p = deriveObservedPeriods(
      [
        ...day("2026-10-12", { 1: 600 }, 5, SEAN_ROTH, 4),
        ...day("2026-10-12", { 2: 400 }, 5, JO_ROTH, 5),
        ...day("2026-10-13", { 1: 610 }, 5, SEAN_ROTH, 4),
        ...day("2026-10-13", { 2: 395 }, 5, JO_ROTH, 5),
      ],
      new Map([[5, "2026-10-13"]]),
    );
    expect(p.map((x) => [x.subKey, x.start, x.end, x.weights]).sort()).toEqual(
      [
        [SEAN_ROTH, "2026-10-12", null, { 1: 1 }],
        [JO_ROTH, "2026-10-12", null, { 2: 1 }],
      ].sort(),
    );
  });

  it("a 401(k) with one whole-account feed keeps one whole-account history, as before", () => {
    const p = deriveObservedPeriods(
      [
        ...day("2026-10-12", { 1: 300, 2: 100 }, 1, null, 7),
        ...day("2026-10-13", { 1: 310, 2: 100 }, 1, null, 7),
      ],
      new Map([[1, "2026-10-13"]]),
    );
    expect(p).toEqual([
      {
        id: null,
        performanceAccountId: 1,
        subKey: null,
        start: "2026-10-12",
        end: null,
        basis: "observed",
        weights: { 1: 0.75, 2: 0.25 },
      },
    ]);
  });

  it("a part's feed a trading day behind the others stays open; a stale one closes", () => {
    const rows = [
      ...day("2026-10-12", { 1: 600 }, 5, SEAN_ROTH, 4),
      ...day("2026-10-12", { 2: 400 }, 5, JO_ROTH, 5),
      ...day("2026-10-13", { 1: 610 }, 5, SEAN_ROTH, 4), // Joanna's feed is a day behind
    ];
    const behind = deriveObservedPeriods(rows, new Map([[5, "2026-10-13"]]));
    expect(behind.every((x) => x.end === null)).toBe(true);
    const stale = deriveObservedPeriods(rows, new Map([[5, "2026-10-30"]]));
    expect(stale.every((x) => x.end !== null)).toBe(true);
  });
});

describe("accountSplits", () => {
  it("split when a counted feed is linked to a part; 401(k)-style whole feeds aren't", () => {
    const s = accountSplits(
      [
        { performanceAccountId: 5, subKey: SEAN_ROTH },
        { performanceAccountId: 5, subKey: JO_ROTH },
        { performanceAccountId: 1, subKey: null },
      ],
      [],
    );
    expect([...s]).toEqual([[5, { conflict: false }]]);
  });

  it("sticky: part periods keep it split after its part feeds are unlinked", () => {
    const s = accountSplits([], [{ performanceAccountId: 5, subKey: JO_ROTH }]);
    expect(s.get(5)).toEqual({ conflict: false });
  });

  it("part periods with only a whole-account feed now: not split (those periods are orphaned)", () => {
    const s = accountSplits(
      [{ performanceAccountId: 5, subKey: null }],
      [{ performanceAccountId: 5, subKey: JO_ROTH }],
    );
    expect(s.has(5)).toBe(false);
    expect(historyHolders([5], s, new Map()).map((h) => h.subKey)).toEqual([
      null,
    ]);
  });

  it("part feeds and a whole-account feed at once: a conflict, not guessed", () => {
    const s = accountSplits(
      [
        { performanceAccountId: 5, subKey: SEAN_ROTH },
        { performanceAccountId: 5, subKey: null },
      ],
      [],
    );
    expect(s.get(5)).toEqual({ conflict: true });
    expect(
      historyHolders([5], s, new Map([[5, [SEAN_ROTH]]])).map((h) => h.subKey),
    ).toEqual([SEAN_ROTH, null]);
  });
});

describe("historyHolders", () => {
  it("one per part of a split account (closed parts included); one per other account", () => {
    const h = historyHolders(
      [1, 5],
      new Map([[5, { conflict: false }]]),
      new Map([[5, [JO_ROTH, "5_preTax__1", SEAN_ROTH]]]),
    );
    expect(h).toEqual([
      { performanceAccountId: 1, subKey: null },
      { performanceAccountId: 5, subKey: JO_ROTH },
      { performanceAccountId: 5, subKey: "5_preTax__1" },
      { performanceAccountId: 5, subKey: SEAN_ROTH },
    ]);
  });
});

describe("partSharesOn", () => {
  const snaps = [
    {
      date: "2019-08-03",
      amounts: new Map([
        ["5_preTax__1", 600],
        [JO_ROTH, 400],
      ]),
    },
    {
      date: "2021-01-02",
      amounts: new Map([
        [SEAN_ROTH, 300],
        [JO_ROTH, 100],
      ]),
    },
  ];
  it("uses the latest snapshot on or before the day; a part missing from it has 0", () => {
    const s = partSharesOn(snaps, "2022-05-01");
    expect(s.get(SEAN_ROTH)).toBeCloseTo(0.75, 9);
    expect(s.get(JO_ROTH)).toBeCloseTo(0.25, 9);
    expect(s.has("5_preTax__1")).toBe(false);
  });
  it("before the first snapshot, the earliest one's shares", () => {
    const s = partSharesOn(snaps, "2017-03-01");
    expect(s.get("5_preTax__1")).toBeCloseTo(0.6, 9);
    expect(s.has(SEAN_ROTH)).toBe(false);
  });
  it("no snapshots: no shares", () => {
    expect(partSharesOn([], "2022-01-01").size).toBe(0);
  });
});

describe("holding period CHECKs", () => {
  it("back the app-layer rules in the Postgres migrations (SQLite drops them)", () => {
    const dir = join(process.cwd(), "drizzle");
    const sqlText = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf-8"))
      .join("\n");
    expect(sqlText).toContain("holding_periods_dates_check");
    expect(sqlText).toContain("holding_period_weights_range_check");
    expect(sqlText).toContain("holding_periods_sub_key_check");
  });
});

describe("partKeyOf / isOrphaned", () => {
  it("a part key must name its own account; an empty link is whole-account", () => {
    expect(partKeyOf(5, "5_taxFree__1")).toBe("5_taxFree__1");
    expect(partKeyOf(5, "51_taxFree__1")).toBeNull();
    expect(partKeyOf(51, "5_taxFree__1")).toBeNull();
    expect(partKeyOf(5, "")).toBeNull();
    expect(partKeyOf(5, null)).toBeNull();
  });

  it("entered whole-account periods on a split account are orphaned; its observed ones aren't", () => {
    const held = new Set(["5|", "5|5_taxFree__1"]); // a conflict account
    const splits = new Map([[5, { conflict: true }]]);
    const p = (basis: "user" | "observed", subKey: string | null) => ({
      performanceAccountId: 5,
      subKey,
      basis,
    });
    expect(isOrphaned(p("user", null), held, splits)).toBe(true);
    expect(isOrphaned(p("observed", null), held, splits)).toBe(false);
    expect(isOrphaned(p("user", "5_taxFree__1"), held, splits)).toBe(false);
    expect(isOrphaned(p("user", "5_preTax__9"), held, splits)).toBe(true);
    // An unsplit 401(k): its whole-account periods are its own.
    expect(
      isOrphaned(
        { ...p("user", null), performanceAccountId: 1 },
        new Set(["1|"]),
        new Map(),
      ),
    ).toBe(false);
  });
});
