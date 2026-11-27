/**
 * Direct pins for src/lib/pure/engine/balance-deduction.ts
 * (behavior baseline, v0.10.0): RMD excess reinvestment, depletion tracking
 * and dust cleanup. Until now these ran only inside the engine. Each test
 * PINS CURRENT BEHAVIOR on an invented balance set; the figures are worked
 * by hand from the inputs.
 */
import { describe, expect, it } from "vitest";
import {
  cleanupDust,
  reinvestRmdExcess,
  trackDepletions,
} from "@/lib/pure/engine/balance-deduction";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import type {
  AccountBalances,
  IndividualAccountInput,
  TaxBuckets,
} from "@/lib/pure/accounts/account-balances.types";
import type { ProjectionResult } from "@/lib/pure/engine/types";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";

/** Buckets and per-account balances that agree: 401k 300k/100k, IRA
 *  100k/0, HSA 30k, brokerage 120k with 80k basis. */
function start(): { balances: TaxBuckets; accountBalance: AccountBalances } {
  return {
    balances: {
      preTax: 400000,
      taxFree: 100000,
      hsa: 30000,
      afterTax: 120000,
      afterTaxBasis: 80000,
    },
    accountBalance: {
      "401k": {
        structure: "roth_traditional",
        traditional: 300000,
        roth: 100000,
      },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 100000, roth: 0 },
      hsa: { structure: "single_bucket", balance: 30000 },
      brokerage: { structure: "basis_tracking", balance: 120000, basis: 80000 },
    },
  };
}

