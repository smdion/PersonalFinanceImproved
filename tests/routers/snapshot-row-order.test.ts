/** A snapshot's rows are read by id wherever they are summed or listed, so a
 *  sum adds in one order on either database: 0.1 + 0.2 + 0.3 is
 *  0.6000000000000001 in saved order and 0.6 in another. SQLite is told to
 *  answer a read without ORDER BY backwards; on PostgreSQL the updated first
 *  row moves to the end of its scan. Invented rows only. */
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
import { ROUTERS_ON_POSTGRES } from "./postgres-router-db";

const AMOUNTS = ["0.1", "0.2", "0.3"];
const SAVED_ORDER_SUM = 0.1 + 0.2 + 0.3;

async function seeded() {
  const t = await createTestCaller(adminSession);
  const k401 = seedPerformanceAccount(t.db, { accountLabel: "Invented 401k" });
  const snapshotId = seedSnapshot(
    t.db,
    "2024-12-31",
    AMOUNTS.map((amount) => ({ performanceAccountId: k401, amount })),
  );
  const ids = t.db
    .select({ id: schema.portfolioAccounts.id })
    .from(schema.portfolioAccounts)
    .where(eq(schema.portfolioAccounts.snapshotId, snapshotId))
    .orderBy(schema.portfolioAccounts.id)
    .all()
    .map((r) => r.id);
  t.db
    .update(schema.portfolioAccounts)
    .set({ amount: AMOUNTS[0]! })
    .where(eq(schema.portfolioAccounts.id, ids[0]!))
    .run();
  if (!ROUTERS_ON_POSTGRES)
    t.sqlite.exec("PRAGMA reverse_unordered_selects = ON");
  return { ...t, k401, ids };
}

describe("a snapshot's rows in saved order", () => {
  it("the comparison sums them in saved order", async () => {
    const { caller, cleanup } = await seeded();
    try {
      const { portfolioBreakdown } = await caller.netWorth.computeComparison({
        dateFrom: "2024-12-31",
        dateTo: "2024-12-31",
      });
      expect(portfolioBreakdown.find((b) => b.label === "preTax")?.to).toBe(
        SAVED_ORDER_SUM,
      );
    } finally {
      cleanup();
    }
  });

  it("finalizing a year sums them in saved order", async () => {
    const { caller, db, cleanup, k401 } = await seeded();
    try {
      db.insert(schema.accountPerformance)
        .values({
          year: 2024,
          performanceAccountId: k401,
          institution: "Fidelity",
          accountLabel: "Invented 401k",
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0.6",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
          parentCategory: "Retirement",
        })
        .run();
      await caller.performance.finalizeYear({ year: 2024 });
      const [stored] = db.select().from(schema.netWorthAnnual).all();
      expect(stored?.portfolioByTaxLocation).toEqual({
        retirement: { preTax: SAVED_ORDER_SUM },
        portfolio: {},
      });
    } finally {
      cleanup();
    }
  });

  it("the latest snapshot lists them in saved order", async () => {
    const { caller, cleanup, ids } = await seeded();
    try {
      const latest = await caller.netWorth.portfolioSnapshots.getLatest();
      expect(latest?.accounts.map((a) => a.id)).toEqual(ids);
    } finally {
      cleanup();
    }
  });
});
