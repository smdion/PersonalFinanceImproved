/**
 * Decimal text in one form on both databases: trailing fractional zeros
 * go, anything that isn't plain decimal text is left as it is.
 */
import { describe, it, expect } from "vitest";
import { canonicalDecimalText } from "@/lib/utils/decimal-text";

describe("canonicalDecimalText", () => {
  it.each([
    ["300.00", "300"],
    ["300", "300"],
    ["0.500000", "0.5"],
    ["1234.50", "1234.5"],
    ["0.000000", "0"],
    ["-0.00", "0"],
    ["-12.340", "-12.34"],
    ["100.0100", "100.01"],
    ["", ""],
    ["1e3", "1e3"],
    ["abc", "abc"],
  ])("reads %j as %j", (text, canonical) => {
    expect(canonicalDecimalText(text)).toBe(canonical);
  });
});
