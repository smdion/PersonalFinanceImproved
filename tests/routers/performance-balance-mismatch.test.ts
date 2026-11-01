/** Performance's "doesn't match the latest snapshot" check compares on the
 *  household's calendar day: an evening edit's UTC stamp is already
 *  tomorrow. */
import "./setup-mocks";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import {
  adminSession,
  createTestCaller,
  seedAppSetting,
  seedPerformanceAccount,
  seedSnapshot,
} from "./setup";

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe("performance.computeSummary balanceMismatch", () => {
  it("an evening update the same day as the snapshot is compared", async () => {
    process.env.TZ = "America/Chicago";
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const year = new Date().getFullYear();
      const perfId = seedPerformanceAccount(db);
      seedSnapshot(db, `${year}-03-10`, [
        { performanceAccountId: perfId, amount: "100000" },
      ]);
      db.insert(schema.accountPerformance)
        .values({
          year,
          performanceAccountId: perfId,
          institution: "Fidelity",
          accountLabel: "401k",
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "50000",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
          parentCategory: "Retirement",
        })
        .run();
      // 9pm in Chicago on the 10th = 02:00 UTC on the 11th.
      seedAppSetting(
        db,
        "performance_last_updated",
        `${year}-03-11T02:00:00.000Z`,
      );
      const summary = await caller.performance.computeSummary();
      expect(summary.balanceMismatch).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
