/**
 * getComparison's matched-mix entry: entered holding history priced with
 * the bucket proxies through the same yearly simulator. Tiingo is mocked;
 * funds, accounts and prices are invented.
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

vi.mock("@/server/helpers/market-prices", () => ({
  getLatestMarketClose: vi.fn(async () => null),
  getBenchmarkMonthlyPrices: vi.fn(async (_db: unknown, ticker: string) => {
    // Stocks +1%/month, bonds flat.
    if (ticker !== "VTI" && ticker !== "BND") return null;
    const growth = ticker === "VTI" ? 0.01 : 0;
    const m = new Map<string, number>();
    let p = 100;
    m.set("2023-12", p);
    for (let mo = 1; mo <= 12; mo++) {
      p *= 1 + growth;
      m.set(`2024-${String(mo).padStart(2, "0")}`, p);
    }
    return m;
  }),
}));

import {
  createTestCaller,
  seedPerformanceAccount,
  seedPerson,
  seedSnapshot,
} from "./setup";

describe("matched mix", () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const perf = seedPerformanceAccount(db, { accountType: "ira" });
    db.insert(sqliteSchema.accountPerformance)
      .values({
        year: 2024,
        institution: "Example Bank",
        accountLabel: "Example IRA",
        performanceAccountId: perf,
        beginningBalance: "10000",
        totalContributions: "0",
        yearlyGainLoss: "1200",
        endingBalance: "11200",
        parentCategory: "Retirement",
      } as typeof sqliteSchema.accountPerformance.$inferInsert)
      .run();
    const fund = db
      .insert(sqliteSchema.securities)
      .values({
        name: "Example Stock Index",
        ticker: "EXSTX",
        kind: "mutual_fund",
      })
      .returning()
      .get().id;
    db.insert(sqliteSchema.securityFacts)
      .values({
        securityId: fund,
        source: "user",
        asOf: "2026-01-01",
        usEquityPct: "1",
        coverage: "1",
      })
      .run();
    await ctx.caller.investments.saveHoldingPeriod({
      id: null,
      performanceAccountId: perf,
      start: "2024-01-01",
      end: "2024-12-31",
      notes: null,
      weights: [{ securityId: fund, weight: 1 }],
    });
  });
  afterAll(() => ctx.cleanup());

  it("is a benchmark entry priced from the history", async () => {
    const r = await ctx.caller.investments.getComparison({ fromYear: 2024 });
    const mm = r.benchmarks.find((b) => b.key === "matched_mix")!;
    expect(mm.available).toBe(true);
    expect(mm.years[0]!.year).toBe(2024);
    // All in US stock, the proxy up 1%/month → 10,000 grows like it.
    expect(mm.years[0]!.end).toBeCloseTo(10000 * 1.01 ** 12, 0);
  });
});

describe("matched mix — an account reported per part", () => {
  // One feed per person's part; each part holds a different fund, and the
  // snapshot puts 75% of the money in the stock part.
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    ctx = await createTestCaller();
    const db = ctx.db;
    const perf = seedPerformanceAccount(db, { accountType: "ira" });
    db.insert(sqliteSchema.accountPerformance)
      .values({
        year: 2024,
        institution: "Example Bank",
        accountLabel: "Example Joint IRA",
        performanceAccountId: perf,
        beginningBalance: "10000",
        totalContributions: "0",
        yearlyGainLoss: "900",
        endingBalance: "10900",
        parentCategory: "Retirement",
      } as typeof sqliteSchema.accountPerformance.$inferInsert)
      .run();
    const alex = await seedPerson(db, "Alex Example");
    const sam = await seedPerson(db, "Sam Example");
    seedSnapshot(db, "2023-12-30", [
      {
        performanceAccountId: perf,
        amount: "7500",
        taxType: "taxFree",
        accountType: "ira",
        ownerPersonId: alex,
      },
      {
        performanceAccountId: perf,
        amount: "2500",
        taxType: "taxFree",
        accountType: "ira",
        ownerPersonId: sam,
      },
    ]);
    const partA = `${perf}_taxFree__${alex}`;
    const partB = `${perf}_taxFree__${sam}`;
    for (const [ext, key] of [
      ["pa", partA],
      ["pb", partB],
    ] as const)
      db.insert(sqliteSchema.simplefinAccounts)
        .values({
          externalAccountId: ext,
          orgName: "Example Bank",
          accountName: ext,
          lastBalance: "0",
          linkedPerformanceAccountId: perf,
          linkedSubKey: key,
        })
        .run();
    const fund = (name: string, ticker: string, pct: "us" | "bond") => {
      const id = db
        .insert(sqliteSchema.securities)
        .values({ name, ticker, kind: "mutual_fund" })
        .returning()
        .get().id;
      db.insert(sqliteSchema.securityFacts)
        .values({
          securityId: id,
          source: "user",
          asOf: "2026-01-01",
          ...(pct === "us" ? { usEquityPct: "1" } : { usBondPct: "1" }),
          coverage: "1",
        })
        .run();
      return id;
    };
    const stock = fund("Example Stock Index", "EXSTX", "us");
    const bond = fund("Example Bond Index", "EXBDX", "bond");
    for (const [subKey, securityId] of [
      [partA, stock],
      [partB, bond],
    ] as const)
      await ctx.caller.investments.saveHoldingPeriod({
        id: null,
        performanceAccountId: perf,
        subKey,
        start: "2024-01-01",
        end: "2024-12-31",
        notes: null,
        weights: [{ securityId, weight: 1 }],
      });
  });
  afterAll(() => ctx.cleanup());

  it("combines the parts by their snapshot shares", async () => {
    const r = await ctx.caller.investments.getComparison({ fromYear: 2024 });
    const mm = r.benchmarks.find((b) => b.key === "matched_mix")!;
    expect(mm.available).toBe(true);
    // 75% stocks (+1%/month), 25% bonds (flat).
    expect(mm.years[0]!.end).toBeCloseTo(10000 * 1.0075 ** 12, 0);
  });
});
