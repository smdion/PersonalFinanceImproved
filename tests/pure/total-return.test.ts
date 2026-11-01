import { describe, it, expect } from "vitest";
import { totalReturnSeries } from "@/lib/pure/total-return";

const c = (date: string, close: number, divCash = 0, splitFactor = 1) => ({
  date,
  close,
  divCash,
  splitFactor,
});

const ratio = (s: ReturnType<typeof totalReturnSeries>, a: string, b: string) =>
  s.get(b)!.adjClose / s.get(a)!.adjClose;

describe("totalReturnSeries", () => {
  it("plain days follow the close", () => {
    const s = totalReturnSeries([c("2026-10-29", 100), c("2026-10-30", 102)]);
    expect(ratio(s, "2026-10-29", "2026-10-30")).toBeCloseTo(1.02, 10);
    expect(s.get("2026-10-30")!.close).toBe(102);
  });

  it("a distribution isn't a loss", () => {
    const s = totalReturnSeries([c("2026-10-29", 100), c("2026-10-30", 95, 5)]);
    expect(ratio(s, "2026-10-29", "2026-10-30")).toBeCloseTo(1, 10);
  });

  it("a split isn't a loss", () => {
    const s = totalReturnSeries([
      c("2026-10-29", 100),
      c("2026-10-30", 50, 0, 2),
    ]);
    expect(ratio(s, "2026-10-29", "2026-10-30")).toBeCloseTo(1, 10);
  });

  it("a later distribution never changes earlier days' ratios", () => {
    const base = [c("2026-10-28", 100), c("2026-10-29", 101)];
    const before = totalReturnSeries(base);
    const after = totalReturnSeries([...base, c("2026-10-30", 96, 5)]);
    expect(ratio(after, "2026-10-28", "2026-10-29")).toBe(
      ratio(before, "2026-10-28", "2026-10-29"),
    );
  });
});
