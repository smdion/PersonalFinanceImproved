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
      brokerageBasisPortion: 9000,
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
      brokerageBasisPortion: 90000,
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
      brokerageBasisPortion: 0,
    });
    expect(balances.preTax).toBe(400000);
    expect(accountBalance.ira).toMatchObject({ traditional: 100000, roth: 0 });
  });
});

describe("clampBalances (pins current behavior)", () => {
  it("floors every balance at 0 and caps basis at the balance", () => {
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
      afterTaxBasis: 50,
    });
    expect(accountBalance["401k"]).toMatchObject({ traditional: 0, roth: 7 });
    expect(accountBalance.hsa).toMatchObject({ balance: 0 });
    // Balance floored first, then basis capped at the floored balance.
    expect(accountBalance.brokerage).toMatchObject({ balance: 0, basis: 0 });
  });

  it("a negative bucket basis stays negative (only capped above)", () => {
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

describe("reinvestRmdExcess (pins current behavior)", () => {
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

  it("returns 0 and changes nothing when the RMD didn't override routing", () => {
    const { balances, accountBalance } = start();
    const excess = reinvestRmdExcess(
      "reinvest",
      false,
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
        true,
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
      true,
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

  it("reinvest: a chosen target account takes it all; rounding remainder goes to the first", () => {
    const { balances, accountBalance } = start();
    const accts = accounts();
    accts[1] = { ...accts[1]!, rmdExcessTarget: true };
    const indBal = indBalOf(accts);
    reinvestRmdExcess(
      "reinvest",
      true,
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
    accts.push({ ...accts[1]!, name: "Retirement brokerage C" });
    accts[0] = { ...accts[0]!, startingBalance: 10000 };
    const indBal = indBalOf(accts);
    reinvestRmdExcess(
      "reinvest",
      true,
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
      true,
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

  it("reinvest: no Retirement brokerage -> aggregate only, the Portfolio account untouched", () => {
    const { balances, accountBalance } = start();
    const accts = accounts().slice(2);
    const indBal = indBalOf(accts);
    reinvestRmdExcess(
      "reinvest",
      true,
      1000,
      0,
      0,
      balances,
      accountBalance,
      accts,
      indBal,
      indKey,
    );
    expect(balances.afterTax).toBe(121000);
    expect(indBal.get(indKey(accts[0]!))).toBe(500000);
  });

  it("spend: returns the excess but changes no balance", () => {
    const { balances, accountBalance } = start();
    const excess = reinvestRmdExcess(
      "spend",
      true,
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
