import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveObservedPeriods,
  periodOn,
  validateHoldingPeriod,
  type DailyPosition,
} from "@/lib/pure/holding-periods";

const day = (
  d: string,
  values: Record<number, number>,
  account = 1,
): DailyPosition[] =>
  Object.entries(values).map(([id, value]) => ({
    performanceAccountId: account,
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
    const base = { id: null, performanceAccountId: 1, weights: {} };
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
    expect(periodOn(periods, 1, "2026-11-01")!.basis).toBe("observed");
    expect(periodOn(periods, 1, "2026-05-01")!.basis).toBe("user");
    expect(periodOn(periods, 1, "2025-05-01")).toBeNull();
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
  });
});
