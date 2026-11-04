import { describe, it, expect } from "vitest";
import {
  contributionStateForYear,
  retirementRateCeiling,
} from "@/lib/pure/contributions/contribution-state";

/** An invented working year: a 10% plan, saving at 6% on $80,000. */
const year = {
  actual: false,
  savingStopped: false,
  rate: 0.06,
  defaultRate: 0.1,
  salary: 80_000,
};

describe("contributionStateForYear", () => {
  it("contributes at the year's rate", () => {
    expect(contributionStateForYear(year)).toEqual({
      kind: "contributing",
      rate: 0.06,
    });
  });

  it("pauses on a 0% rate when the plan's own rate is above 0 and there's pay", () => {
    expect(contributionStateForYear({ ...year, rate: 0 })).toEqual({
      kind: "paused",
    });
  });

  it("doesn't pause a plan whose own rate is 0, or a year with no pay", () => {
    for (const y of [
      { ...year, rate: 0, defaultRate: 0 },
      { ...year, rate: 0, salary: 0 },
    ])
      expect(contributionStateForYear(y).kind).toBe("contributing");
  });

  it("stops when nobody saves, ahead of a pause", () => {
    expect(contributionStateForYear({ ...year, savingStopped: true })).toEqual({
      kind: "stopped",
    });
    expect(
      contributionStateForYear({ ...year, savingStopped: true, rate: 0 }),
    ).toEqual({ kind: "stopped" });
  });

  it("year 0's real contributions are contributing, whatever the rate", () => {
    expect(
      contributionStateForYear({ ...year, actual: true, rate: 0 }).kind,
    ).toBe("contributing");
  });
});

describe("retirementRateCeiling", () => {
  it("holds a paused year to 0", () => {
    expect(retirementRateCeiling({ kind: "paused" }, 0)).toEqual({
      kind: "at",
      amount: 0,
    });
  });

  it("a 0 amount otherwise sets no limit", () => {
    expect(retirementRateCeiling({ kind: "contributing", rate: 0 }, 0)).toEqual(
      { kind: "none" },
    );
  });

  it("caps at rate × pay", () => {
    expect(
      retirementRateCeiling({ kind: "contributing", rate: 0.06 }, 4_800),
    ).toEqual({ kind: "at", amount: 4_800 });
  });
});
