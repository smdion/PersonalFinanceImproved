/**
 * ProfileSelection (DESIGN § Profile Resolution): a page sends only what it
 * picked, the server hands the engine payload exactly those picks, and a
 * stale flat key is refused rather than dropped.
 */
import { describe, it, expect } from "vitest";
import {
  engineProfileOptions,
  profileSelectionFrom,
  profileSelectionSchema,
} from "@/lib/pure/household/profile-selection";

describe("profileSelectionFrom", () => {
  it("leaves out every key the page didn't pick", () => {
    expect(
      profileSelectionFrom({
        contributionProfileId: null,
        salaryProfileId: undefined,
        accumulationBudgetColumn: null,
      }),
    ).toEqual({});
  });

  it("groups each phase's budget fields, keeping a typed 0", () => {
    expect(
      profileSelectionFrom({
        contributionProfileId: 2,
        retirementProfileId: 4,
        accumulationBudgetProfileId: 3,
        accumulationBudgetColumn: 1,
        decumulationExpenseOverride: 0,
      }),
    ).toEqual({
      contribution: 2,
      retirement: 4,
      accumulationBudget: { profileId: 3, column: 1 },
      decumulationBudget: { annualExpenses: 0 },
    });
  });
});

describe("engineProfileOptions", () => {
  it("gives back today's flat options, absent staying absent", () => {
    const picks = {
      contributionProfileId: 2,
      salaryProfileId: 1,
      accumulationBudgetProfileId: 3,
      accumulationExpenseOverride: 50_000,
      decumulationBudgetColumn: 2,
    };
    expect(engineProfileOptions(profileSelectionFrom(picks))).toEqual({
      ...picks,
      retirementProfileId: undefined,
      accumulationBudgetColumn: undefined,
      decumulationBudgetProfileId: undefined,
      decumulationExpenseOverride: undefined,
    });
    expect(
      Object.values(engineProfileOptions()).every((v) => v === undefined),
    ).toBe(true);
  });
});

describe("profileSelectionSchema", () => {
  it("refuses a flat key instead of stripping it", () => {
    expect(
      profileSelectionSchema.safeParse({ contributionProfileId: 2 }).success,
    ).toBe(false);
    expect(
      profileSelectionSchema.safeParse({
        accumulationBudget: { profileId: 3, extra: 1 },
      }).success,
    ).toBe(false);
  });
});
