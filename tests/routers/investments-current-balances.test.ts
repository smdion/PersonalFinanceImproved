/**
 * Current Balances on the router: newest figure per account, a feed behind
 * the snapshot left out of the comparison, its data date proven from
 * closes, and parts kept apart. Invented accounts and rows only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller, seedPerson } from "./setup";
import * as sqlite from "@/lib/db/schema-sqlite";
import { loadCurrentBalances } from "@/server/routers/investments/load-current-balances";

vi.mock("@/server/helpers/market-prices", () => ({
  getLatestMarketClose: async () => null,
  getBenchmarkMonthlyPrices: async () => null,
  getDailyMarketCloses: async (_db: unknown, ticker: string) =>
    ticker === "VTI"
      ? new Map(
          [
            ["2026-10-26", 99],
            ["2026-10-27", 100],
            ["2026-10-28", 101],
            ["2026-10-29", 102],
            ["2026-10-30", 103],
          ].map(([d, c]) => [d, { close: c, adjClose: c }]),
        )
      : null,
}));

const at = (s: string) => new Date(s);

describe("investments.getCurrentBalances", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const owner = await seedPerson(db, "Example Person", "1980-01-01");
    const perf = (accountLabel: string) =>
      db
        .insert(sqlite.performanceAccounts)
        .values({
          institution: "Example Brokerage",
          accountType: "ira",
          accountLabel,
          ownershipType: "individual",
          ownerPersonId: owner,
          parentCategory: "Retirement",
        })
        .returning()
        .get().id;
    const behind = perf("Behind IRA");
    const caughtUp = perf("Caught Up IRA");
    const snapshot = db
      .insert(sqlite.portfolioSnapshots)
      .values({
        snapshotDate: "2026-10-29",
        createdAt: at("2026-10-29T22:00:00Z"), // 6pm Eastern: that day's close
      })
      .returning()
      .get().id;
    for (const [performanceAccountId, amount] of [
      [behind, "1000"],
      [caughtUp, "2000"],
    ] as const)
      db.insert(sqlite.portfolioAccounts)
        .values({
          snapshotId: snapshot,
          performanceAccountId,
          institution: "Example Brokerage",
          accountType: "ira",
          taxType: "preTax",
          amount,
          ownerPersonId: owner,
          parentCategory: "Retirement",
        })
        .run();
    const feed = (id: string, linked: number, balance: string, when: string) =>
      db
        .insert(sqlite.simplefinAccounts)
        .values({
          externalAccountId: id,
          orgName: "Example Brokerage",
          accountName: id,
          lastBalance: balance,
          lastBalanceDate: at(when),
          linkedPerformanceAccountId: linked,
        })
        .returning()
        .get().id;
    // Reported Thursday night, but its fund's price is Tuesday's close: the
    // position proves the data is older than the snapshot.
    const old = feed("sf-old", behind, "909", "2026-10-30T01:00:00Z");
    feed("sf-new", caughtUp, "2100", "2026-10-31T05:00:00Z");
    const sec = db
      .insert(sqlite.securities)
      .values({ ticker: "VTI", name: "Example Fund", kind: "etf" })
      .returning()
      .get().id;
    db.insert(sqlite.holdingObservations)
      .values({
        simplefinAccountId: old,
        securityId: sec,
        asOf: "2026-10-29",
        balanceDate: at("2026-10-30T01:00:00Z"),
        shares: "9",
        reportedMarketValue: "900",
        source: "simplefin",
      })
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("a feed proven older than the snapshot gives way to it, and leaves the comparison", async () => {
    const r = await loadCurrentBalances(ctx.db as never);
    const old = r.feeds.find((f) => f.behindSnapshot)!;
    expect(old).toMatchObject({ dataDay: "2026-10-27", basis: "proven" });
    expect(r.snapshotDay).toBe("2026-10-29");
    const byFeed = (reported: number) =>
      r.balances.find((b) => b.reported === reported)!;
    expect(byFeed(909)).toMatchObject({
      source: "snapshot",
      comparable: false,
    });
    // Rolled from the snapshot's close to the latest: 9 × (103 − 102).
    expect(byFeed(909).current).toBe(1009);
    expect(byFeed(2100)).toMatchObject({
      source: "reported",
      comparable: true,
    });
    expect(r.summary).toMatchObject({
      behindCount: 1,
      comparedCount: 1,
    });
  });

  it("the route sends figures and dates, never holdings or transactions", async () => {
    const r = await ctx.caller.investments.getCurrentBalances();
    expect(Object.keys(r).sort()).toEqual([
      "balances",
      "feeds",
      "movement",
      "snapshotDate",
      "summary",
    ]);
    expect(Object.keys(r.balances[0]!).sort()).toEqual([
      "comparable",
      "current",
      "feedIds",
      "key",
      "noSnapshot",
      "performanceAccountId",
      "snapshot",
    ]);
    expect(r.feeds).toHaveLength(2);
  });
});
