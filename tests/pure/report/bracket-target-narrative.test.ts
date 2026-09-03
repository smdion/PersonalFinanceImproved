import { describe, it, expect } from "vitest";
import {
  describeBracketTargetChoice,
  describeBracketTargetQualitative,
  describeBracketCeilingMath,
  describeDiscretionaryCapacityMath,
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

  it("folds the ceiling-math sentence into the rich comparison right after the intro, when ceilingMath is passed", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 5000, shortfallScore: 0, depleted: false },
      { target: 0.22, netCost: 3000, shortfallScore: 0, depleted: false },
    ]);
    const text = describeBracketTargetChoice(opt, 0.22, {
      bracketTraditionalCap: 60000,
      taxableSS: 15000,
      standardDeduction: 32200,
    });
    expect(text).toMatch(/bracket's ceiling sits at about \$75,000\.00/);
    expect(text).toMatch(/22% is the lowest lifetime-cost choice/);
  });

  it("omits the ceiling-math sentence when ceilingMath is not passed, identical to before", () => {
    const opt = optimizer([
      { target: 0.12, netCost: 5000, shortfallScore: 0, depleted: false },
      { target: 0.22, netCost: 3000, shortfallScore: 0, depleted: false },
    ]);
    const withMath = describeBracketTargetChoice(opt, 0.22, {
      bracketTraditionalCap: 60000,
      taxableSS: 15000,
      standardDeduction: 32200,
    });
    const withoutMath = describeBracketTargetChoice(opt, 0.22);
    expect(withoutMath).not.toMatch(/bracket's ceiling sits at/);
    expect(withMath.length).toBeGreaterThan(withoutMath.length);
  });

  it("folds the ceiling-math sentence into the qualitative fallback path too", () => {
    const text = describeBracketTargetChoice(null, 0.22, {
      bracketTraditionalCap: 60000,
      taxableSS: 15000,
      standardDeduction: 32200,
    });
    expect(text).toMatch(/bracket's ceiling sits at about \$75,000\.00/);
    expect(text).toMatch(/Required Minimum Distribution/i);
  });
});

