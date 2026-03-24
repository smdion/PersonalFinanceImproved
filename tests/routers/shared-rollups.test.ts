/**
 * Tests for recomputeAnnualRollups in settings/_shared.ts
 *
 * Covers:
 *   - No accountPerformance rows → nothing happens
 *   - Single category → category row + Portfolio row upserted
 *   - Multiple categories → each category + Portfolio rollup
 *   - Updates existing annualPerformance rows on re-run
 *   - Correct field aggregation (beginBal, contribs, gainLoss, endBal, employer, distributions, fees)
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedPerson, seedPerformanceAccount } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";
import { eq, and } from "drizzle-orm";
import { recomputeAnnualRollups } from "@/server/routers/settings/_shared";

describe("recomputeAnnualRollups", () => {
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let rawDb: Awaited<ReturnType<typeof createTestCaller>>["rawDb"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    db = ctx.db;
    rawDb = ctx.rawDb;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Rollup Person", "1990-01-01");
  });

  afterAll(() => cleanup());

  it("does nothing when no accountPerformance rows exist for the year", async () => {
    await recomputeAnnualRollups(rawDb, 2020);

    const rows = db
      .select()
      .from(schema.annualPerformance)
      .where(eq(schema.annualPerformance.year, 2020))
      .all();

    expect(rows).toHaveLength(0);
  });

  it("creates category + Portfolio rollup from single-category data", async () => {
    // Seed account_performance rows
    const perfAcctId = seedPerformanceAccount(db, {
      accountType: "401k",
      parentCategory: "Retirement",
    });

    db.insert(schema.accountPerformance)
      .values({
        year: 2024,
        institution: "Fidelity",
        accountLabel: "401k",
        ownerPersonId: personId,
        parentCategory: "Retirement",
        beginningBalance: "10000.00",
        totalContributions: "5000.00",
        yearlyGainLoss: "2000.00",
        endingBalance: "17000.00",
        employerContributions: "3000.00",
        distributions: "0.00",
        fees: "100.00",
        performanceAccountId: perfAcctId,
      })
      .run();

    // Pre-create annualPerformance rows so the update path is taken
    db.insert(schema.annualPerformance)
      .values({
        year: 2024,
        category: "Retirement",
        beginningBalance: "0",
        totalContributions: "0",
        yearlyGainLoss: "0",
        endingBalance: "0",
        employerContributions: "0",
        distributions: "0",
        fees: "0",
        lifetimeGains: "0",
        lifetimeContributions: "0",
        lifetimeMatch: "0",
      })
      .run();

    db.insert(schema.annualPerformance)
      .values({
        year: 2024,
        category: "Portfolio",
        beginningBalance: "0",
        totalContributions: "0",
        yearlyGainLoss: "0",
        endingBalance: "0",
        employerContributions: "0",
        distributions: "0",
        fees: "0",
        lifetimeGains: "0",
        lifetimeContributions: "0",
        lifetimeMatch: "0",
      })
      .run();

    await recomputeAnnualRollups(rawDb, 2024);

    const rows = db
      .select()
      .from(schema.annualPerformance)
      .where(eq(schema.annualPerformance.year, 2024))
      .all();

    // Should have 2 rows: Retirement + Portfolio
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const retirement = rows.find((r) => r.category === "Retirement");
    expect(retirement).toBeDefined();
    expect(retirement!.beginningBalance).toBe("10000.00");
    expect(retirement!.totalContributions).toBe("5000.00");
    expect(retirement!.yearlyGainLoss).toBe("2000.00");
    expect(retirement!.endingBalance).toBe("17000.00");
    expect(retirement!.employerContributions).toBe("3000.00");
    expect(retirement!.distributions).toBe("0.00");
    expect(retirement!.fees).toBe("100.00");

    const portfolio = rows.find((r) => r.category === "Portfolio");
    expect(portfolio).toBeDefined();
    // Portfolio should be the same as Retirement (only one category)
    expect(portfolio!.beginningBalance).toBe("10000.00");
    expect(portfolio!.totalContributions).toBe("5000.00");
    expect(portfolio!.endingBalance).toBe("17000.00");
  });

  it("aggregates multiple categories correctly", async () => {
    const year = 2023;
    const perfAcctRet = seedPerformanceAccount(db, {
      accountType: "401k",
      parentCategory: "Retirement",
      name: "Ret Acct",
    });
    const perfAcctPort = seedPerformanceAccount(db, {
      accountType: "brokerage",
      parentCategory: "Portfolio",
      name: "Port Acct",
    });

    // Retirement account
    db.insert(schema.accountPerformance)
      .values({
        year,
        institution: "Vanguard",
        accountLabel: "Ret401k",
        ownerPersonId: personId,
        parentCategory: "Retirement",
        beginningBalance: "20000.00",
        totalContributions: "8000.00",
        yearlyGainLoss: "3000.00",
        endingBalance: "31000.00",
        employerContributions: "4000.00",
        distributions: "500.00",
        fees: "50.00",
        performanceAccountId: perfAcctRet,
      })
      .run();

    // Portfolio account
    db.insert(schema.accountPerformance)
      .values({
        year,
        institution: "Schwab",
        accountLabel: "Brokerage",
        ownerPersonId: personId,
        parentCategory: "Portfolio",
        beginningBalance: "5000.00",
        totalContributions: "2000.00",
        yearlyGainLoss: "1000.00",
        endingBalance: "8000.00",
        employerContributions: "0.00",
        distributions: "200.00",
        fees: "25.00",
        performanceAccountId: perfAcctPort,
      })
      .run();

    // Pre-create annual_performance rows for all 3 categories
    for (const cat of ["Retirement", "Portfolio"]) {
      db.insert(schema.annualPerformance)
        .values({
          year,
          category: cat,
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0",
          employerContributions: "0",
          distributions: "0",
          fees: "0",
          lifetimeGains: "0",
          lifetimeContributions: "0",
          lifetimeMatch: "0",
        })
        .run();
    }

    await recomputeAnnualRollups(rawDb, year);

    const rows = db
      .select()
      .from(schema.annualPerformance)
      .where(eq(schema.annualPerformance.year, year))
      .all();

    const retirement = rows.find((r) => r.category === "Retirement")!;
    expect(retirement.beginningBalance).toBe("20000.00");
    expect(retirement.totalContributions).toBe("8000.00");

    // The "Portfolio" category in accountPerformance data
    const portfolioCat = rows.find((r) => r.category === "Portfolio")!;
    // Portfolio rollup = sum of ALL categories (Retirement + Portfolio)
    // beginBal: 20000 + 5000 = 25000
    expect(portfolioCat.beginningBalance).toBe("25000.00");
    // contribs: 8000 + 2000 = 10000
    expect(portfolioCat.totalContributions).toBe("10000.00");
    // gainLoss: 3000 + 1000 = 4000
    expect(portfolioCat.yearlyGainLoss).toBe("4000.00");
    // endBal: 31000 + 8000 = 39000
    expect(portfolioCat.endingBalance).toBe("39000.00");
    // employer: 4000 + 0 = 4000
    expect(portfolioCat.employerContributions).toBe("4000.00");
    // distributions: 500 + 200 = 700
    expect(portfolioCat.distributions).toBe("700.00");
    // fees: 50 + 25 = 75
    expect(portfolioCat.fees).toBe("75.00");
  });

  it("updates existing rows on second call", async () => {
    const year = 2022;
    const perfAcctId = seedPerformanceAccount(db, {
      accountType: "ira",
      parentCategory: "Retirement",
      name: "IRA Acct",
    });

    db.insert(schema.accountPerformance)
      .values({
        year,
        institution: "TD",
        accountLabel: "IRA",
        ownerPersonId: personId,
        parentCategory: "Retirement",
        beginningBalance: "1000.00",
        totalContributions: "500.00",
        yearlyGainLoss: "200.00",
        endingBalance: "1700.00",
        employerContributions: "0.00",
        distributions: "0.00",
        fees: "10.00",
        performanceAccountId: perfAcctId,
      })
      .run();

    // Pre-create annual rows
    for (const cat of ["Retirement", "Portfolio"]) {
      db.insert(schema.annualPerformance)
        .values({
          year,
          category: cat,
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0",
          employerContributions: "0",
          distributions: "0",
          fees: "0",
          lifetimeGains: "0",
          lifetimeContributions: "0",
          lifetimeMatch: "0",
        })
        .run();
    }

    // First call
    await recomputeAnnualRollups(rawDb, year);

    let retRow = db
      .select()
      .from(schema.annualPerformance)
      .where(
        and(
          eq(schema.annualPerformance.year, year),
          eq(schema.annualPerformance.category, "Retirement"),
        ),
      )
      .all()[0]!;

    expect(retRow.beginningBalance).toBe("1000.00");

    // Update the account performance data
    db.update(schema.accountPerformance)
      .set({ beginningBalance: "2000.00", endingBalance: "2700.00" })
      .where(
        and(
          eq(schema.accountPerformance.year, year),
          eq(schema.accountPerformance.accountLabel, "IRA"),
        ),
      )
      .run();

    // Second call — should update, not insert
    await recomputeAnnualRollups(rawDb, year);

    retRow = db
      .select()
      .from(schema.annualPerformance)
      .where(
        and(
          eq(schema.annualPerformance.year, year),
          eq(schema.annualPerformance.category, "Retirement"),
        ),
      )
      .all()[0]!;

    expect(retRow.beginningBalance).toBe("2000.00");
    expect(retRow.endingBalance).toBe("2700.00");
  });
});
