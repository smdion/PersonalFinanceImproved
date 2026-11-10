import { describe, it, expect } from "vitest";
import {
  autoMaxView,
  type AutoMaxInput,
} from "@/lib/pure/contributions/auto-max";

/** An invented 401k: $23,000 limit, $5,000 used by another 401k. */
const base: AutoMaxInput = {
  accountType: "401k",
  contributionMethod: "percent_of_salary",
  currentValue: 10,
  annualLimit: 23_000,
  employerMatchAnnual: 3_000,
  siblingAnnualContributions: 5_000,
  salary: 100_000,
  periodsPerYear: 26,
};

describe("autoMaxView", () => {
  it("leaves the limit less the other accounts' contributions", () => {
    expect(autoMaxView(base).remainingLimit).toBe(18_000);
  });

  it("takes the employer match off only where it counts toward the limit", () => {
    const hsa: AutoMaxInput = {
      ...base,
      accountType: "hsa",
      annualLimit: 8_000,
    };
    expect(autoMaxView(hsa).remainingLimit).toBe(0);
    expect(
      autoMaxView({ ...hsa, employerMatchAnnual: 1_000 }).remainingLimit,
    ).toBe(2_000);
  });

  it("sizes a percent of salary in whole percents, rounded down", () => {
    const view = autoMaxView({ ...base, salary: 110_000 });
    expect(view.target).toEqual({
      method: "percent_of_salary",
      current: 10,
      currentAnnual: 110_000 * (10 / 100),
      target: 16,
      targetAnnual: 110_000 * (16 / 100),
      wouldChange: true,
    });
  });

  it("sizes a per-paycheck amount to the cent, rounded down", () => {
    const view = autoMaxView({
      ...base,
      contributionMethod: "fixed_per_period",
      currentValue: 692.3,
    });
    expect(view.target).toEqual({
      method: "fixed_per_period",
      current: 692.3,
      currentAnnual: 692.3 * 26,
      target: 692.3,
      targetAnnual: 692.3 * 26,
      wouldChange: false,
    });
    expect(view.currentAnnual).toBe(692.3 * 26);
  });

  it("sizes a monthly amount and an annual one", () => {
    const monthly = autoMaxView({
      ...base,
      contributionMethod: "fixed_monthly",
      currentValue: 1_000,
    });
    expect(monthly.target?.target).toBe(1_500);
    expect(monthly.target?.targetAnnual).toBe(18_000);
    expect(monthly.currentAnnual).toBe(12_000);
    const annual = autoMaxView({
      ...base,
      contributionMethod: "fixed_annual",
      currentValue: 18_000,
    });
    expect(annual.target?.target).toBe(18_000);
    expect(annual.target?.wouldChange).toBe(false);
  });

  it("has no target for a method it can't size", () => {
    expect(autoMaxView({ ...base, salary: 0 }).target).toBeNull();
    expect(
      autoMaxView({
        ...base,
        contributionMethod: "fixed_per_period",
        periodsPerYear: undefined,
      }).target,
    ).toBeNull();
  });

  it("says when the other accounts use the whole limit", () => {
    const full = autoMaxView({ ...base, siblingAnnualContributions: 23_000 });
    expect(full.remainingLimit).toBe(0);
    expect(full.target).toBeNull();
    expect(full.limitUsedByOthers).toBe(true);
    expect(autoMaxView(base).limitUsedByOthers).toBe(false);
  });

  it("has no room and no note without a limit", () => {
    const none = autoMaxView({ ...base, annualLimit: undefined });
    expect(none.remainingLimit).toBe(0);
    expect(none.target).toBeNull();
    expect(none.limitUsedByOthers).toBe(false);
  });
});
