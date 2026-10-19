/**
 * Holding history: observed periods from daily holdings, entered periods
 * (validated server-side), adding funds by ticker / by name, and the
 * account-delete guard. Invented funds and accounts only.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { createTestCaller, seedPerformanceAccount } from "./setup";

describe("holding periods", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let perf: number;
  let fundA: number;
  let fundB: number;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    perf = seedPerformanceAccount(db, {
      institution: "Example Bank",
      accountType: "ira",
    });
    const feed = db
      .insert(sqliteSchema.simplefinAccounts)
      .values({
        externalAccountId: "f1",
        orgName: "Example Bank",
        accountName: "f1",
        lastBalance: "0",
        linkedPerformanceAccountId: perf,
      })
      .returning()
      .get().id;
    const sec = (name: string, ticker: string) =>
      db
        .insert(sqliteSchema.securities)
        .values({ name, ticker, kind: "mutual_fund", sourceSymbol: ticker })
        .returning()
        .get().id;
    fundA = sec("Example Stock Index", "EXSTX");
    fundB = sec("Example Bond Index", "EXBDX");
    for (const [asOf, a, b] of [
      ["2026-10-12", "600", "400"],
      ["2026-10-13", "590", "405"],
    ] as const)
      db.insert(sqliteSchema.holdingObservations)
        .values([
          {
            simplefinAccountId: feed,
            securityId: fundA,
            asOf,
            shares: "10",
            reportedMarketValue: a,
            source: "simplefin",
          },
          {
            simplefinAccountId: feed,
            securityId: fundB,
            asOf,
            shares: "10",
            reportedMarketValue: b,
            source: "simplefin",
          },
        ])
        .run();
  });
  afterAll(() => ctx.cleanup());

  it("lists the observed period derived from daily holdings, still held", async () => {
    const r = await ctx.caller.investments.listHoldingPeriods();
    const observed = r.periods.filter((p) => p.basis === "observed");
    expect(observed).toEqual([
      expect.objectContaining({
        performanceAccountId: perf,
        start: "2026-10-12",
        end: null,
      }),
    ]);
    expect(observed[0]!.weights[fundA]).toBeCloseTo(0.6, 6);
  });

  it("saves an entered period; refuses overlaps, bad sums and duplicate funds", async () => {
    const base = {
      id: null,
      performanceAccountId: perf,
      start: "2020-01-01",
      end: "2024-12-31",
      notes: null,
    };
    const { id } = await ctx.caller.investments.saveHoldingPeriod({
      ...base,
      weights: [
        { securityId: fundA, weight: 0.7 },
        { securityId: fundB, weight: 0.3 },
      ],
    });
    await expect(
      ctx.caller.investments.saveHoldingPeriod({
        ...base,
        start: "2024-06-01",
        end: null,
        weights: [{ securityId: fundA, weight: 1 }],
      }),
    ).rejects.toThrow(/overlaps/);
    await expect(
      ctx.caller.investments.saveHoldingPeriod({
        ...base,
        id,
        weights: [{ securityId: fundA, weight: 0.5 }],
      }),
    ).rejects.toThrow(/add up to 100%/);
    await expect(
      ctx.caller.investments.saveHoldingPeriod({
        ...base,
        id,
        weights: [
          { securityId: fundA, weight: 0.5 },
          { securityId: fundA, weight: 0.5 },
        ],
      }),
    ).rejects.toThrow(/listed twice/);
    // Editing itself is fine.
    await ctx.caller.investments.saveHoldingPeriod({
      ...base,
      id,
      weights: [{ securityId: fundB, weight: 1 }],
    });
    const r = await ctx.caller.investments.listHoldingPeriods();
    expect(r.periods.find((p) => p.id === id)!.weights).toEqual({ [fundB]: 1 });
  });

  it("an account with entered history can't be deleted", async () => {
    await expect(
      ctx.caller.performance.performanceAccounts.delete({ id: perf }),
    ).rejects.toThrow(/holding period/);
  });

  it("adds funds: a known ticker is reused; without SEC, an unknown ticker is refused; by name dedupes", async () => {
    expect(
      await ctx.caller.investments.addFundByTicker({ ticker: "exstx" }),
    ).toEqual({ id: fundA });
    await expect(
      ctx.caller.investments.addFundByTicker({ ticker: "NEWFX" }),
    ).rejects.toThrow(/SEC fund facts/);
    const a = await ctx.caller.investments.addFundByName({
      name: "Example Plan Stable Value",
    });
    const b = await ctx.caller.investments.addFundByName({
      name: "example plan stable value",
    });
    expect(b.id).toBe(a.id);
  });
});
