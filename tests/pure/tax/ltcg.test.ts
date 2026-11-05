import { describe, it, expect } from "vitest";
import { ltcgRoomForRate } from "@/lib/config/tax-tables";
import { toLtcgTaxableIncome } from "@/lib/pure/tax/ltcg";
import { shippedTaxTables } from "../../helpers/tax-data";

/** The shipped 2026 LTCG brackets. */
const LTCG = shippedTaxTables(2026).ltcgBrackets;

// LTCG brackets are denominated in taxable income, not gross ordinary
// income. $120,100 gross with MFJ's $32,200 deduction is $87,900 taxable:
// $11,000 under the $98,900 0%-LTCG ceiling.
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
    const withoutFix = ltcgRoomForRate(0, grossOrdinary, "MFJ", LTCG);
    const withFix = ltcgRoomForRate(
      0,
      toLtcgTaxableIncome(grossOrdinary, 32200),
      "MFJ",
      LTCG,
    );
    expect(withoutFix).toBe(0); // the bug: no 0%-LTCG room at all
    expect(withFix).toBe(11000); // 98,900 - 87,900
  });
});
