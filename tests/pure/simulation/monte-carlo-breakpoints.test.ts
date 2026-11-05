/**
 * The one check for whether a Simulation can run (simulationNotConfigured),
 * and the engine's refusal when there is nothing to draw returns from,
 * instead of running every trial at 0%.
 */
import { describe, it, expect } from "vitest";
import {
  calculateMonteCarlo,
  simulationNotConfigured,
  SimulationNotConfiguredError,
} from "@/lib/pure/simulation/monte-carlo";
import {
  makeTrinityInput,
  makeMCInput,
} from "../../benchmarks/benchmark-helpers";

const input = (over: Parameters<typeof makeMCInput>[1]) =>
  makeMCInput(makeTrinityInput(), { numTrials: 50, ...over });

describe("simulationNotConfigured", () => {
  const { assetClasses, glidePath } = input({});
  const found = { found: true };

  it("a named preset the database lacks", () => {
    expect(
      simulationNotConfigured({ found: false }, assetClasses, glidePath),
    ).toBe("no_presets");
  });

  it("no asset classes, or no glide path", () => {
    expect(simulationNotConfigured(found, [], glidePath)).toBe(
      "no_asset_classes",
    );
    expect(simulationNotConfigured(found, assetClasses, [])).toBe(
      "no_glide_path",
    );
  });

  it("a glide path that puts no weight on any active class", () => {
    expect(
      simulationNotConfigured(found, assetClasses, [
        { age: 30, allocations: { 999: 1 } },
      ]),
    ).toBe("no_glide_path");
  });

  it("an age whose active-class weights don't add up to 100%", () => {
    // Class 1 only: the rest of the mix sits on classes that aren't active.
    expect(simulationNotConfigured(found, [assetClasses[0]!], glidePath)).toBe(
      "glide_path_mismatch",
    );
  });

  it("float rounding in a mix that adds up to 100% is not a mismatch", () => {
    const weights = { 1: 0.57, 2: 0.3, 3: 0.09, 4: 0.03, 5: 0.01 };
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).not.toBe(1);
    expect(
      simulationNotConfigured(found, assetClasses, [
        { age: 35, allocations: weights },
      ]),
    ).toBeNull();
  });

  it("a mix that adds up runs", () => {
    expect(simulationNotConfigured(found, assetClasses, glidePath)).toBeNull();
    expect(simulationNotConfigured(null, assetClasses, glidePath)).toBeNull();
  });
});

describe("the engine with nothing to draw returns from", () => {
  it("refuses to run without asset classes", () => {
    expect(() =>
      calculateMonteCarlo(input({ assetClasses: [], correlations: [] })),
    ).toThrow(SimulationNotConfiguredError);
  });

  it("refuses to run without a glide path", () => {
    expect(() => calculateMonteCarlo(input({ glidePath: [] }))).toThrow(
      /No glide path/,
    );
  });
});
