import { describe, it, expect } from "vitest";
import { computeRmdSmoothingTargets } from "@/lib/calculators/engine/rmd-smoothing";
import type {
  RmdSmoothingInput,
  RmdSmoothingPersonInput,
} from "@/lib/calculators/engine/rmd-smoothing";

function person(
  overrides: Partial<RmdSmoothingPersonInput> = {},
): RmdSmoothingPersonInput {
  return {
    personId: 1,
    currentAge: 60,
    rmdStartAge: 73,
    personTraditionalBalance: 500000,
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<RmdSmoothingInput> = {},
): RmdSmoothingInput {
  return {
    enabled: true,
    people: [person()],
    householdTraditionalBalance: 500000,
    returnRateMap: new Map([[0, 0.05]]), // flat 5% for every age (fallback)
    totalTraditionalWithdrawal: 40000,
    totalWithdrawal: 80000, // 50% Traditional
    currentProjectedAnnualSpendingNeed: 80000,
    postRetirementInflationRate: 0.02,
    ...overrides,
  };
}

describe("computeRmdSmoothingTargets", () => {
  it("returns an all-zero result when disabled", () => {
    const result = computeRmdSmoothingTargets(baseInput({ enabled: false }));
    expect(result.householdSmoothingTarget).toBe(0);
    expect(result.byPerson).toEqual([]);
  });

  it("returns an all-zero result when no people are supplied", () => {
    const result = computeRmdSmoothingTargets(baseInput({ people: [] }));
    expect(result.householdSmoothingTarget).toBe(0);
  });

  it("skips a person already at or past RMD age", () => {
    const result = computeRmdSmoothingTargets(
      baseInput({ people: [person({ currentAge: 73, rmdStartAge: 73 })] }),
    );
    expect(result.byPerson).toEqual([]);
  });

  it("skips a person with no Traditional balance", () => {
    const result = computeRmdSmoothingTargets(
      baseInput({ people: [person({ personTraditionalBalance: 0 })] }),
    );
    expect(result.byPerson).toEqual([]);
  });

  it("produces a positive target for a person whose projected future RMD would exceed spending need", () => {
    const result = computeRmdSmoothingTargets(
      baseInput({
        people: [
          person({
            currentAge: 70,
            rmdStartAge: 73,
            // Large enough that even after 3 years of estimated
            // withdrawal + modest growth, the projected balance clears
            // what the (much smaller) projected spending need would
            // imply as a target RMD-driving balance -- regardless of the
            // exact IRS factor at 73.
            personTraditionalBalance: 10_000_000,
          }),
        ],
        householdTraditionalBalance: 10_000_000,
      }),
    );
    expect(result.byPerson).toHaveLength(1);
    expect(result.byPerson[0]!.thisYearSmoothingTarget).toBeGreaterThan(0);
    expect(result.householdSmoothingTarget).toBe(
      result.byPerson[0]!.thisYearSmoothingTarget,
    );
  });

  it("returns zero when the projected future RMD already lands at or under spending need", () => {
    const result = computeRmdSmoothingTargets(
      baseInput({
        people: [
          person({
            currentAge: 72,
            rmdStartAge: 73,
            personTraditionalBalance: 10000, // tiny balance, one year out
          }),
        ],
        householdTraditionalBalance: 10000,
      }),
    );
    expect(result.byPerson).toEqual([]);
    expect(result.householdSmoothingTarget).toBe(0);
  });

  it("floors the forward-projected balance at 0 instead of going negative when estimated withdrawals exceed growth", () => {
    // Small balance, large spending need relative to it, long horizon --
    // the balance should deplete to 0 well before rmdStartAge, not go
    // negative, and therefore produce zero target (nothing left to force
    // an RMD from).
    const result = computeRmdSmoothingTargets(
      baseInput({
        people: [
          person({
            currentAge: 55,
            rmdStartAge: 73,
            personTraditionalBalance: 50000,
          }),
        ],
        householdTraditionalBalance: 50000,
        totalTraditionalWithdrawal: 100000,
        totalWithdrawal: 100000, // 100% Traditional -- aggressive drawdown
        currentProjectedAnnualSpendingNeed: 100000,
      }),
    );
    expect(result.byPerson).toEqual([]);
  });

  it("computes independent targets for a two-person household with different ages/balances/shares", () => {
    const result = computeRmdSmoothingTargets(
      baseInput({
        people: [
          person({
            personId: 1,
            currentAge: 68,
            rmdStartAge: 73,
            personTraditionalBalance: 7_500_000,
          }),
          person({
            personId: 2,
            currentAge: 65,
            rmdStartAge: 75,
            personTraditionalBalance: 2_500_000,
          }),
        ],
        householdTraditionalBalance: 10_000_000,
      }),
    );
    expect(result.byPerson.length).toBeGreaterThan(0);
    const person1 = result.byPerson.find((p) => p.personId === 1);
    const person2 = result.byPerson.find((p) => p.personId === 2);
    // Person 1 has 3x the balance and less time -- their target, if
    // present, should not simply mirror person 2's.
    if (person1 && person2) {
      expect(person1.thisYearSmoothingTarget).not.toBe(
        person2.thisYearSmoothingTarget,
      );
    }
    const sum = result.byPerson.reduce(
      (s, p) => s + p.thisYearSmoothingTarget,
      0,
    );
    expect(result.householdSmoothingTarget).toBeCloseTo(sum, 2);
  });

  it("returns zero when this year's realized Traditional withdrawal fraction is zero", () => {
    const result = computeRmdSmoothingTargets(
      baseInput({ totalTraditionalWithdrawal: 0 }),
    );
    expect(result.householdSmoothingTarget).toBe(0);
  });
});
