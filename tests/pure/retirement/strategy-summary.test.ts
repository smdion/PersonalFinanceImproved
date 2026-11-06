import { describe, expect, it } from "vitest";
import { strategySummary } from "@/lib/pure/retirement/strategy-summary";

const years = [
  { year: 2040, withdrawal: 100, spending: 90, retirementBalance: 1000 },
  { year: 2060, withdrawal: 400, spending: 360, retirementBalance: 4000 },
];
/** Halves every 20 years from 2040. */
const today = (v: number, y: number) => v / 2 ** ((y - 2040) / 20);

describe("strategySummary", () => {
  it("deflates each year by its own year, not the retirement year", () => {
    const s = strategySummary(years, today);
    expect(s.legacy).toBe(2000);
    expect(s.avgWithdrawal).toBe(150);
    expect(s.minWithdrawal).toBe(100);
    expect(s.maxWithdrawal).toBe(200);
    expect(s.avgSpending).toBe(135);
    expect(s.year1Withdrawal).toBe(100);
  });
  it("in future dollars is the plain figures", () => {
    const s = strategySummary(years, (v) => v);
    expect(s.legacy).toBe(4000);
    expect(s.maxWithdrawal).toBe(400);
  });
  it("no years, no figures", () => {
    expect(strategySummary([], today).legacy).toBe(0);
  });
});
