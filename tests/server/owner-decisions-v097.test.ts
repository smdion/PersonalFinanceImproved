/** Small rules decided with the owner for v0.9.7. */
import "../routers/setup-mocks";
import { describe, expect, it } from "vitest";
import { resolveJoblessPeriodsPerYear } from "@/server/helpers/contribution";
import { retirementProfileIsFallback } from "@/server/helpers/retirement-profile";
import { isGoalMet } from "@/lib/pure/savings-goal-met";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";

describe("a jobless account paid per paycheck", () => {
  it("is complete when everyone shares a schedule", () => {
    expect(
      resolveJoblessPeriodsPerYear([
        { payPeriod: "biweekly" },
        { payPeriod: "biweekly" },
      ]),
    ).toEqual({ periodsPerYear: 26, incomplete: false });
  });
  it("is incomplete when schedules differ: no job order decides it", () => {
    expect(
      resolveJoblessPeriodsPerYear([
        { payPeriod: "biweekly" },
        { payPeriod: "semimonthly" },
      ]).incomplete,
    ).toBe(true);
  });
});

describe("retirementProfileIsFallback", () => {
  const setting = (value: unknown) => [
    { key: SK_ACTIVE_RETIREMENT_PROFILE_ID, value },
  ];
  const profiles = [{ id: 2 }, { id: 5 }];
  it("is false for a valid active profile, or with no profiles at all", () => {
    expect(retirementProfileIsFallback(setting(5), profiles)).toBe(false);
    expect(retirementProfileIsFallback([], [])).toBe(false);
  });
  it("is true when the setting is missing or names a deleted profile", () => {
    expect(retirementProfileIsFallback([], profiles)).toBe(true);
    expect(retirementProfileIsFallback(setting(9), profiles)).toBe(true);
  });
});

describe("isGoalMet", () => {
  const g = { targetMode: "fixed", target: 100, current: 100 };
  it("needs a fixed target, reached", () => {
    expect(isGoalMet(g)).toBe(true);
    expect(isGoalMet({ ...g, current: 99 })).toBe(false);
    expect(isGoalMet({ ...g, targetMode: "ongoing" })).toBe(false);
    expect(isGoalMet({ ...g, target: 0 })).toBe(false);
  });
});
