import { describe, expect, it } from "vitest";
import {
  ownPartCredits,
  unclaimedSlot,
} from "@/lib/pure/engine/individual-accounts/own-part-credits";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { makeContributionSpec } from "../fixtures/engine-fixtures";
import type { AccumulationSlot } from "@/lib/pure/engine/types/routing";

const part = (
  category: IndividualAccountInput["category"],
  taxType: string,
): IndividualAccountInput => ({
  name: `${category} ${taxType}`,
  category,
  taxType,
  startingBalance: 0,
  parentCategory: "Retirement",
  origin: "synthetic",
});
const parts = [
  part("401k", "preTax"),
  part("401k", "taxFree"),
  part("hsa", "hsa"),
  part("brokerage", "afterTax"),
];
const slot = (
  category: AccumulationSlot["category"],
  money: Partial<AccumulationSlot>,
): AccumulationSlot => ({
  category,
  irsLimit: 0,
  effectiveLimit: 0,
  employerMatch: 0,
  employeeContrib: 0,
  rothContrib: 0,
  traditionalContrib: 0,
  remainingSpace: 0,
  cappedByAccount: false,
  cappedByTaxType: false,
  overflowAmount: 0,
  ...money,
});
const slots = [
  slot("401k", {
    employeeContrib: 10000,
    traditionalContrib: 6000,
    rothContrib: 4000,
    employerMatch: 3000,
  }),
  slot("hsa", { employeeContrib: 4000, employerMatch: 500 }),
  slot("brokerage", { employeeContrib: 2000 }),
];
/** Runs rule 5 over `accounts`; each part's credit by name, or undefined
 *  when it doesn't apply. */
const byName = (
  accounts: IndividualAccountInput[],
  ramp: number,
  specs?: ReturnType<typeof makeContributionSpec>[],
) => {
  const indBalance = new Map<string, number>();
  const indKey = makeIndKey();
  const ledger = { indAccounts: accounts, indKey, indBalance };
  if (!ownPartCredits(ledger, slots, ramp, specs)) return undefined;
  return Object.fromEntries(
    accounts
      .filter((p) => indBalance.has(indKey(p)))
      .map((p) => [p.name, indBalance.get(indKey(p))]),
  );
};

describe("ownPartCredits (EN14 rule 5)", () => {
  it("credits each slot to its own part by the category totals' split", () => {
    expect(byName(parts, 1200)).toEqual({
      "401k preTax": 9000,
      "401k taxFree": 4000,
      "hsa hsa": 4500,
      "brokerage afterTax": 2000 + 1200,
    });
  });

  it("applies only when no part is held and there are no specs", () => {
    const held = [...parts, { ...part("ira", "preTax"), origin: undefined }];
    expect(byName(held, 0)).toBeUndefined();
    expect(byName([], 0)).toBeUndefined();
    const spec = makeContributionSpec();
    expect(byName(parts, 0, [spec])).toBeUndefined();
    expect(byName(parts, 0, [])).toBeDefined();
  });
});

describe("unclaimedSlot (the specs' path: a slot no spec claims)", () => {
  const run = (accounts: IndividualAccountInput[]) => {
    const indBalance = new Map<string, number>();
    const contributions = new Map<string, number>();
    const indKey = makeIndKey();
    const ledger = { indAccounts: accounts, indKey, indBalance };
    for (const s of slots)
      unclaimedSlot({ ...ledger, overflowToBrokerage: 500 }, s, contributions);
    return { balance: Object.fromEntries(indBalance), contributions };
  };

  it("on a run with no held part, credits each slot's employee money to its own part, the brokerage net of the overflow", () => {
    const { balance } = run(parts);
    expect(Object.values(balance)).toEqual([6000, 4000, 4000, 1500]);
  });

  it("on a run that holds an account, credits nothing (the year-end reconcile places it)", () => {
    const held = [...parts, { ...part("ira", "preTax"), origin: undefined }];
    expect(run(held).balance).toEqual({});
  });
});
