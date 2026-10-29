/**
 * Holding history: observed periods from daily holdings, entered periods
 * (validated server-side), adding funds by ticker / by name, and the
 * account-delete guard. Invented funds and accounts only.
 */
import "./setup-mocks";
import type { PortfolioTaxType } from "@/lib/config/enum-values";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  createTestCaller,
  seedPerformanceAccount,
  seedPerson,
  seedSnapshot,
} from "./setup";

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

describe("holding periods — an account reported per part", () => {
  // One feed per person's part (like a joint IRA), next to an account whose
  // parts share one whole-account feed (like a 401(k)).
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let split: number;
  let whole: number;
  let fundA: number;
  let fundB: number;
  let partA: string;
  let partB: string;
  let closedPart: string;

  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    split = seedPerformanceAccount(db, {
      institution: "Example Brokerage",
      accountType: "ira",
    });
    whole = seedPerformanceAccount(db, {
      institution: "Example Plan",
      accountType: "401k",
    });
    const alex = await seedPerson(db, "Alex Example");
    const sam = await seedPerson(db, "Sam Example");
    partA = `${split}_taxFree__${alex}`;
    partB = `${split}_taxFree__${sam}`;
    // Alex's Traditional part held money years ago and is gone from the
    // latest snapshot — its history must still be enterable.
    closedPart = `${split}_preTax__${alex}`;
    const part = (
      taxType: PortfolioTaxType,
      owner: number,
      amount: string,
    ) => ({
      performanceAccountId: split,
      amount,
      taxType,
      accountType: "ira",
      ownerPersonId: owner,
    });
    seedSnapshot(db, "2019-08-03", [
      part("preTax", alex, "600"),
      part("taxFree", sam, "400"),
    ]);
    seedSnapshot(db, "2026-10-10", [
      part("taxFree", alex, "600"),
      part("taxFree", sam, "400"),
    ]);
    const feed = (ext: string, perf: number, subKey: string | null) =>
      db
        .insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId: ext,
          orgName: "Example",
          accountName: ext,
          lastBalance: "0",
          linkedPerformanceAccountId: perf,
          linkedSubKey: subKey,
        })
        .returning()
        .get().id;
    const sec = (name: string, ticker: string) =>
      db
        .insert(sqliteSchema.securities)
        .values({ name, ticker, kind: "mutual_fund", sourceSymbol: ticker })
        .returning()
        .get().id;
    fundA = sec("Example 2055 Fund", "EXFFX");
    fundB = sec("Example 2060 Fund", "EXTTX");
    const observe = (feedId: number, securityId: number, value: string) =>
      db
        .insert(sqliteSchema.holdingObservations)
        .values({
          simplefinAccountId: feedId,
          securityId,
          asOf: "2026-10-12",
          shares: "10",
          reportedMarketValue: value,
          source: "simplefin",
        })
        .run();
    observe(feed("pa", split, partA), fundA, "600");
    observe(feed("pb", split, partB), fundB, "400");
    const w = feed("w", whole, null);
    observe(w, fundA, "300");
    observe(w, fundB, "100");
  });
  afterAll(() => ctx.cleanup());

  it("each part has its own history; the whole-account feed's account keeps one", async () => {
    const r = await ctx.caller.investments.listHoldingPeriods();
    const of = (perf: number) =>
      r.periods
        .filter((p) => p.performanceAccountId === perf)
        .map((p) => [p.subKey, p.weights]);
    expect(of(split).sort()).toEqual(
      [
        [partA, { [fundA]: 1 }],
        [partB, { [fundB]: 1 }],
      ].sort(),
    );
    expect(of(whole)).toEqual([[null, { [fundA]: 0.75, [fundB]: 0.25 }]]);
    expect(
      r.holders
        .filter((h) => h.performanceAccountId === split)
        .map((h) => h.subKey)
        .sort(),
    ).toEqual([partA, partB, closedPart].sort());
    expect(r.holders.find((h) => h.subKey === closedPart)!.label).toMatch(
      /^Alex Example — /,
    );
    expect(r.accounts.find((a) => a.id === whole)).toMatchObject({
      split: false,
    });
  });

  it("entered per part: whole-account, unknown or misplaced parts are refused; parts may overlap in time", async () => {
    const base = {
      id: null,
      start: "2020-01-01",
      end: "2024-12-31",
      notes: null,
      weights: [{ securityId: fundA, weight: 1 }],
    };
    await expect(
      ctx.caller.investments.saveHoldingPeriod({
        ...base,
        performanceAccountId: split,
        subKey: null,
      }),
    ).rejects.toThrow(/per part/);
    await expect(
      ctx.caller.investments.saveHoldingPeriod({
        ...base,
        performanceAccountId: split,
        subKey: `${split}_preTax__9`,
      }),
    ).rejects.toThrow(/isn't one of this account's parts/);
    await expect(
      ctx.caller.investments.saveHoldingPeriod({
        ...base,
        performanceAccountId: whole,
        subKey: `${whole}_taxFree__1`,
      }),
    ).rejects.toThrow(/whole account/);
    await ctx.caller.investments.saveHoldingPeriod({
      ...base,
      performanceAccountId: split,
      subKey: partA,
    });
    await ctx.caller.investments.saveHoldingPeriod({
      ...base,
      performanceAccountId: split,
      subKey: partB,
      weights: [{ securityId: fundB, weight: 1 }],
    });
    await expect(
      ctx.caller.investments.saveHoldingPeriod({
        ...base,
        performanceAccountId: split,
        subKey: partB,
        start: "2024-01-01",
        end: null,
      }),
    ).rejects.toThrow(/for this part/);
    const r = await ctx.caller.investments.listHoldingPeriods();
    expect(
      r.periods.filter((p) => p.basis === "user" && !p.orphaned),
    ).toHaveLength(2);
  });

  it("a part gone from the latest snapshot still takes its history", async () => {
    const { id } = await ctx.caller.investments.saveHoldingPeriod({
      id: null,
      performanceAccountId: split,
      subKey: closedPart,
      start: "2016-01-01",
      end: "2019-12-31",
      notes: null,
      weights: [{ securityId: fundB, weight: 1 }],
    });
    const r = await ctx.caller.investments.listHoldingPeriods();
    expect(r.periods.find((p) => p.id === id)).toMatchObject({
      subKey: closedPart,
      orphaned: false,
    });
  });

  it("a whole-account period stored on a split account shows as one to move", async () => {
    const [row] = await ctx.db
      .insert(sqliteSchema.holdingPeriods)
      .values({
        performanceAccountId: split,
        subKey: null,
        startDate: "2010-01-01",
        endDate: "2010-12-31",
        basis: "user",
      })
      .returning();
    const r = await ctx.caller.investments.listHoldingPeriods();
    expect(r.periods.find((p) => p.id === row!.id)!.orphaned).toBe(true);
  });
});
