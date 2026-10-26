/**
 * Tests for computeQcdAmounts / totalQcdAmount — the QCD-eligible
 * amount approximation: min(cap, personIraTraditionalBalance). Not capped
 * by the person's RMD amount — IRC §408(d)(8) caps a QCD at the annual
 * dollar limit, not at the RMD; a QCD can legally exceed the RMD.
 */
import { describe, it, expect } from "vitest";
import {
  computeQcdAmounts,
  totalQcdAmount,
} from "@/lib/calculators/engine/qcd";

/** An invented per-person limit (the real one is the year's
 *  `qcd_annual_limit`, passed in by the engine). */
const LIMIT = 100000;

describe("computeQcdAmounts", () => {
  it("returns empty when qcdMaximize is off, regardless of IRA size", () => {
    const result = computeQcdAmounts(
      false,
      [{ personId: 1, iraTraditionalBalance: 1000000 }],
      LIMIT,
    );
    expect(result).toEqual([]);
  });

  it("is NOT capped by an RMD amount — can exceed it up to the IRA balance/annual cap", () => {
    // A person with a small (or zero) RMD can still QCD up to their full
    // IRA balance (below the annual cap) -- the RMD size never enters
    // this computation.
    const result = computeQcdAmounts(
      true,
      [{ personId: 1, iraTraditionalBalance: 60000 }],
      LIMIT,
    );
    expect(result).toEqual([{ personId: 1, qcdAmount: 60000 }]);
  });

  it("caps at the IRA-only Traditional balance when it's below the annual cap", () => {
    const result = computeQcdAmounts(
      true,
      [{ personId: 1, iraTraditionalBalance: 15000 }],
      LIMIT,
    );
    expect(result).toEqual([{ personId: 1, qcdAmount: 15000 }]);
  });

  it("caps at the per-person limit when the IRA balance exceeds it", () => {
    const result = computeQcdAmounts(
      true,
      [{ personId: 1, iraTraditionalBalance: 2000000 }],
      LIMIT,
    );
    expect(result).toEqual([{ personId: 1, qcdAmount: LIMIT }]);
  });

  it("excludes a person with zero IRA Traditional balance (e.g. 401k-only)", () => {
    const result = computeQcdAmounts(
      true,
      [{ personId: 1, iraTraditionalBalance: 0 }],
      LIMIT,
    );
    expect(result).toEqual([]);
  });

  it("computes each person independently in a multi-person household", () => {
    const result = computeQcdAmounts(
      true,
      [
        { personId: 1, iraTraditionalBalance: 20000 },
        { personId: 2, iraTraditionalBalance: 2000000 },
        { personId: 3, iraTraditionalBalance: 0 },
      ],
      LIMIT,
    );
    expect(result).toEqual([
      { personId: 1, qcdAmount: 20000 },
      { personId: 2, qcdAmount: LIMIT },
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
