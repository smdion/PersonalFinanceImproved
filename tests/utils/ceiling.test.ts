import { describe, it, expect } from "vitest";
import { applyCeiling, storedCeiling } from "@/lib/utils/ceiling";

describe("storedCeiling", () => {
  it("reads 0 or unset as no cap", () => {
    expect(storedCeiling(0)).toEqual({ kind: "none" });
    expect(storedCeiling(null)).toEqual({ kind: "none" });
    expect(storedCeiling(undefined)).toEqual({ kind: "none" });
    expect(storedCeiling(-1)).toEqual({ kind: "none" });
  });

  it("reads a positive value as a cap at it", () => {
    expect(storedCeiling(0.06)).toEqual({ kind: "at", amount: 0.06 });
  });
});

describe("applyCeiling", () => {
  it("leaves a value alone with no ceiling", () => {
    expect(applyCeiling(10, { kind: "none" })).toBe(10);
  });

  it("holds a value to the ceiling, 0 included", () => {
    expect(applyCeiling(10, { kind: "at", amount: 4 })).toBe(4);
    expect(applyCeiling(3, { kind: "at", amount: 4 })).toBe(3);
    expect(applyCeiling(10, { kind: "at", amount: 0 })).toBe(0);
  });
});
