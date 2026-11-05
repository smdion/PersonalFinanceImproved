import { describe, it, expect } from "vitest";
import {
  ltcgRoomForRate,
  getLtcgRate,
  ltcgRateForNextDollar,
} from "@/lib/config/tax-tables";
import { shippedTaxTables } from "../helpers/tax-data";

/** The shipped 2026 LTCG brackets. */
const LTCG = shippedTaxTables(2026).ltcgBrackets;

describe("ltcgRoomForRate", () => {
  it("MFJ: 0% headroom at $0 ordinary income is the 0% bracket's own ceiling ($98,900)", () => {
    expect(ltcgRoomForRate(0, 0, "MFJ", LTCG)).toBe(98900);
  });

  it("MFJ: 0% headroom shrinks by however much ordinary income already occupies", () => {
    expect(ltcgRoomForRate(0, 80000, "MFJ", LTCG)).toBe(18900);
  });

  it("MFJ: 0% headroom floors at 0, never negative, once ordinary income exceeds the ceiling", () => {
    expect(ltcgRoomForRate(0, 200000, "MFJ", LTCG)).toBe(0);
  });

  it("MFJ: 15% headroom is the 15% bracket's ceiling minus ordinary income", () => {
    expect(ltcgRoomForRate(0.15, 100000, "MFJ", LTCG)).toBe(513700);
  });

  it("MFJ: no bracket exceeds a 20%+ target ⇒ Infinity (matches incomeCapForMarginalRate's convention)", () => {
    expect(ltcgRoomForRate(0.2, 100000, "MFJ", LTCG)).toBe(Infinity);
  });

  it("Single: uses the Single bracket table, not MFJ's", () => {
    expect(ltcgRoomForRate(0, 0, "Single", LTCG)).toBe(49450);
  });

  it("does NOT reproduce incomeCapForMarginalRate's semantics against the same table — regression guard for the advisor-flagged bug", () => {
    // incomeCapForMarginalRate(0, LTCG.MFJ) would wrongly return
    // 613700 (the 15% bracket's ceiling) because ordinary brackets match
    // `>=` floor semantics while LTCG brackets match `<=` ceiling semantics.
    // ltcgRoomForRate must NOT produce that number here.
    expect(ltcgRoomForRate(0, 0, "MFJ", LTCG)).not.toBe(613700);
  });

  it("reads the brackets it's given", () => {
    const dbBrackets = {
      MFJ: [
        { threshold: 50000, rate: 0 },
        { threshold: 300000, rate: 0.15 },
        { threshold: null, rate: 0.2 },
      ],
    };
    expect(ltcgRoomForRate(0, 10000, "MFJ", dbBrackets)).toBe(40000);
  });

  it("throws when the filing status has no brackets (never guesses)", () => {
    expect(() => ltcgRoomForRate(0, 0, "MFJ", {})).toThrow(/MFJ/);
    expect(() => getLtcgRate(0, "MFJ", { Single: [] })).toThrow(/MFJ/);
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
    expect(ltcgRateForNextDollar(98899, "MFJ", LTCG)).toBe(0);
  });

  it("MFJ: exactly AT the 0% ceiling ⇒ the NEXT dollar is 15%, not 0%", () => {
    expect(ltcgRateForNextDollar(98900, "MFJ", LTCG)).toBe(0.15);
  });

  it("MFJ: one dollar past the 0% ceiling ⇒ 15%", () => {
    expect(ltcgRateForNextDollar(98901, "MFJ", LTCG)).toBe(0.15);
  });

  it("MFJ: exactly AT the 15% ceiling ⇒ the NEXT dollar is 20%, not 15%", () => {
    expect(ltcgRateForNextDollar(613700, "MFJ", LTCG)).toBe(0.2);
  });

  it("MFJ: well past the top bracket ⇒ 20%", () => {
    expect(ltcgRateForNextDollar(1_000_000, "MFJ", LTCG)).toBe(0.2);
  });

  it("deliberately disagrees with getLtcgRate at an exact ceiling — documents the intentional inclusive/exclusive split", () => {
    expect(getLtcgRate(98900, "MFJ", LTCG)).toBe(0);
    expect(ltcgRateForNextDollar(98900, "MFJ", LTCG)).toBe(0.15);
    expect(getLtcgRate(613700, "MFJ", LTCG)).toBe(0.15);
    expect(ltcgRateForNextDollar(613700, "MFJ", LTCG)).toBe(0.2);
  });

  it("reads the brackets it's given", () => {
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
