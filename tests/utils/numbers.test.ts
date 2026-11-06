import { describe, it, expect } from "vitest";
import { toNumber } from "@/lib/utils/numbers";

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
