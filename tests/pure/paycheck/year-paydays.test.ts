/** The year's paydays and the salary divisor (PAY-22): a 27 or 53 payday
 *  year counts every real payday, walked from a known one. */
import { describe, expect, it } from "vitest";
import {
  checksPerYearLabel,
  salaryDivisor,
  yearPaydays,
} from "@/lib/pure/paycheck/year-paydays";
import { jobChecksThisYear } from "@/lib/pure/paycheck/job-last-check";
import type { PaycheckInput } from "@/lib/pure/paycheck/paycheck.types";

const at = (
  payPeriod: PaycheckInput["payPeriod"],
  anchor: string,
  asOf = "2026-08-14T12:00:00Z",
) => ({
  payPeriod,
  anchorPayDate: new Date(anchor),
  asOfDate: new Date(asOf),
});

describe("yearPaydays", () => {
  it("biweekly from Thursday January 1, 2026: 27 paydays (the last December 31)", () => {
    expect(yearPaydays(at("biweekly", "2026-01-01"))).toBe(27);
    // The same calendar from a later payday, and from one in the year before.
    expect(yearPaydays(at("biweekly", "2026-07-02"))).toBe(27);
    expect(yearPaydays(at("biweekly", "2025-12-18"))).toBe(27);
  });

  it("biweekly from Friday January 2, 2026: 26 (the 27th falls on January 1, 2027)", () => {
    expect(yearPaydays(at("biweekly", "2026-01-02"))).toBe(26);
  });

  it("the year is the as-of date's: the January 1 calendar has 26 in 2027", () => {
    expect(
      yearPaydays(at("biweekly", "2026-01-01", "2027-03-01T12:00:00Z")),
    ).toBe(26);
  });

  it("a leap year: January 2, 2028's calendar reaches December 31 (27)", () => {
    expect(
      yearPaydays(at("biweekly", "2028-01-02", "2028-03-01T12:00:00Z")),
    ).toBe(27);
  });

  it("weekly: 53 from Thursday January 1, 2026, else 52", () => {
    expect(yearPaydays(at("weekly", "2026-01-01"))).toBe(53);
    expect(yearPaydays(at("weekly", "2026-01-02"))).toBe(52);
  });

  it("semimonthly and monthly keep their periods", () => {
    expect(yearPaydays(at("semimonthly", "2026-01-01"))).toBe(24);
    expect(yearPaydays(at("monthly", "2026-01-01"))).toBe(12);
  });
});

describe("a job's checks, counted up to the periods (the cap pass)", () => {
  it("27 paydays: 26 for the cap pass, 27 for pay", () => {
    const input = {
      ...at("biweekly", "2026-01-01"),
      startDate: new Date("2020-01-01"),
      endDate: null,
    };
    expect(jobChecksThisYear(input).total).toBe(27);
    expect(jobChecksThisYear(input, 26).total).toBe(26);
  });
});

describe("salaryDivisor", () => {
  const year27 = at("biweekly", "2026-01-01");
  it("absent or pay_periods: the pay schedule's periods (26)", () => {
    expect(salaryDivisor(year27)).toBe(26);
    expect(salaryDivisor({ ...year27, salaryDivisor: "pay_periods" })).toBe(26);
  });
  it("paydays: the year's paydays (27)", () => {
    expect(salaryDivisor({ ...year27, salaryDivisor: "paydays" })).toBe(27);
  });
});

describe("checksPerYearLabel", () => {
  it("names the year's checks and the divisor only when they differ", () => {
    expect(checksPerYearLabel(26, { payPeriod: "biweekly" })).toBe(
      "26 checks/yr",
    );
    expect(checksPerYearLabel(27, { payPeriod: "biweekly" })).toBe(
      "27 checks this year (salary ÷ 26 each)",
    );
    expect(
      checksPerYearLabel(27, {
        payPeriod: "biweekly",
        salaryDivisor: "paydays",
      }),
    ).toBe("27 checks this year (salary ÷ 27 each)");
  });
});
