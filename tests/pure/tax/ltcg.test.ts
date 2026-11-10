import { describe, it, expect } from "vitest";
import {
  getLtcgRate,
  ltcgRateForNextDollar,
  computeLtcgTax,
  ltcgRoomForRate,
  ltcgStackBase,
} from "@/lib/pure/tax/ltcg";
import { shippedTaxTables } from "../../helpers/tax-data";

/** The shipped 2026 LTCG brackets. */
const LTCG = shippedTaxTables(2026).ltcgBrackets;

// LTCG brackets are denominated in taxable income, not gross ordinary
// income. $120,100 gross with MFJ's $32,200 deduction is $87,900 taxable:
// $11,000 under the $98,900 0%-LTCG ceiling.
describe("ltcgStackBase", () => {
  it("subtracts the standard deduction from gross ordinary income", () => {
    expect(ltcgStackBase(120100, 32200).ordinaryTaxable).toBe(87900);
  });

  it("is 0 at exactly the deduction and for a negative gross", () => {
    expect(ltcgStackBase(32200, 32200).ordinaryTaxable).toBe(0);
    expect(ltcgStackBase(-5000, 32200).ordinaryTaxable).toBe(0);
  });

  it("a 0 deduction subtracts nothing", () => {
    expect(ltcgStackBase(120100, 0).ordinaryTaxable).toBe(120100);
  });

  it("floors at 0 rather than going negative", () => {
    expect(ltcgStackBase(10000, 32200).ordinaryTaxable).toBe(0);
  });

  it("leaves the deduction ordinary income doesn't use, never more than the deduction", () => {
    expect(ltcgStackBase(10000, 32200).unusedDeduction).toBe(22200);
    expect(ltcgStackBase(120100, 32200).unusedDeduction).toBe(0);
    expect(ltcgStackBase(-5000, 32200).unusedDeduction).toBe(32200);
    expect(ltcgStackBase(0, undefined).unusedDeduction).toBe(0);
  });

  it("taxes only the gains the unused deduction leaves, stacked on ordinary taxable income", () => {
    expect(ltcgStackBase(10000, 32200, 50000)).toEqual({
      ordinaryTaxable: 0,
      unusedDeduction: 22200,
      taxedGains: 27800,
      top: 27800,
    });
    expect(ltcgStackBase(10000, 32200, 15000).taxedGains).toBe(0);
    expect(ltcgStackBase(120100, 32200, 40000).top).toBe(127900);
    expect(ltcgStackBase(120100, 32200).taxedGains).toBe(0);
  });

  it("undefined standardDeduction ⇒ subtracts 0 (pre-fix behavior, not a throw)", () => {
    expect(ltcgStackBase(120100, undefined).ordinaryTaxable).toBe(120100);
  });

  it("real household scenario: crosses from 15% into 0%-LTCG room once the deduction is applied", () => {
    const grossOrdinary = 120100;
    const withoutFix = ltcgRoomForRate(0, grossOrdinary, "MFJ", LTCG);
    const withFix = ltcgRoomForRate(
      0,
      ltcgStackBase(grossOrdinary, 32200).ordinaryTaxable,
      "MFJ",
      LTCG,
    );
    expect(withoutFix).toBe(0); // the bug: no 0%-LTCG room at all
    expect(withFix).toBe(11000); // 98,900 - 87,900
  });
});

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

// getLtcgRate is where a dollar sits (a ceiling included); this is the
// bracket the next dollar enters (a ceiling excluded, as computeLtcgTax
// stacks), for a slice of gains starting exactly on a ceiling.
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

// Hand-worked against the shipped 2026 MFJ thresholds ($98,900 / $613,700).
describe("computeLtcgTax", () => {
  it("stacks gains on ordinary income: $18,900 at 0%, $11,100 at 15%", () => {
    expect(computeLtcgTax(80000, 30000, "MFJ", LTCG)).toBe(1665);
  });

  it("gains past the 15% ceiling are taxed at 20%", () => {
    // 613,700 − 600,000 = 13,700 at 15% (2,055) and 6,300 at 20% (1,260).
    expect(computeLtcgTax(600000, 20000, "MFJ", LTCG)).toBe(3315);
  });

  it("no gains, no tax", () => {
    expect(computeLtcgTax(80000, 0, "MFJ", LTCG)).toBe(0);
  });
});
