/** finalizeYear end to end (async transactions run on SQLite through
 *  withAsyncTransactions). */
import "./setup-mocks";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";
import {
  adminSession,
  createTestCaller,
  seedAppSetting,
  seedJob,
  seedPerformanceAccount,
  seedPerson,
  seedSalaryProfile,
  TEST_NOW,
} from "./setup";

describe("performance.finalizeYear", () => {
  it("writes a category's year that had no annual row, and can't run twice", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const perfId = seedPerformanceAccount(db);
      db.insert(schema.accountPerformance)
        .values({
          year: 2024,
          performanceAccountId: perfId,
          institution: "Fidelity",
          accountLabel: "401k",
          beginningBalance: "1000",
          totalContributions: "500",
          yearlyGainLoss: "100",
          endingBalance: "1600",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
          parentCategory: "Retirement",
        })
        .run();
      await caller.performance.finalizeYear({ year: 2024 });
      const rows = db
        .select()
        .from(schema.annualPerformance)
        .where(eq(schema.annualPerformance.year, 2024))
        .all();
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.isFinalized)).toBe(true);
      const portfolio = rows.find((r) => r.category === "Portfolio");
      expect(Number(portfolio?.endingBalance)).toBe(1600);
      await expect(
        caller.performance.finalizeYear({ year: 2024 }),
      ).rejects.toThrow(/already finalized/);
    } finally {
      cleanup();
    }
  });

  it("refuses the current year while the active Salary Profile has an entry it can't read, naming it", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const personId = await seedPerson(db, "Odd Entry");
      const jobId = seedJob(db, personId, { employerName: "Odd Entry Co" });
      const profileId = seedSalaryProfile(db, {
        name: "Odd entry",
        // eslint-disable-next-line no-restricted-syntax -- a stored entry of another shape, as the column can hold it
        salaries: { [String(jobId)]: 7 as unknown as SalaryEntry },
      });
      db.delete(schema.appSettings)
        .where(eq(schema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
        .run();
      seedAppSetting(db, SK_ACTIVE_SALARY_PROFILE_ID, profileId);
      db.insert(schema.accountPerformance)
        .values({
          year: TEST_NOW.getFullYear(),
          performanceAccountId: seedPerformanceAccount(db),
          institution: "Fidelity",
          accountLabel: "401k",
          beginningBalance: "1000",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "1000",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
          parentCategory: "Retirement",
        })
        .run();
      await expect(
        caller.performance.finalizeYear({ year: TEST_NOW.getFullYear() }),
      ).rejects.toThrow(
        /The saved salary for Odd Entry Co in Salary Profile "Odd entry" can't be read/,
      );
    } finally {
      vi.restoreAllMocks();
      cleanup();
    }
  });
});

describe("performance.computeSummary lifetime totals", () => {
  it("a category with no stored row in a finalized year still carries its gains forward", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const hsa = seedPerformanceAccount(db, {
        institution: "Example HSA",
        accountType: "hsa",
        accountLabel: "HSA",
      });
      // 2024 was finalized before this HSA had an annual row of its own.
      db.insert(schema.annualPerformance)
        .values({
          year: 2024,
          category: "Portfolio",
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0",
          lifetimeGains: "0",
          lifetimeContributions: "0",
          lifetimeMatch: "0",
          isFinalized: true,
        })
        .run();
      const year = (y: number, gain: string, end: string) =>
        db
          .insert(schema.accountPerformance)
          .values({
            year: y,
            performanceAccountId: hsa,
            institution: "Example HSA",
            accountLabel: "HSA",
            beginningBalance: "1000",
            totalContributions: "0",
            yearlyGainLoss: gain,
            endingBalance: end,
            employerContributions: "0",
            fees: "0",
            distributions: "0",
            isActive: true,
            parentCategory: "Retirement",
          })
          .run();
      year(2024, "100", "1100");
      year(2025, "50", "1150");
      const summary = await caller.performance.computeSummary();
      const hsa2025 = summary.annualRows.find(
        (r) => r.year === 2025 && r.category === "HSA",
      );
      expect(hsa2025?.lifetimeGains).toBe(150);
    } finally {
      cleanup();
    }
  });
});

describe("performance.computeSummary Retirement rollup", () => {
  it("starts from its categories' stored lifetime totals, not from zero", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      // Imported history: 2023 is the first year on file, and its stored
      // lifetime totals include the years before it.
      for (const category of ["401k/IRA", "Portfolio"])
        db.insert(schema.annualPerformance)
          .values({
            year: 2023,
            category,
            beginningBalance: "40000",
            totalContributions: "1000",
            yearlyGainLoss: "100",
            endingBalance: "41100",
            lifetimeGains: "5000",
            lifetimeContributions: "30000",
            lifetimeMatch: "2000",
            isFinalized: true,
          })
          .run();
      const summary = await caller.performance.computeSummary();
      const ret = summary.annualRows.find(
        (r) => r.year === 2023 && r.category === "Retirement",
      );
      expect(ret?.lifetimeGains).toBe(5000);
      expect(ret?.lifetimeContributions).toBe(30000);
      expect(ret?.lifetimeMatch).toBe(2000);
    } finally {
      cleanup();
    }
  });
});
