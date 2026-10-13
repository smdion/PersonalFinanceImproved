import { describe, it, expect } from "vitest";
import {
  glidePathSeries,
  vanguardStockShare,
} from "@/lib/pure/glide-path-chart";

describe("glide path chart data", () => {
  it("interpolates the mix by age and holds steady past the ends", () => {
    const series = glidePathSeries(
      [
        { age: 40, allocations: { 1: 0.8, 2: 0.2 } },
        { age: 50, allocations: { 1: 0.6, 2: 0.4 } },
      ],
      38,
      52,
    );
    const at = (age: number) => series.find((p) => p.age === age)!.shares;
    expect(at(38)).toEqual({ 1: 0.8, 2: 0.2 });
    expect(at(45)[1]).toBeCloseTo(0.7);
    expect(at(52)).toEqual({ 1: 0.6, 2: 0.4 });
    expect(glidePathSeries([], 25, 95)).toEqual([]);
  });

  it("shifts Vanguard's target-date stock share to the retirement age", () => {
    // Retiring at 65: 90% until 40, 50% at 65, 30% from 72.
    expect(vanguardStockShare(30, 65)).toBeCloseTo(0.9);
    expect(vanguardStockShare(40, 65)).toBeCloseTo(0.9);
    expect(vanguardStockShare(52.5, 65)).toBeCloseTo(0.7);
    expect(vanguardStockShare(65, 65)).toBeCloseTo(0.5);
    expect(vanguardStockShare(80, 65)).toBeCloseTo(0.3);
    // Retiring at 55 moves the whole path ten years earlier.
    expect(vanguardStockShare(55, 55)).toBeCloseTo(0.5);
    expect(vanguardStockShare(39, 55)).toBeCloseTo(0.756, 3);
  });
});
