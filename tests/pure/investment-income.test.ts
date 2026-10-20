import { describe, it, expect } from "vitest";
import {
  estimateFeedIncome,
  estimateTaxableInvestmentIncome,
  investmentIncomeGaps,
  type IncomeTransaction,
} from "@/lib/pure/investment-income";
import { isTaxableCategory } from "@/lib/config/account-types";

const tx = (
  posted: string,
  amount: number,
  over: Partial<IncomeTransaction> = {},
): IncomeTransaction => ({
  feedId: 1,
  posted,
  kind: "dividend",
  amount,
  pending: false,
  voided: false,
  ...over,
});

describe("isTaxableCategory", () => {
  it("is decided by the account-type config, not the name", () => {
    expect(isTaxableCategory("brokerage")).toBe(true);
    expect(isTaxableCategory("ira")).toBe(false);
    expect(isTaxableCategory("401k")).toBe(false);
    expect(isTaxableCategory("hsa")).toBe(false);
    expect(isTaxableCategory(null)).toBe(false);
    expect(isTaxableCategory("unknown")).toBe(false);
  });
});

describe("estimateFeedIncome", () => {
  const rows = [
    tx("2025-03-15", 100),
    tx("2025-12-20", 900), // December capital-gain distribution
    tx("2026-03-15", 120),
    tx("2026-06-15", 80, { kind: "interest" }),
    tx("2026-06-21", 40, { pending: true }),
    tx("2026-06-22", 30, { voided: true }),
    tx("2026-06-23", 500, { kind: "contribution" }),
  ];

  it("this year so far + last year's rest of the year when last year is covered", () => {
    const r = estimateFeedIncome({
      rows,
      taxYear: 2026,
      today: "2026-07-01",
      coverageStart: "2025-01-01",
    });
    expect(r).toEqual({
      estimate: 1100,
      ytd: 200,
      lastYearRemainder: 900,
      basis: "ytdPlusLastYear",
    });
  });

  it("annualizes the covered stretch when last year isn't covered", () => {
    const r = estimateFeedIncome({
      rows,
      taxYear: 2026,
      today: "2026-07-01",
      coverageStart: "2026-04-03",
    });
    expect(r.basis).toBe("annualized");
    // Covered 2026-04-03 → 07-01 = 90 days: $80 interest × 365 / 90.
    expect(r.estimate).toBeCloseTo((80 * 365) / 90, 2);
  });

  it("a finished, covered year is the actual figure", () => {
    const r = estimateFeedIncome({
      rows,
      taxYear: 2025,
      today: "2026-07-01",
      coverageStart: "2024-12-01",
    });
    expect(r.basis).toBe("actual");
    expect(r.estimate).toBe(1000);
  });

  it("a tax year that hasn't started uses this year's estimate, never $0", () => {
    const next = estimateFeedIncome({
      rows,
      taxYear: 2027,
      today: "2026-07-01",
      coverageStart: "2025-01-01",
    });
    expect(next.estimate).toBe(1100);
    expect(next.basis).toBe("ytdPlusLastYear");
  });

  it("nothing stored → none", () => {
    expect(
      estimateFeedIncome({
        rows: [],
        taxYear: 2026,
        today: "2026-07-01",
        coverageStart: null,
      }).basis,
    ).toBe("none");
  });

  it("leap day maps to Feb 28 last year", () => {
    const r = estimateFeedIncome({
      rows: [tx("2027-02-28", 10), tx("2027-03-01", 7)],
      taxYear: 2028,
      today: "2028-02-29",
      coverageStart: "2027-01-01",
    });
    expect(r.lastYearRemainder).toBe(7);
  });
});

describe("estimateTaxableInvestmentIncome (household)", () => {
  const feeds = [
    {
      id: 1,
      label: "Old Brokerage",
      accountType: "brokerage",
      coverageStart: "2025-01-01",
    },
    // Added this year: no last-year history even though the household has it.
    {
      id: 2,
      label: "New Brokerage",
      accountType: "brokerage",
      coverageStart: "2026-04-03",
    },
    { id: 3, label: "IRA", accountType: "ira", coverageStart: "2025-01-01" },
    {
      id: 4,
      label: "Linked, no history",
      accountType: "brokerage",
      coverageStart: null,
    },
  ];
  const rows = [
    tx("2025-12-20", 900, { feedId: 1 }),
    tx("2026-03-15", 120, { feedId: 1 }),
    tx("2026-06-15", 90, { feedId: 2 }),
    tx("2026-06-15", 999, { feedId: 3 }), // tax-deferred
  ];
  const r = estimateTaxableInvestmentIncome({
    feeds,
    rows,
    taxYear: 2026,
    today: "2026-07-01",
  });

  it("each taxable feed on its own coverage; IRA income excluded", () => {
    expect(r.ytd).toBe(210);
    expect(r.estimate).toBeCloseTo(1020 + (90 * 365) / 90, 2);
  });

  it("the basis is the least certain feed's, and the annualized / no-history feeds are named", () => {
    expect(r.basis).toBe("annualized");
    expect(r.annualizedFeeds).toEqual(["New Brokerage"]);
    expect(r.noHistoryFeeds).toEqual(["Linked, no history"]);
  });
});

describe("investmentIncomeGaps", () => {
  it("counts unlinked feeds and names taxable accounts with no feed", () => {
    const g = investmentIncomeGaps({
      feeds: [{ performanceAccountId: 10 }, { performanceAccountId: null }],
      accounts: [
        { performanceAccountId: 10, accountType: "brokerage", amount: 5 },
        { performanceAccountId: 11, accountType: "brokerage", amount: 5 },
        { performanceAccountId: 11, accountType: "brokerage", amount: 5 },
        { performanceAccountId: 12, accountType: "ira", amount: 5 },
        { performanceAccountId: 13, accountType: "brokerage", amount: 0 },
      ],
      accountName: (id) => `#${id}`,
    });
    expect(g).toEqual({ unlinkedFeedCount: 1, unfedTaxableAccounts: ["#11"] });
  });
});
