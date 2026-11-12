import { describe, it, expect } from "vitest";
import {
  buildBracketInput,
  type WithholdingTableRow,
} from "@/lib/pure/paycheck/withholding";

// Invented tables: thresholds chosen so each figure is easy to work by hand.
const standard: WithholdingTableRow = {
  taxYear: 2030,
  filingStatus: "MFJ",
  w4Checkbox: false,
  brackets: [
    { threshold: 0, rate: 0 },
    { threshold: 20_000, rate: 0.1 },
    { threshold: 60_000, rate: 0.2 },
  ],
};
const checkbox: WithholdingTableRow = {
  taxYear: 2030,
  filingStatus: "MFJ",
  w4Checkbox: true,
  brackets: [
    { threshold: 0, rate: 0 },
    { threshold: 16_000, rate: 0.1 },
  ],
};
const limits = new Map<string, number>([
  ["standard_deduction_mfj", 34_000],
  ["ss_wage_base", 200_000],
  ["fica_ss_rate", 0.062],
  ["fica_medicare_rate", 0.0145],
  ["fica_medicare_surtax_rate", 0.009],
  ["fica_medicare_surtax_threshold", 250_000],
]);

describe("buildBracketInput", () => {
  it("chains each threshold to the next as min and max, the top one open", () => {
    expect(buildBracketInput(standard, limits, []).brackets).toEqual([
      { min: 0, max: 20_000, rate: 0 },
      { min: 20_000, max: 60_000, rate: 0.1 },
      { min: 60_000, max: null, rate: 0.2 },
    ]);
  });

  it("line 1g uses the tables' own standard deduction: twice the 2(c) table's first threshold", () => {
    // 2 × 16,000 = 32,000 (not the return's 34,000), less 20,000.
    const input = buildBracketInput(standard, limits, [standard, checkbox]);
    expect(input.w4Adjustment).toBe(12_000);
    expect(input.standardDeduction).toBe(34_000);
  });

  it("a table of one bracket has no zero band built in: line 1g is the whole standard deduction", () => {
    // No stored table has this shape; it states the intent. With no first
    // taxed threshold to net against, 34,000 − 0.
    const flat: WithholdingTableRow = {
      ...standard,
      brackets: [{ threshold: 0, rate: 0.1 }],
    };
    expect(buildBracketInput(flat, limits, [flat]).w4Adjustment).toBe(34_000);
  });

  it("with no 2(c) table that year, line 1g falls back to the return's standard deduction", () => {
    // 34,000 − 20,000.
    expect(buildBracketInput(standard, limits, [standard]).w4Adjustment).toBe(
      14_000,
    );
    const otherYear = { ...checkbox, taxYear: 2031 };
    expect(
      buildBracketInput(standard, limits, [standard, otherYear]).w4Adjustment,
    ).toBe(14_000);
  });

  it("a 2(c) table takes no line 1g adjustment", () => {
    expect(
      buildBracketInput(checkbox, limits, [standard, checkbox]).w4Adjustment,
    ).toBe(0);
  });

  it("reads FICA from the limits", () => {
    const input = buildBracketInput(standard, limits, []);
    expect(input).toMatchObject({
      filingStatus: "MFJ",
      w4Checkbox: false,
      socialSecurityWageBase: 200_000,
      socialSecurityRate: 0.062,
      medicareRate: 0.0145,
      medicareAdditionalRate: 0.009,
      medicareAdditionalThreshold: 250_000,
    });
  });
});