describe("reinvestRmdExcess: what the RMD added past the draw's cost (D1), reinvested by balance or spent", () => {
  // An RMD addition larger than any over-draw below, so the excess is the
  // whole over-draw (D1's bound doesn't bind).
  const RMD_ADDED_ALL = 1_000_000;
  const indKey = makeIndKey();
  const accounts = (): IndividualAccountInput[] => [
    makeIndividualAccount({
      name: "Retirement brokerage A",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 30000,
      parentCategory: "Retirement",
    }),
    makeIndividualAccount({
      name: "Retirement brokerage B",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 10000,
      parentCategory: "Retirement",
    }),
    makeIndividualAccount({
      name: "Portfolio brokerage",
      category: "brokerage",
      taxType: "afterTax",
      startingBalance: 500000,
      parentCategory: "Portfolio",
    }),
  ];
  const indBalOf = (accts: IndividualAccountInput[]) =>
    new Map(accts.map((ia) => [indKey(ia), ia.startingBalance]));
  /** The excess with these accounts, their balances and basis. */
  const reinvest = (
    mode: "reinvest" | "spend",
    rmdAdded: number,
    drawn: [withdrawal: number, need: number, tax: number],
    accts: IndividualAccountInput[],
    indBal: Map<string, number>,
    basis = new Map<string, number>(),
  ) =>
    reinvestRmdExcess(mode, rmdAdded, ...drawn, accts, indBal, indKey, basis);

  it("returns 0 and changes nothing when the RMD added nothing to the draw", () => {
    const accts = accounts();
    const indBal = indBalOf(accts);
    const excess = reinvest(
      "reinvest",
      0,
      [90000, 50000, 10000],
      accts,
      indBal,
    );
    expect(excess).toBe(0);
    expect(indBal).toEqual(indBalOf(accts));
  });

  it("returns 0 when the withdrawal is exactly need plus tax", () => {
    const accts = accounts();
    expect(
      reinvest(
        "reinvest",
        RMD_ADDED_ALL,
        [60000, 50000, 10000],
        accts,
        indBalOf(accts),
      ),
    ).toBe(0);
  });

  it("reinvest: the excess lands in the Retirement brokerages by balance, as new basis", () => {
    const accts = accounts();
    const indBal = indBalOf(accts);
    const basis = new Map<string, number>();
    // 90,000 drawn - 50,000 need - 10,000 tax = 30,000 excess.
    const excess = reinvest(
      "reinvest",
      RMD_ADDED_ALL,
      [90000, 50000, 10000],
      accts,
      indBal,
      basis,
    );
    expect(excess).toBe(30000);
    // 30,000 by 30k:10k -> 22,500 and 7,500; the Portfolio account untouched.
    expect(indBal.get(indKey(accts[0]!))).toBe(52500);
    expect(indBal.get(indKey(accts[1]!))).toBe(17500);
    expect(indBal.get(indKey(accts[2]!))).toBe(500000);
    expect(basis.get(indKey(accts[0]!))).toBe(22500);
    expect(basis.get(indKey(accts[1]!))).toBe(7500);
  });

  it("reinvest: accounts with no Retirement brokerage part are refused (the opening state declares one)", () => {
    const accts = accounts().slice(2);
    expect(() =>
      reinvest(
        "reinvest",
        RMD_ADDED_ALL,
        [90000, 50000, 10000],
        accts,
        indBalOf(accts),
      ),
    ).toThrow("no Retirement brokerage part");
  });

  it("reinvest: a chosen target account takes it all; rounding remainder goes to the first", () => {
    const accts = accounts();
    accts[1] = { ...accts[1]!, rmdExcessTarget: true };
    const indBal = indBalOf(accts);
    reinvest("reinvest", RMD_ADDED_ALL, [60100, 50000, 0], accts, indBal);
    expect(indBal.get(indKey(accts[0]!))).toBe(30000);
    expect(indBal.get(indKey(accts[1]!))).toBe(20100);
  });

  it("reinvest: three equal targets split 100 as 33.33 x 3 plus a 0.01 remainder on the first", () => {
    const accts = accounts().slice(0, 2);
    accts.push(
      makeIndividualAccount({
        ...accts[1]!,
        name: "Retirement brokerage C",
        performanceAccountId: undefined,
      }),
    );
    accts[0] = { ...accts[0]!, startingBalance: 10000 };
    const indBal = indBalOf(accts);
    reinvest("reinvest", RMD_ADDED_ALL, [100, 0, 0], accts, indBal);
    expect(accts.map((ia) => indBal.get(indKey(ia)))).toEqual([
      10033.34, 10033.33, 10033.33,
    ]);
  });

  it("reinvest: Retirement targets all at $0 -> the first takes it all", () => {
    const accts = accounts().map((ia, i) =>
      i < 2 ? { ...ia, startingBalance: 0 } : ia,
    );
    const indBal = indBalOf(accts);
    reinvest("reinvest", RMD_ADDED_ALL, [1000, 0, 0], accts, indBal);
    expect(indBal.get(indKey(accts[0]!))).toBe(1000);
    expect(indBal.get(indKey(accts[1]!))).toBe(0);
  });

  it("reinvest: a member below $0 in a group holding money keeps its shortfall; the accounts gain the excess, not more", () => {
    const accts = accounts().slice(0, 2);
    const [a, b] = accts.map((ia) => indKey(ia));
    const indBal = new Map([
      [a!, 30000],
      [b!, -1000],
    ]);
    const basis = new Map([
      [a!, 20000],
      [b!, 0],
    ]);
    // 90,000 drawn - 50,000 need - 10,000 tax = 30,000 excess, all to A (B
    // holds nothing). B stays at -1,000: read at $0 and written back as
    // 0 + 0.
    const excess = reinvest(
      "reinvest",
      RMD_ADDED_ALL,
      [90000, 50000, 10000],
      accts,
      indBal,
      basis,
    );
    expect(excess).toBe(30000);
    expect([indBal.get(a!), indBal.get(b!)]).toEqual([60000, -1000]);
    expect([basis.get(a!), basis.get(b!)]).toEqual([50000, 0]);
  });

  it("reinvest: an account below $0 takes in as basis what it gained, not the excess", () => {
    const accts = accounts().slice(0, 2);
    const [a, b] = accts.map((ia) => indKey(ia));
    const indBal = new Map([
      [a!, -10],
      [b!, 0],
    ]);
    const basis = new Map([
      [a!, 0],
      [b!, 0],
    ]);
    // 50,100 drawn − 50,000 need = 100 excess. Neither account holds money,
    // so the first takes it: −10 → 90, which is 90 of new basis.
    const excess = reinvest(
      "reinvest",
      RMD_ADDED_ALL,
      [50100, 50000, 0],
      accts,
      indBal,
      basis,
    );
    expect(excess).toBe(100);
    expect(indBal.get(a!)).toBe(90);
    expect([basis.get(a!), basis.get(b!)]).toEqual([90, 0]);
  });

  it("spend: returns the excess but changes no account", () => {
    const accts = accounts();
    const indBal = indBalOf(accts);
    const excess = reinvest(
      "spend",
      RMD_ADDED_ALL,
      [90000, 50000, 10000],
      accts,
      indBal,
    );
    expect(excess).toBe(30000);
    expect(indBal).toEqual(indBalOf(accts));
  });

  // D1 (owner 2026-11-02; E0 RX1 ruling 2026-11-23): the excess is RMD
  // dollars beyond the need, so it is never more than what the RMD added.
  // The rest of an over-draw (a strategy-fixed draw, a tax term the test
  // doesn't see) isn't RMD money. Worked: the RMD added 0.01 of a year that
  // drew 3,588.66 past need + tax: min(0.01, 3,588.66) = 0.01 reinvested.
  it("D1: an RMD that added $0.01 reinvests $0.01, not the year's $3,588.66 over-draw", () => {
    const accts = accounts();
    const indBal = indBalOf(accts);
    const excess = reinvest(
      "reinvest",
      0.01,
      [63588.66, 50000, 10000],
      accts,
      indBal,
    );
    expect(excess).toBe(0.01);
    expect(
      [indBal.get(indKey(accts[0]!))!, indBal.get(indKey(accts[1]!))!].map(
        (v) => Math.round(v * 100),
      ),
    ).toEqual([3_000_001, 1_000_000]);
  });

  it("D1: an RMD larger than the over-draw reinvests only the over-draw", () => {
    // Added 20,000; drawn 90,000 − need 50,000 − tax 10,000 = 30,000 over:
    // min(20,000, 30,000) = 20,000.
    const accts = accounts();
    expect(
      reinvest("spend", 20000, [90000, 50000, 10000], accts, indBalOf(accts)),
    ).toBe(20000);
  });
});

