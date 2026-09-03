import { describe, it, expect } from "vitest";
import {
  ltcgRoomForRate,
  toLtcgTaxableIncome,
  getLtcgRate,
  ltcgRateForNextDollar,
} from "@/lib/config/tax-tables";

describe("ltcgRoomForRate", () => {
  it("MFJ: 0% headroom at $0 ordinary income is the 0% bracket's own ceiling ($98,900)", () => {
    expect(ltcgRoomForRate(0, 0, "MFJ")).toBe(98900);
  });

  it("MFJ: 0% headroom shrinks by however much ordinary income already occupies", () => {
    expect(ltcgRoomForRate(0, 80000, "MFJ")).toBe(18900);
  });

  it("MFJ: 0% headroom floors at 0, never negative, once ordinary income exceeds the ceiling", () => {
    expect(ltcgRoomForRate(0, 200000, "MFJ")).toBe(0);
  });

  it("MFJ: 15% headroom is the 15% bracket's ceiling minus ordinary income", () => {
    expect(ltcgRoomForRate(0.15, 100000, "MFJ")).toBe(513700);
  });

  it("MFJ: no bracket exceeds a 20%+ target ⇒ Infinity (matches incomeCapForMarginalRate's convention)", () => {
    expect(ltcgRoomForRate(0.2, 100000, "MFJ")).toBe(Infinity);
  });

  it("Single: uses the Single bracket table, not MFJ's", () => {
    expect(ltcgRoomForRate(0, 0, "Single")).toBe(49450);
  });

  it("does NOT reproduce incomeCapForMarginalRate's semantics against the same table — regression guard for the advisor-flagged bug", () => {
    // incomeCapForMarginalRate(0, LTCG_BRACKETS.MFJ) would wrongly return
    // 613700 (the 15% bracket's ceiling) because ordinary brackets match
    // `>=` floor semantics while LTCG brackets match `<=` ceiling semantics.
    // ltcgRoomForRate must NOT produce that number here.
    expect(ltcgRoomForRate(0, 0, "MFJ")).not.toBe(613700);
  });

  it("respects DB-loaded override brackets over the hardcoded defaults", () => {
    const dbBrackets = {
      MFJ: [
        { threshold: 50000, rate: 0 },
        { threshold: 300000, rate: 0.15 },
        { threshold: null, rate: 0.2 },
      ],
    };
    expect(ltcgRoomForRate(0, 10000, "MFJ", dbBrackets)).toBe(40000);
  });

  it("returns 0 when the filing status has no bracket data at all", () => {
    expect(ltcgRoomForRate(0, 0, "MFJ", {})).toBe(0);
  });
});

// Regression coverage for the 2026-08-30 fix: LTCG bracket lookups were
// being fed GROSS ordinary income (Traditional withdrawal + taxable SS,
// with nothing subtracted) where the brackets are denominated in real
// taxable income — systematically understating 0%-LTCG room. Confirmed
// against a real household: $120,100 gross Traditional withdrawal +
// $0 taxable SS, MFJ $32,200 standard deduction ⇒ real taxable income
// $87,900, comfortably under the $98,900 0%-LTCG ceiling (~$11,000 of
// room the pre-fix code never saw, since 120,100 alone already exceeds
// 98,900).
describe("toLtcgTaxableIncome", () => {
  it("subtracts the standard deduction from gross ordinary income", () => {
    expect(toLtcgTaxableIncome(120100, 32200)).toBe(87900);
  });

  it("floors at 0 rather than going negative", () => {
    expect(toLtcgTaxableIncome(10000, 32200)).toBe(0);
  });

  it("undefined standardDeduction ⇒ subtracts 0 (pre-fix behavior, not a throw)", () => {
    expect(toLtcgTaxableIncome(120100, undefined)).toBe(120100);
  });

  it("real household scenario: crosses from 15% into 0%-LTCG room once the deduction is applied", () => {
    const grossOrdinary = 120100;
    const withoutFix = ltcgRoomForRate(0, grossOrdinary, "MFJ");
    const withFix = ltcgRoomForRate(
      0,
      toLtcgTaxableIncome(grossOrdinary, 32200),
      "MFJ",
    );
    expect(withoutFix).toBe(0); // the bug: no 0%-LTCG room at all
    expect(withFix).toBe(11000); // 98,900 - 87,900
  });
});

// ltcgRateForNextDollar is the exclusive counterpart to getLtcgRate,
// deliberately NOT consolidated with it (see its
// docblock): getLtcgRate answers "what bracket is a real dollar SITTING
// AT" (inclusive <=, correct for a total-income figure); this answers
// "what bracket does the NEXT dollar enter" (exclusive <, matching
// computeLtcgTax's stacking `floor >= threshold` skip logic) — needed when
// pricing a slice of gains that STARTS at a value landing exactly on
// another bracket's own ceiling, where getLtcgRate would wrongly return
// the bracket BELOW.
describe("ltcgRateForNextDollar", () => {
  it("MFJ: one dollar below the 0% ceiling ⇒ still 0%", () => {
    expect(ltcgRateForNextDollar(98899, "MFJ")).toBe(0);
  });

  it("MFJ: exactly AT the 0% ceiling ⇒ the NEXT dollar is 15%, not 0%", () => {
    expect(ltcgRateForNextDollar(98900, "MFJ")).toBe(0.15);
  });

  it("MFJ: one dollar past the 0% ceiling ⇒ 15%", () => {
    expect(ltcgRateForNextDollar(98901, "MFJ")).toBe(0.15);
  });

  it("MFJ: exactly AT the 15% ceiling ⇒ the NEXT dollar is 20%, not 15%", () => {
    expect(ltcgRateForNextDollar(613700, "MFJ")).toBe(0.2);
  });

  it("MFJ: well past the top bracket ⇒ 20%", () => {
    expect(ltcgRateForNextDollar(1_000_000, "MFJ")).toBe(0.2);
  });

  it("deliberately disagrees with getLtcgRate at an exact ceiling — documents the intentional inclusive/exclusive split", () => {
    expect(getLtcgRate(98900, "MFJ")).toBe(0);
    expect(ltcgRateForNextDollar(98900, "MFJ")).toBe(0.15);
    expect(getLtcgRate(613700, "MFJ")).toBe(0.15);
    expect(ltcgRateForNextDollar(613700, "MFJ")).toBe(0.2);
  });

  it("respects DB-loaded override brackets over the hardcoded defaults", () => {
    const dbBrackets = {
      MFJ: [
        { threshold: 50000, rate: 0 },
        { threshold: 200000, rate: 0.15 },
        { threshold: null, rate: 0.2 },
      ],
    };
    expect(ltcgRateForNextDollar(50000, "MFJ", dbBrackets)).toBe(0.15);
    expect(ltcgRateForNextDollar(200000, "MFJ", dbBrackets)).toBe(0.2);
  });
});
