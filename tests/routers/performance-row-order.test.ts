/**
 * performance.computeSummary lists a year's rows in one order on either
 * database: account rows by institution, label, owner (no owner first),
 * then id; stored annual rows by category. SQLite answered `ORDER BY year`
 * from the unique (year, institution, account_label, owner) and (year,
 * category) indexes; PostgreSQL left a year's rows in its scan order, so a
 * backup restored there listed them differently. The indexes are dropped
 * here, so the database's plan decides nothing.
 */
import "./setup-mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedPerformanceAccount, seedPerson } from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;
let t: Ctx;

beforeEach(async () => {
  t = await createTestCaller();
  t.sqlite.exec('DROP INDEX "account_perf_year_inst_label_owner_idx"');
  t.sqlite.exec('DROP INDEX "annual_performance_year_cat_idx"');
});
afterEach(() => t.cleanup());

const zero = {
  beginningBalance: "0",
  totalContributions: "0",
  yearlyGainLoss: "0",
  endingBalance: "0",
  employerContributions: "0",
  distributions: "0",
  fees: "0",
  rollovers: "0",
};

function accountRow(
  year: number,
  institution: string,
  accountLabel: string,
  ownerPersonId: number | null,
): number {
  const performanceAccountId = seedPerformanceAccount(t.db, {
    institution,
    accountLabel,
    ownerPersonId,
    ownershipType: ownerPersonId == null ? "joint" : "individual",
  });
  t.db
    .insert(schema.accountPerformance)
    .values({
      year,
      institution,
      accountLabel,
      ownerPersonId,
      parentCategory: "Retirement",
      performanceAccountId,
      ...zero,
    })
    .run();
  return performanceAccountId;
}

describe("performance.computeSummary row order", () => {
  it("lists a year's account rows by institution, label and owner, whatever order they were stored in", async () => {
    const person = await seedPerson(t.db, "Invented Person");
    const rothB = accountRow(2025, "Vanguard", "Roth IRA", person);
    const rothA = accountRow(2024, "Vanguard", "Roth IRA", person);
    const k401B = accountRow(2025, "AdAgency", "401(k)", person);
    const ownBrokerage = accountRow(2025, "Vanguard", "Brokerage", person);
    const jointBrokerage = accountRow(2025, "Vanguard", "Brokerage", null);
    const k401A = accountRow(2024, "AdAgency", "401(k)", person);

    const { accountRows } = await t.caller.performance.computeSummary();
    expect(accountRows.map((r) => [r.year, r.performanceAccountId])).toEqual([
      [2024, k401A],
      [2024, rothA],
      [2025, k401B],
      [2025, jointBrokerage],
      [2025, ownBrokerage],
      [2025, rothB],
    ]);
  });

  it("lists a year's stored annual rows by category, whatever order they were stored in", async () => {
    for (const category of ["Portfolio", "401k/IRA"])
      t.db
        .insert(schema.annualPerformance)
        .values({
          year: 2025,
          category,
          ...zero,
          lifetimeGains: "0",
          lifetimeContributions: "0",
          lifetimeMatch: "0",
        })
        .run();

    const { annualRows } = await t.caller.performance.computeSummary();
    expect(
      annualRows
        .map((r) => r.category)
        .filter((c) => c === "Portfolio" || c === "401k/IRA"),
    ).toEqual(["401k/IRA", "Portfolio"]);
  });
});
