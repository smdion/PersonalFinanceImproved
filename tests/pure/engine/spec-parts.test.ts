/**
 * A spec's money over its parts (`creditSpecParts`): one part takes it all;
 * several (a joint spec on an account held in owner parts) share it by the
 * parts' one weight rule: balance; all $0, each person's other part of the
 * account; those $0 too, equally; the last part takes the cents.
 */
import { describe, expect, it } from "vitest";
import { creditSpecParts } from "@/lib/pure/engine/individual-accounts/spec-accounts";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";

const indKey = makeIndKey();
const part = (
  ownerPersonId: number,
  taxType: string,
): IndividualAccountInput => ({
  name: "Joint IRA",
  category: "ira",
  taxType,
  startingBalance: 0,
  performanceAccountId: 5,
  ownerPersonId,
  parentCategory: "Retirement",
});
const annTrad = part(1, "preTax");
const boTrad = part(2, "preTax");
const annRoth = part(1, "taxFree");
const boRoth = part(2, "taxFree");
const indAccounts = [annTrad, boTrad, annRoth, boRoth];
const keys = [indKey(annTrad), indKey(boTrad)];

function run(balances: [IndividualAccountInput, number][], amount: number) {
  const indBalance = new Map(balances.map(([ia, b]) => [indKey(ia), b]));
  const credited = new Map<string, number>();
  creditSpecParts({ indAccounts, indKey, indBalance }, keys, amount, [
    credited,
  ]);
  return [credited.get(keys[0]!), credited.get(keys[1]!)];
}

describe("a spec's money over its parts", () => {
  it("one part takes the whole amount", () => {
    const credited = new Map<string, number>();
    creditSpecParts(
      { indAccounts, indKey, indBalance: new Map() },
      [indKey(annTrad)],
      1234.56,
      [credited],
    );
    expect([...credited]).toEqual([[indKey(annTrad), 1234.56]]);
  });

  it("several parts share it by balance, the last part the cents", () => {
    expect(
      run(
        [
          [annTrad, 300],
          [boTrad, 600],
        ],
        100,
      ),
    ).toEqual([33.33, 66.67]);
  });

  it("all $0: by each person's other part of the account", () => {
    expect(
      run(
        [
          [annRoth, 1000],
          [boRoth, 3000],
        ],
        100,
      ),
    ).toEqual([25, 75]);
  });

  it("those $0 too: equally", () => {
    expect(run([], 100)).toEqual([50, 50]);
  });
});
