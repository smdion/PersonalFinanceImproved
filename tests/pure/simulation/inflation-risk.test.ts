import { describe, it, expect } from "vitest";
import { resolveInflationRisk } from "@/lib/pure/simulation/inflation-risk";
import { DEFAULT_MC_INFLATION_RISK } from "@/lib/constants";

describe("resolveInflationRisk", () => {
  it("this run's override comes first", () => {
    expect(
      resolveInflationRisk({
        ui: { stdDev: 0.03 },
        saved: { stdDev: 0.02 },
        presetStdDev: 0.01,
      }),
    ).toEqual({ stdDev: 0.03 });
  });

  it("then the saved override, then the preset's", () => {
    expect(
      resolveInflationRisk({ saved: { stdDev: 0.02 }, presetStdDev: 0.01 }),
    ).toEqual({ stdDev: 0.02 });
    expect(
      resolveInflationRisk({ ui: null, saved: null, presetStdDev: 0.01 }),
    ).toEqual({ stdDev: 0.01 });
    expect(resolveInflationRisk({ saved: {}, presetStdDev: 0.01 })).toEqual({
      stdDev: 0.01,
    });
  });

  it("a zero override is a setting, not absent", () => {
    expect(
      resolveInflationRisk({ ui: { stdDev: 0 }, saved: { stdDev: 0.02 } }),
    ).toEqual({ stdDev: 0 });
  });

  it("with none of them, the default", () => {
    expect(resolveInflationRisk({ saved: null, presetStdDev: null })).toEqual({
      stdDev: DEFAULT_MC_INFLATION_RISK.stdDev,
    });
  });
});
