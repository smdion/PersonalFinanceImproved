/**
 * Tests for computeQcdAmounts / totalQcdAmount (R46) — the QCD-eligible
 * amount approximation: min(cap, personRmdAmount, personIraTraditionalBalance).
 */
import { describe, it, expect } from "vitest";
import {
  computeQcdAmounts,
  totalQcdAmount,
} from "@/lib/calculators/engine/qcd";
import { QCD_ANNUAL_CAP_PER_PERSON } from "@/lib/constants";

describe("computeQcdAmounts", () => {
  it("returns empty when qcdMaximize is off, regardless of RMD/IRA size", () => {
    const result = computeQcdAmounts(false, [
      { personId: 1, rmdAmount: 50000, iraTraditionalBalance: 1000000 },
    ]);
    expect(result).toEqual([]);
  });

  it("caps at the person's RMD amount when IRA balance and cap both exceed it", () => {
    const result = computeQcdAmounts(true, [
      { personId: 1, rmdAmount: 20000, iraTraditionalBalance: 1000000 },
    ]);
    expect(result).toEqual([{ personId: 1, qcdAmount: 20000 }]);
  });

  it("caps at the IRA-only Traditional balance when it's the smallest constraint", () => {
    const result = computeQcdAmounts(true, [
      { personId: 1, rmdAmount: 50000, iraTraditionalBalance: 15000 },
    ]);
    expect(result).toEqual([{ personId: 1, qcdAmount: 15000 }]);
  });

  it(`caps at QCD_ANNUAL_CAP_PER_PERSON (${QCD_ANNUAL_CAP_PER_PERSON}) when both RMD and IRA balance exceed it`, () => {
    const result = computeQcdAmounts(true, [
      { personId: 1, rmdAmount: 300000, iraTraditionalBalance: 2000000 },
    ]);
    expect(result).toEqual([
      { personId: 1, qcdAmount: QCD_ANNUAL_CAP_PER_PERSON },
    ]);
  });

  it("excludes a person with zero IRA Traditional balance even if they have an RMD (e.g. 401k-only)", () => {
    const result = computeQcdAmounts(true, [
      { personId: 1, rmdAmount: 40000, iraTraditionalBalance: 0 },
    ]);
    expect(result).toEqual([]);
  });

  it("computes each person independently in a multi-person household", () => {
    const result = computeQcdAmounts(true, [
      { personId: 1, rmdAmount: 20000, iraTraditionalBalance: 1000000 },
      { personId: 2, rmdAmount: 300000, iraTraditionalBalance: 2000000 },
      { personId: 3, rmdAmount: 40000, iraTraditionalBalance: 0 },
    ]);
    expect(result).toEqual([
      { personId: 1, qcdAmount: 20000 },
      { personId: 2, qcdAmount: QCD_ANNUAL_CAP_PER_PERSON },
    ]);
  });
});

describe("totalQcdAmount", () => {
  it("sums per-person QCD amounts", () => {
    expect(
      totalQcdAmount([
        { personId: 1, qcdAmount: 20000 },
        { personId: 2, qcdAmount: 105000 },
      ]),
    ).toBe(125000);
  });

  it("returns 0 for an empty result set", () => {
    expect(totalQcdAmount([])).toBe(0);
  });
});
