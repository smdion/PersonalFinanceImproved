/**
 * The one rule for splitting money that flows into a group of account parts
 * (part-weights.ts `inflowShares`): by the parts' balances while the group
 * holds money, else the caller's fallback; and `partShares`' three tiers.
 */
import { describe, expect, it } from "vitest";
import {
  equalShares,
  inflowShares,
  partShares,
  placeWhole,
} from "@/lib/pure/engine/individual-accounts/part-weights";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { withAccountId } from "../fixtures/engine-input";

const firstTakesAll = (n: number) => () =>
  Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));

describe("inflowShares", () => {
  it("splits by balance when the group holds money", () => {
    expect(inflowShares([300, 100], firstTakesAll(2))).toEqual([0.75, 0.25]);
  });

  it("uses the fallback's shares when the group holds $0", () => {
    expect(inflowShares([0, 0, 0], equalShares(3))).toEqual([
      1 / 3,
      1 / 3,
      1 / 3,
    ]);
    expect(inflowShares([0, 0], firstTakesAll(2))).toEqual([1, 0]);
  });

  it("a 1¢ part beside $0 parts takes a small share, not all of it (E0 PW1)", () => {
    // T = $0.01 of F = $1: 1% by balance, 99% by the fallback.
    const shares = inflowShares([0.01, 0, 0], equalShares(3));
    expect(shares[0]).toBeCloseTo(0.01 + 0.99 / 3, 12);
    expect(shares[1]).toBeCloseTo(0.99 / 3, 12);
    expect(shares[2]).toBeCloseTo(0.99 / 3, 12);
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12);
    // $0.50 beside $0, first-takes-all fallback on the $0 part: half each.
    const half = inflowShares([0, 0.5], firstTakesAll(2));
    expect(half[0]).toBeCloseTo(0.5, 12);
    expect(half[1]).toBeCloseTo(0.5, 12);
  });

  it("is continuous as the group's total goes to $0 and to $1", () => {
    const near = (a: number[], b: number[], within: number) =>
      a.every((x, i) => Math.abs(x - b[i]!) <= within);
    // To $0: 1¢ on the part the fallback leaves out lands within 1% of
    // the $0 split (today it takes everything).
    expect(
      near(
        inflowShares([0, 0.01], firstTakesAll(2)),
        inflowShares([0, 0], firstTakesAll(2)),
        0.01 + 1e-12,
      ),
    ).toBe(true);
    // To $1: 99.5¢ against a fallback on the other part lands within
    // half a percent of $1's split by balance.
    expect(
      near(
        inflowShares([0.995, 0], () => [0, 1]),
        inflowShares([1, 0], () => [0, 1]),
        0.006,
      ),
    ).toBe(true);
  });

  it("is today's split wherever a group holds $1 or more, or exactly $0", () => {
    expect(inflowShares([1, 0], () => [0, 1])).toEqual([1, 0]);
    expect(inflowShares([0.6, 0.4], () => [0, 1])).toEqual([0.6, 0.4]);
    expect(inflowShares([0, 0], () => [0, 1])).toEqual([0, 1]);
  });

  it("asks for the fallback only when it needs it", () => {
    let asked = 0;
    inflowShares([5, 5], () => {
      asked++;
      return [1, 0];
    });
    expect(asked).toBe(0);
  });
});

describe("partShares", () => {
  const part = (
    name: string,
    taxType: IndividualAccountInput["taxType"],
    startingBalance: number,
    ownerPersonId: number,
  ): IndividualAccountInput =>
    withAccountId({
      name,
      category: "401k",
      taxType,
      startingBalance,
      ownerPersonId,
      parentCategory: "Retirement",
    });
  const shares = (
    all: IndividualAccountInput[],
    of: IndividualAccountInput[],
  ) => {
    const indKey = makeIndKey();
    const indBalance = new Map(all.map((p) => [indKey(p), p.startingBalance]));
    return partShares({ indAccounts: all, indKey, indBalance }, of);
  };

  it("by balance, then each part's account's other parts, then equally", () => {
    const annRoth = part("Ann 401k", "taxFree", 0, 1);
    const boRoth = part("Bo 401k", "taxFree", 0, 2);
    const annTrad = part("Ann 401k", "preTax", 300_000, 1);
    const boTrad = part("Bo 401k", "preTax", 100_000, 2);
    expect(shares([annTrad, boTrad], [annTrad, boTrad])).toEqual([0.75, 0.25]);
    expect(
      shares([annRoth, boRoth, annTrad, boTrad], [annRoth, boRoth]),
    ).toEqual([0.75, 0.25]);
    expect(shares([annRoth, boRoth], [annRoth, boRoth])).toEqual([0.5, 0.5]);
  });
});

describe("placeWhole", () => {
  it("rounds each member's amount; the largest share takes the cents left", () => {
    expect(placeWhole(100, [10, 30, 60])).toEqual([10, 30, 60]);
    // $10 at 1/7, 2/7, 4/7: 1.43 + 2.86 + 5.71 = 10.00; the 4/7 member takes no cent.
    expect(placeWhole(10, [10 / 7, 20 / 7, 40 / 7])).toEqual([
      1.43, 2.86, 5.71,
    ]);
    // $0.05 split 1:2:7 rounds to 0.01 + 0.01 + 0.04 = 0.06; the largest share gives back the 1¢ over.
    expect(placeWhole(0.05, [0.005, 0.01, 0.035])).toEqual([0.01, 0.01, 0.03]);
    // One member takes the whole amount, whatever its raw amount says.
    expect(placeWhole(10, [9.996])).toEqual([10]);
  });

  it("a tie goes to the earlier member: $100 in thirds is 33.34, 33.33, 33.33", () => {
    expect(placeWhole(100, [100 / 3, 100 / 3, 100 / 3])).toEqual([
      33.34, 33.33, 33.33,
    ]);
  });

  it("a $0 member never goes below $0 when rounded shares overshoot", () => {
    // $1,000.01 over [1, 1, 0]: 500.005 rounds up twice to 1,000.02; the
    // first $500 member gives back the cent, not the $0 member listed last.
    const placed = placeWhole(1000.01, [500.005, 500.005, 0]);
    expect(placed).toEqual([500, 500.01, 0]);
    expect(placed[2]).toBeGreaterThanOrEqual(0);
  });

  it("places the whole amount for any split", () => {
    for (const [amount, weights] of [
      [1234.57, [0.123, 0.456, 0.421]],
      [0.05, [0.5, 0.5, 0, 0]],
      [999_999.99, [1 / 7, 2 / 7, 4 / 7]],
    ] as const) {
      const placed = placeWhole(
        amount,
        weights.map((w) => amount * w),
      );
      const sum = placed.reduce((s, x) => s + x, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(amount * 100));
      placed.forEach((x) =>
        expect(Math.round(x * 100)).toBeCloseTo(x * 100, 6),
      );
    }
  });
});
