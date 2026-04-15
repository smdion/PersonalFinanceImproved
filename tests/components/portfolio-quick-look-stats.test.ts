/**
 * Tests for derivePortfolioQuickLookStats — pure stats derivation.
 *
 * Covers: null guard, input-order independence (sort), YTD, 52-week,
 * best/worst month, streak, ATH, all-time growth.
 */
import { describe, it, expect } from "vitest";
import { derivePortfolioQuickLookStats } from "@/components/portfolio/portfolio-quick-look-stats";
import type { PortfolioSnapshot } from "@/components/portfolio/portfolio-quick-look-stats";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const snap = (id: number, date: string, total: number): PortfolioSnapshot => ({
  id,
  date,
  total,
});

// Three snapshots covering 2024-01 through 2024-03
const THREE_SNAPS: PortfolioSnapshot[] = [
  snap(1, "2024-01-01", 100_000),
  snap(2, "2024-02-01", 110_000),
  snap(3, "2024-03-01", 105_000),
];

// ---- null guard ----

describe("null guard — fewer than 2 snapshots", () => {
  it("returns null for empty array", () => {
    expect(derivePortfolioQuickLookStats([])).toBeNull();
  });

  it("returns null for exactly 1 snapshot", () => {
    expect(
      derivePortfolioQuickLookStats([snap(1, "2024-01-01", 100_000)]),
    ).toBeNull();
  });

  it("returns non-null for 2 snapshots", () => {
    const result = derivePortfolioQuickLookStats([
      snap(1, "2024-01-01", 100_000),
      snap(2, "2024-02-01", 110_000),
    ]);
    expect(result).not.toBeNull();
  });
});

// ---- input-order independence (ISO 8601 sort) ----

describe("input order independence", () => {
  it("produces the same result regardless of input order", () => {
    const forward = derivePortfolioQuickLookStats(THREE_SNAPS);
    const reversed = derivePortfolioQuickLookStats([...THREE_SNAPS].reverse());
    const shuffled = derivePortfolioQuickLookStats([
      THREE_SNAPS[2]!,
      THREE_SNAPS[0]!,
      THREE_SNAPS[1]!,
    ]);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(shuffled);
  });

  it("reports the correct current (latest) snapshot as reference", () => {
    const result = derivePortfolioQuickLookStats(THREE_SNAPS)!;
    // latest is 2024-03-01 at 105_000
    expect(result.allTimeGrowth).toBe(5_000); // 105k - 100k
    expect(result.firstDate).toBe("2024-01-01");
    expect(result.totalSnapshots).toBe(3);
  });
});

// ---- YTD ----

describe("YTD change", () => {
  it("uses first snapshot of the current year as baseline", () => {
    // now = 2024-03-15, first snap in 2024 is 2024-01-01 (100k)
    const now = new Date("2024-03-15");
    const result = derivePortfolioQuickLookStats(THREE_SNAPS, now)!;
    // current (2024-03-01, 105k) vs first-of-year (2024-01-01, 100k)
    expect(result.ytdDelta).toBeCloseTo(5_000);
    expect(result.ytdPct).toBeCloseTo(5);
  });

  it("falls back to the overall first snapshot when no snap in current year", () => {
    const snaps = [
      snap(1, "2023-06-01", 80_000),
      snap(2, "2023-12-01", 90_000),
    ];
    const now = new Date("2024-01-15"); // new year, no 2024 snapshots yet
    const result = derivePortfolioQuickLookStats(snaps, now)!;
    // first-of-2024 lookup falls back to first snap (2023-06-01)
    expect(result.ytdDelta).toBe(10_000);
  });
});

// ---- 52-week change ----

describe("52-week change", () => {
  it("returns null fields when no snapshot is old enough", () => {
    // both snaps are within the last year
    const now = new Date("2024-03-01");
    const snaps = [
      snap(1, "2024-01-01", 100_000),
      snap(2, "2024-02-01", 110_000),
    ];
    const result = derivePortfolioQuickLookStats(snaps, now)!;
    expect(result.weekChange52).toBeNull();
    expect(result.weekChange52Pct).toBeNull();
  });

  it("picks the snapshot closest to exactly one year ago", () => {
    const now = new Date("2024-03-01");
    // one year ago = 2023-03-01; snap at 2023-03-01 is the closest
    const snaps = [
      snap(1, "2023-02-15", 90_000),
      snap(2, "2023-03-01", 95_000), // ← closest to target
      snap(3, "2024-03-01", 110_000),
    ];
    const result = derivePortfolioQuickLookStats(snaps, now)!;
    expect(result.weekChange52).toBeCloseTo(15_000);
    expect(result.weekChange52Pct).toBeCloseTo((15_000 / 95_000) * 100);
  });
});

