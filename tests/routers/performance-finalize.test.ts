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
