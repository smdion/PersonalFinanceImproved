import { describe, it, expect } from "vitest";
import { salaryEntryEdit } from "@/lib/db/salary-entry-edit";

describe("salaryEntryEdit — one parse for every salary editor", () => {
  it("numbers, with blanks clearing the nullable ones", () => {
    expect(salaryEntryEdit("annualSalary", "95000")).toEqual({ salary: 95000 });
    expect(salaryEntryEdit("annualSalary", "0")).toEqual({ salary: 0 });
    expect(salaryEntryEdit("annualSalary", "-5")).toBeNull();
    expect(salaryEntryEdit("bonusPercent", "0.12")).toEqual({
      bonusPercent: 0.12,
    });
    expect(salaryEntryEdit("bonusMultiplier", "abc")).toBeNull();
    expect(salaryEntryEdit("bonusOverride", "")).toEqual({
      bonusOverride: null,
    });
    expect(salaryEntryEdit("bonusOverride", "8000")).toEqual({
      bonusOverride: 8000,
    });
    expect(salaryEntryEdit("budgetPeriodsPerMonth", "")).toEqual({
      budgetPeriodsPerMonth: null,
    });
    expect(salaryEntryEdit("additionalFedWithholding", "25")).toEqual({
      additionalFedWithholding: 25,
    });
  });

  it("the bonus date is one write of both fields", () => {
    expect(salaryEntryEdit("bonusDate", "03-15")).toEqual({
      bonusMonth: 3,
      bonusDayOfMonth: 15,
    });
    expect(salaryEntryEdit("bonusDate", "")).toEqual({
      bonusMonth: null,
      bonusDayOfMonth: null,
    });
  });

  it("choices must be one of their values", () => {
    expect(salaryEntryEdit("payPeriod", "biweekly")).toEqual({
      payPeriod: "biweekly",
    });
    expect(salaryEntryEdit("payPeriod", "daily")).toBeNull();
    expect(salaryEntryEdit("w4FilingStatus", "MFJ")).toEqual({
      w4FilingStatus: "MFJ",
    });
    expect(salaryEntryEdit("bonusDestination", "spending")).toEqual({
      bonusDestination: "spending",
    });
    expect(salaryEntryEdit("bonusDestination", "vacation")).toBeNull();
    expect(salaryEntryEdit("w4Box2cChecked", "true")).toEqual({
      w4Box2cChecked: true,
    });
    expect(salaryEntryEdit("anchorPayDate", "")).toEqual({
      anchorPayDate: null,
    });
    expect(salaryEntryEdit("anchorPayDate", "2026-01-09")).toEqual({
      anchorPayDate: "2026-01-09",
    });
  });

  it("an other-pay amount keeps the job's other lines", () => {
    expect(
      salaryEntryEdit("otherEarnings:7", "40", {
        otherEarnings: { "3": 12.5, "7": 30 },
      }),
    ).toEqual({ otherEarnings: { "3": 12.5, "7": 40 } });
    expect(salaryEntryEdit("otherEarnings:7", "-1")).toBeNull();
  });

  it("job columns aren't Salary Profile fields", () => {
    expect(salaryEntryEdit("employerName", "Acme")).toBeUndefined();
    expect(salaryEntryEdit("title", "Engineer")).toBeUndefined();
  });
});

describe("salaryEntryEdit — out-of-range values are refused", () => {
  it("month 1-12, day 1-31, paychecks per month above 0", () => {
    expect(salaryEntryEdit("bonusMonth", "13")).toBeNull();
    expect(salaryEntryEdit("bonusMonth", "0")).toBeNull();
    expect(salaryEntryEdit("bonusDayOfMonth", "40")).toBeNull();
    expect(salaryEntryEdit("bonusDate", "13-40")).toBeNull();
    expect(salaryEntryEdit("budgetPeriodsPerMonth", "0")).toBeNull();
    expect(salaryEntryEdit("budgetPeriodsPerMonth", "2.17")).toEqual({
      budgetPeriodsPerMonth: 2.17,
    });
  });
});

describe("salaryEntryEdit — the schema's limits", () => {
  it("refuses a half-typed or impossible date", () => {
    expect(salaryEntryEdit("anchorPayDate", "0002-01-09")).toBeNull();
    expect(salaryEntryEdit("anchorPayDate", "2026-02-30")).toBeNull();
    expect(salaryEntryEdit("bonusDate", "02-31")).toBeNull();
    expect(salaryEntryEdit("bonusDate", "1.5-02")).toBeNull();
    // A date some year has.
    expect(salaryEntryEdit("bonusDate", "02-29")).toEqual({
      bonusMonth: 2,
      bonusDayOfMonth: 29,
    });
  });

  it("refuses negative amounts and more than 12 bonus months", () => {
    expect(salaryEntryEdit("bonusPercent", "-0.1")).toBeNull();
    expect(salaryEntryEdit("additionalFedWithholding", "-1")).toBeNull();
    expect(salaryEntryEdit("monthsInBonusYear", "13")).toBeNull();
    expect(salaryEntryEdit("bonusOverride", "0")).toEqual({ bonusOverride: 0 });
  });
});
