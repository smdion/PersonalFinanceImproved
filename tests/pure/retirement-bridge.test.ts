/** The bridge to penalty-free money — read from the engine's projection. */
import { describe, it, expect } from "vitest";
import { retirementBridge } from "@/lib/pure/retirement-bridge";
import type { EngineYearProjection } from "@/lib/calculators/types/engine-projection";

type Acct = {
  name: string;
  category: string;
  taxType: string;
  ownerName?: string;
  ownerPersonId?: number;
  parentCategory?: string;
  balance: number;
  withdrawal?: number;
  penaltyFreeAmount?: number;
  penaltyExposedAmount?: number;
  allowPenalizedWithdrawals?: boolean;
  rothBasisUncertain?: boolean;
};

const acct = (
  o: Partial<Acct> & Pick<Acct, "name" | "category" | "taxType">,
): Acct => ({
  ownerName: "Pat",
  ownerPersonId: 1,
  parentCategory: "Retirement",
  balance: 0,
  withdrawal: 0,
  penaltyFreeAmount: 0,
  penaltyExposedAmount: 0,
  ...o,
});

const year = (
  y: number,
  age: number,
  accounts: Acct[],
  o: Record<string, unknown> = {},
): EngineYearProjection =>
  ({
    year: y,
    age,
    phase: "decumulation",
    afterTaxNeed: 60_000,
    ssIncome: 0,
    deliveredAfterTax: 60_000,
    unmetNeedMaterial: false,
    penaltyAvoidedShortfall: 0,
    nonRetirementShortfall: 0,
    penaltyCost: 0,
    projectedExpenses: 60_000,
    budgetOnlyExpenses: 60_000,
    rothConversionAmount: 0,
    penaltyLockedStillExcluded: accounts.some(
      (a) => (a.penaltyExposedAmount ?? 0) > 0 && a.category !== "hsa",
    )
      ? 1
      : 0,
    individualAccountBalances: accounts,
    ...o,
  }) as never;

const accum = { year: 2039, age: 54, phase: "accumulation" } as never;

describe("retirementBridge", () => {
  it("unknown without per-account eligibility (e.g. an older cached result)", () => {
    expect(
      retirementBridge([
        accum,
        year(2040, 55, [], { penaltyLockedStillExcluded: undefined }),
      ]),
    ).toEqual({ status: "unknown" });
  });

  it("nothing locked at the start: no bridge", () => {
    expect(
      retirementBridge([
        accum,
        year(2040, 55, [
          acct({
            name: "Taxable",
            category: "brokerage",
            taxType: "afterTax",
            balance: 900_000,
            penaltyFreeAmount: 900_000,
          }),
        ]),
      ]),
    ).toEqual({ status: "nothingLocked", year: 2040, age: 55 });
  });

  const brokerage = (free: number, w = 0) =>
    acct({
      name: "Taxable",
      category: "brokerage",
      taxType: "afterTax",
      balance: free,
      penaltyFreeAmount: free,
      withdrawal: w,
    });
  const ira = (exposed: number, free = 0) =>
    acct({
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
      balance: free + exposed,
      penaltyFreeAmount: free,
      penaltyExposedAmount: exposed,
    });
  const hsa = acct({
    name: "HSA",
    category: "hsa",
    taxType: "hsa",
    balance: 50_000,
    penaltyExposedAmount: 50_000,
  });
  const portfolio = acct({
    name: "Side brokerage",
    category: "brokerage",
    taxType: "afterTax",
    parentCategory: "Portfolio",
    balance: 99_000,
    penaltyFreeAmount: 99_000,
  });

  it("the bridge: years while money is locked, sources at the start, unlock year, tightest cushion", () => {
    const b = retirementBridge([
      accum,
      year(2040, 55, [
        brokerage(200_000, 60_000),
        ira(300_000, 40_000),
        hsa,
        portfolio,
      ]),
      year(2041, 56, [
        brokerage(150_000, 60_000),
        ira(320_000, 40_000),
        hsa,
        portfolio,
      ]),
      year(2042, 57, [
        brokerage(100_000, 60_000),
        ira(0, 400_000),
        hsa,
        portfolio,
      ]),
    ]);
    expect(b).toMatchObject({
      status: "bridge",
      firstYear: 2040,
      lastYear: 2041,
      startAge: 55,
      endAge: 56,
      // Portfolio savings and the HSA aren't counted as bridge money.
      sources: [
        { kind: "brokerage", amount: 200_000 },
        { kind: "roth", amount: 40_000 },
      ],
      hsa: 50_000,
      unlocks: [{ name: "Pat", year: 2042 }],
      cushion: { amount: 130_000, year: 2041 },
    });
    if (b.status === "bridge")
      expect(b.years.map((y) => [y.year, y.short, y.covered])).toEqual([
        [2040, false, 60_000],
        [2041, false, 60_000],
      ]);
  });

  it("a short year says why; strategy cuts, penalties, conversions, unowned accounts are noted", () => {
    const b = retirementBridge([
      year(
        2040,
        55,
        [
          brokerage(10_000),
          ira(300_000),
          acct({
            name: "Old 401k",
            category: "401k",
            taxType: "preTax",
            ownerPersonId: undefined,
            ownerName: undefined,
            balance: 5_000,
            penaltyFreeAmount: 5_000,
          }),
        ],
        {
          unmetNeedMaterial: true,
          penaltyAvoidedShortfall: 40_000,
          deliveredAfterTax: 20_000,
          budgetOnlyExpenses: 70_000,
          penaltyCost: 1_000,
          rothConversionAmount: 25_000,
        },
      ),
      year(2041, 56, [brokerage(0), ira(300_000)], {
        unmetNeedMaterial: true,
        deliveredAfterTax: 0,
      }),
    ]);
    if (b.status !== "bridge") throw new Error(b.status);
    expect(b.years.map((y) => [y.cause, y.covered])).toEqual([
      ["locked", 20_000],
      ["outOfMoney", 0],
    ]);
    expect(b).toMatchObject({
      strategyCut: 10_000,
      penaltyCost: 1_000,
      conversionsDuring: true,
      unownedAccounts: ["Old 401k"],
    });
  });

  it("an account opted into penalized draws doesn't keep the bridge open", () => {
    const optedIn = acct({
      name: "IRA",
      category: "ira",
      taxType: "preTax",
      balance: 300_000,
      penaltyExposedAmount: 300_000,
      allowPenalizedWithdrawals: true,
    });
    const b = retirementBridge([
      year(2040, 55, [brokerage(200_000), ira(100_000), optedIn]),
      year(2041, 56, [brokerage(150_000), optedIn], {
        penaltyLockedStillExcluded: 0,
      }),
    ]);
    if (b.status !== "bridge") throw new Error(b.status);
    expect(b.lastYear).toBe(2040);
    expect(b.unlocks).toEqual([{ name: "Pat", year: 2041 }]);
  });
});
