import { describe, expect, it } from "vitest";
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
      declared: true,
    });
  });

  it("an account held in both tax parts declares nothing more", () => {
    const parts = declareOpeningParts([
      retirementBrokerage,
      roth401k,
      { ...roth401k, taxType: "preTax", rothBasisMeta: undefined },
    ]);
    expect(parts).toHaveLength(3);
    expect(parts.some((p) => p.declared)).toBe(false);
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
    expect(keysOf(parts.filter((p) => p.declared))).toEqual([
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
        projectedOnly: true,
      },
    ]);
  });

  it("an account with no parent is retirement money, so no projected brokerage is added", () => {
    const { parentCategory: _parent, ...noParent } = retirementBrokerage;
    expect(declareOpeningParts([noParent])).toEqual([noParent]);
  });
});
