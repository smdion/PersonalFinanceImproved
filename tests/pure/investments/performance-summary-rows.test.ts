/**
 * The Performance summary's stages (lib/pure/investments/performance-
 * annual-rows.ts and performance-account-rows.ts), on an invented household:
 * a 401k, a taxable brokerage account and a Retirement-goal brokerage
 * account, one year of account rows and no stored annual rows except a stray
 * Retirement row from the year before.
 */
import { describe, expect, it } from "vitest";
import {
  addRetirementRollup,
  performanceAnnualRows,
  performanceCategories,
  performanceLifetimeFlows,
} from "@/lib/pure/investments/performance-annual-rows";
import {
  performanceAccountRows,
  performanceBalanceMismatch,
  resolveOwnerName,
} from "@/lib/pure/investments/performance-account-rows";

const masters = [
  { id: 1, accountType: "401k", parentCategory: "Retirement" },
  { id: 2, accountType: "brokerage", parentCategory: "Portfolio" },
  { id: 3, accountType: "brokerage", parentCategory: "Retirement" },
].map((m) => ({
  ...m,
  institution: "Acme",
  accountLabel: `Acct ${m.id}`,
  ownershipType: "individual" as const,
  subType: null,
  displayOrder: m.id,
}));
const perfLookups = new Map(masters.map((m) => [m.id, m]));

function accountRow(
  id: number,
  begin: number,
  gain: number,
  extra: Partial<
    Record<"contribs" | "employer" | "fees" | "dist", number>
  > = {},
) {
  const end =
    begin +
    gain +
    (extra.contribs ?? 0) -
    (extra.fees ?? 0) -
    (extra.dist ?? 0);
  return {
    id,
    year: 2025,
    institution: "Acme",
    accountLabel: `Acct ${id}`,
    performanceAccountId: id,
    // Stored legacy value; the stage replaces it with the master's.
    parentCategory: "Brokerage",
    ownerPersonId: 1 as number | null,
    isActive: true,
    note: null,
    estimatedFields: null,
    acceptedChecks: null,
    beginningBalance: String(begin),
    totalContributions: String(extra.contribs ?? 0),
    yearlyGainLoss: String(gain),
    endingBalance: String(end),
    employerContributions: String(extra.employer ?? 0),
    distributions: String(extra.dist ?? 0),
    fees: String(extra.fees ?? 0),
    rollovers: "0",
  };
}

function household() {
  const accounts = [
    accountRow(1, 1000, 50, { contribs: 100, employer: 10, fees: 5 }),
    accountRow(2, 500, 20, { dist: 15 }),
    accountRow(3, 200, 10),
  ];
  const strayRetirement = {
    id: 9,
    year: 2024,
    category: "Retirement",
    beginningBalance: "0",
    totalContributions: "0",
    yearlyGainLoss: "0",
    endingBalance: "999",
    annualReturnPct: null,
    employerContributions: "0",
    distributions: "0",
    fees: "0",
    rollovers: "0",
    lifetimeGains: "0",
    lifetimeContributions: "0",
    lifetimeMatch: "0",
    isCurrentYear: false,
    isFinalized: true,
  };
  return { accounts, annual: [strayRetirement] };
}

function summarize() {
  const { accounts, annual } = household();
  const { currentYear, annualRows } = performanceAnnualRows(
    annual,
    accounts,
    perfLookups,
  );
  addRetirementRollup(annualRows, accounts, perfLookups, currentYear);
  return { accounts, currentYear, annualRows };
}

const row = (
  rows: ReturnType<typeof summarize>["annualRows"],
  year: number,
  category: string,
) => rows.find((r) => r.year === year && r.category === category);

