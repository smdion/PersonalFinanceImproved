/**
 * Tests for roth-distribution-tax.ts. Acceptance criteria exercised here:
 * conservation, the qualified test matching PENALTY_FREE_AGE exactly (no
 * second "59.5" definition), and joint accounts (no ownerBirthYear) treated
 * as qualified — matching withdrawal-eligibility.ts's identical handling.
 */
import { describe, it, expect } from "vitest";
import { splitRothWithdrawalForTax } from "@/lib/pure/roth-distribution-tax";
import type { BasisDraw } from "@/lib/pure/roth-basis-tracking";
import { PENALTY_FREE_AGE } from "@/lib/constants";

function makeDraw(overrides: Partial<BasisDraw> = {}): BasisDraw {
  return {
    contributionDrawn: 0,
    conversionDrawn: 0,
    growthDrawn: 0,
    ...overrides,
  };
}

describe("splitRothWithdrawalForTax", () => {
  it("an account with no BasisDraw this year contributes nothing", () => {
    const result = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a", ownerBirthYear: 1990 }],
      draws: new Map(),
      year: 2026,
    });
    expect(result.taxableGrowth).toBe(0);
    expect(result.taxFreeAmount).toBe(0);
    expect(result.byKey.size).toBe(0);
  });

  it("qualified (age >= PENALTY_FREE_AGE): all growth is tax-free", () => {
    const birthYear = 2026 - 62; // age 62 in 2026
    const draws = new Map([
      ["a", makeDraw({ contributionDrawn: 1000, growthDrawn: 5000 })],
    ]);
    const result = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a", ownerBirthYear: birthYear }],
      draws,
      year: 2026,
    });
    expect(result.taxableGrowth).toBe(0);
    expect(result.taxFreeAmount).toBe(6000);
    expect(result.byKey.get("a")).toEqual({
      taxableGrowth: 0,
      qualified: true,
    });
  });

  it("non-qualified (age < PENALTY_FREE_AGE): growth is taxable, basis stays tax-free", () => {
    const birthYear = 2026 - 50; // age 50 in 2026, well under 59.5
    const draws = new Map([
      [
        "a",
        makeDraw({
          contributionDrawn: 1000,
          conversionDrawn: 500,
          growthDrawn: 5000,
        }),
      ],
    ]);
    const result = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a", ownerBirthYear: birthYear }],
      draws,
      year: 2026,
    });
    expect(result.taxableGrowth).toBe(5000);
    expect(result.taxFreeAmount).toBe(1500);
    expect(result.byKey.get("a")).toEqual({
      taxableGrowth: 5000,
      qualified: false,
    });
  });

  it("exact PENALTY_FREE_AGE boundary: qualified at exactly 59.5-equivalent integer age (60)", () => {
    // ageInYear is integer-granular; PENALTY_FREE_AGE=59.5 is only ever
    // crossed at integer age 60 (see ageInYear's docblock). Age 59 must
    // still be non-qualified, age 60 must be qualified.
    const yearAge59Birth = 2026 - 59;
    const yearAge60Birth = 2026 - 60;
    const draws = new Map([["a", makeDraw({ growthDrawn: 1000 })]]);

    const age59Result = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a", ownerBirthYear: yearAge59Birth }],
      draws,
      year: 2026,
    });
    expect(age59Result.byKey.get("a")?.qualified).toBe(false);

    const age60Result = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a", ownerBirthYear: yearAge60Birth }],
      draws,
      year: 2026,
    });
    expect(age60Result.byKey.get("a")?.qualified).toBe(true);
    expect(PENALTY_FREE_AGE).toBe(59.5);
  });

  it("joint account (no ownerBirthYear) is treated as qualified", () => {
    const draws = new Map([["a", makeDraw({ growthDrawn: 3000 })]]);
    const result = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a" }],
      draws,
      year: 2026,
    });
    expect(result.byKey.get("a")).toEqual({
      taxableGrowth: 0,
      qualified: true,
    });
  });

  it("conservation: taxableGrowth + taxFreeAmount === sum of all withdrawn dollars across accounts", () => {
    const draws = new Map([
      [
        "young",
        makeDraw({
          contributionDrawn: 2000,
          conversionDrawn: 1000,
          growthDrawn: 7000,
        }),
      ],
      ["old", makeDraw({ contributionDrawn: 500, growthDrawn: 4500 })],
      ["joint", makeDraw({ growthDrawn: 2500 })],
    ]);
    const totalWithdrawn = [...draws.values()].reduce(
      (s, d) => s + d.contributionDrawn + d.conversionDrawn + d.growthDrawn,
      0,
    );
    const result = splitRothWithdrawalForTax({
      accounts: [
        { indKey: "young", ownerBirthYear: 2026 - 45 },
        { indKey: "old", ownerBirthYear: 2026 - 70 },
        { indKey: "joint" },
      ],
      draws,
      year: 2026,
    });
    expect(result.taxableGrowth + result.taxFreeAmount).toBeCloseTo(
      totalWithdrawn,
      2,
    );
  });

  it("aggregates multiple non-qualified accounts' taxable growth", () => {
    const draws = new Map([
      ["a", makeDraw({ growthDrawn: 3000 })],
      ["b", makeDraw({ growthDrawn: 2000 })],
    ]);
    const result = splitRothWithdrawalForTax({
      accounts: [
        { indKey: "a", ownerBirthYear: 2026 - 40 },
        { indKey: "b", ownerBirthYear: 2026 - 45 },
      ],
      draws,
      year: 2026,
    });
    expect(result.taxableGrowth).toBe(5000);
  });
});
