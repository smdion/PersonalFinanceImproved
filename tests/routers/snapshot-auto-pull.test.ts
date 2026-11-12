/**
 * A snapshot that pulls fresh balances from the budget app: the pulled
 * amounts and the year's Performance figures change together.
 */
import "./setup-mocks";
import { describe, expect, it, vi } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { eq } from "drizzle-orm";
import {
  adminSession,
  createTestCaller,
  seedPerformanceAccount,
} from "./setup";

vi.mock("@/lib/budget-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getActiveBudgetApi: vi.fn(async () => "actual"),
  getApiConnection: vi.fn(async () => ({
    accountMappings: [
      {
        localName: "401k",
        remoteAccountId: "remote-401k",
        syncDirection: "pull",
        performanceAccountId: 1,
      },
    ],
  })),
}));
vi.mock(
  "@/server/services/sync/api-balance-resolution",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getApiAccountBalanceMap: vi.fn(
      async () => new Map([["remote-401k", 15000]]),
    ),
  }),
);

describe("snapshot auto-pull", () => {
  it("Performance's ending balance is the pulled figure, not the typed one", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const id = seedPerformanceAccount(ctx.db, { accountType: "401k" });
      expect(id).toBe(1);
      ctx.db
        .insert(sqliteSchema.accountPerformance)
        .values({
          year: 2025,
          performanceAccountId: id,
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
          parentCategory: "Retirement",
        })
        .run();
      const result = await ctx.caller.netWorth.portfolioSnapshots.create({
        snapshotDate: "2025-12-31",
        accounts: [
          {
            institution: "Fidelity",
            taxType: "preTax",
            accountType: "401k",
            amount: "10000",
            ownerPersonId: null,
            performanceAccountId: id,
          },
        ],
      });
      expect(result.apiPullResult.pulled).toBe(1);
      const [row] = ctx.db
        .select()
        .from(sqliteSchema.accountPerformance)
        .where(eq(sqliteSchema.accountPerformance.performanceAccountId, id))
        .all();
      expect(Number(row!.endingBalance)).toBe(15000);
    } finally {
      ctx.cleanup();
    }
  });
});