describe("trackDepletions (pins current behavior)", () => {
  it("records each sub-bucket at or below 0 once, with the year and age", () => {
    const { accountBalance } = start();
    accountBalance.ira = {
      structure: "roth_traditional",
      traditional: 0,
      roth: 0,
    };
    accountBalance.hsa = { structure: "single_bucket", balance: -0.5 };
    const tracked = new Set<string>();
    const depletions: ProjectionResult["accountDepletions"] = [];
    trackDepletions(accountBalance, tracked, depletions, 2040, 80);
    trackDepletions(accountBalance, tracked, depletions, 2041, 81);
    expect(depletions).toEqual(PINNED_DEPLETIONS);
    expect([...tracked].sort()).toEqual(
      ["403b_roth", "403b_trad", "hsa", "ira_roth", "ira_trad"].sort(),
    );
  });
});

/** Category order as the config lists it; the second call adds nothing. */
const PINNED_DEPLETIONS: ProjectionResult["accountDepletions"] = [
  {
    category: "403b",
    subType: "traditional",
    depletionYear: 2040,
    depletionAge: 80,
  },
  { category: "403b", subType: "roth", depletionYear: 2040, depletionAge: 80 },
  {
    category: "ira",
    subType: "traditional",
    depletionYear: 2040,
    depletionAge: 80,
  },
  { category: "ira", subType: "roth", depletionYear: 2040, depletionAge: 80 },
  {
    category: "hsa",
    subType: undefined,
    depletionYear: 2040,
    depletionAge: 80,
  },
];

describe("cleanupDust (pins current behavior)", () => {
  const indKey = makeIndKey();
  const accts = [makeIndividualAccount({ name: "IRA", category: "ira" })];

  it("zeroes every account part when the buckets total under $1", () => {
    const balances: TaxBuckets = {
      preTax: 0.4,
      taxFree: 0.3,
      hsa: 0.2,
      afterTax: 0.09,
      afterTaxBasis: 0.05,
    };
    const indBal = new Map([[indKey(accts[0]!), 0.4]]);
    expect(cleanupDust(balances, accts, indKey, indBal)).toBe(true);
    // The parts are zeroed from the bucket total alone; the settled point
    // after it gives the categories and buckets.
    expect(indBal.get(indKey(accts[0]!))).toBe(0);
  });

  it("leaves everything at exactly $1", () => {
    const balances: TaxBuckets = {
      preTax: 0.5,
      taxFree: 0.5,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    };
    const indBal = new Map([[indKey(accts[0]!), 0.5]]);
    expect(cleanupDust(balances, accts, indKey, indBal)).toBe(false);
    expect(indBal.get(indKey(accts[0]!))).toBe(0.5);
  });
});
