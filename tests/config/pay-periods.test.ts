/**
 * Periods per year has one table, PAY_PERIOD_CONFIG. getPeriodsPerYear and
 * the paycheck calculator must give the same count for every pay period.
 */
import { describe, it, expect } from "vitest";
import { PAY_PERIOD_VALUES } from "@/lib/config/enum-values";
import { PAY_PERIOD_CONFIG, getPeriodsPerYear } from "@/lib/config/pay-periods";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import { PERSON_A_PAYCHECK_INPUT } from "../pure/fixtures";

describe("periods per year", () => {
  it("covers every pay period", () => {
    expect(Object.keys(PAY_PERIOD_CONFIG).sort()).toEqual(
      [...PAY_PERIOD_VALUES].sort(),
    );
  });

  it.each(PAY_PERIOD_VALUES)("%s agrees everywhere", (payPeriod) => {
    const expected = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[
      payPeriod
    ];
    expect(PAY_PERIOD_CONFIG[payPeriod].periodsPerYear).toBe(expected);
    expect(getPeriodsPerYear(payPeriod)).toBe(expected);
    const paycheck = calculatePaycheck({
      ...PERSON_A_PAYCHECK_INPUT,
      payPeriod,
      payWeek: payPeriod === "biweekly" ? "even" : "na",
    });
    expect(paycheck.periodsPerYear).toBe(expected);
  });

  it("rejects an unknown pay period", () => {
    expect(() => getPeriodsPerYear("daily")).toThrow(/Unknown pay period/);
  });
});
