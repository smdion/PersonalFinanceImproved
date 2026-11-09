/**
 * Always Be Buying months as the investments router reads them: counted
 * feeds only, deposits by month, months nobody reported left unknown.
 * Invented accounts and rows only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, createViewerSessionWithPermissions } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { calendarDateOf } from "@/lib/utils/calendar-date";

/** The 15th of the month `back` months before this one, as YYYY-MM-DD. */
function monthDay(back: number, day = 15): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - back);
  d.setDate(day);
  return calendarDateOf(d);
}

describe("investments.computeBuyingMonths", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const perfId = db
      .insert(sqliteSchema.performanceAccounts)
      .values({
        institution: "Example Bank",
        accountType: "ira",
        accountLabel: "Example IRA",
        ownershipType: "individual",
        parentCategory: "Retirement",
      })
      .returning()
      .get().id;
    const feed = (externalAccountId: string, linked: number | null) =>
      db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId,
          orgName: "Example Bank",
          accountName: externalAccountId,
          lastBalance: "10000",
          linkedPerformanceAccountId: linked,
        })
        .returning()
        .get().id;
    const counted = feed("sf-ira", perfId);
    const unlinked = feed("sf-other", null);
    const deposit = (account: number, posted: string, key: string) =>
      db
        .insert(sqliteSchema.investmentTransactions)
        .values({
          simplefinAccountId: account,
          externalId: key,
          posted,
          amount: "500.00",
          description: "ZZZ DEPOSIT",
          pending: false,
          kindOverride: "contribution",
        })
        .run();
    const report = (posted: string) =>
      db
        .insert(sqliteSchema.simplefinAccountBalances)
        .values({
          simplefinAccountId: counted,
          balanceDate: new Date(`${posted}T12:00:00Z`),
          balance: "10000",
        })
        .run();
    // First transaction three months back (that month is partial), a
    // deposit two months back, none last month — though the feed reported.
    deposit(counted, monthDay(3), "first");
    deposit(counted, monthDay(2, 5), "bought");
    // A deposit into a feed that counts toward nothing changes nothing.
    deposit(unlinked, monthDay(1, 5), "elsewhere");
    report(monthDay(3, 20));
    report(monthDay(2, 20));
    report(monthDay(1, 20));
    report(monthDay(0, 1));
  });
  afterAll(() => ctx.cleanup());

  it("bought, then a covered month without a deposit", async () => {
    expect(await ctx.caller.investments.computeBuyingMonths()).toEqual([
      { month: monthDay(2).slice(0, 7), state: "invested" },
      { month: monthDay(1).slice(0, 7), state: "notInvested" },
    ]);
  });

  it("needs the portfolio permission", async () => {
    const viewer = await createTestCaller(
      createViewerSessionWithPermissions([]),
    );
    await expect(
      viewer.caller.investments.computeBuyingMonths(),
    ).rejects.toThrow();
    viewer.cleanup();
  });
});
