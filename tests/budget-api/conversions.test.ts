import { describe, it, expect } from "vitest";
import {
  fromMilliunits,
  toMilliunits,
  fromCents,
  toCents,
} from "@/lib/budget-api/conversions";

describe("YNAB milliunits", () => {
  it("fromMilliunits converts to dollars", () => {
    expect(fromMilliunits(1000)).toBe(1);
    expect(fromMilliunits(1500)).toBe(1.5);
    expect(fromMilliunits(-5000)).toBe(-5);
    expect(fromMilliunits(0)).toBe(0);
  });

  it("toMilliunits converts from dollars", () => {
    expect(toMilliunits(1)).toBe(1000);
    expect(toMilliunits(1.5)).toBe(1500);
    expect(toMilliunits(-5)).toBe(-5000);
    expect(toMilliunits(0)).toBe(0);
  });

  it("toMilliunits rounds to nearest integer", () => {
    expect(toMilliunits(1.2345)).toBe(1235);
    expect(toMilliunits(0.0001)).toBe(0);
  });
});

describe("Actual Budget cents", () => {
  it("fromCents converts to dollars", () => {
    expect(fromCents(100)).toBe(1);
    expect(fromCents(150)).toBe(1.5);
    expect(fromCents(-500)).toBe(-5);
    expect(fromCents(0)).toBe(0);
  });

  it("toCents converts from dollars", () => {
    expect(toCents(1)).toBe(100);
    expect(toCents(1.5)).toBe(150);
    expect(toCents(-5)).toBe(-500);
    expect(toCents(0)).toBe(0);
  });

  it("toCents rounds to nearest integer", () => {
    expect(toCents(1.234)).toBe(123);
    expect(toCents(1.235)).toBe(124);
  });
});

describe("round-trip conversions", () => {
  it("milliunits round-trip preserves value", () => {
    expect(fromMilliunits(toMilliunits(42.5))).toBe(42.5);
  });

  it("cents round-trip preserves value", () => {
    expect(fromCents(toCents(42.5))).toBe(42.5);
  });
});
