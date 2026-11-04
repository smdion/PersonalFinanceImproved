/**
 * Strategy defaults come from each param field's `default` (plus VPW's
 * fixed params); they must equal these pinned literals exactly.
 */
import { describe, it, expect } from "vitest";
import {
  getAllStrategyKeys,
  getStrategyDefaults,
} from "@/lib/config/withdrawal-strategies";

const PINNED: Record<string, Record<string, number | boolean>> = {
  fixed: {},
  forgo_inflation_after_loss: {},
  rmd_spending: { rmdMultiplier: 1.0, ssInAmount: false },
  guyton_klinger: {
    upperGuardrail: 0.8,
    lowerGuardrail: 1.2,
    increasePercent: 0.1,
    decreasePercent: 0.1,
    skipInflationAfterLoss: true,
  },
  spending_decline: { annualDeclineRate: 0.02 },
  constant_percentage: {
    withdrawalPercent: 0.05,
    floorPercent: 0.9,
    ssInAmount: false,
  },
  endowment: {
    withdrawalPercent: 0.05,
    rollingYears: 10,
    floorPercent: 0.9,
    ssInAmount: false,
  },
  vanguard_dynamic: {
    basePercent: 0.05,
    ceilingPercent: 0.05,
    floorPercent: 0.025,
    ssInAmount: false,
  },
  vpw: {
    cap: 0.1,
    endAge: 100,
    stockReturn: 0.05,
    bondReturn: 0.019,
    stockShare: 0.6,
    ssInAmount: false,
  },
};

describe("getStrategyDefaults", () => {
  it("covers every strategy", () => {
    expect([...getAllStrategyKeys()].sort()).toEqual(
      Object.keys(PINNED).sort(),
    );
  });

  it.each(Object.entries(PINNED))("%s equals its pinned defaults", (k, v) => {
    const key = getAllStrategyKeys().find((s) => s === k);
    expect(key).toBeDefined();
    expect(getStrategyDefaults(key!)).toStrictEqual(v);
  });

  it("returns a fresh object each call", () => {
    const a = getStrategyDefaults("guyton_klinger");
    a.upperGuardrail = 0.5;
    expect(getStrategyDefaults("guyton_klinger").upperGuardrail).toBe(0.8);
  });
});
