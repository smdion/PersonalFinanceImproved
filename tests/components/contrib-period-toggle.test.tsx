/**
 * The one contribution-period part (Dashboard, Paycheck, Contributions):
 * its words, each page's option order, and the zero-periods case.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ContributionPeriodToggle,
  getContributionMultiplier,
  getPeriodSuffix,
  householdPeriodsPerYear,
  toContributionPeriod,
} from "@/components/ui/contrib-period-toggle";

const labels = () => screen.getAllByRole("radio").map((b) => b.textContent);

describe("ContributionPeriodToggle", () => {
  it("says Per paycheck, Monthly, Annual by default (Dashboard, Paycheck)", () => {
    render(<ContributionPeriodToggle value="annual" onChange={vi.fn()} />);
    expect(labels()).toEqual(["Per paycheck", "Monthly", "Annual"]);
  });

  it("starts from the year with annualFirst (Contributions)", () => {
    render(
      <ContributionPeriodToggle
        value="annual"
        onChange={vi.fn()}
        order="annualFirst"
        look="pill"
      />,
    );
    expect(labels()).toEqual(["Annual", "Monthly", "Per paycheck"]);
  });

  it("suffixes an amount /paycheck, /mo or /yr", () => {
    expect(getPeriodSuffix("paycheck")).toBe("/paycheck");
    expect(getPeriodSuffix("monthly")).toBe("/mo");
    expect(getPeriodSuffix("annual")).toBe("/yr");
  });
});

describe("toContributionPeriod", () => {
  it("divides an annual amount by the period", () => {
    expect(toContributionPeriod(26_000, 26, "paycheck")).toBe(1_000);
    expect(toContributionPeriod(1_000, 26, "monthly")).toBe(1_000 / 12);
    expect(toContributionPeriod(1_000, 26, "annual")).toBe(1_000);
  });

  it("gives $0 per paycheck when a person has no pay periods", () => {
    expect(toContributionPeriod(12_000, 0, "paycheck")).toBe(0);
    expect(getContributionMultiplier("paycheck", 0)).toBe(0);
  });
});

describe("householdPeriodsPerYear", () => {
  it("averages the people's paychecks a year, 26 with no one", () => {
    expect(householdPeriodsPerYear([26, 24])).toBe(25);
    expect(householdPeriodsPerYear([])).toBe(26);
  });
});
