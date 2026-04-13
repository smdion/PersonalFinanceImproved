import { describe, it, expect } from "vitest";
import {
  recomputeLifetimeFields,
  type LifetimeCascadeRow,
} from "@/lib/pure/performance";

/**
 * Lifetime cascade recomputation contract (v0.5.x test backfill).
 *
 * recomputeLifetimeFields() is the pure core of the cascadeLifetimeFields
 * tRPC helper, which is the ONLY legal writer to the `lifetime_*` fields
 * on annual_performance rows that are marked is_immutable=true (the H4
 * immutability flag from the v0.5 expert review). A regression here =
 * silently wrong historical numbers across every page that reads lifetime
 * data (Trends, Portfolio history, FI projection, Plan Health card, etc).
 *
 * Tests walk every branch of the forward-sum loop:
 *   - Empty input
 *   - Single category with sequential years
 *   - Multiple categories (independent running sums per category)
 *   - Out-of-order input (must sort by year before summing)
 *   - Rows already matching the running sum (no update emitted)
 *   - Rows within the 0.005 epsilon (treated as unchanged)
 *   - Negative yearlyGainLoss (real production case: 2015 401k losses)
 *   - Years with zero gain (running sum unchanged but still accumulates)
 *
 * These are all failures I'd want to catch as a pre-merge test, not as
 * a user report after the fact.
 */

function makeRow(
  overrides: Partial<LifetimeCascadeRow> & {
    id: number;
    year: number;
    category: string;
  },
): LifetimeCascadeRow {
  return {
    yearlyGainLoss: 0,
    totalContributions: 0,
    employerContributions: 0,
    lifetimeGains: 0,
    lifetimeContributions: 0,
    lifetimeMatch: 0,
    ...overrides,
  };
}

