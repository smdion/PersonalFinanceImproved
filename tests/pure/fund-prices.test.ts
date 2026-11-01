import { describe, it, expect } from "vitest";
import { impliedUnitPrices } from "@/lib/pure/fund-prices";

const r = (day: string, shares: number, value: number | null, feedId = 1) => ({
  feedId,
  day,
  shares,
  value,
});

describe("impliedUnitPrices", () => {
  it("value ÷ shares on each close, the day's last report", () => {
    const p = impliedUnitPrices([
      r("2026-10-29", 1000, 50_000),
      r("2026-10-30", 1000, 50_400),
      r("2026-10-30", 1000, 50_500),
    ]);
    expect(p.get("2026-10-29")).toEqual({ close: 50, adjClose: 50 });
    expect(p.get("2026-10-30")!.close).toBeCloseTo(50.5, 6);
  });

  it("a value left over while the shares updated is no price", () => {
    const p = impliedUnitPrices([
      r("2026-10-29", 1000, 50_000),
      r("2026-10-30", 1010, 50_000), // contribution's shares, yesterday's value
    ]);
    expect(p.has("2026-10-30")).toBe(false);
  });

  it("the same price on a new close is stale: these funds price every session", () => {
    const p = impliedUnitPrices([
      r("2026-10-29", 1000, 50_000),
      r("2026-10-30", 1020, 51_000),
    ]);
    expect(p.has("2026-10-30")).toBe(false);
  });

  it("a small position's rounding gives no price", () => {
    const p = impliedUnitPrices([r("2026-10-30", 0.5, 10)]);
    expect(p.size).toBe(0);
  });

  it("several feeds holding the fund: the largest position's price", () => {
    const p = impliedUnitPrices([
      r("2026-10-30", 10, 505.5, 1),
      r("2026-10-30", 1000, 50_500, 2),
    ]);
    expect(p.get("2026-10-30")!.close).toBeCloseTo(50.5, 6);
  });

  it("no value or no shares: no price", () => {
    expect(
      impliedUnitPrices([r("2026-10-30", 0, 100), r("2026-10-29", 5, null)])
        .size,
    ).toBe(0);
  });
});
