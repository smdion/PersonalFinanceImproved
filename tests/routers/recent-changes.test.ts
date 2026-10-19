/**
 * investments.getRecentChanges — counted feeds only, household and per
 * tracked account. Invented household only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedPerformanceAccount } from "./setup";

describe("investments.getRecentChanges", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const perf = seedPerformanceAccount(db, {
      institution: "Example Bank",
      accountType: "brokerage",
    });
    const feed = (id: string, linked: number | null, included = true) =>
      db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId: id,
          orgName: "Example Bank",
          accountName: id,
          lastBalance: "0",
          linkedPerformanceAccountId: linked,
          isIncluded: included,
        })
        .returning()
        .get().id;
    const counted = feed("counted", perf);
    const unlinked = feed("unlinked", null);
    const unchecked = feed("unchecked", perf, false);
    const bal = (account: number, day: string, balance: string) =>
      db
        .insert(sqliteSchema.simplefinAccountBalances)
        .values({
          simplefinAccountId: account,
          balanceDate: new Date(`${day}T20:00:00Z`),
          balance,
        })
        .run();
    bal(counted, "2026-10-10", "1000");
    bal(counted, "2026-10-16", "1100");
    bal(counted, "2026-10-17", "1150");
    for (const other of [unlinked, unchecked]) {
      bal(other, "2026-10-10", "1");
      bal(other, "2026-10-17", "999");
    }
  });
  afterAll(() => ctx.cleanup());

  it("household and per-account change from counted feeds only", async () => {
    const r = await ctx.caller.investments.getRecentChanges();
    expect(r.household.slice(0, 2)).toEqual([
      { days: 1, change: 50, since: "2026-10-16" },
      { days: 7, change: 150, since: "2026-10-10" },
    ]);
    expect(r.household[2]!.change).toBeNull(); // 30 days not covered yet
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0]!.changes[1]!.change).toBe(150);
  });
});
