/** Adding an account row to a snapshot: only the latest snapshot, the
 *  master's parent category, and the year's Performance follows. */
import "./setup-mocks";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import {
  adminSession,
  createTestCaller,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";

const row = {
  institution: "Fidelity",
  taxType: "preTax" as const,
  amount: "5000",
  accountType: "401k" as const,
};

describe("portfolioSnapshots.createAccount", () => {
  it("refuses an older snapshot", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const older = seedSnapshot(db, "2025-03-01", []);
      seedSnapshot(db, "2025-06-01", []);
      await expect(
        caller.networth.portfolioSnapshots.createAccount({
          ...row,
          snapshotId: older,
        }),
      ).rejects.toThrow(/most recent snapshot/);
    } finally {
      cleanup();
    }
  });

  it("a linked row takes the master's category and Performance follows", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const perfId = seedPerformanceAccount(db, {
        parentCategory: "Portfolio",
      });
      db.insert(schema.accountPerformance)
        .values({
          year: 2025,
          performanceAccountId: perfId,
          institution: "Fidelity",
          accountLabel: "401k",
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
          parentCategory: "Portfolio",
        })
        .run();
      const snap = seedSnapshot(db, "2025-06-01", []);
      const created = await caller.networth.portfolioSnapshots.createAccount({
        ...row,
        snapshotId: snap,
        parentCategory: "Retirement",
        performanceAccountId: perfId,
      });
      expect(created.parentCategory).toBe("Portfolio");
      const [perf] = db
        .select()
        .from(schema.accountPerformance)
        .where(eq(schema.accountPerformance.performanceAccountId, perfId))
        .all();
      expect(Number(perf!.endingBalance)).toBe(5000);
    } finally {
      cleanup();
    }
  });
});
