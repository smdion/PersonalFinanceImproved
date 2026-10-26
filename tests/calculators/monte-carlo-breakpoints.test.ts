/**
 * Without asset classes, Monte Carlo falls back to the deterministic
 * return-rate table — read as breakpoints (a rate applies from its age up to
 * the next row), the same as the deterministic engine. A table with one row
 * per age and its collapsed form must simulate identically.
 */
import { describe, it, expect } from "vitest";
import { calculateMonteCarlo } from "@/lib/calculators/monte-carlo";
import { makeTrinityInput, makeMCInput } from "../benchmarks/benchmark-helpers";

const run = (returnRates: { label: string; rate: number }[]) =>
  calculateMonteCarlo(
    makeMCInput(makeTrinityInput({ returnRates }), {
      numTrials: 50,
      assetClasses: [],
      correlations: [],
    }),
  );

describe("Monte Carlo fallback return rates", () => {
  it("applies a breakpoint to every age until the next one", () => {
    const perAge = Array.from({ length: 31 }, (_, i) => ({
      label: `Age ${65 + i}`,
      rate: i < 10 ? 0.05 : 0.03,
    }));
    const collapsed = [
      { label: "Age 65", rate: 0.05 },
      { label: "Age 75", rate: 0.03 },
    ];
    const a = run(perAge);
    const b = run(collapsed);
    expect(b.medianEndBalance).toBeCloseTo(a.medianEndBalance, 2);
    // Not the 7% default: a lower-return table ends lower.
    expect(b.medianEndBalance).toBeLessThan(
      run([{ label: "Age 65", rate: 0.07 }]).medianEndBalance,
    );
  });
});
