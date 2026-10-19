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
    if (ticker !== "VTI") return null;
    const m = new Map<string, number>();
    let p = 100;
    m.set("2023-12", p);
    for (let mo = 1; mo <= 12; mo++) {
      p *= 1.01;
      m.set(`2024-${String(mo).padStart(2, "0")}`, p);
    }
    return m;
  }),
}));

import { createTestCaller, seedPerformanceAccount } from "./setup";

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
