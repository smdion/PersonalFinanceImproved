import { describe, it, expect } from "vitest";
import {
  computeAllocation,
  computeDrift,
  computeBlendedER,
  aggregateHoldings,
  coverageStatus,
} from "@/lib/pure/analytics";

// ---------------------------------------------------------------------------
// computeAllocation
// ---------------------------------------------------------------------------

describe("computeAllocation", () => {
  it("returns empty map for empty input", () => {
    expect(computeAllocation([])).toEqual(new Map());
  });

  it("returns empty map when all holdings have null assetClassId", () => {
    const holdings = [
      { assetClassId: null, weightBps: 3000 },
      { assetClassId: null, weightBps: 7000 },
    ];
    expect(computeAllocation(holdings)).toEqual(new Map());
  });

  it("normalises classified holdings to fractions summing to 1", () => {
    const holdings = [
      { assetClassId: 1, weightBps: 6000 },
      { assetClassId: 2, weightBps: 4000 },
    ];
    const result = computeAllocation(holdings);
    expect(result.get(1)).toBeCloseTo(0.6);
    expect(result.get(2)).toBeCloseTo(0.4);
  });

  it("excludes null-class holdings from normalisation denominator", () => {
    const holdings = [
      { assetClassId: 1, weightBps: 5000 },
      { assetClassId: null, weightBps: 5000 }, // unclassified — excluded
    ];
    const result = computeAllocation(holdings);
    // Only class 1 is classified — 5000/5000 = 1.0
    expect(result.get(1)).toBeCloseTo(1.0);
    expect(result.size).toBe(1);
  });

  it("aggregates multiple holdings with the same assetClassId", () => {
    const holdings = [
      { assetClassId: 1, weightBps: 3000 },
      { assetClassId: 1, weightBps: 2000 },
      { assetClassId: 2, weightBps: 5000 },
    ];
    const result = computeAllocation(holdings);
    expect(result.get(1)).toBeCloseTo(0.5);
    expect(result.get(2)).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// computeDrift
// ---------------------------------------------------------------------------

describe("computeDrift", () => {
  it("returns empty map for two empty maps", () => {
    expect(computeDrift(new Map(), new Map())).toEqual(new Map());
  });

  it("computes positive drift when actual > target", () => {
    const actual = new Map([[1, 0.7]]);
    const target = new Map([[1, 0.6]]);
    const drift = computeDrift(actual, target);
    expect(drift.get(1)).toBeCloseTo(0.1);
  });

  it("computes negative drift when actual < target", () => {
    const actual = new Map([[2, 0.3]]);
    const target = new Map([[2, 0.4]]);
    const drift = computeDrift(actual, target);
    expect(drift.get(2)).toBeCloseTo(-0.1);
  });

  it("includes classes present only in actual (no target) with positive drift", () => {
    const actual = new Map([[3, 0.2]]);
    const target = new Map<number, number>();
    const drift = computeDrift(actual, target);
    expect(drift.get(3)).toBeCloseTo(0.2);
  });

  it("includes classes present only in target (no actual) with negative drift", () => {
    const actual = new Map<number, number>();
    const target = new Map([[4, 0.15]]);
    const drift = computeDrift(actual, target);
    expect(drift.get(4)).toBeCloseTo(-0.15);
  });

  it("covers all asset classes from both maps", () => {
    const actual = new Map([
      [1, 0.6],
      [2, 0.4],
    ]);
    const target = new Map([
      [1, 0.5],
      [3, 0.5],
    ]);
    const drift = computeDrift(actual, target);
    expect(drift.get(1)).toBeCloseTo(0.1); // actual 0.6 - target 0.5
    expect(drift.get(2)).toBeCloseTo(0.4); // actual 0.4 - target 0
    expect(drift.get(3)).toBeCloseTo(-0.5); // actual 0 - target 0.5
  });
});

// ---------------------------------------------------------------------------
// computeBlendedER
// ---------------------------------------------------------------------------

describe("computeBlendedER", () => {
  it("returns null for empty input", () => {
    expect(computeBlendedER([])).toBeNull();
  });

  it("returns null when no holdings have expense ratios", () => {
    const holdings = [
      { weightBps: 5000, expenseRatio: null },
      { weightBps: 5000, expenseRatio: null },
    ];
    expect(computeBlendedER(holdings)).toBeNull();
  });

  it("computes weighted average for holdings with expense ratios", () => {
    // 50% in a 0.03% ER fund, 50% in a 0.10% ER fund → blended = 0.065%
    const holdings = [
      { weightBps: 5000, expenseRatio: "0.0003" },
      { weightBps: 5000, expenseRatio: "0.001" },
    ];
    const result = computeBlendedER(holdings);
    expect(result).toBeCloseTo(0.00065);
  });

  it("excludes null-ER holdings from the weighted average", () => {
    // Only the 0.0005 holding has an ER — result should equal 0.0005
    const holdings = [
      { weightBps: 5000, expenseRatio: "0.0005" },
      { weightBps: 5000, expenseRatio: null },
    ];
    const result = computeBlendedER(holdings);
    expect(result).toBeCloseTo(0.0005);
  });

  it("handles a single holding correctly", () => {
    const holdings = [{ weightBps: 10000, expenseRatio: "0.0003" }];
    expect(computeBlendedER(holdings)).toBeCloseTo(0.0003);
  });
});

// ---------------------------------------------------------------------------
// aggregateHoldings
// ---------------------------------------------------------------------------

describe("aggregateHoldings", () => {
  it("returns empty array for empty input", () => {
    expect(aggregateHoldings([])).toEqual([]);
  });

  it("returns empty array when all accounts have zero balance", () => {
    const input = [
      {
        accountBalance: 0,
        holdings: [{ assetClassId: 1, weightBps: 10000, expenseRatio: null }],
      },
    ];
    expect(aggregateHoldings(input)).toEqual([]);
  });

  it("preserves holdings unchanged for a single account", () => {
    const input = [
      {
        accountBalance: 100_000,
        holdings: [
          { assetClassId: 1, weightBps: 7000, expenseRatio: "0.0003" },
          { assetClassId: 2, weightBps: 3000, expenseRatio: null },
        ],
      },
    ];
    const result = aggregateHoldings(input);
    // Single account = 100% weight → same bps values
    expect(result).toHaveLength(2);
    expect(result[0].weightBps).toBe(7000);
    expect(result[1].weightBps).toBe(3000);
  });

  it("scales holdings proportionally across two equal-balance accounts", () => {
    const input = [
      {
        accountBalance: 50_000,
        holdings: [{ assetClassId: 1, weightBps: 10000, expenseRatio: null }],
      },
      {
        accountBalance: 50_000,
        holdings: [{ assetClassId: 2, weightBps: 10000, expenseRatio: null }],
      },
    ];
    const result = aggregateHoldings(input);
    expect(result).toHaveLength(2);
    // Each account is 50% of total — 10000 bps × 50% = 5000
    expect(result[0].weightBps).toBe(5000);
    expect(result[1].weightBps).toBe(5000);
  });

  it("weights a larger account more heavily", () => {
    const input = [
      {
        accountBalance: 75_000,
        holdings: [{ assetClassId: 1, weightBps: 10000, expenseRatio: null }],
      },
      {
        accountBalance: 25_000,
        holdings: [{ assetClassId: 1, weightBps: 10000, expenseRatio: null }],
      },
    ];
    const result = aggregateHoldings(input);
    // Both in class 1: 75% × 10000bps + 25% × 10000bps = 7500 + 2500
    const totalBps = result.reduce((s, h) => s + h.weightBps, 0);
    expect(totalBps).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// coverageStatus
// ---------------------------------------------------------------------------

describe("coverageStatus", () => {
  const WARN_BPS = 500;

  it("returns ok when sum is exactly 10000", () => {
    const { status } = coverageStatus([{ weightBps: 10000 }], WARN_BPS);
    expect(status).toBe("ok");
  });

  it("returns ok when sum is within tolerance below 10000", () => {
    const { status, sumBps } = coverageStatus([{ weightBps: 9600 }], WARN_BPS);
    expect(status).toBe("ok"); // 400 bps under = within 500 tolerance
    expect(sumBps).toBe(9600);
  });

  it("returns under when sum is significantly below 10000", () => {
    const { status, sumBps } = coverageStatus([{ weightBps: 9000 }], WARN_BPS);
    expect(status).toBe("under"); // 1000 bps under > 500 threshold
    expect(sumBps).toBe(9000);
  });

  it("returns over when sum exceeds 10000", () => {
    const { status, sumBps } = coverageStatus(
      [{ weightBps: 6000 }, { weightBps: 5000 }],
      WARN_BPS,
    );
    expect(status).toBe("over");
    expect(sumBps).toBe(11000);
  });

  it("returns ok for empty holdings (sum = 0 only triggers under if > WARN_BPS off)", () => {
    // 0 bps, threshold 500 → 10000 - 0 = 10000 > 500 → under
    const { status } = coverageStatus([], WARN_BPS);
    expect(status).toBe("under");
  });
});
