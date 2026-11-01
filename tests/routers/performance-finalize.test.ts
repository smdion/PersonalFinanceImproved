/** finalizeYear end to end (async transactions run on SQLite through
 *  withAsyncTransactions). */
import "./setup-mocks";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import {
  adminSession,
  createTestCaller,
  seedPerformanceAccount,
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
