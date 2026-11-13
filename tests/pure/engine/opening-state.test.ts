import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import { acct, household } from "../fixtures/two-person-household";
import { makeAccumulationDefaults } from "../fixtures/engine-fixtures";
import { declareOpeningParts } from "@/lib/pure/engine/opening-state";
import { accountKeyOf } from "@/lib/pure/accounts/account-part";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { PROJECTED_RETIREMENT_BROKERAGE_LABEL } from "@/lib/config/display-labels";

const retirementBrokerage: IndividualAccountInput = {
  name: "Retirement brokerage",
  category: "brokerage",
  taxType: "afterTax",
  startingBalance: 1000,
  startingBasis: 800,
  parentCategory: "Retirement",
};

const roth401k: IndividualAccountInput = {
  name: "Alice 401(k)",
  performanceAccountId: 7,
  category: "401k",
  taxType: "taxFree",
  startingBalance: 50000,
  ownerName: "Alice",
  ownerPersonId: 1,
  parentCategory: "Retirement",
  rothBasisMeta: {
    year: 2026,
    contributionBasis: 20000,
    conversionBasis: 0,
    latestConversionYear: null,
    isSeeded: false,
    updatedAt: "2026-01-01",
  },
  ruleOf55: null,
};

const keysOf = (parts: IndividualAccountInput[]) =>
  parts.map((p) => accountKeyOf(p));

describe("declareOpeningParts", () => {
  it("a run with no accounts declares nothing", () => {
    expect(declareOpeningParts([])).toEqual([]);
  });

  it("a Roth-only 401(k) gains its owner's Traditional part at $0, with the account's facts and none of the held part's money", () => {
    const parts = declareOpeningParts([retirementBrokerage, roth401k]);
    expect(parts.slice(0, 2)).toEqual([retirementBrokerage, roth401k]);
    expect(parts).toHaveLength(3);
    const { rothBasisMeta: _basis, ...facts } = roth401k;
    expect(parts[2]).toEqual({
      ...facts,
      taxType: "preTax",
      startingBalance: 0,
      origin: "declared",
    });
  });

  it("an account held in both tax parts declares nothing more", () => {
    const parts = declareOpeningParts([
      retirementBrokerage,
      roth401k,
      { ...roth401k, taxType: "preTax", rothBasisMeta: undefined },
    ]);
    expect(parts).toHaveLength(3);
    expect(parts.some((p) => p.origin === "declared")).toBe(false);
  });

  it("an IRA held in parts by two owners declares each owner's missing part", () => {
    const ira = (ownerPersonId: number, taxType: string) => ({
      name: "Joint IRA",
      category: "ira" as const,
      taxType,
      startingBalance: 10000,
      ownerPersonId,
      parentCategory: "Retirement",
    });
    const parts = declareOpeningParts([
      retirementBrokerage,
      ira(1, "preTax"),
      ira(2, "taxFree"),
    ]);
    expect(keysOf(parts.filter((p) => p.origin === "declared"))).toEqual([
      accountKeyOf(ira(1, "taxFree")),
      accountKeyOf(ira(2, "preTax")),
    ]);
  });

  it("accounts with no Roth split declare no other part", () => {
    const hsa: IndividualAccountInput = {
      name: "HSA",
      category: "hsa",
      taxType: "hsa",
      startingBalance: 5000,
      parentCategory: "Retirement",
    };
    expect(declareOpeningParts([retirementBrokerage, hsa])).toEqual([
      retirementBrokerage,
      hsa,
    ]);
  });

  it("with no Retirement brokerage, the projected one is declared after the held parts", () => {
    const portfolioBrokerage = {
      ...retirementBrokerage,
      parentCategory: "Portfolio",
    };
    const parts = declareOpeningParts([portfolioBrokerage]);
    expect(parts).toEqual([
      portfolioBrokerage,
      {
        name: PROJECTED_RETIREMENT_BROKERAGE_LABEL,
        category: "brokerage",
        taxType: "afterTax",
        startingBalance: 0,
        startingBasis: 0,
        parentCategory: "Retirement",
        origin: "projected",
      },
    ]);
  });

  it("an account with no parent is retirement money, so no projected brokerage is added", () => {
    const { parentCategory: _parent, ...noParent } = retirementBrokerage;
    expect(declareOpeningParts([noParent])).toEqual([noParent]);
  });
});

describe("a slot's money with no spec of its tax type", () => {
  // Ann (40, working) holds a Traditional 401(k) and saves through a
  // pre-tax spec only; year 0's paycheck amounts follow her 401(k) split,
  // half Roth.
  const input = household(
    [{ ...acct("Ann 401k", "401k", 100000, 1), parentCategory: "Retirement" }],
    {
      currentAge: 40,
      birthYear: 1986,
      retirementYear: 2050,
      projectionEndYear: 2030,
      currentSalary: 100000,
      accumulationDefaults: makeAccumulationDefaults({
        contributionRate: 0.1,
        accountSplits: { "401k": 1, "403b": 0, hsa: 0, ira: 0, brokerage: 0 },
        taxSplits: { "401k": 0.5, ira: 1 },
      }),
      contributionSpecs: [
        {
          category: "401k",
          name: "Ann 401k",
          accountName: "Ann 401k",
          method: "percent_of_salary",
          value: 10,
          salaryFraction: 1,
          baseAnnual: 10000,
          taxTreatment: "pre_tax",
          allocationPriority: 0,
          personId: 1,
          ownerName: "Ann",
          parentCategory: "Retirement",
        },
      ],
      baseYearContributions: {
        "401k": 10000,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      baseYearEmployerMatch: {
        "401k": 0,
        "403b": 0,
        hsa: 0,
        ira: 0,
        brokerage: 0,
      },
      socialSecurityEntries: [],
    },
  );

  it("lands on the same account's declared part of that tax type", () => {
    const result = calculateProjection(input);
    const year0 = result.projectionByYear[0]!;
    const part = (taxType: string) =>
      year0.individualAccountBalances.find(
        (r) => r.name === "Ann 401k" && r.taxType === taxType,
      );
    // 10 of 12 months of $10,000, split half and half to the cent.
    expect(part("taxFree")?.contribution).toBe(4166.67);
    expect(part("preTax")?.contribution).toBe(4166.66);
    expect(
      result.projectionByYear.flatMap((y) => y.warnings ?? []),
    ).not.toContainEqual(expect.stringContaining("drifted"));
  });
});

describe("parts no real account stands behind", () => {
  const parts = [
    { ...acct("Ann IRA", "ira", 400000, 1), parentCategory: "Retirement" },
    { ...acct("Bo IRA", "ira", 300000, 2), parentCategory: "Retirement" },
  ];
  const run = (synthetic: boolean) =>
    calculateProjection(
      household(
        parts.map((p) =>
          synthetic ? { ...p, origin: "synthetic" as const } : p,
        ),
      ),
    ).projectionByYear;

  it("show no per-account rows", () => {
    expect(run(false)[0]!.individualAccountBalances).not.toEqual([]);
    for (const y of run(true)) expect(y.individualAccountBalances).toEqual([]);
  });
});