// ---- best / worst month ----

describe("best and worst month", () => {
  it("identifies the best and worst months by dollar", () => {
    // Jan → +10k, Feb → -5k
    const result = derivePortfolioQuickLookStats(THREE_SNAPS)!;
    expect(result.bestMonthDollar[0]).toBe("2024-02"); // Feb +10k
    expect(result.bestMonthDollar[1]).toBeCloseTo(10_000);
    expect(result.worstMonthDollar[0]).toBe("2024-03"); // Mar -5k
    expect(result.worstMonthDollar[1]).toBeCloseTo(-5_000);
  });

  it("identifies the best and worst months by percent", () => {
    const result = derivePortfolioQuickLookStats(THREE_SNAPS)!;
    // Feb: +10% of 100k; Mar: ~-4.55% of 110k
    expect(result.bestMonthPct[0]).toBe("2024-02");
    expect(result.bestMonthPct[1]).toBeCloseTo(10);
    expect(result.worstMonthPct[0]).toBe("2024-03");
    expect(result.worstMonthPct[1]).toBeCloseTo((-5_000 / 110_000) * 100, 1);
  });
});

// ---- streak ----

describe("streak", () => {
  it("reports a gain streak when last N changes are all up", () => {
    const snaps = [
      snap(1, "2024-01-01", 100_000),
      snap(2, "2024-02-01", 105_000),
      snap(3, "2024-03-01", 110_000),
    ];
    const result = derivePortfolioQuickLookStats(snaps)!;
    expect(result.streak).toBe(2);
    expect(result.streakDir).toBe("gain");
  });

  it("reports a loss streak when last N changes are all down", () => {
    const snaps = [
      snap(1, "2024-01-01", 110_000),
      snap(2, "2024-02-01", 105_000),
      snap(3, "2024-03-01", 100_000),
    ];
    const result = derivePortfolioQuickLookStats(snaps)!;
    expect(result.streak).toBe(2);
    expect(result.streakDir).toBe("loss");
  });

  it("breaks streak at direction change", () => {
    // up, down — streak of 1 (last change is down)
    const result = derivePortfolioQuickLookStats(THREE_SNAPS)!;
    expect(result.streak).toBe(1);
    expect(result.streakDir).toBe("loss");
  });
});

// ---- all-time high ----

describe("all-time high (ATH)", () => {
  it("identifies ATH correctly when not at current value", () => {
    // highest was 2024-02-01 at 110k, current is 105k
    const result = derivePortfolioQuickLookStats(THREE_SNAPS)!;
    expect(result.ath.total).toBe(110_000);
    expect(result.ath.date).toBe("2024-02-01");
    expect(result.athDistance).toBeCloseTo(-5_000);
    expect(result.isAtAth).toBe(false);
  });

  it("reports isAtAth when current equals ATH (within $1)", () => {
    const snaps = [
      snap(1, "2024-01-01", 100_000),
      snap(2, "2024-02-01", 110_000),
    ];
    const result = derivePortfolioQuickLookStats(snaps)!;
    expect(result.ath.total).toBe(110_000);
    expect(result.isAtAth).toBe(true);
    expect(result.athDistance).toBeCloseTo(0);
  });
});

// ---- all-time growth ----

describe("all-time growth", () => {
  it("computes growth vs first snapshot", () => {
    const result = derivePortfolioQuickLookStats(THREE_SNAPS)!;
    expect(result.allTimeGrowth).toBe(5_000); // 105k - 100k
    expect(result.allTimeGrowthPct).toBeCloseTo(5);
  });

  it("reports 0 growth pct when first snapshot total is 0", () => {
    const snaps = [snap(1, "2024-01-01", 0), snap(2, "2024-02-01", 10_000)];
    const result = derivePortfolioQuickLookStats(snaps)!;
    expect(result.allTimeGrowthPct).toBe(0);
  });
});
