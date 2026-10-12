/** Benchmark definitions and how each resolves to a fund. */
import { describe, it, expect } from "vitest";
import {
  BENCHMARKS,
  DEFAULT_BENCHMARK_KEY,
  resolveBenchmark,
} from "@/lib/config/benchmarks";

const targetDate = BENCHMARKS.find((b) => b.key === "target_date")!;

describe("benchmarks", () => {
  it("defaults to the target-date fund and has unique keys", () => {
    expect(DEFAULT_BENCHMARK_KEY).toBe("target_date");
    expect(new Set(BENCHMARKS.map((b) => b.key)).size).toBe(BENCHMARKS.length);
  });

  it("picks the target-date vintage closest to the retirement year", () => {
    expect(resolveBenchmark(targetDate, 2056)).toMatchObject({
      label: "Target-date 2055 fund",
      ticker: "VFFVX",
    });
    expect(resolveBenchmark(targetDate, 2058)?.ticker).toBe("VTTSX");
    expect(resolveBenchmark(targetDate, 2057)?.ticker).toBe("VFFVX");
    expect(resolveBenchmark(targetDate, 2100)?.ticker).toBe("VSVNX"); // past the last: latest
  });

  it("can't pick a target-date fund without a retirement year", () => {
    expect(resolveBenchmark(targetDate, null)).toBeNull();
  });

  it("resolves a fixed benchmark to its own fund", () => {
    const sp = BENCHMARKS.find((b) => b.key === "sp500")!;
    expect(resolveBenchmark(sp, null)).toMatchObject({
      ticker: "SPY",
      label: "S&P 500",
    });
  });
});
