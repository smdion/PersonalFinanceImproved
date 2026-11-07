/**
 * Each person's RMD comes from that person's own Retirement accounts,
 * never a spouse's (enforceOwnerRmds). Per person, each year:
 *
 *   ownerDraw + min(qcd, rmd) + shortfall = rmd
 */
import { describe, it, expect } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { distributeWithdrawals } from "@/lib/pure/engine/individual-accounts/withdrawals";
import {
  enforceOwnerRmds,
  rmdOwnerOf,
} from "@/lib/pure/engine/rmd-enforcement";
import type {
  AccountBalances,
  IndividualAccountInput,
} from "@/lib/pure/accounts/account-balances.types";
import type {
  DecumulationSlot,
  EngineDecumulationYear,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { acct, household } from "../fixtures/two-person-household";

const decumYears = (input: ProjectionInput) =>
  calculateProjection(input).projectionByYear.filter(
    (y): y is EngineDecumulationYear => y.phase === "decumulation",
  );
const person = (y: EngineDecumulationYear, id: number) =>
  y.rmdByPerson?.find((p) => p.personId === id);

describe("per-owner RMDs through the engine", () => {
  // Routing draws Bo's 401k first; Ann's IRA holds the RMD.
  const accounts = [
    acct("Ann IRA", "ira", 500000, 1),
    acct("Bo 401k", "401k", 500000, 2),
  ];

  it("routing took enough from Bo: Ann's RMD still comes from Ann, and income doesn't rise", () => {
    const [first, second] = decumYears(household(accounts));
    const required = person(first!, 1)!.amount;
    expect(required).toBeCloseTo(500000 / 22, 0);
    expect(person(first!, 2)).toBeUndefined();
    // The next year's RMD base shows what left Ann's own account.
    expect(person(second!, 1)!.priorYearEndTradBalance).toBeCloseTo(
      500000 - required,
      0,
    );
    expect(first!.rmdOverrodeRouting).toBe(false);
    expect(first!.rmdReassignedAmount).toBeGreaterThan(0);
    expect(first!.rmdShortfallAmount).toBe(0);
    // The household total is what the need took, not need + RMD.
    expect(first!.totalTraditionalWithdrawal).toBe(first!.targetWithdrawal);
    expect(first!.rmdExcessAmount).toBe(0);
  });

  it("a QCD above Ann's RMD doesn't reduce Bo's", () => {
    const ages = {
      currentAge: 78,
      socialSecurityEntries: [
        {
          personId: 1,
          personName: "Ann",
          birthYear: 1948,
          startAge: 70,
          annualAmount: 0,
        },
        {
          personId: 2,
          personName: "Bo",
          birthYear: 1950,
          startAge: 70,
          annualAmount: 0,
        },
      ],
      perPersonBirthYears: [1948, 1950],
    };
    const qcdYear = decumYears(
      household(
        [acct("Ann IRA", "ira", 500000, 1), acct("Bo 401k", "401k", 500000, 2)],
        { ...ages, annualExpenses: 1000 },
        { qcdMaximize: true },
      ),
    )[0]!;
    const annRmd = person(qcdYear, 1)!.amount;
    const boRmd = person(qcdYear, 2)!.amount;
    expect(qcdYear.qcdAmount).toBeGreaterThan(annRmd);
    // Ann's covered by her QCD; Bo's is still a taxable draw in full.
    expect(qcdYear.totalTraditionalWithdrawal).toBeCloseTo(boRmd, 0);
    expect(qcdYear.rmdAmount).toBeCloseTo(annRmd + boRmd, 0);
  });

  it("the primary with no Traditional money doesn't force an RMD on a 65-year-old", () => {
    const year = decumYears(
      household(
        [
          acct("Ann Roth", "ira", 100000, 1, "taxFree"),
          acct("Bo 401k", "401k", 500000, 2),
        ],
        { annualExpenses: 1000 },
      ),
    )[0]!;
    expect(year.rmdAmount).toBe(0);
    expect(year.rmdOverrodeRouting).toBe(false);
    expect(year.totalTraditionalWithdrawal).toBeLessThan(5000);
  });

  it("Traditional money with no owner counts as the primary's, with a warning once", () => {
    const years = decumYears(
      household([
        acct("Old IRA", "ira", 440000, undefined),
        acct("Bo 401k", "401k", 500000, 2),
      ]),
    );
    expect(person(years[0]!, 1)!.amount).toBeCloseTo(20000, 0);
    const warned = years.flatMap((y) => y.warnings ?? []);
    expect(warned.filter((w) => w.includes("has no owner"))).toHaveLength(1);
  });

  it("an ownerless IRA counts for the primary's QCD as it does for their RMD", () => {
    const year = (owner: number | undefined) =>
      calculateProjection(
        household(
          [acct("IRA", "ira", 1_000_000, owner)],
          {},
          { qcdMaximize: true },
        ),
      ).projectionByYear.find(
        (y) => y.phase === "decumulation",
      ) as EngineDecumulationYear;
    const owned = year(1);
    expect(owned.qcdAmount).toBeGreaterThan(0);
    expect(year(undefined).qcdAmount).toBe(owned.qcdAmount);
  });

  it("money held outside the plan: the shortfall is Ann's, never Bo's", () => {
    const portfolio = {
      ...acct("Ann IRA", "ira", 500000, 1),
      parentCategory: "Portfolio" as const,
    };
    const year = decumYears(
      household([portfolio, acct("Bo 401k", "401k", 500000, 2)]),
    )[0]!;
    const required = person(year, 1)!.amount;
    expect(person(year, 1)!.shortfall).toBeCloseTo(required, 0);
    expect(year.rmdShortfallAmount).toBeCloseTo(required, 0);
    const warning = (year.warnings ?? []).find((w) =>
      w.includes("RMD SHORTFALL"),
    )!;
    expect(warning).toContain("Ann");
    expect(warning).toContain("outside the retirement plan");
    expect(warning).not.toContain("Roth conversions");
  });
});

describe("per-owner RMDs with an HSA draw and real returns", () => {
  // Routing draws the HSA first, then Bo's 401k; Ann's IRA holds the RMD.
  const accounts = [
    acct("Ann IRA", "ira", 500000, 1),
    acct("Bo 401k", "401k", 500000, 2),
    acct("Bo HSA", "hsa", 20000, 2, "hsa"),
  ];
  const input = () => {
    const base = household(
      accounts,
      { returnRates: [{ label: "6%", rate: 0.06 }] },
      {
        withdrawalOrder: ["hsa", "401k", "403b", "ira", "brokerage"],
        withdrawalSplits: {
          "401k": 0,
          "403b": 0,
          ira: 0,
          brokerage: 0,
          hsa: 1,
        },
      },
    );
    return {
      ...base,
      startingBalances: { ...base.startingBalances, hsa: 20000 },
      startingAccountBalances: {
        ...base.startingAccountBalances!,
        hsa: { structure: "single_bucket" as const, balance: 20000 },
      },
    };
  };

  it("slots add up to the reported withdrawal, every year", () => {
    for (const y of decumYears(input())) {
      expect(y.slots.reduce((sum, s) => sum + s.withdrawal, 0)).toBeCloseTo(
        y.totalWithdrawal,
        1,
      );
      expect(y.totalWithdrawal).toBeGreaterThan(0);
    }
  });

  it("balances fall by exactly the reported withdrawal: no money vanishes", () => {
    const [first, second] = decumYears(input());
    expect(first!.slots.find((s) => s.category === "hsa")!.withdrawal).toBe(
      20000,
    );
    // Withdrawn at the start of the year, then 6% on what's left.
    expect(first!.retirementBalance).toBeCloseTo(
      (1020000 - first!.totalWithdrawal + first!.rmdExcessAmount) * 1.06,
      -1,
    );
    expect(second!.retirementBalance).toBeCloseTo(
      (first!.retirementBalance -
        second!.totalWithdrawal +
        second!.rmdExcessAmount) *
        1.06,
      -1,
    );
  });

  it("each owner's RMD base is the year-end balance, after growth", () => {
    const [first, second] = decumYears(input());
    const required = person(first!, 1)!.amount;
    expect(person(second!, 1)!.priorYearEndTradBalance).toBeCloseTo(
      (500000 - required) * 1.06,
      0,
    );
  });

  it("an HSA draw doesn't meet an RMD", () => {
    const [first] = decumYears(input());
    const required = person(first!, 1)!.amount;
    expect(first!.rmdOverrodeRouting).toBe(false);
    expect(
      first!.slots.find((s) => s.category === "ira")!.traditionalWithdrawal,
    ).toBeCloseTo(required, 0);
  });
});

describe("enforceOwnerRmds", () => {
  const indKey = (ia: { name: string }) => ia.name;
  const balances = (trad401k: number, tradIra = 0) =>
    ({
      "401k": { structure: "roth_traditional", traditional: trad401k, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: tradIra, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
    }) as AccountBalances;
  const slot = (category: "401k" | "ira", amount: number) =>
    ({
      category,
      withdrawal: amount,
      traditionalWithdrawal: amount,
      rothWithdrawal: 0,
    }) as DecumulationSlot;
  const run = (
    accts: IndividualAccountInput[],
    slots: DecumulationSlot[],
    owners: { personId: number; personName: string; required: number }[],
    acctBal: AccountBalances,
  ) => {
    const indBal = new Map(accts.map((a) => [a.name, a.startingBalance]));
    const total = slots.reduce((s, x) => s + x.traditionalWithdrawal, 0);
    const result = enforceOwnerRmds({
      owners,
      primaryPersonId: 1,
      slots,
      totalTraditionalWithdrawal: total,
      totalWithdrawal: total,
      acctBal,
      indAccts: accts,
      indKey: indKey as never,
      indBal,
    });
    return { result, indBal };
  };

  it("an HSA draw stays put and isn't reshaped into Traditional, RMD due or not", () => {
    const accts = [acct("Bo 401k", "401k", 500000, 2)];
    const hsa = {
      category: "hsa",
      withdrawal: 10000,
      traditionalWithdrawal: 10000,
      rothWithdrawal: 0,
    } as DecumulationSlot;
    const slots = [slot("401k", 20000), hsa];
    const { result } = run(accts, slots, [], balances(500000));
    expect(slots.map((s) => s.withdrawal)).toEqual([20000, 10000]);
    expect(result.totalWithdrawal).toBe(30000);
    expect(result.totalTraditionalWithdrawal).toBe(30000);
    expect(result.rmdOverrodeRouting).toBe(false);
  });

  it("two owners in one category: the pin stays on the owner's account", () => {
    const accts = [
      acct("Ann 401k", "401k", 300000, 1),
      acct("Bo 401k", "401k", 700000, 2),
    ];
    const slots = [slot("401k", 50000)];
    const { result, indBal } = run(
      accts,
      slots,
      [{ personId: 1, personName: "Ann", required: 20000 }],
      balances(1000000),
    );
    expect(result.pins.get("Ann 401k")).toBe(20000);
    expect(result.totalTraditionalWithdrawal).toBe(50000);
    const { decIndWithdrawal } = distributeWithdrawals(
      slots,
      accts,
      indKey as never,
      indBal,
      undefined,
      result.pins,
    );
    // Pin first, then the other 30,000 fans out by what's left (280k / 700k).
    expect(decIndWithdrawal.get("Ann 401k")).toBeCloseTo(
      20000 + (30000 * 280) / 980,
      1,
    );
    expect(decIndWithdrawal.get("Bo 401k")).toBeCloseTo((30000 * 700) / 980, 1);
  });

  it("a draw moves across categories without adding income", () => {
    const accts = [
      acct("Ann IRA", "ira", 500000, 1),
      acct("Bo 401k", "401k", 500000, 2),
    ];
    const slots = [slot("401k", 40000)];
    const { result } = run(
      accts,
      slots,
      [{ personId: 1, personName: "Ann", required: 22727.27 }],
      balances(500000, 500000),
    );
    expect(result.totalTraditionalWithdrawal).toBe(40000);
    expect(result.rmdOverrodeRouting).toBe(false);
    expect(result.rmdReassignedAmount).toBe(22727.27);
    expect(slots.find((s) => s.category === "ira")?.traditionalWithdrawal).toBe(
      22727.27,
    );
    expect(
      slots.find((s) => s.category === "401k")?.traditionalWithdrawal,
    ).toBe(17272.73);
  });

  it("only a real deficit adds money and overrides routing", () => {
    const accts = [acct("Ann IRA", "ira", 500000, 1)];
    const { result } = run(
      accts,
      [slot("ira", 5000)],
      [{ personId: 1, personName: "Ann", required: 20000 }],
      balances(0, 500000),
    );
    expect(result.rmdOverrodeRouting).toBe(true);
    expect(result.totalTraditionalWithdrawal).toBe(20000);
    expect(result.totalWithdrawal).toBe(20000);
  });

  it("an owner's accounts are spread by balance, capped", () => {
    const accts = [
      acct("Ann 401k", "401k", 90000, 1),
      acct("Ann IRA", "ira", 10000, 1),
    ];
    const { result } = run(
      accts,
      [],
      [{ personId: 1, personName: "Ann", required: 10000 }],
      balances(90000, 10000),
    );
    expect(result.pins.get("Ann 401k")).toBe(9000);
    expect(result.pins.get("Ann IRA")).toBe(1000);
  });

  it("rmdOwnerOf: the owner, else the primary", () => {
    expect(rmdOwnerOf({ ownerPersonId: 2 }, 1)).toBe(2);
    expect(rmdOwnerOf({ ownerPersonId: undefined }, 1)).toBe(1);
    expect(rmdOwnerOf({ ownerPersonId: undefined }, null)).toBeNull();
  });
});
