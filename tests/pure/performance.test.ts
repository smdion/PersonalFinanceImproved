/**
 * Tests for pure business logic extracted from performance router's finalizeYear.
 * Covers: resolveCategoryValues, resolvePortfolioValues, filterAccountsForNextYear,
 * buildAccountKeys, assembleNetWorthValues, computePortfolioTotal,
 * computeHomeImprovementsCumulative, filterActiveJobsAtDate.
 */
import { describe, it, expect } from "vitest";
import {
  resolveCategoryValues,
  resolvePortfolioValues,
  filterAccountsForNextYear,
  buildAccountKeys,
  assembleNetWorthValues,
  computePortfolioTotal,
  computeHomeImprovementsCumulative,
  filterActiveJobsAtDate,
} from "@/lib/pure/performance";
import type {
  CategoryOverride,
  LifetimeBaseline,
} from "@/lib/pure/performance";

const zeroPrev: LifetimeBaseline = {
  lifetimeGains: 0,
  lifetimeContributions: 0,
  lifetimeMatch: 0,
};

describe("resolveCategoryValues", () => {
  const accounts = [
    {
      beginningBalance: "10000",
      totalContributions: "5000",
      yearlyGainLoss: "2000",
      endingBalance: "17000",
      employerContributions: "1000",
      distributions: "0",
      fees: "50",
      rollovers: "0",
    },
    {
      beginningBalance: "20000",
      totalContributions: "3000",
      yearlyGainLoss: "1500",
      endingBalance: "24500",
      employerContributions: "500",
      distributions: "200",
      fees: "30",
      rollovers: "100",
    },
  ];

  it("computes from accounts when no override", () => {
    const { values, returnPct } = resolveCategoryValues(
      accounts,
      undefined,
      zeroPrev,
    );
    expect(values.beginningBalance).toBe(30000);
    expect(values.totalContributions).toBe(8000);
    expect(values.yearlyGainLoss).toBe(3500);
    expect(values.endingBalance).toBe(41500);
    expect(values.employerContributions).toBe(1500);
    expect(values.distributions).toBe(200);
    expect(values.fees).toBe(80);
    expect(values.rollovers).toBe(100);
    // Lifetime = prev + current
    expect(values.lifetimeGains).toBe(3500);
    expect(values.lifetimeContributions).toBe(8000);
    expect(values.lifetimeMatch).toBe(1500);
    expect(returnPct).not.toBeNull();
  });

  it("carries forward lifetime from previous year", () => {
    const prev: LifetimeBaseline = {
      lifetimeGains: 10000,
      lifetimeContributions: 20000,
      lifetimeMatch: 5000,
    };
    const { values } = resolveCategoryValues(accounts, undefined, prev);
    expect(values.lifetimeGains).toBe(13500);
    expect(values.lifetimeContributions).toBe(28000);
    expect(values.lifetimeMatch).toBe(6500);
  });

  it("uses override values when provided", () => {
    const override: CategoryOverride = {
      category: "401k/IRA",
      beginningBalance: "99000",
      totalContributions: "11000",
      yearlyGainLoss: "5000",
      endingBalance: "115000",
      employerContributions: "3000",
      distributions: "0",
      fees: "100",
      rollovers: "0",
      lifetimeGains: "50000",
      lifetimeContributions: "80000",
      lifetimeMatch: "20000",
    };
    const { values, returnPct } = resolveCategoryValues(
      accounts,
      override,
      zeroPrev,
    );
    expect(values.beginningBalance).toBe(99000);
    expect(values.totalContributions).toBe(11000);
    expect(values.endingBalance).toBe(115000);
    expect(values.lifetimeGains).toBe(50000);
    expect(returnPct).not.toBeNull();
  });
});

describe("resolvePortfolioValues", () => {
  const catValues = [
    {
      beginningBalance: 30000,
      totalContributions: 8000,
      yearlyGainLoss: 3500,
      endingBalance: 41500,
      employerContributions: 1500,
      distributions: 200,
      fees: 80,
      rollovers: 100,
      lifetimeGains: 3500,
      lifetimeContributions: 8000,
      lifetimeMatch: 1500,
    },
    {
      beginningBalance: 5000,
      totalContributions: 2000,
      yearlyGainLoss: 500,
      endingBalance: 7500,
      employerContributions: 0,
      distributions: 0,
      fees: 10,
      rollovers: 0,
      lifetimeGains: 500,
      lifetimeContributions: 2000,
      lifetimeMatch: 0,
    },
  ];

  it("sums category values when no override", () => {
    const { values } = resolvePortfolioValues(catValues, undefined);
    expect(values.beginningBalance).toBe(35000);
    expect(values.totalContributions).toBe(10000);
    expect(values.yearlyGainLoss).toBe(4000);
    expect(values.endingBalance).toBe(49000);
    expect(values.lifetimeGains).toBe(4000);
  });

  it("uses override when provided", () => {
    const override: CategoryOverride = {
      category: "Portfolio",
      beginningBalance: "100000",
      totalContributions: "20000",
      yearlyGainLoss: "10000",
      endingBalance: "130000",
      employerContributions: "5000",
      distributions: "0",
      fees: "200",
      rollovers: "0",
      lifetimeGains: "50000",
      lifetimeContributions: "100000",
      lifetimeMatch: "20000",
    };
    const { values } = resolvePortfolioValues(catValues, override);
    expect(values.beginningBalance).toBe(100000);
    expect(values.endingBalance).toBe(130000);
  });
});

