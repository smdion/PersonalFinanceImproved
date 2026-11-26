/**
 * Brokerage cost basis per account — seeding and the year-end sync
 * (fictional accounts).
 */
import { describe, it, expect } from "vitest";
import {
  basisOut,
  categoryBasis,
  followDrawsSold,
  followDrawsSoldOnCopies,
  followInflowsAdded,
  seedBrokerageBasis,
  sellAtCost,
  syncAggregateBasis,
  takeBasisOut,
} from "@/lib/pure/engine/brokerage-basis";
import { accountBalancesFromTaxBuckets } from "../fixtures/tax-bucket-split";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import type {
  IndividualAccountInput,
  TaxBuckets,
} from "@/lib/pure/accounts/account-balances.types";
import { withAccountId } from "../fixtures/engine-input";

const indKey = makeIndKey();
const brokerage = (
  name: string,
  startingBalance: number,
  startingBasis?: number,
): IndividualAccountInput =>
  withAccountId({
    name,
    category: "brokerage",
    taxType: "afterTax",
    startingBalance,
    ...(startingBasis != null ? { startingBasis } : {}),
  });

describe("sellAtCost", () => {
  it("a sale takes basis out at average cost and taxes the rest as gain", () => {
    // $40,000 held at $10,000 basis (ratio 0.25): a $4,000 sale returns $1,000 of basis.
    expect(sellAtCost(4000, 0.25)).toEqual({
      basisOut: 1000,
      basisPortion: 1000,
      gainsPortion: 3000,
    });
    expect(basisOut(4000, 0.25)).toBe(1000);
  });

  it("basis above the balance leaves in proportion, and the gain is never below 0", () => {
    // $8,000 held at $10,000 basis (ratio 1.25): selling half takes half the basis.
    expect(sellAtCost(4000, 1.25)).toEqual({
      basisOut: 5000,
      basisPortion: 4000,
      gainsPortion: 0,
    });
  });
});

describe("followDrawsSold and takeBasisOut", () => {
  it("each category's basis sold is the sum its accounts gave up, each at its own ratio", () => {
    // A: $30,000 at $12,000 basis (0.4) sells $3,000 → $1,200; B: $10,000 at $10,000 (1.0) sells $1,000 → $1,000.
    const accts = [brokerage("A", 0), brokerage("B", 0)];
    const indBal = new Map([
      [indKey(accts[0]!), 30000],
      [indKey(accts[1]!), 10000],
    ]);
    const basis = new Map([
      [indKey(accts[0]!), 12000],
      [indKey(accts[1]!), 10000],
    ]);
    const { result, sold } = followDrawsSold(
      accts,
      indKey,
      indBal,
      basis,
      () => {
        indBal.set(indKey(accts[0]!), 27000);
        indBal.set(indKey(accts[1]!), 9000);
        return "drawn";
      },
    );
    expect(result).toBe("drawn");
    expect(sold.get("brokerage")).toBe(2200);
    expect(accts.map((a) => basis.get(indKey(a)))).toEqual([10800, 9000]);
  });

  it("on copies, the accounts' maps hold until the draw lands in them", () => {
    // The same draw as above: A $30,000 at $12,000 sells $3,000, B $10,000 at $10,000 sells $1,000.
    const accts = [brokerage("A", 0), brokerage("B", 0)];
    const [a, b] = accts.map((acct) => indKey(acct)) as [string, string];
    const indBal = new Map([
      [a, 30000],
      [b, 10000],
    ]);
    const basis = new Map([
      [a, 12000],
      [b, 10000],
    ]);
    const drawn = followDrawsSoldOnCopies(
      accts,
      indKey,
      indBal,
      basis,
      (copy) => {
        copy.set(a, 27000);
        copy.set(b, 9000);
        return "drawn";
      },
    );
    expect(drawn.result).toBe("drawn");
    expect(drawn.sold.get("brokerage")).toBe(2200);
    expect([...indBal.values(), ...basis.values()]).toEqual([
      30000, 10000, 12000, 10000,
    ]);
    drawn.land();
    expect([...indBal.values(), ...basis.values()]).toEqual([
      27000, 9000, 10800, 9000,
    ]);
  });

  it("money in: each category's basis added is the sum of its accounts' rises", () => {
    const accts = [brokerage("A", 0), brokerage("B", 0)];
    const indBal = new Map([
      [indKey(accts[0]!), 100],
      [indKey(accts[1]!), 0],
    ]);
    const basis = new Map([
      [indKey(accts[0]!), 50],
      [indKey(accts[1]!), 0],
    ]);
    const { added } = followInflowsAdded(accts, indKey, indBal, basis, () => {
      indBal.set(indKey(accts[0]!), 100.33);
      indBal.set(indKey(accts[1]!), 200.34);
    });
    expect(added.get("brokerage")).toBe(200.67);
  });

  it("a category's basis is its accounts' with a ledger, else the one aggregate amount", () => {
    const sold = new Map([["brokerage" as const, 12.34]]);
    expect(categoryBasis(sold, 99)("brokerage")).toBe(12.34);
    expect(categoryBasis(sold, 99)("ira")).toBe(0);
    expect(categoryBasis(undefined, 99)("brokerage")).toBe(99);
  });

  it("the basis out leaves the tax buckets and the category, each floored at 0", () => {
    const balances: TaxBuckets = {
      preTax: 0,
      taxFree: 0,
      hsa: 0,
      afterTax: 5000,
      afterTaxBasis: 3000,
    };
    const accountBalance = accountBalancesFromTaxBuckets(balances);
    takeBasisOut(balances, accountBalance.brokerage, 1000.004);
    expect(balances.afterTaxBasis).toBe(2000);
    expect(accountBalance.brokerage).toMatchObject({ basis: 2000 });
    takeBasisOut(balances, accountBalance.brokerage, 9000);
    expect(balances.afterTaxBasis).toBe(0);
    expect(accountBalance.brokerage).toMatchObject({ basis: 0 });
  });
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

  it("a stated basis above the balance is kept: basis is cost, and a loss leaves it above", () => {
    const accts = [brokerage("A", 1000, 5000)];
    expect(seedBrokerageBasis(accts, indKey, 0).get(indKey(accts[0]!))).toBe(
      5000,
    );
  });

  it("an account holding nothing seeds no basis, whatever it states", () => {
    const accts = [brokerage("A", 0, 2500)];
    expect(seedBrokerageBasis(accts, indKey, 0).get(indKey(accts[0]!))).toBe(0);
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

  it("basis above the balance after a loss stays on every track", () => {
    // $8,000 held at $10,000 cost: the aggregate, the category and the account all keep $10,000.
    const accts = [brokerage("A", 0)];
    const indBal = new Map([[indKey(accts[0]!), 8000]]);
    const basis = new Map([[indKey(accts[0]!), 10000]]);
    const balances = buckets(8000, 10000);
    const accountBalance = accountBalancesFromTaxBuckets(balances);
    syncAggregateBasis(
      accts,
      indKey,
      indBal,
      basis,
      balances,
      accountBalance,
      [],
    );
    expect(balances.afterTaxBasis).toBe(10000);
    expect(accountBalance.brokerage).toMatchObject({ basis: 10000 });
    expect(basis.get(indKey(accts[0]!))).toBe(10000);
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
