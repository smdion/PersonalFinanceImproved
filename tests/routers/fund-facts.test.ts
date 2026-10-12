/**
 * Benchmarks holdings overview and fund-facts actions. Tiingo and SEC are
 * mocked; funds, accounts and values are invented.
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import type { CompositionBucket } from "@/lib/config/enum-values";

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
      bucket: CompositionBucket | null,
      sortOrder: number,
    ) => {
      const classId = db
        .insert(sqliteSchema.assetClassParams)
        .values({ name, meanReturn: "0.07", stdDev: "0.15", sortOrder })
        .returning()
        .get().id;
      if (bucket)
        db.insert(sqliteSchema.assetClassBuckets)
          .values({ bucket, assetClassId: classId })
          .run();
      return classId;
    };
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
      sourceSymbol: "ZZQX", // the institution's own code, not a ticker
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

  it("names an account the way the rest of the app does once it's linked", async () => {
    const before = await ctx.caller.investments.getHoldingsOverview();
    // Not linked to a tracked account: the institution's own name.
    expect(before.accounts[0]!.label).toBe("Example Bank Example IRA");
    const perf = ctx.db
      .insert(sqliteSchema.performanceAccounts)
      .values({
        institution: "Example Bank",
        accountType: "ira",
        accountLabel: "Example Person IRA (Example Bank)",
        displayName: "Example Retirement Account",
        ownershipType: "individual",
        parentCategory: "Retirement",
      })
      .returning()
      .get().id;
    ctx.db
      .update(sqliteSchema.simplefinAccounts)
      .set({ linkedPerformanceAccountId: perf })
      .run();
    const after = await ctx.caller.investments.getHoldingsOverview();
    expect(after.accounts[0]!.label).toBe("Example Retirement Account");
    ctx.db
      .update(sqliteSchema.simplefinAccounts)
      .set({ linkedPerformanceAccountId: null })
      .run();
  });

  it("values holdings at today's close when priced, else as reported", async () => {
    const o = await ctx.caller.investments.getHoldingsOverview();
    const rows = o.accounts[0]!.holdings;
    // Two funds of real size: the account gets a rollup (the plan fund's
    // mix and fee aren't known, so they cover the stock fund only).
    expect(o.accounts[0]!.rollup).toMatchObject({
      coverage: expect.closeTo(5000 / 6000, 5),
      cost: { expenseRatio: expect.closeTo(0.001, 6) },
    });
    expect(o.accounts[0]!.rollup!.mix!.us_equity).toBeCloseTo(0.8);
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
      symbol: "ZZQX",
      symbolConfirmed: false,
    });
    expect(rows.find((r) => r.securityId === id.stock)).toMatchObject({
      symbol: "EXSTX",
      symbolConfirmed: true,
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

  it("checks a suggested stand-in's filings at most hourly, unless the last check failed", async () => {
    const setPreview = (checkedAt: Date, error: string | null) =>
      ctx.db
        .update(sqliteSchema.securities)
        .set({
          standinPreview: {
            coverage: 0.9,
            mix: null,
            expenseRatio: 0.001,
            asOf: "2026-06-30",
            checkedAt: checkedAt.toISOString(),
            error,
          },
        })
        .where(eq(sqliteSchema.securities.id, id.plan!))
        .run();
    const check = () =>
      ctx.caller.investments.checkStandIn({ securityId: id.plan! });
    const calls = syncCalls.ids.length;

    setPreview(new Date(), null);
    expect(await check()).toMatchObject({ checked: false });
    expect(syncCalls.ids).toHaveLength(calls);

    setPreview(new Date(), "Unreadable report");
    expect(await check()).toMatchObject({ checked: true });
    expect(syncCalls.ids.at(-1)).toEqual([id.plan]);

    setPreview(new Date(Date.now() - 2 * 60 * 60 * 1000), null);
    expect(await check()).toMatchObject({ checked: true });

    // Only a suggestion waiting for an answer can be checked.
    await expect(
      ctx.caller.investments.checkStandIn({ securityId: id.stock! }),
    ).rejects.toThrow(/No suggested stand-in/);
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

  it("stopping a stand-in removes its facts, keeps the household's, and isn't re-suggested", async () => {
    ctx.db
      .insert(sqliteSchema.securityFacts)
      .values([
        {
          securityId: id.plan!,
          source: "sec_ncsr",
          asOf: "2026-05-01",
          expenseRatio: "0.003000",
          secSeriesId: "S9",
        },
        {
          securityId: id.plan!,
          source: "user",
          asOf: "2026-01-02",
          expenseRatio: "0.000500",
        },
      ])
      .run();
    await ctx.caller.investments.rejectStandIn({ securityId: id.plan! });
    const s = ctx.db
      .select()
      .from(sqliteSchema.securities)
      .where(eq(sqliteSchema.securities.id, id.plan!))
      .get()!;
    expect(s).toMatchObject({
      factsBasis: "none",
      factsSeriesId: null,
      standinConfirmedAt: null,
    });
    const left = ctx.db
      .select()
      .from(sqliteSchema.securityFacts)
      .where(eq(sqliteSchema.securityFacts.securityId, id.plan!))
      .all();
    expect(left.map((r) => r.source)).toEqual(["user"]);
  });

  it("can look for a stand-in again after 'not a match'", async () => {
    const r = await ctx.caller.investments.findStandIn({
      securityId: id.plan!,
    });
    expect(syncCalls.ids.at(-1)).toEqual([id.plan]);
    expect(r.stoppedBySec).toBe(false);
    const s = ctx.db
      .select()
      .from(sqliteSchema.securities)
      .where(eq(sqliteSchema.securities.id, id.plan!))
      .get()!;
    expect(s.factsBasis).toBeNull();
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

  it("entering only a fee keeps the household's mix, and each part can be cleared", async () => {
    await ctx.caller.investments.setUserFacts({
      securityId: id.plan!,
      expenseRatio: 0.0007,
    });
    let plan = (
      await ctx.caller.investments.getHoldingsOverview()
    ).accounts[0]!.holdings.find((r) => r.securityId === id.plan)!;
    expect(plan.facts.expenseRatio?.value).toBeCloseTo(0.0007);
    expect(plan.facts.composition?.fromUser).toBe(true);
    await ctx.caller.investments.clearUserFacts({
      securityId: id.plan!,
      part: "expenseRatio",
    });
    plan = (
      await ctx.caller.investments.getHoldingsOverview()
    ).accounts[0]!.holdings.find((r) => r.securityId === id.plan)!;
    expect(plan.facts.expenseRatio).toBeNull();
    expect(plan.facts.composition?.fromUser).toBe(true);
    await ctx.caller.investments.clearUserFacts({
      securityId: id.plan!,
      part: "composition",
    });
    const rows = ctx.db
      .select()
      .from(sqliteSchema.securityFacts)
      .where(eq(sqliteSchema.securityFacts.securityId, id.plan!))
      .all();
    expect(rows.filter((r) => r.source === "user")).toHaveLength(0);
  });

  it("counts several fund categories toward one asset class, each toward one", async () => {
    const link = (bucket: CompositionBucket, assetClassId: number | null) =>
      ctx.caller.investments.linkCompositionBucket({ bucket, assetClassId });
    const overview = () => ctx.caller.investments.getHoldingsOverview();
    const row = async (classId: number) =>
      (await overview()).allocation.rows.find(
        (r) => r.assetClassId === classId,
      )!;

    const before = (await row(id.bonds!)).value;
    await link("intl_bond", id.bonds!);
    expect(await row(id.bonds!)).toMatchObject({
      buckets: ["us_bond", "intl_bond"],
      value: expect.closeTo(before + 500, 5),
    });
    expect((await overview()).allocation.unmapped).toEqual([]);

    // A category moves rather than counting twice.
    await link("intl_bond", id.spare!);
    expect((await row(id.bonds!)).buckets).toEqual(["us_bond"]);
    expect((await row(id.spare!)).buckets).toEqual(["intl_bond"]);

    await link("intl_bond", null);
    expect((await overview()).allocation.unmapped).toEqual([
      { bucket: "intl_bond", value: 500 },
    ]);

    await expect(link("intl_bond", 999_999)).rejects.toThrow(
      /No such asset class/,
    );
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