describe("filterAccountsForNextYear", () => {
  const activeMasterIds = new Set([1, 2, 3]);

  it("includes active accounts with active masters", () => {
    const accts = [
      { isActive: true, performanceAccountId: 1, name: "a" },
      { isActive: true, performanceAccountId: 2, name: "b" },
    ];
    expect(filterAccountsForNextYear(accts, activeMasterIds)).toHaveLength(2);
  });

  it("excludes inactive accounts", () => {
    const accts = [
      { isActive: false, performanceAccountId: 1, name: "a" },
      { isActive: true, performanceAccountId: 2, name: "b" },
    ];
    expect(filterAccountsForNextYear(accts, activeMasterIds)).toHaveLength(1);
  });

  it("excludes accounts whose master is deactivated", () => {
    const accts = [
      { isActive: true, performanceAccountId: 99, name: "deactivated" },
      { isActive: true, performanceAccountId: 1, name: "ok" },
    ];
    expect(filterAccountsForNextYear(accts, activeMasterIds)).toHaveLength(1);
    expect(filterAccountsForNextYear(accts, activeMasterIds)[0]!.name).toBe(
      "ok",
    );
  });

  it("includes accounts without performanceAccountId", () => {
    const accts = [
      { isActive: true, performanceAccountId: null, name: "legacy" },
    ];
    expect(filterAccountsForNextYear(accts, activeMasterIds)).toHaveLength(1);
  });
});

describe("buildAccountKeys", () => {
  it("builds dedup keys", () => {
    const keys = buildAccountKeys([
      { institution: "Vanguard", accountLabel: "401k", ownerPersonId: 1 },
      { institution: "Fidelity", accountLabel: "IRA", ownerPersonId: null },
    ]);
    expect(keys.has("Vanguard:401k:1")).toBe(true);
    expect(keys.has("Fidelity:IRA:")).toBe(true);
    expect(keys.has("Schwab:401k:1")).toBe(false);
  });
});

describe("assembleNetWorthValues", () => {
  it("formats all values to 2 decimal places", () => {
    const nw = assembleNetWorthValues({
      yearEndDate: "2024-12-31",
      grossIncome: 150000.555,
      portfolioTotal: 500000,
      cash: 25000.1,
      houseValue: 350000,
      otherAssets: 15000,
      mortgageBalance: 200000,
      otherLiabilities: 5000,
      homeImprovements: 30000,
      propertyTaxes: 8000,
    });
    expect(nw.yearEndDate).toBe("2024-12-31");
    expect(nw.grossIncome).toBe("150000.55");
    expect(nw.cash).toBe("25000.10");
    expect(nw.propertyTaxes).toBe("8000.00");
  });

  it("returns null for zero property taxes", () => {
    const nw = assembleNetWorthValues({
      yearEndDate: "2024-12-31",
      grossIncome: 100000,
      portfolioTotal: 500000,
      cash: 10000,
      houseValue: 300000,
      otherAssets: 0,
      mortgageBalance: 200000,
      otherLiabilities: 0,
      homeImprovements: 0,
      propertyTaxes: 0,
    });
    expect(nw.propertyTaxes).toBeNull();
  });
});

describe("computePortfolioTotal", () => {
  it("sums ending balances", () => {
    expect(
      computePortfolioTotal([
        { endingBalance: "10000.50" },
        { endingBalance: "20000.25" },
        { endingBalance: null },
      ]),
    ).toBeCloseTo(30000.75);
  });

  it("returns 0 for empty array", () => {
    expect(computePortfolioTotal([])).toBe(0);
  });
});

describe("computeHomeImprovementsCumulative", () => {
  const items = [
    { year: 2020, cost: "5000" },
    { year: 2021, cost: "10000" },
    { year: 2023, cost: "3000" },
  ];

  it("sums items up to given year", () => {
    expect(computeHomeImprovementsCumulative(items, 2021)).toBe(15000);
  });

  it("includes all items when year is after last", () => {
    expect(computeHomeImprovementsCumulative(items, 2025)).toBe(18000);
  });

  it("returns 0 for year before any items", () => {
    expect(computeHomeImprovementsCumulative(items, 2019)).toBe(0);
  });
});

describe("filterActiveJobsAtDate", () => {
  const jobs = [
    { startDate: "2020-01-01", endDate: "2022-12-31", name: "old" },
    { startDate: "2023-01-01", endDate: null, name: "current" },
    { startDate: "2025-06-01", endDate: null, name: "future" },
  ];

  it("returns jobs active at a given date", () => {
    const active = filterActiveJobsAtDate(jobs, new Date("2024-06-15"));
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe("current");
  });

  it("includes jobs ending on the exact date", () => {
    const active = filterActiveJobsAtDate(jobs, new Date("2022-12-31"));
    expect(active.map((j) => j.name)).toContain("old");
  });
});
