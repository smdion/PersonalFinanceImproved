/**
 * Benchmarks holdings overview and fund-facts actions. Tiingo and SEC are
 * mocked; funds, accounts and values are invented.
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

vi.mock("@/server/helpers/market-prices", () => ({
  getLatestMarketClose: vi.fn(async (_db: unknown, ticker: string) =>
    ticker === "EXSTX" ? { date: "2026-10-09", close: 50 } : null,
  ),
  getBenchmarkMonthlyPrices: vi.fn(async () => null),
}));
const syncCalls = vi.hoisted(() => ({ ids: [] as number[][] }));
vi.mock("@/lib/sec/facts-sync", () => ({
  syncSecurityFacts: vi.fn(
    async (_db: unknown, opts: { securityIds?: number[] }) => {
      syncCalls.ids.push(opts.securityIds ?? []);
      return {
        checked: 1,
        updated: 2,
        unresolved: 0,
        stoppedBySec: false,
        errors: [],
      };
    },
  ),
}));

import { createTestCaller, createViewerSessionWithPermissions } from "./setup";

describe("fund facts", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  const id: Record<string, number> = {};

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const cls = (
      name: string,
      compositionBucket: string | null,
      sortOrder: number,
    ) =>
      db
        .insert(sqliteSchema.assetClassParams)
        .values({
          name,
          meanReturn: "0.07",
          stdDev: "0.15",
          sortOrder,
          compositionBucket: compositionBucket as never,
        })
        .returning()
        .get().id;
    id.stocks = cls("Example Stocks", "us_equity", 1);
    id.bonds = cls("Example Bonds", "us_bond", 2);
    id.spare = cls("Example Spare", null, 3);
    const person = db
      .insert(sqliteSchema.people)
      .values({
        name: "Example Person",
        dateOfBirth: "1986-01-01",
        isPrimaryUser: true,
      })
      .returning()
      .get().id;
    void person;
    db.insert(sqliteSchema.glidePathAllocations)
      .values([
        { age: 30, assetClassId: id.stocks, allocation: "0.9" },
        { age: 30, assetClassId: id.bonds, allocation: "0.1" },
        { age: 50, assetClassId: id.stocks, allocation: "0.7" },
        { age: 50, assetClassId: id.bonds, allocation: "0.3" },
      ])
      .run();
    const account = db
      .insert(sqliteSchema.simplefinAccounts)
      .values({
        externalAccountId: "sf-1",
        orgName: "Example Bank",
        accountName: "Example IRA",
        lastBalance: "0",
      })
      .returning()
      .get().id;
    const sec = (
      key: string,
      values: Partial<typeof sqliteSchema.securities.$inferInsert>,
    ) => {
      id[key] = db
        .insert(sqliteSchema.securities)
        .values({
          name: key,
          kind: "mutual_fund",
          institution: "Example Bank",
          sourceDescription: key,
          ...values,
        })
        .returning()
        .get().id;
      db.insert(sqliteSchema.holdingObservations)
        .values({
          simplefinAccountId: account,
          securityId: id[key]!,
          asOf: "2026-10-09",
          shares: "100",
          reportedMarketValue: "1000.00",
          source: "simplefin",
        })
        .run();
    };
    sec("stock", { ticker: "EXSTX", factsBasis: "exact" });
    sec("plan", {
      factsBasis: "standin",
      factsSeriesId: "S9",
      factsSeriesName: "Example Registered Twin Fund",
    });
    db.insert(sqliteSchema.securityFacts)
      .values([
        {
          securityId: id.stock!,
          source: "sec_nport",
          asOf: "2026-06-30",
          usEquityPct: "0.800000",
          usBondPct: "0.100000",
          intlBondPct: "0.100000",
          coverage: "1.000000",
        },
        {
          securityId: id.stock!,
          source: "sec_ncsr",
          asOf: "2026-03-01",
          expenseRatio: "0.001000",
        },
      ])
      .run();
  });
  afterAll(() => ctx.cleanup());

  it("values holdings at today's close when priced, else as reported", async () => {
    const o = await ctx.caller.investments.getHoldingsOverview();
    const rows = o.accounts[0]!.holdings;
    expect(rows.find((r) => r.securityId === id.stock)).toMatchObject({
      value: 5000,
      valueBasis: "priced",
      valuedOn: "2026-10-09",
    });
    expect(rows.find((r) => r.securityId === id.plan)).toMatchObject({
      value: 1000,
      valueBasis: "reported",
      standInPending: true,
      factsSeriesName: "Example Registered Twin Fund",
    });
  });

  it("adds up the mix, compares with the engine's interpolated target, and costs it", async () => {
    const o = await ctx.caller.investments.getHoldingsOverview();
    const stocks = o.allocation.rows.find((r) => r.assetClassId === id.stocks)!;
    expect(stocks.value).toBeCloseTo(4000);
    expect(stocks.targetPct).not.toBeNull();
    expect(o.allocation.unmapped).toEqual([
      { bucket: "intl_bond", value: 500 },
    ]);
    expect(o.allocation.unknown).toBeCloseTo(1000);
    expect(o.cost).toMatchObject({ yearlyCost: 5 });
    expect(o.cost.coveredShare).toBeCloseTo(5000 / 6000);
  });

  it("confirms a stand-in and fetches its facts right away", async () => {
    await ctx.caller.investments.confirmStandIn({ securityId: id.plan! });
    expect(syncCalls.ids.at(-1)).toEqual([id.plan]);
    const s = ctx.db
      .select()
      .from(sqliteSchema.securities)
      .where(eq(sqliteSchema.securities.id, id.plan!))
      .get()!;
    expect(s.standinConfirmedAt).not.toBeNull();
  });

  it("records 'not a match' so the stand-in isn't suggested again", async () => {
    ctx.db
      .update(sqliteSchema.securities)
      .set({ standinConfirmedAt: null })
      .where(eq(sqliteSchema.securities.id, id.plan!))
      .run();
    await ctx.caller.investments.rejectStandIn({ securityId: id.plan! });
    const s = ctx.db
      .select()
      .from(sqliteSchema.securities)
      .where(eq(sqliteSchema.securities.id, id.plan!))
      .get()!;
    expect(s).toMatchObject({ factsBasis: "none", factsSeriesId: null });
  });

  it("takes the household's own facts, and rejects a mix that doesn't add up", async () => {
    await expect(
      ctx.caller.investments.setUserFacts({
        securityId: id.plan!,
        composition: { us_equity: 0.5 },
      }),
    ).rejects.toThrow(/100%/);
    await ctx.caller.investments.setUserFacts({
      securityId: id.plan!,
      expenseRatio: 0.0025,
      composition: { us_equity: 0.6, intl_equity: 0.4 },
    });
    const o = await ctx.caller.investments.getHoldingsOverview();
    const plan = o.accounts[0]!.holdings.find((r) => r.securityId === id.plan)!;
    expect(plan.facts.expenseRatio).toMatchObject({
      value: 0.0025,
      fromUser: true,
    });
    expect(o.allocation.unknown).toBeCloseTo(0);
  });

  it("links a bucket to one asset class at a time", async () => {
    await ctx.caller.investments.setCompositionBucket({
      assetClassId: id.spare!,
      bucket: "us_bond",
    });
    const rows = ctx.db.select().from(sqliteSchema.assetClassParams).all();
    expect(rows.find((r) => r.id === id.spare)?.compositionBucket).toBe(
      "us_bond",
    );
    expect(rows.find((r) => r.id === id.bonds)?.compositionBucket).toBeNull();
  });

  it("needs the portfolio permission", async () => {
    const other = await createTestCaller(
      createViewerSessionWithPermissions(["sync"]),
    );
    try {
      await expect(
        other.caller.investments.getHoldingsOverview(),
      ).rejects.toThrow();
      await expect(
        other.caller.investments.setUserFacts({
          securityId: 1,
          expenseRatio: 0.001,
        }),
      ).rejects.toThrow();
    } finally {
      other.cleanup();
    }
  });
});
