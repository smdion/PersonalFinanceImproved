import { describe, it, expect } from "vitest";
import { goldilocksPlan, investedAtStartOf } from "@/lib/pure/goldilocks";

describe("goldilocksPlan (Money Guy's Goldilocks rule)", () => {
  it("under 10% of invested assets: invest it at once", () => {
    expect(goldilocksPlan(10_000, 1_000_000)).toEqual({
      share: 0.01,
      months: 0,
    });
    expect(goldilocksPlan(99_999, 1_000_000)!.months).toBe(0);
  });

  it("at 10%: five months, one more for each further 5%", () => {
    expect(goldilocksPlan(100_000, 1_000_000)!.months).toBe(5);
    expect(goldilocksPlan(149_999, 1_000_000)!.months).toBe(5);
    expect(goldilocksPlan(150_000, 1_000_000)!.months).toBe(6);
    expect(goldilocksPlan(200_000, 1_000_000)!.months).toBe(7);
  });

  it("at most 12 months (reached at 45%), however large", () => {
    expect(goldilocksPlan(450_000, 1_000_000)!.months).toBe(12);
    // Money Guy's example: $1M on top of $1M invested.
    expect(goldilocksPlan(1_000_000, 1_000_000)!.months).toBe(12);
  });

  it("nothing to compare against, or nothing coming in: no plan", () => {
    expect(goldilocksPlan(50_000, 0)).toBeNull();
    expect(goldilocksPlan(0, 1_000_000)).toBeNull();
    expect(goldilocksPlan(-5_000, 1_000_000)).toBeNull();
  });
});

describe("investedAtStartOf", () => {
  const rows = [
    { year: 2027, allAccountsBalance: 500_000 },
    { year: 2028, allAccountsBalance: 540_000 },
    { year: 2029, allAccountsBalance: 580_000 },
  ];
  it("the end of the latest year before it", () => {
    expect(investedAtStartOf(rows, 2029)).toBe(540_000);
    expect(investedAtStartOf(rows, 2035)).toBe(580_000);
  });
  it("undefined when the projection starts at or after that year", () => {
    expect(investedAtStartOf(rows, 2027)).toBeUndefined();
  });
});
