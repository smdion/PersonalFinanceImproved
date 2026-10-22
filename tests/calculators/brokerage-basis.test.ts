/**
 * Brokerage cost basis per account — seeding and the year-end sync
 * (fictional accounts).
 */
import { describe, it, expect } from "vitest";
import {
  seedBrokerageBasis,
  syncAggregateBasis,
} from "@/lib/calculators/engine/brokerage-basis";
import { accountBalancesFromTaxBuckets } from "@/lib/calculators/engine/balance-utils";
import { makeIndKey } from "@/lib/calculators/engine/individual-account-tracking";
import type {
  IndividualAccountInput,
  TaxBuckets,
} from "@/lib/calculators/types";

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

describe("syncAggregateBasis", () => {
  const buckets = (afterTax: number, afterTaxBasis: number): TaxBuckets => ({
    preTax: 0,
    taxFree: 0,
    hsa: 0,
    afterTax,
    afterTaxBasis,
  });

  it("the accounts' basis becomes the aggregate when they hold all the brokerage money", () => {
    const accts = [brokerage("A", 0), brokerage("B", 0)];
    const indBal = new Map([
      [indKey(accts[0]!), 30000],
      [indKey(accts[1]!), 10000],
    ]);
    const basis = new Map([
      [indKey(accts[0]!), 12000],
      [indKey(accts[1]!), 10000],
    ]);
    const balances = buckets(40000, 25000);
    const diagnostics: string[] = [];
    syncAggregateBasis(
      accts,
      indKey,
      indBal,
      basis,
      balances,
      accountBalancesFromTaxBuckets(balances),
      diagnostics,
    );
    expect(balances.afterTaxBasis).toBe(22000);
    expect(diagnostics).toHaveLength(1); // the $3,000 drift is surfaced
  });

  it("keeps the aggregate basis when brokerage money lives outside the accounts", () => {
    // Overflow built $50k of brokerage with no account to hold it; only a
    // projection-only account at $0 exists.
    const accts = [brokerage("Projected", 0, 0)];
    const indBal = new Map([[indKey(accts[0]!), 0]]);
    const basis = new Map([[indKey(accts[0]!), 0]]);
    const balances = buckets(50000, 45000);
    const diagnostics: string[] = [];
    syncAggregateBasis(
      accts,
      indKey,
      indBal,
      basis,
      balances,
      accountBalancesFromTaxBuckets(balances),
      diagnostics,
    );
    expect(balances.afterTaxBasis).toBe(45000);
    expect(diagnostics[0]).toMatch(/aggregate basis kept/);
  });
});
