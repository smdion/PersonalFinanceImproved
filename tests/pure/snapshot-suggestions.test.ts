/** Suggested snapshot balances from linked feeds. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  splitAccountBalance,
  suggestSnapshotAmounts,
} from "@/lib/pure/snapshot-suggestions";

const sub = (
  key: string,
  performanceAccountId: number,
  amount: number,
  taxType = "preTax",
  subType: string | null = null,
) => ({ key, performanceAccountId, amount, taxType, subType });

const subs = [
  sub("roth", 1, 300, "taxFree"),
  sub("trad", 1, 100),
  sub("solo", 2, 50),
  sub("nofeed", 3, 10),
];

describe("suggestSnapshotAmounts", () => {
  it("uses a sub-account link's balance as is", () => {
    const s = suggestSnapshotAmounts(subs, [
      {
        performanceAccountId: 1,
        subKey: "roth",
        balance: 320,
        balanceDate: "2026-10-09",
      },
    ]);
    expect(s.amounts.get("roth")).toBe(320);
    expect(s.amounts.has("trad")).toBe(false);
    expect(s.accounts.get(1)).toMatchObject({
      total: 320,
      split: false,
      balanceDate: "2026-10-09",
    });
  });

  it("spreads a whole-account balance's change by the last snapshot without contribution data", () => {
    const s = suggestSnapshotAmounts(subs, [
      {
        performanceAccountId: 1,
        subKey: null,
        balance: 800,
        balanceDate: null,
      },
      {
        performanceAccountId: 2,
        subKey: null,
        balance: 55.55,
        balanceDate: null,
      },
    ]);
    expect(s.amounts.get("roth")).toBe(600);
    expect(s.amounts.get("trad")).toBe(200);
    expect(s.amounts.get("solo")).toBe(55.55);
    expect(s.amounts.has("nofeed")).toBe(false);
    expect(s.accounts.get(1)).toMatchObject({ split: true, newMoney: 0 });
    expect(s.accounts.get(2)).toMatchObject({ split: false });
  });

  it("gives a whole-account link only the sub-accounts not linked on their own", () => {
    const s = suggestSnapshotAmounts(subs, [
      {
        performanceAccountId: 1,
        subKey: "roth",
        balance: 320,
        balanceDate: null,
      },
      { performanceAccountId: 1, subKey: null, balance: 90, balanceDate: null },
    ]);
    expect(s.amounts.get("roth")).toBe(320);
    expect(s.amounts.get("trad")).toBe(90);
    expect(s.accounts.get(1)?.total).toBe(410);
  });
});

describe("splitAccountBalance", () => {
  const plan = [
    sub("roth", 1, 1000, "taxFree"),
    sub("trad", 1, 1000),
    sub("match", 1, 1000, "preTax", "Employer Match"),
    sub("rollover", 1, 1000, "preTax", "Rollover"),
  ];
  const money = {
    employeeRoth: 100,
    employeePreTax: 60,
    employeeOther: 0,
    employer: 40,
    employerRoth: 0,
    estimated: false,
  };
  const sum = (m: Map<string, number>) =>
    [...m.values()].reduce((t, v) => t + v, 0);

  it("weights each part by its prior amount plus the new money placed in it", () => {
    const { amounts, placed } = splitAccountBalance(
      plan,
      4600,
      money,
      "Employer Match",
    );
    expect(placed).toBe(200);
    // Weights 1100 / 1060 / 1040 / 1000 of 4200.
    expect(amounts.get("roth")).toBeCloseTo((4600 * 1100) / 4200, 2);
    expect(amounts.get("trad")).toBeCloseTo((4600 * 1060) / 4200, 2);
    expect(amounts.get("match")).toBeCloseTo((4600 * 1040) / 4200, 2);
    expect(sum(amounts)).toBeCloseTo(4600, 10);
  });

  it("never makes a part negative when the balance lags the deposits", () => {
    const { amounts } = splitAccountBalance(
      [sub("roth", 1, 0, "taxFree"), sub("trad", 1, 100)],
      600,
      { ...money, employeeRoth: 1000, employeePreTax: 0, employer: 0 },
      null,
    );
    expect(Math.min(...amounts.values())).toBeGreaterThanOrEqual(0);
    expect(sum(amounts)).toBeCloseTo(600, 10);
  });

  it("places the match by tax type, and after-tax money in the after-tax part", () => {
    const parts = [
      sub("roth", 1, 100, "taxFree"),
      sub("trad", 1, 100),
      sub("after", 1, 100, "afterTax"),
      sub("matchRoth", 1, 0, "taxFree", "Employer Match"),
      sub("matchPre", 1, 0, "preTax", "Employer Match"),
    ];
    const { amounts } = splitAccountBalance(
      parts,
      400,
      {
        employeeRoth: 0,
        employeePreTax: 0,
        employeeOther: 40,
        employer: 60,
        employerRoth: 20,
        estimated: false,
      },
      "Employer Match",
    );
    // Weights 100 / 100 / 140 / 20 / 40 of 400 — the balance matches exactly.
    expect(Object.fromEntries(amounts)).toEqual({
      roth: 100,
      trad: 100,
      after: 140,
      matchRoth: 20,
      matchPre: 40,
    });
  });

  it("sends the match to the pre-tax part when the plan has no match part", () => {
    const { amounts } = splitAccountBalance(
      plan.slice(0, 2),
      2200,
      money,
      null,
    );
    // trad gets 60 + 40; weights 1100 / 1100.
    expect(amounts.get("trad")).toBe(1100);
  });
});
