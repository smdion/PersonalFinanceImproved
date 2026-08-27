import { describe, it, expect } from "vitest";
import { ltcgRoomForRate } from "@/lib/config/tax-tables";

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
