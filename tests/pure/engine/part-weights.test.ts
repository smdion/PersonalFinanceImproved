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
