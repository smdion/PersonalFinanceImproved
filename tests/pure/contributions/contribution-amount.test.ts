import { describe, it, expect } from "vitest";
import {
  computeAnnualContribution,
  fractionFromPercent,
  parseEmployerMatch,
} from "@/lib/pure/contributions/contribution-amount";

describe("computeAnnualContribution", () => {
  it("computes percent_of_salary correctly", () => {
    // 10% of $120,000
    expect(computeAnnualContribution("percent_of_salary", 10, 120000, 26)).toBe(
      12000,
    );
  });

  it("computes fixed_per_period correctly", () => {
    // $500/period × 26 periods
    expect(computeAnnualContribution("fixed_per_period", 500, 120000, 26)).toBe(
      13000,
    );
  });

  it("computes fixed_monthly correctly", () => {
    // $1000/month × 12
    expect(computeAnnualContribution("fixed_monthly", 1000, 120000, 26)).toBe(
      12000,
    );
  });

  it("computes fixed_annual as the value", () => {
    expect(computeAnnualContribution("fixed_annual", 6000, 120000, 26)).toBe(
      6000,
    );
  });

  it("handles zero salary for percent_of_salary", () => {
    expect(computeAnnualContribution("percent_of_salary", 10, 0, 26)).toBe(0);
  });

  it("handles zero value", () => {
    expect(computeAnnualContribution("percent_of_salary", 0, 120000, 26)).toBe(
      0,
    );
  });
});

describe("computeAnnualContribution: an unknown stored method", () => {
  it("reads as a fixed annual amount", () => {
    expect(computeAnnualContribution("weekly", 6000, 120000, 26)).toBe(6000);
  });
});

describe("parseEmployerMatch", () => {
  it("reads the rate as a whole percent and the cap as a fraction", () => {
    expect(parseEmployerMatch("percent_of_contribution", 50, 0.06)).toEqual({
      kind: "percent_of_contribution",
      rate: fractionFromPercent(50),
      capOfPay: { kind: "at", amount: 0.06 },
    });
  });

  it("reads a 0 cap as none", () => {
    expect(parseEmployerMatch("percent_of_contribution", 100, 0)).toMatchObject(
      {
        capOfPay: { kind: "none" },
      },
    );
  });

  it("reads dollar and fixed-annual matches as flat", () => {
    expect(parseEmployerMatch("dollar_match", 1500, 0)).toEqual({
      kind: "flat",
      perYear: 1500,
    });
    expect(parseEmployerMatch("fixed_annual", 2000, 0)).toEqual({
      kind: "flat",
      perYear: 2000,
    });
  });

  it("reads no type, none, or an unknown stored type as no match", () => {
    expect(parseEmployerMatch(null, 50, 0.06)).toEqual({ kind: "none" });
    expect(parseEmployerMatch("none", 50, 0.06)).toEqual({ kind: "none" });
    expect(parseEmployerMatch("bonus", 50, 0.06)).toEqual({ kind: "none" });
  });
});
