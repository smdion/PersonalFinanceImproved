import { describe, it, expect } from "vitest";
import { sumBracketTax } from "@/lib/calculators/tax-brackets";

const BRACKETS = [
  { min: 0, max: 10000, rate: 0.1 },
  { min: 10000, max: 40000, rate: 0.12 },
  { min: 40000, max: 100000, rate: 0.22 },
  { min: 100000, max: null, rate: 0.24 },
];

describe("sumBracketTax", () => {
  it("zero income yields zero tax", () => {
    const { total, marginalRate } = sumBracketTax(0, BRACKETS);
    expect(total).toBe(0);
    expect(marginalRate).toBe(0);
  });

  it("income within the first bracket", () => {
    const { total, marginalRate } = sumBracketTax(5000, BRACKETS);
    expect(total).toBe(500); // 5000 * 0.10
    expect(marginalRate).toBe(0.1);
  });

  it("income exactly at a bracket boundary uses the lower bracket's rate", () => {
    const { total, marginalRate } = sumBracketTax(100000, BRACKETS);
    expect(total).toBe(1000 + 30000 * 0.12 + 60000 * 0.22);
    expect(marginalRate).toBe(0.22);
  });

  it("income $1 past a bracket boundary crosses into the next bracket", () => {
    const { total, marginalRate } = sumBracketTax(100001, BRACKETS);
    expect(total).toBeCloseTo(1000 + 30000 * 0.12 + 60000 * 0.22 + 1 * 0.24, 6);
    expect(marginalRate).toBe(0.24);
  });

  it("income in the open-ended top bracket", () => {
    const { total, marginalRate } = sumBracketTax(500000, BRACKETS);
    expect(total).toBeCloseTo(
      1000 + 30000 * 0.12 + 60000 * 0.22 + 400000 * 0.24,
      6,
    );
    expect(marginalRate).toBe(0.24);
  });

  it("empty bracket list yields zero", () => {
    const { total, marginalRate } = sumBracketTax(50000, []);
    expect(total).toBe(0);
    expect(marginalRate).toBe(0);
  });
});