describe("performance summary annual rows", () => {
  it("builds each category's row from the account rows, and Portfolio from the categories", () => {
    const { currentYear, annualRows, accounts } = summarize();
    expect(currentYear).toBeNull();
    expect(row(annualRows, 2025, "401k/IRA")?.endingBalance).toBe(1145);
    expect(row(annualRows, 2025, "Brokerage")?.endingBalance).toBe(715);
    const portfolio = row(annualRows, 2025, "Portfolio");
    expect(portfolio?.endingBalance).toBe(1860);
    expect(portfolio?.lifetimeGains).toBe(80);
    expect(portfolio?.lifetimeContributions).toBe(100);
    expect(portfolio?.lifetimeMatch).toBe(10);
    // The account rows' parentCategory comes from the master record.
    expect(accounts.map((a) => a.parentCategory)).toEqual([
      "Retirement",
      "Portfolio",
      "Retirement",
    ]);
  });

  it("rolls Retirement up from the 401k and the Retirement-goal brokerage account, dropping a stray stored Retirement row", () => {
    const { annualRows } = summarize();
    const retirement = row(annualRows, 2025, "Retirement");
    expect(retirement?.endingBalance).toBe(1355);
    expect(retirement?.yearlyGainLoss).toBe(60);
    expect(retirement?.lifetimeGains).toBe(60);
    expect(retirement?.lifetimeContributions).toBe(100);
    expect(retirement?.lifetimeMatch).toBe(10);
    expect(annualRows.some((r) => r.year === 2024)).toBe(false);
    expect(annualRows.map((r) => r.year)).toEqual(
      [...annualRows.map((r) => r.year)].sort((a, b) => a - b),
    );
  });

  it("lists the account-type categories, then the rollups", () => {
    const { annualRows } = summarize();
    expect(performanceCategories(annualRows)).toEqual({
      accountTypeCategories: ["401k/IRA", "Brokerage"],
      parentCategories: ["Retirement", "Portfolio"],
      categories: ["401k/IRA", "Brokerage", "Retirement", "Portfolio"],
    });
  });

  it("sums lifetime fees and distributions over the Portfolio rows", () => {
    const { annualRows } = summarize();
    expect(performanceLifetimeFlows(annualRows)).toEqual({
      lifetimeFees: 5,
      lifetimeDistributions: 15,
    });
  });
});

describe("performance summary account rows", () => {
  const basis = (ownerPersonId: number, contributionBasis: string) => ({
    performanceAccountId: 1,
    ownerPersonId,
    year: 2025,
    contributionBasis,
    conversionBasis: "0",
    latestConversionYear: null,
  });

  it("carries every owner's Roth basis on a row two people hold, and totals it", () => {
    const { accounts } = household();
    const basisRows = [basis(2, "300"), basis(1, "200")];
    const basisByKey = new Map(
      basisRows.map((b) => [
        `${b.performanceAccountId}|${b.ownerPersonId}|${b.year}`,
        b,
      ]),
    );
    const { accountRows } = performanceAccountRows(
      accounts,
      perfLookups,
      basisRows,
      basisByKey,
      new Map([
        [1, "Alex"],
        [2, "Sam"],
      ]),
      new Map(),
      new Map([["1|2025", 1]]),
    );
    const first = accountRows[0]!;
    expect(first.ownerName).toBe("Alex");
    expect(first.contributionBasis).toBe(500);
    expect(first.basisByOwner.map((b) => [b.ownerName, b.recorded])).toEqual([
      ["Alex", true],
      ["Sam", true],
    ]);
    // No basis row for the other accounts' owner: an unrecorded zero entry.
    expect(accountRows[1]!.contributionBasis).toBeNull();
    expect(accountRows[1]!.basisByOwner).toEqual([
      expect.objectContaining({ ownerPersonId: 1, recorded: false }),
    ]);
  });

  it("refuses an owner who isn't a person", () => {
    expect(() => resolveOwnerName(7, new Map())).toThrow(/orphan FK/);
    expect(resolveOwnerName(null, new Map())).toBeNull();
  });
});

describe("performance summary balance mismatch", () => {
  const snapshot = { snapshot: { snapshotDate: "2025-06-01" }, total: 1100 };
  const rows = [{ year: 2025, isActive: true, endingBalance: 1000 }];

  it("reports the gap when the snapshot and the edit share a day", () => {
    expect(
      performanceBalanceMismatch(snapshot, "2025-06-01", rows, 2025),
    ).toEqual({
      balanceMismatch: { perfTotal: 1000, snapTotal: 1100, delta: -100 },
    });
  });

  it("stays quiet on a different day, inside the threshold, or with no snapshot", () => {
    expect(
      performanceBalanceMismatch(snapshot, "2025-06-02", rows, 2025)
        .balanceMismatch,
    ).toBeNull();
    expect(
      performanceBalanceMismatch(
        { ...snapshot, total: 1003 },
        "2025-06-01",
        rows,
        2025,
      ).balanceMismatch,
    ).toBeNull();
    expect(
      performanceBalanceMismatch(null, "2025-06-01", rows, 2025)
        .balanceMismatch,
    ).toBeNull();
  });
});
