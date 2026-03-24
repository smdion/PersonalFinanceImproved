import { describe, it, expect } from "vitest";
import { isPriorYearContribWindow } from "@/lib/utils/date";

describe("isPriorYearContribWindow", () => {
  it("returns true for January 1", () => {
    expect(isPriorYearContribWindow(new Date(2026, 0, 1))).toBe(true);
  });

  it("returns true for February 15", () => {
    expect(isPriorYearContribWindow(new Date(2026, 1, 15))).toBe(true);
  });

  it("returns true for March 31", () => {
    expect(isPriorYearContribWindow(new Date(2026, 2, 31))).toBe(true);
  });

  it("returns true for April 15 (deadline day)", () => {
    expect(isPriorYearContribWindow(new Date(2026, 3, 15))).toBe(true);
  });

  it("returns false for April 16", () => {
    expect(isPriorYearContribWindow(new Date(2026, 3, 16))).toBe(false);
  });

  it("returns false for May 1", () => {
    expect(isPriorYearContribWindow(new Date(2026, 4, 1))).toBe(false);
  });

  it("returns false for December 31", () => {
    expect(isPriorYearContribWindow(new Date(2026, 11, 31))).toBe(false);
  });
});
