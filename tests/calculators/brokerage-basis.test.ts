/**
 * Brokerage cost basis per account — seeding (fictional accounts).
 */
import { describe, it, expect } from "vitest";
import { seedBrokerageBasis } from "@/lib/calculators/engine/brokerage-basis";
import { makeIndKey } from "@/lib/calculators/engine/individual-account-tracking";
import type { IndividualAccountInput } from "@/lib/calculators/types";

const indKey = makeIndKey();
const brokerage = (
  name: string,
  startingBalance: number,
  startingBasis?: number,
): IndividualAccountInput => ({
  name,
  category: "brokerage",
  taxType: "afterTax",
  startingBalance,
  ...(startingBasis != null ? { startingBasis } : {}),
});

describe("seedBrokerageBasis", () => {
  it("each account keeps its own basis, a $0 one included", () => {
    const accts = [brokerage("A", 18000, 5000), brokerage("B", 0, 0)];
    const basis = seedBrokerageBasis(accts, indKey, 999999);
    expect(accts.map((a) => basis.get(indKey(a)))).toEqual([5000, 0]);
  });

  it("accounts without a basis share what's left of the aggregate by balance", () => {
    const accts = [
      brokerage("Known", 10000, 4000),
      brokerage("C", 30000),
      brokerage("D", 10000),
    ];
    const basis = seedBrokerageBasis(accts, indKey, 12000);
    // 12,000 − 4,000 known = 8,000 shared 3:1.
    expect(accts.map((a) => basis.get(indKey(a)))).toEqual([4000, 6000, 2000]);
  });

  it("basis never exceeds the balance", () => {
    const accts = [brokerage("A", 1000, 5000)];
    expect(seedBrokerageBasis(accts, indKey, 0).get(indKey(accts[0]!))).toBe(
      1000,
    );
  });
});