describe("describeBracketCeilingMath", () => {
  it("returns undefined when no input is given", () => {
    expect(describeBracketCeilingMath(0.22, undefined)).toBeUndefined();
    expect(describeBracketCeilingMath(0.22, null)).toBeUndefined();
  });

  it("returns undefined when standardDeduction is missing — a bare number would be unexplained", () => {
    const text = describeBracketCeilingMath(0.22, {
      bracketTraditionalCap: 60000,
      taxableSS: 15000,
    });
    expect(text).toBeUndefined();
  });

  it("states the gross-income ceiling as bracketTraditionalCap + taxableSS, adjusted for the standard deduction", () => {
    const text = describeBracketCeilingMath(0.22, {
      bracketTraditionalCap: 60000,
      taxableSS: 15000,
      standardDeduction: 32200,
    })!;
    expect(text).toMatch(
      /22% bracket's ceiling sits at about \$75,000\.00 in gross income/,
    );
    expect(text).toMatch(/\$32,200\.00 standard deduction/);
    expect(text).toMatch(
      /\$15,000\.00 of that room is already used by taxable Social Security this year, leaving \$60,000\.00 available/,
    );
  });

  it("uses the no-Social-Security phrasing when taxableSS is zero, instead of an odd '$0.00 is already used' claim", () => {
    const text = describeBracketCeilingMath(0.22, {
      bracketTraditionalCap: 60000,
      taxableSS: 0,
      standardDeduction: 32200,
    })!;
    expect(text).toMatch(
      /With no taxable Social Security this year, the full \$60,000\.00 is available/,
    );
    expect(text).not.toMatch(/\$0\.00 of that room/);
  });

  it("does NOT reconstruct incomeCap as bracketTraditionalCap + taxableSS when the cap was clamped to 0 by SS alone (advisor-caught 2026-09-01)", () => {
    // A household with high taxable SS and a low bracket target: the real
    // income cap for a 10% bracket might be, say, $30,000, but taxable SS
    // alone is $40,000 — computeBracketTraditionalCap
    // (withdrawal-routing.ts) clamps bracketTraditionalCap to 0 in this
    // case, discarding how far over the real cap SS actually pushed
    // things. Reconstructing incomeCap as 0 + 40,000 = $40,000 would
    // UNDER-state the true (higher) ceiling as exactly equal to taxable
    // SS — this must not happen.
    const text = describeBracketCeilingMath(0.1, {
      bracketTraditionalCap: 0,
      taxableSS: 40000,
      standardDeduction: 32200,
    })!;
    expect(text).toBeDefined();
    expect(text).not.toMatch(/\$40,000\.00 in gross income/);
    expect(text).toMatch(
      /taxable Social Security income alone \(\$40,000\.00\) already fills the 10% bracket's room/,
    );
    expect(text).toMatch(/no room for Traditional withdrawals/);
  });

  it("still uses the normal ceiling-math sentence when bracketTraditionalCap is 0 but taxableSS is also 0 (nothing clamped, just no room)", () => {
    const text = describeBracketCeilingMath(0.1, {
      bracketTraditionalCap: 0,
      taxableSS: 0,
      standardDeduction: 32200,
    })!;
    expect(text).toMatch(/bracket's ceiling sits at about \$0\.00/);
  });
});

describe("describeDiscretionaryCapacityMath", () => {
  const tierBreakdown = (
    entries: {
      source: "roth" | "brokerage" | "hsa";
      costRate: number;
      amount: number;
    }[],
  ) => entries;

  it("returns undefined when capacities is missing", () => {
    expect(
      describeDiscretionaryCapacityMath(undefined, [], "roth_first", false),
    ).toBeUndefined();
    expect(
      describeDiscretionaryCapacityMath(null, [], "roth_first", false),
    ).toBeUndefined();
  });

  it("returns undefined when rmdOverrodeRouting is true — capacities would overstate the real room", () => {
    const text = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 10000, brokerageZeroLtcgCapacity: 10000 },
      tierBreakdown([{ source: "roth", costRate: 0, amount: 5000 }]),
      "roth_first",
      true,
    );
    expect(text).toBeUndefined();
  });

  it("returns undefined when there was no discretionary draw this year", () => {
    expect(
      describeDiscretionaryCapacityMath(
        { rothBasisCapacity: 10000, brokerageZeroLtcgCapacity: 10000 },
        [],
        "roth_first",
        false,
      ),
    ).toBeUndefined();
    expect(
      describeDiscretionaryCapacityMath(
        { rothBasisCapacity: 10000, brokerageZeroLtcgCapacity: 10000 },
        undefined,
        "roth_first",
        false,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when neither tier had any capacity", () => {
    const text = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 0, brokerageZeroLtcgCapacity: 0 },
      tierBreakdown([{ source: "roth", costRate: 0.12, amount: 5000 }]),
      "roth_first",
      false,
    );
    expect(text).toBeUndefined();
  });

  it("reproduces the live crowd-out scenario: brokerage capacity is $0 (Traditional/SS filled the LTCG ceiling), Roth basis absorbed the need — states the numbers, no claim about why", () => {
    const text = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 30000, brokerageZeroLtcgCapacity: 0 },
      tierBreakdown([
        { source: "roth", costRate: 0, amount: 10854.07 },
        { source: "roth", costRate: 0.12, amount: 17678.07 },
      ]),
      "brokerage_first",
      false,
    )!;
    expect(text).toMatch(/\$0\.00 you could have drawn from brokerage/);
    expect(text).toMatch(
      /\$10,854\.07 came from Roth basis and \$0\.00 from brokerage/,
    );
    expect(text).toMatch(/\$19,145\.93 of Roth basis went unused this year/);
    expect(text).toMatch(
      /Discretionary Withdrawal Order setting \(currently "Brokerage 0% room first"\)/,
    );
  });

  it("symmetric case: no Roth basis available, brokerage's free room absorbed the need", () => {
    const text = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 0, brokerageZeroLtcgCapacity: 15000 },
      tierBreakdown([{ source: "brokerage", costRate: 0, amount: 12000 }]),
      "roth_first",
      false,
    )!;
    expect(text).toMatch(/\$0\.00 of tax-free Roth basis/);
    expect(text).toMatch(
      /\$0\.00 came from Roth basis and \$12,000\.00 from brokerage/,
    );
    expect(text).toMatch(
      /\$3,000\.00 of brokerage's 0% room went unused this year/,
    );
  });

  it("states the current order setting neutrally regardless of which tier was used, with no causal claim and no one-directional nudge", () => {
    const rothFirst = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 30000, brokerageZeroLtcgCapacity: 31000 },
      tierBreakdown([{ source: "roth", costRate: 0, amount: 20000 }]),
      "roth_first",
      false,
    )!;
    expect(rothFirst).toMatch(
      /\$20,000\.00 came from Roth basis and \$0\.00 from brokerage/,
    );
    expect(rothFirst).toMatch(
      /\$10,000\.00 of Roth basis and \$31,000\.00 of brokerage's 0% room went unused this year/,
    );
    expect(rothFirst).toMatch(
      /Discretionary Withdrawal Order setting \(currently "Roth basis first"\) on the Taxes settings page/,
    );
    expect(rothFirst).not.toMatch(/ran out/);
    expect(rothFirst).not.toMatch(
      /covered the full discretionary need on its own/,
    );
    expect(rothFirst).not.toMatch(/Change this/);

    const brokerageFirst = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 30000, brokerageZeroLtcgCapacity: 31000 },
      tierBreakdown([{ source: "brokerage", costRate: 0, amount: 20000 }]),
      "brokerage_first",
      false,
    )!;
    expect(brokerageFirst).toMatch(
      /\$0\.00 came from Roth basis and \$20,000\.00 from brokerage/,
    );
    expect(brokerageFirst).toMatch(
      /Discretionary Withdrawal Order setting \(currently "Brokerage 0% room first"\)/,
    );
  });

  it("states both used and leftover correctly when a per-category withdrawal cap (not tier exhaustion) split the draw across both tiers", () => {
    // Neither tier's own household-wide capacity was actually reached --
    // this reproduces the case where an account cap, not
    // order/capacity, explains the split. The function must not claim a
    // mechanism ("ran out") it can't verify -- only the real numbers.
    const text = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 30000, brokerageZeroLtcgCapacity: 25000 },
      tierBreakdown([
        { source: "roth", costRate: 0, amount: 10000 }, // capped well below its own 30000 capacity
        { source: "brokerage", costRate: 0, amount: 8000 },
      ]),
      "roth_first",
      false,
    )!;
    expect(text).toMatch(
      /\$10,000\.00 came from Roth basis and \$8,000\.00 from brokerage/,
    );
    expect(text).toMatch(
      /\$20,000\.00 of Roth basis and \$17,000\.00 of brokerage's 0% room went unused this year/,
    );
    expect(text).not.toMatch(/ran out/);
    expect(text).not.toMatch(/covered the full discretionary need on its own/);
  });

  it("no leftover-unused clause when both tiers were used exactly to their full capacity", () => {
    const text = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 10000, brokerageZeroLtcgCapacity: 8000 },
      tierBreakdown([
        { source: "roth", costRate: 0, amount: 10000 },
        { source: "brokerage", costRate: 0, amount: 8000 },
      ]),
      "roth_first",
      false,
    )!;
    expect(text).toMatch(
      /\$10,000\.00 came from Roth basis and \$8,000\.00 from brokerage/,
    );
    expect(text).not.toMatch(/went unused/);
  });

  it("clamps 'used' to rothBasisCapacity when a $0-cost Roth GROWTH entry (household in the 0% ordinary bracket) would otherwise push 'used' above the household's real basis", () => {
    // Both a $0-cost Roth basis draw AND a $0-cost Roth GROWTH draw exist
    // in tierBreakdown -- summing them uncapped would claim more came from
    // basis ($8,000) than the household's actual basis capacity ($5,000),
    // a self-contradicting number.
    const text = describeDiscretionaryCapacityMath(
      { rothBasisCapacity: 5000, brokerageZeroLtcgCapacity: 20000 },
      tierBreakdown([
        { source: "roth", costRate: 0, amount: 5000 }, // basis
        { source: "roth", costRate: 0, amount: 3000 }, // growth, also 0% this year
      ]),
      "roth_first",
      false,
    )!;
    expect(text).toMatch(/\$5,000\.00 came from Roth basis/);
    expect(text).not.toMatch(/\$8,000\.00 came from Roth basis/);
  });
});
