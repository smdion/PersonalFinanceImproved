/**
 * Direct pins for src/lib/pure/engine/balance-deduction.ts
 * (behavior baseline, v0.10.0): withdrawal deduction, clamping, RMD excess
 * reinvestment, depletion tracking and dust cleanup. Until now these ran
 * only inside the engine. Each test PINS CURRENT BEHAVIOR on an invented
 * balance set; the figures are worked by hand from the inputs.
 */
import { describe, expect, it } from "vitest";
import {
  clampBalances,
  cleanupDust,
  deductWithdrawals,
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
import {
  makeDecumulationSlot,
  makeIndividualAccount,
} from "../fixtures/engine-fixtures";

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

describe("deductWithdrawals (pins current behavior)", () => {
  it("takes each slot from its own bucket and account", () => {
    const { balances, accountBalance } = start();
    deductWithdrawals({
      slots: [
        makeDecumulationSlot("401k", {
          withdrawal: 25000.004,
          traditionalWithdrawal: 20000.004,
          rothWithdrawal: 5000,
        }),
        makeDecumulationSlot("hsa", { withdrawal: 2000 }),
        makeDecumulationSlot("brokerage", { withdrawal: 15000 }),
      ],
      balances,
      accountBalance,
      basisOut: () => 9000,
    });
    // Rounded to cents: 400,000 - 20,000.004 = 379,999.996 -> 380,000.00.
    expect(balances).toEqual({
      preTax: 380000,
      taxFree: 95000,
      hsa: 28000,
      afterTax: 105000,
      afterTaxBasis: 71000,
    });
    expect(accountBalance["401k"]).toEqual({
      structure: "roth_traditional",
      traditional: 280000,
      roth: 95000,
    });
    expect(accountBalance.ira).toEqual({
      structure: "roth_traditional",
      traditional: 100000,
      roth: 0,
    });
    expect(accountBalance.hsa).toEqual({
      structure: "single_bucket",
      balance: 28000,
    });
    expect(accountBalance.brokerage).toEqual({
      structure: "basis_tracking",
      balance: 105000,
      basis: 71000,
    });
  });

  it("a basis portion above the basis floors basis at 0; balances may go negative", () => {
    const { balances, accountBalance } = start();
    deductWithdrawals({
      slots: [makeDecumulationSlot("brokerage", { withdrawal: 130000 })],
      balances,
      accountBalance,
      basisOut: () => 90000,
    });
    expect(balances.afterTax).toBe(-10000);
    expect(balances.afterTaxBasis).toBe(0);
    expect(accountBalance.brokerage).toEqual({
      structure: "basis_tracking",
      balance: -10000,
      basis: 0,
    });
  });

  it("a roth_traditional slot reads its split, not `withdrawal`", () => {
    const { balances, accountBalance } = start();
    deductWithdrawals({
      slots: [makeDecumulationSlot("ira", { withdrawal: 50000 })],
      balances,
      accountBalance,
      basisOut: () => 0,
    });
    expect(balances.preTax).toBe(400000);
    expect(accountBalance.ira).toMatchObject({ traditional: 100000, roth: 0 });
  });
});

describe("clampBalances (pins current behavior)", () => {
  it("floors every balance at 0; basis is cost, and an emptied brokerage keeps none", () => {
    const balances: TaxBuckets = {
      preTax: -5,
      taxFree: 10,
      hsa: -1,
      afterTax: 50,
      afterTaxBasis: 80,
    };
    const { accountBalance } = start();
    accountBalance["401k"] = {
      structure: "roth_traditional",
      traditional: -3,
      roth: 7,
    };
    accountBalance.hsa = { structure: "single_bucket", balance: -2 };
    accountBalance.brokerage = {
      structure: "basis_tracking",
      balance: -10,
      basis: 40,
    };
    clampBalances(balances, accountBalance);
    expect(balances).toEqual({
      preTax: 0,
      taxFree: 10,
      hsa: 0,
      afterTax: 50,
      afterTaxBasis: 80,
    });
    expect(accountBalance["401k"]).toMatchObject({ traditional: 0, roth: 7 });
    expect(accountBalance.hsa).toMatchObject({ balance: 0 });
    // The balance floors at 0, so the brokerage is empty and keeps no basis.
    expect(accountBalance.brokerage).toMatchObject({ balance: 0, basis: 0 });
  });

  it("a negative bucket basis stays negative while the brokerage holds money", () => {
    const balances: TaxBuckets = {
      preTax: 0,
      taxFree: 0,
      hsa: 0,
      afterTax: 100,
      afterTaxBasis: -20,
    };
    clampBalances(balances, start().accountBalance);
    expect(balances.afterTaxBasis).toBe(-20);
  });
});

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

  it("returns 0 and changes nothing when the RMD added nothing to the draw", () => {
    const { balances, accountBalance } = start();
    const excess = reinvestRmdExcess(
      "reinvest",
      0,
      90000,
      50000,
      10000,
      balances,
      accountBalance,
    );
    expect(excess).toBe(0);
    expect(balances).toEqual(start().balances);
  });

  it("returns 0 when the withdrawal is exactly need plus tax", () => {
    const { balances, accountBalance } = start();
    expect(
      reinvestRmdExcess(
        "reinvest",
        RMD_ADDED_ALL,
        60000,
        50000,
        10000,
        balances,
        accountBalance,
      ),
    ).toBe(0);
  });

  it("reinvest: the excess lands in brokerage as basis, split over the Retirement brokerages by balance", () => {
    const { balances, accountBalance } = start();
    const accts = accounts();
    const indBal = indBalOf(accts);
    // 90,000 drawn - 50,000 need - 10,000 tax = 30,000 excess.
    const excess = reinvestRmdExcess(
      "reinvest",
      RMD_ADDED_ALL,
      90000,
      50000,
      10000,
      balances,
      accountBalance,
      accts,
      indBal,
      indKey,
    );
    expect(excess).toBe(30000);
    expect(balances.afterTax).toBe(150000);
    expect(balances.afterTaxBasis).toBe(110000);
    expect(accountBalance.brokerage).toEqual({
      structure: "basis_tracking",
      balance: 150000,
      basis: 110000,
    });
    // 30,000 by 30k:10k -> 22,500 and 7,500; the Portfolio account untouched.
    expect(indBal.get(indKey(accts[0]!))).toBe(52500);
    expect(indBal.get(indKey(accts[1]!))).toBe(17500);
    expect(indBal.get(indKey(accts[2]!))).toBe(500000);
  });

  it("reinvest: accounts with no Retirement brokerage part are refused (the opening state declares one)", () => {
    const { balances, accountBalance } = start();
    const accts = accounts().slice(2);
    expect(() =>
      reinvestRmdExcess(
        "reinvest",
        RMD_ADDED_ALL,
        90000,
        50000,
        10000,
        balances,
        accountBalance,
        accts,
        indBalOf(accts),
        indKey,
      ),
    ).toThrow("no Retirement brokerage part");
  });

  it("reinvest: a chosen target account takes it all; rounding remainder goes to the first", () => {
    const { balances, accountBalance } = start();
    const accts = accounts();
    accts[1] = { ...accts[1]!, rmdExcessTarget: true };
    const indBal = indBalOf(accts);
    reinvestRmdExcess(
      "reinvest",
      RMD_ADDED_ALL,
      60100,
      50000,
      0,
      balances,
      accountBalance,
      accts,
      indBal,
      indKey,
    );
    expect(indBal.get(indKey(accts[0]!))).toBe(30000);
    expect(indBal.get(indKey(accts[1]!))).toBe(20100);
  });

  it("reinvest: three equal targets split 100 as 33.33 x 3 plus a 0.01 remainder on the first", () => {
    const { balances, accountBalance } = start();
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
    reinvestRmdExcess(
      "reinvest",
      RMD_ADDED_ALL,
      100,
      0,
      0,
      balances,
      accountBalance,
      accts,
      indBal,
      indKey,
    );
    expect(accts.map((ia) => indBal.get(indKey(ia)))).toEqual([
      10033.34, 10033.33, 10033.33,
    ]);
  });

  it("reinvest: Retirement targets all at $0 -> the first takes it all", () => {
    const { balances, accountBalance } = start();
    const accts = accounts().map((ia, i) =>
      i < 2 ? { ...ia, startingBalance: 0 } : ia,
    );
    const indBal = indBalOf(accts);
    reinvestRmdExcess(
      "reinvest",
      RMD_ADDED_ALL,
      1000,
      0,
      0,
      balances,
      accountBalance,
      accts,
      indBal,
      indKey,
    );
    expect(indBal.get(indKey(accts[0]!))).toBe(1000);
    expect(indBal.get(indKey(accts[1]!))).toBe(0);
  });

  it("reinvest: a member below $0 in a group holding money keeps its shortfall; the accounts gain the excess, not more", () => {
    const { balances, accountBalance } = start();
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
    // 0 + 0, the accounts gained 31,000 for the category's 30,000.
    const excess = reinvestRmdExcess(
      "reinvest",
      RMD_ADDED_ALL,
      90000,
      50000,
      10000,
      balances,
      accountBalance,
      accts,
      indBal,
      indKey,
      basis,
    );
    expect(excess).toBe(30000);
    expect([indBal.get(a!), indBal.get(b!)]).toEqual([60000, -1000]);
    expect([basis.get(a!), basis.get(b!)]).toEqual([50000, 0]);
    expect(balances.afterTax).toBe(150000);
    expect(balances.afterTaxBasis).toBe(110000);
    expect(accountBalance.brokerage).toEqual({
      structure: "basis_tracking",
      balance: 150000,
      basis: 110000,
    });
  });

  it("reinvest with a basis ledger: the category and the buckets take the basis the accounts took in, not the excess", () => {
    const { balances, accountBalance } = start();
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
    const excess = reinvestRmdExcess(
      "reinvest",
      RMD_ADDED_ALL,
      50100,
      50000,
      0,
      balances,
      accountBalance,
      accts,
      indBal,
      indKey,
      basis,
    );
    expect(excess).toBe(100);
    expect(indBal.get(a!)).toBe(90);
    expect([basis.get(a!), basis.get(b!)]).toEqual([90, 0]);
    expect(balances.afterTax).toBe(120100);
    expect(balances.afterTaxBasis).toBe(80090);
    expect(accountBalance.brokerage).toEqual({
      structure: "basis_tracking",
      balance: 120100,
      basis: 80090,
    });
  });

  it("spend: returns the excess but changes no balance", () => {
    const { balances, accountBalance } = start();
    const excess = reinvestRmdExcess(
      "spend",
      RMD_ADDED_ALL,
      90000,
      50000,
      10000,
      balances,
      accountBalance,
    );
    expect(excess).toBe(30000);
    expect(balances).toEqual(start().balances);
    expect(accountBalance).toEqual(start().accountBalance);
  });

  // D1 (owner 2026-11-02; E0 RX1 ruling 2026-11-23): the excess is RMD
  // dollars beyond the need, so it is never more than what the RMD added.
  // The rest of an over-draw (a strategy-fixed draw, a tax term the test
  // doesn't see) isn't RMD money. Worked: the RMD added 0.01 of a year that
  // drew 3,588.66 past need + tax: min(0.01, 3,588.66) = 0.01 reinvested.
  it("D1: an RMD that added $0.01 reinvests $0.01, not the year's $3,588.66 over-draw", () => {
    const { balances, accountBalance } = start();
    const excess = reinvestRmdExcess(
      "reinvest",
      0.01,
      63588.66,
      50000,
      10000,
      balances,
      accountBalance,
    );
    expect(excess).toBe(0.01);
    expect(balances.afterTax).toBe(120000.01);
    expect(balances.afterTaxBasis).toBe(80000.01);
  });

  it("D1: an RMD larger than the over-draw reinvests only the over-draw", () => {
    // Added 20,000; drawn 90,000 − need 50,000 − tax 10,000 = 30,000 over:
    // min(20,000, 30,000) = 20,000.
    const { balances, accountBalance } = start();
    expect(
      reinvestRmdExcess(
        "spend",
        20000,
        90000,
        50000,
        10000,
        balances,
        accountBalance,
      ),
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

  it("zeroes everything when the buckets total under $1", () => {
    const balances: TaxBuckets = {
      preTax: 0.4,
      taxFree: 0.3,
      hsa: 0.2,
      afterTax: 0.09,
      afterTaxBasis: 0.05,
    };
    const { accountBalance } = start();
    const indBal = new Map([[indKey(accts[0]!), 0.4]]);
    expect(cleanupDust(balances, accountBalance, accts, indKey, indBal)).toBe(
      true,
    );
    expect(balances).toEqual({
      preTax: 0,
      taxFree: 0,
      hsa: 0,
      afterTax: 0,
      afterTaxBasis: 0,
    });
    // Per-account balances are zeroed from the bucket total alone.
    expect(accountBalance["401k"]).toMatchObject({ traditional: 0, roth: 0 });
    expect(accountBalance.brokerage).toMatchObject({ balance: 0, basis: 0 });
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
    const { accountBalance } = start();
    expect(
      cleanupDust(balances, accountBalance, accts, indKey, new Map()),
    ).toBe(false);
    expect(balances.preTax).toBe(0.5);
    expect(accountBalance["401k"]).toMatchObject({ traditional: 300000 });
  });
});