describe("recomputeLifetimeFields", () => {
  it("returns an empty array for empty input", () => {
    expect(recomputeLifetimeFields([])).toEqual([]);
  });

  it("computes running sums for a single category across sequential years", () => {
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 1,
        year: 2022,
        category: "401k/IRA",
        yearlyGainLoss: 1000,
        totalContributions: 5000,
        employerContributions: 500,
        // Stored values wrong on purpose so the helper emits updates
        lifetimeGains: 999,
        lifetimeContributions: 999,
        lifetimeMatch: 999,
      }),
      makeRow({
        id: 2,
        year: 2023,
        category: "401k/IRA",
        yearlyGainLoss: 2000,
        totalContributions: 6000,
        employerContributions: 600,
        lifetimeGains: 999,
        lifetimeContributions: 999,
        lifetimeMatch: 999,
      }),
      makeRow({
        id: 3,
        year: 2024,
        category: "401k/IRA",
        yearlyGainLoss: 3000,
        totalContributions: 7000,
        employerContributions: 700,
        lifetimeGains: 999,
        lifetimeContributions: 999,
        lifetimeMatch: 999,
      }),
    ];

    const updates = recomputeLifetimeFields(rows);
    expect(updates).toHaveLength(3);
    // 2022: just the first year's values
    expect(updates[0]).toEqual({
      id: 1,
      lifetimeGains: 1000,
      lifetimeContributions: 5000,
      lifetimeMatch: 500,
    });
    // 2023: running sum = 2022 + 2023
    expect(updates[1]).toEqual({
      id: 2,
      lifetimeGains: 3000,
      lifetimeContributions: 11000,
      lifetimeMatch: 1100,
    });
    // 2024: running sum through 2024
    expect(updates[2]).toEqual({
      id: 3,
      lifetimeGains: 6000,
      lifetimeContributions: 18000,
      lifetimeMatch: 1800,
    });
  });

  it("sorts input by year before computing — out-of-order input still produces correct results", () => {
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 3,
        year: 2024,
        category: "HSA",
        yearlyGainLoss: 3000,
        totalContributions: 7000,
        lifetimeGains: 999,
      }),
      makeRow({
        id: 1,
        year: 2022,
        category: "HSA",
        yearlyGainLoss: 1000,
        totalContributions: 5000,
        lifetimeGains: 999,
      }),
      makeRow({
        id: 2,
        year: 2023,
        category: "HSA",
        yearlyGainLoss: 2000,
        totalContributions: 6000,
        lifetimeGains: 999,
      }),
    ];

    const updates = recomputeLifetimeFields(rows);
    // Updates are emitted in the category's sorted order (2022, 2023, 2024)
    expect(updates.map((u) => u.id)).toEqual([1, 2, 3]);
    // 2022 → 1000; 2023 → 3000; 2024 → 6000
    expect(updates[0]!.lifetimeGains).toBe(1000);
    expect(updates[1]!.lifetimeGains).toBe(3000);
    expect(updates[2]!.lifetimeGains).toBe(6000);
  });

  it("keeps categories independent — running sums reset per category", () => {
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 1,
        year: 2023,
        category: "401k/IRA",
        yearlyGainLoss: 10000,
        lifetimeGains: 999,
      }),
      makeRow({
        id: 2,
        year: 2023,
        category: "Brokerage",
        yearlyGainLoss: 500,
        lifetimeGains: 999,
      }),
      makeRow({
        id: 3,
        year: 2024,
        category: "401k/IRA",
        yearlyGainLoss: 5000,
        lifetimeGains: 999,
      }),
      makeRow({
        id: 4,
        year: 2024,
        category: "Brokerage",
        yearlyGainLoss: 200,
        lifetimeGains: 999,
      }),
    ];

    const updates = recomputeLifetimeFields(rows);
    const byId = new Map(updates.map((u) => [u.id, u]));

    // 401k/IRA cumulative
    expect(byId.get(1)!.lifetimeGains).toBe(10000);
    expect(byId.get(3)!.lifetimeGains).toBe(15000);
    // Brokerage cumulative — NOT affected by 401k amounts
    expect(byId.get(2)!.lifetimeGains).toBe(500);
    expect(byId.get(4)!.lifetimeGains).toBe(700);
  });

  it("emits no updates when stored values already match the running sum", () => {
    // These rows are already consistent: lifetime fields = cumulative sum.
    // The helper's update-if-different guard should emit nothing.
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 1,
        year: 2022,
        category: "HSA",
        yearlyGainLoss: 1000,
        totalContributions: 4000,
        employerContributions: 0,
        lifetimeGains: 1000,
        lifetimeContributions: 4000,
        lifetimeMatch: 0,
      }),
      makeRow({
        id: 2,
        year: 2023,
        category: "HSA",
        yearlyGainLoss: 2000,
        totalContributions: 5000,
        employerContributions: 0,
        lifetimeGains: 3000,
        lifetimeContributions: 9000,
        lifetimeMatch: 0,
      }),
    ];

    expect(recomputeLifetimeFields(rows)).toEqual([]);
  });

  it("treats differences within the 0.005 epsilon as unchanged", () => {
    // The guard uses Math.abs(stored - running) > 0.005 — amounts that
    // differ by sub-half-cent floating point noise should not trigger
    // a write, which would churn the DB on every cascade call.
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 1,
        year: 2023,
        category: "Brokerage",
        yearlyGainLoss: 1000.001,
        // Stored is 1000 exact — difference is 0.001, below the threshold
        lifetimeGains: 1000,
        lifetimeContributions: 0,
        lifetimeMatch: 0,
      }),
    ];
    expect(recomputeLifetimeFields(rows)).toEqual([]);
  });

  it("emits an update when any one of the three lifetime fields is out of sync", () => {
    // lifetimeGains is correct, but lifetimeContributions is wrong → update
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 1,
        year: 2023,
        category: "401k/IRA",
        yearlyGainLoss: 1000,
        totalContributions: 5000,
        employerContributions: 500,
        lifetimeGains: 1000, // correct
        lifetimeContributions: 999, // stale
        lifetimeMatch: 500, // correct
      }),
    ];
    const updates = recomputeLifetimeFields(rows);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      id: 1,
      lifetimeGains: 1000,
      lifetimeContributions: 5000,
      lifetimeMatch: 500,
    });
  });

  it("handles negative yearlyGainLoss (production case: 2015 401k had -$58.76)", () => {
    // Regression guard for a real production row: the 2015 401k/IRA
    // category had a yearlyGainLoss of -58.76 and lifetime_gains ended
    // up at -58.73 (sum of 2012-2014's ~$0 gains + 2015's loss).
    // H4's original CHECK constraint would have rejected this, which is
    // why it was removed — negative lifetime_gains is legitimate data.
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 1,
        year: 2014,
        category: "401k/IRA",
        yearlyGainLoss: 0.01,
        lifetimeGains: 999,
      }),
      makeRow({
        id: 2,
        year: 2015,
        category: "401k/IRA",
        yearlyGainLoss: -58.76,
        lifetimeGains: 999,
      }),
    ];

    const updates = recomputeLifetimeFields(rows);
    expect(updates[0]!.lifetimeGains).toBeCloseTo(0.01, 2);
    expect(updates[1]!.lifetimeGains).toBeCloseTo(-58.75, 2);
  });

  it("accumulates correctly even when a year has zero yearly gain/loss", () => {
    const rows: LifetimeCascadeRow[] = [
      makeRow({
        id: 1,
        year: 2022,
        category: "HSA",
        yearlyGainLoss: 1000,
        lifetimeGains: 999,
      }),
      makeRow({
        id: 2,
        year: 2023,
        category: "HSA",
        yearlyGainLoss: 0, // flat year
        lifetimeGains: 999,
      }),
      makeRow({
        id: 3,
        year: 2024,
        category: "HSA",
        yearlyGainLoss: 500,
        lifetimeGains: 999,
      }),
    ];

    const updates = recomputeLifetimeFields(rows);
    expect(updates[0]!.lifetimeGains).toBe(1000);
    expect(updates[1]!.lifetimeGains).toBe(1000); // unchanged from prior year
    expect(updates[2]!.lifetimeGains).toBe(1500);
  });
});
