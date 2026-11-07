/**
 * What finalizing a Performance year writes (lib/pure/investments/
 * finalize-year.ts), on an invented household. The writes themselves, in one
 * transaction, are pinned by tests/baseline's finalize pins.
 */
import { describe, expect, it } from "vitest";
import {
  finalizedAnnualFields,
  nearestToYearEnd,
  nextYearAccountRow,
  nextYearAnnualRow,
  portfolioByTaxLocationFrom,
  yearGrossIncome,
} from "@/lib/pure/investments/finalize-year";

const values = {
  beginningBalance: 1000,
  totalContributions: 100.005,
  yearlyGainLoss: 50,
  endingBalance: 1150,
  employerContributions: 10,
  distributions: 0,
  fees: 0,
  rollovers: 0,
  lifetimeGains: 250,
  lifetimeContributions: 900,
  lifetimeMatch: 40,
};

describe("finalizedAnnualFields", () => {
  it("locks the row and writes each figure to the cent, the return to six places", () => {
    const fields = finalizedAnnualFields(values, 0.0476190476);
    expect(fields).toMatchObject({
      isFinalized: true,
      isCurrentYear: false,
      isImmutable: true,
      beginningBalance: "1000.00",
      endingBalance: "1150.00",
      annualReturnPct: "0.047619",
      lifetimeMatch: "40.00",
    });
    expect(finalizedAnnualFields(values, null).annualReturnPct).toBeNull();
  });
});

describe("next year's rows", () => {
  const masters = [
    { id: 1, accountType: "401k", parentCategory: "Retirement" },
    { id: 2, accountType: "brokerage", parentCategory: "Portfolio" },
  ];
  const lookups = new Map(masters.map((m) => [m.id, m]));
  const account = (id: number, endingBalance: string) => ({
    id,
    institution: "Acme",
    accountLabel: `Acct ${id}`,
    ownerPersonId: 1,
    parentCategory: "Brokerage",
    performanceAccountId: id,
    endingBalance,
  });

  it("opens an account at this year's ending balance, under its master's parent category", () => {
    expect(nextYearAccountRow(account(2, "520.00"), masters, 2026)).toEqual({
      year: 2026,
      institution: "Acme",
      accountLabel: "Acct 2",
      ownerPersonId: 1,
      parentCategory: "Portfolio",
      isActive: true,
      performanceAccountId: 2,
      beginningBalance: "520.00",
      totalContributions: "0",
      yearlyGainLoss: "0",
      endingBalance: "520.00",
      employerContributions: "0",
      fees: "0",
      distributions: "0",
    });
    // An account whose master isn't in the list keeps its own parent category.
    const orphan = account(9, "1.00");
    expect(nextYearAccountRow(orphan, masters, 2026).parentCategory).toBe(
      "Brokerage",
    );
  });

  it("opens a category at its accounts' balances, Portfolio at all of them, with the lifetime totals carried", () => {
    const active = [account(1, "1150.00"), account(2, "520.00")];
    const finalized = [
      {
        category: "Portfolio",
        lifetimeGains: "300.00",
        lifetimeContributions: "1000.00",
        lifetimeMatch: "50.00",
      },
    ];
    const portfolio = nextYearAnnualRow(
      2026,
      "Portfolio",
      active,
      lookups,
      finalized,
    );
    expect(portfolio).toMatchObject({
      year: 2026,
      beginningBalance: "1670.00",
      endingBalance: "1670.00",
      lifetimeGains: "300.00",
      isCurrentYear: true,
      isFinalized: false,
    });
    const brokerage = nextYearAnnualRow(
      2026,
      "Brokerage",
      active,
      lookups,
      finalized,
    );
    expect(brokerage.beginningBalance).toBe("520.00");
    expect(brokerage.lifetimeGains).toBe("0");
  });
});

describe("yearGrossIncome", () => {
  it("sums each person's recorded salary and bonus", () => {
    const rows = new Map([
      [1, { salary: "90000", bonus: "5000" }],
      [2, { salary: "60000", bonus: null }],
    ]);
    expect(
      yearGrossIncome(
        2024,
        2026,
        [{ id: 1 }, { id: 2 }],
        [],
        rows,
        new Map(),
        new Date(2026, 5, 1),
      ),
    ).toEqual({ grossIncome: 155000, anyIncomeRecorded: true });
  });

  it("says when nobody's income for a past year was recorded", () => {
    expect(
      yearGrossIncome(
        2024,
        2026,
        [{ id: 1 }],
        [],
        new Map(),
        new Map(),
        new Date(2026, 5, 1),
      ),
    ).toEqual({ grossIncome: 0, anyIncomeRecorded: false });
  });
});

describe("the tax-location split", () => {
  it("takes the snapshot nearer Dec 31, either side", () => {
    const before = { id: 1, snapshotDate: "2025-12-20" };
    const after = { id: 2, snapshotDate: "2026-01-02" };
    expect(nearestToYearEnd("2025-12-31", [before, after])).toEqual([after]);
    expect(nearestToYearEnd("2025-12-31", [before, undefined])).toEqual([
      before,
    ]);
    expect(nearestToYearEnd("2025-12-31", [undefined, undefined])).toEqual([]);
  });

  it("sums by tax type, Portfolio-parented apart from the rest", () => {
    expect(
      portfolioByTaxLocationFrom([
        { parentCategory: "Retirement", taxType: "preTax", amount: "100.50" },
        { parentCategory: "Retirement", taxType: "preTax", amount: "50" },
        { parentCategory: "Portfolio", taxType: "taxFree", amount: "20" },
      ]),
    ).toEqual({
      retirement: { preTax: 150.5 },
      portfolio: { taxFree: 20 },
    });
    expect(portfolioByTaxLocationFrom([])).toEqual({
      retirement: {},
      portfolio: {},
    });
  });
});
