import { describe, it, expect } from "vitest";
import { toNumber, toNumberOrNull } from "@/lib/utils/numbers";

describe("toNumber", () => {
  it("parses numeric string", () => {
    expect(toNumber("123.45")).toBe(123.45);
  });

  it("returns 0 for null", () => {
    expect(toNumber(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(toNumber(undefined)).toBe(0);
  });

  it("returns NaN for non-numeric string", () => {
    expect(toNumber("abc")).toBeNaN();
  });

  it("parses empty string as NaN", () => {
    expect(toNumber("")).toBeNaN();
  });

  it("parses negative numbers", () => {
    expect(toNumber("-42.5")).toBe(-42.5);
  });

  it("parses zero", () => {
    expect(toNumber("0")).toBe(0);
  });
});

describe("toNumberOrNull", () => {
  it("returns null for null and undefined", () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
  });

  it("parses a present value exactly as toNumber does", () => {
    for (const v of ["123.45", "0", "-42.5", "", "abc", "1e3", " 7 "]) {
      expect(toNumberOrNull(v)).toEqual(toNumber(v));
    }
  });

  it("keeps zero as zero", () => {
    expect(toNumberOrNull("0")).toBe(0);
  });

  it("parses an empty string as NaN, not null", () => {
    expect(toNumberOrNull("")).toBeNaN();
  });
});
