import { describe, it, expect } from "vitest";
import {
  describeBracketTargetChoice,
  describeBracketTargetQualitative,
} from "@/lib/pure/report/bracket-target-narrative";
import type { BracketOptimizerResult } from "@/lib/calculators/withdrawal-bracket-optimizer";

function optimizer(
  candidates: BracketOptimizerResult["candidates"],
  overrides: Partial<BracketOptimizerResult> = {},
): BracketOptimizerResult {
  return {
    recommendedTarget: null,
    currentTarget: null,
    candidates,
    ...overrides,
  };
}

describe("describeBracketTargetQualitative", () => {
  it("names the target rate and explains the RMD-avoidance rationale", () => {
    const text = describeBracketTargetQualitative(0.22);
    expect(text).toMatch(/22% tax bracket/);
    expect(text).toMatch(/Required Minimum Distribution/i);
  });
});

describe("describeBracketTargetChoice", () => {
  it("falls back to the qualitative explanation when no optimizer result is available", () => {
    const text = describeBracketTargetChoice(undefined, 0.22);
    expect(text).toBe(describeBracketTargetQualitative(0.22));
  });

  it("falls back to the qualitative explanation when the optimizer result is null", () => {
    const text = describeBracketTargetChoice(null, 0.22);
    expect(text).toBe(describeBracketTargetQualitative(0.22));
  });

  it("falls back when fewer than 2 candidates exist", () => {
    const opt = optimizer([
      { target: 0.22, netCost: 1000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toBe(describeBracketTargetQualitative(0.22));
  });

  it("falls back when the current target isn't among the candidates", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 1000, shortfallScore: 0, depleted: false },
      { target: 0.24, netCost: 2000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toBe(describeBracketTargetQualitative(0.22));
  });

  it("states the current target is the lowest-cost choice when it truly is the cheapest", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 5000, shortfallScore: 0, depleted: false },
      { target: 0.22, netCost: 3000, shortfallScore: 0, depleted: false },
      { target: 0.24, netCost: 4000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toMatch(/22% is the lowest lifetime-cost choice/);
  });

  it("flags when a DIFFERENT candidate is cheaper than the household's current target, with the real dollar gap", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 3000, shortfallScore: 0, depleted: false },
      { target: 0.22, netCost: 5000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toMatch(/12% scores as the lower-cost choice/);
    expect(text).toMatch(/\$2,000\.00 less/);
    expect(text).toMatch(/Taxes settings page/);
  });

  it("explains the immediately-lower candidate's real tradeoff when it's genuinely cheaper today", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 3000, shortfallScore: 0, depleted: false },
      { target: 0.22, netCost: 5000, shortfallScore: 0, depleted: false },
      { target: 0.24, netCost: 6000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toMatch(
      /Filling only to 12% instead would cost about \$2,000\.00 less/,
    );
  });

  it("explains the immediately-lower candidate isn't worth it when it doesn't actually reduce cost", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 5000, shortfallScore: 0, depleted: false },
      { target: 0.22, netCost: 3000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toMatch(/not worth it/);
  });

  it("explains the immediately-higher candidate's real extra cost", () => {
    const opt = optimizer([
      { target: 0.22, netCost: 3000, shortfallScore: 0, depleted: false },
      { target: 0.24, netCost: 4500, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toMatch(
      /Filling further to 24% would cost about \$1,500\.00 more/,
    );
  });

  it("excludes depleted candidates from the comparison entirely", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 100, shortfallScore: 0, depleted: true }, // cheapest but depletes — must be excluded
      { target: 0.22, netCost: 3000, shortfallScore: 0, depleted: false },
      { target: 0.24, netCost: 4000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).toMatch(/22% is the lowest lifetime-cost choice/);
    expect(text).not.toMatch(/12%/);
  });

  it("has no higher-candidate clause when the current target is already the highest tested", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 5000, shortfallScore: 0, depleted: false },
      { target: 0.22, netCost: 3000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22);
    expect(text).not.toMatch(/Filling further/);
  });
});
