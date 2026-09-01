import { describe, it, expect } from "vitest";
import { computeLifetimeTaxSummary } from "@/lib/pure/report/lifetime-tax-summary";
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decumYear(overrides: Record<string, unknown> = {}): any {
  return {
    phase: "decumulation" as const,
    year: 2044,
    age: 55,
    taxCost: 10000,
    totalWithdrawal: 50000,
    ...overrides,
  };
}

const identityDeflate = (v: number) => v;

describe("computeLifetimeTaxSummary", () => {
  it("returns null for an empty decumulation-years array", () => {
    expect(computeLifetimeTaxSummary([], identityDeflate)).toBeNull();
  });

  it("sums tax and withdrawal across years, in deflated dollars", () => {
    const years: EngineDecumulationYear[] = [
      decumYear({ age: 55, taxCost: 10000, totalWithdrawal: 50000 }),
      decumYear({ age: 56, taxCost: 12000, totalWithdrawal: 55000 }),
    ];
    const summary = computeLifetimeTaxSummary(years, identityDeflate);
    expect(summary).not.toBeNull();
    expect(summary!.totalTaxToday).toBe(22000);
    expect(summary!.totalWithdrawalToday).toBe(105000);
    expect(summary!.yearsCovered).toBe(2);
  });

  it("computes the weighted effective rate as total tax / total withdrawal", () => {
    const years: EngineDecumulationYear[] = [
      decumYear({ age: 55, taxCost: 10000, totalWithdrawal: 50000 }),
      decumYear({ age: 56, taxCost: 30000, totalWithdrawal: 100000 }),
    ];
    const summary = computeLifetimeTaxSummary(years, identityDeflate);
    // 40000 / 150000
    expect(summary!.weightedRate).toBeCloseTo(40000 / 150000, 6);
  });

  it("returns a 0 weighted rate instead of NaN/Infinity when nothing was withdrawn", () => {
    const years: EngineDecumulationYear[] = [
      decumYear({ age: 55, taxCost: 0, totalWithdrawal: 0 }),
    ];
    const summary = computeLifetimeTaxSummary(years, identityDeflate);
    expect(summary!.weightedRate).toBe(0);
  });

  it("buckets years into decades by age, e.g. 55 and 59 both fall in the 50s", () => {
    const years: EngineDecumulationYear[] = [
      decumYear({ age: 55, taxCost: 5000, totalWithdrawal: 20000 }),
      decumYear({ age: 59, taxCost: 6000, totalWithdrawal: 25000 }),
      decumYear({ age: 65, taxCost: 9000, totalWithdrawal: 40000 }),
    ];
    const summary = computeLifetimeTaxSummary(years, identityDeflate);
    expect(summary!.decades.map((d) => d.label)).toEqual(["50s", "60s"]);
    const fifties = summary!.decades.find((d) => d.label === "50s")!;
    expect(fifties.taxToday).toBe(11000);
    expect(fifties.withdrawalToday).toBe(45000);
    expect(fifties.years).toBe(2);
  });

  it("sorts decades ascending by label", () => {
    const years: EngineDecumulationYear[] = [
      decumYear({ age: 75, year: 2064 }),
      decumYear({ age: 55, year: 2044 }),
      decumYear({ age: 65, year: 2054 }),
    ];
    const summary = computeLifetimeTaxSummary(years, identityDeflate);
    expect(summary!.decades.map((d) => d.label)).toEqual(["50s", "60s", "70s"]);
  });

  it("passes each year's own `year` field to deflate, not a shared base year", () => {
    const calls: number[] = [];
    const trackingDeflate = (v: number, year: number) => {
      calls.push(year);
      return v;
    };
    const years: EngineDecumulationYear[] = [
      decumYear({ age: 55, year: 2044 }),
      decumYear({ age: 56, year: 2045 }),
    ];
    computeLifetimeTaxSummary(years, trackingDeflate);
    // Each year contributes 2 deflate calls (taxCost + totalWithdrawal).
    expect(calls).toEqual([2044, 2044, 2045, 2045]);
  });
});
