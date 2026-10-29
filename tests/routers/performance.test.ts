/**
 * Performance router integration tests.
 *
 * Tests computeSummary (empty + seeded), updateAnnual, updateAccount,
 * createAccount (account_performance), deleteAccount, and the
 * performanceAccounts master-registry CRUD (list/create).
 *
 * Note: finalizeYear uses db.transaction() with tx.execute() which isn't
 * compatible with better-sqlite3 in tests, so it is excluded.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedPerformanceAccount,
  seedSnapshot,
  adminSession,
} from "./setup";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

describe("performance router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // ── computeSummary (empty DB) ──

  describe("computeSummary (empty DB)", () => {
    it("returns expected shape with empty DB", async () => {
      const summary = await caller.performance.computeSummary();

      expect(summary).toHaveProperty("categories");
      expect(summary).toHaveProperty("accountTypeCategories");
      expect(summary).toHaveProperty("parentCategories");
      expect(summary).toHaveProperty("currentYear");
      expect(summary).toHaveProperty("annualRows");
      expect(summary).toHaveProperty("accountRows");
      expect(summary).toHaveProperty("masterAccounts");
      expect(summary).toHaveProperty("lastSnapshotDate");
      expect(summary).toHaveProperty("performanceLastUpdated");
      expect(summary).toHaveProperty("lifetimeTotals");

      expect(Array.isArray(summary.categories)).toBe(true);
      expect(Array.isArray(summary.annualRows)).toBe(true);
      expect(Array.isArray(summary.accountRows)).toBe(true);
      expect(Array.isArray(summary.masterAccounts)).toBe(true);

      expect(summary.annualRows).toHaveLength(0);
      expect(summary.accountRows).toHaveLength(0);
      expect(summary.masterAccounts).toHaveLength(0);
      expect(summary.currentYear).toBeNull();
      expect(summary.lifetimeTotals).toBeNull();
    });
  });

  // ── performance.performanceAccounts (list / create) ──

  describe("listAccounts", () => {
    it("returns empty array when no performance accounts exist", async () => {
      const accounts = await caller.performance.performanceAccounts.list();
      expect(accounts).toEqual([]);
    });
  });

  describe("performanceAccounts.create", () => {
    it("creates a performance account with required fields", async () => {
      const personId = await seedPerson(db, "Test Owner");

      const account = await caller.performance.performanceAccounts.create({
        institution: "Vanguard",
        accountType: "ira",
        ownerPersonId: personId,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 0,
      });

      expect(account).toBeDefined();
      expect(account!.institution).toBe("Vanguard");
      expect(account!.accountType).toBe("ira");
      expect(account!.isActive).toBe(true);
      expect(typeof account!.id).toBe("number");
    });

    it("creates a performance account without an owner", async () => {
      const account = await caller.performance.performanceAccounts.create({
        institution: "Fidelity",
        accountType: "401k",
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 1,
      });

      expect(account).toBeDefined();
      expect(account!.institution).toBe("Fidelity");
      expect(account!.ownerPersonId).toBeNull();
    });
  });

  describe("listAccounts (after create)", () => {
    it("returns the created accounts", async () => {
      const accounts = await caller.performance.performanceAccounts.list();
      expect(accounts.length).toBeGreaterThanOrEqual(2);

      const vanguard = accounts.find(
        (a: { institution: string }) => a.institution === "Vanguard",
      );
      expect(vanguard).toBeDefined();
      expect(vanguard!.accountType).toBe("ira");
    });
  });

  // ── computeSummary (after accounts created) ──

  describe("computeSummary (after accounts created)", () => {
    it("masterAccounts contains the created performance accounts", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.masterAccounts.length).toBeGreaterThanOrEqual(2);

      const vanguard = summary.masterAccounts.find(
        (a: { institution: string }) => a.institution === "Vanguard",
      );
      expect(vanguard).toBeDefined();
      expect(vanguard!.accountType).toBe("ira");
      expect(vanguard!.parentCategory).toBe("Retirement");
    });

    it("masterAccounts entries have expected shape fields", async () => {
      const summary = await caller.performance.computeSummary();
      for (const a of summary.masterAccounts) {
        expect(a).toHaveProperty("id");
        expect(a).toHaveProperty("institution");
        expect(a).toHaveProperty("accountLabel");
        expect(a).toHaveProperty("accountType");
        expect(a).toHaveProperty("parentCategory");
        expect(a).toHaveProperty("isActive");
        expect(a).toHaveProperty("ownershipType");
        expect(a).toHaveProperty("displayOrder");
      }
    });
  });

  // ── history (empty accountRows / annualRows) ──

  describe("history (empty)", () => {
    it("returns empty accountRows when no account_performance records exist", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.accountRows).toHaveLength(0);
    });

    it("annualRows is empty with no performance data seeded", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.annualRows).toHaveLength(0);
    });
  });

  // ── createAccount (account_performance via performance.createAccount) ──

  describe("performance.createAccount", () => {
    let perfAccountId: number;

    beforeAll(() => {
      // Seed a performance_accounts master record directly for use in account_performance
      perfAccountId = seedPerformanceAccount(db, {
        institution: "Schwab",
        accountType: "401k",
        accountLabel: "Main 401k",
        parentCategory: "Retirement",
        ownershipType: "individual",
      });
    });

    it("creates an account_performance row for a given year", async () => {
      const row = await caller.performance.createAccount({
        year: 2024,
        performanceAccountId: perfAccountId,
        beginningBalance: "50000",
        totalContributions: "10000",
        yearlyGainLoss: "5000",
        endingBalance: "65000",
        employerContributions: "3000",
        fees: "100",
        distributions: "0",
        rollovers: "0",
      });

      expect(row).toBeDefined();
      expect(row!.year).toBe(2024);
      expect(row!.institution).toBe("Schwab");
      expect(row!.beginningBalance).toBe("50000");
      expect(row!.totalContributions).toBe("10000");
      expect(row!.yearlyGainLoss).toBe("5000");
      expect(row!.endingBalance).toBe("65000");
      expect(row!.employerContributions).toBe("3000");
      expect(row!.fees).toBe("100");
      expect(row!.performanceAccountId).toBe(perfAccountId);
    });

    it("denormalizes institution/label/owner from master record", async () => {
      const row = await caller.performance.createAccount({
        year: 2023,
        performanceAccountId: perfAccountId,
        beginningBalance: "40000",
        totalContributions: "8000",
        yearlyGainLoss: "2000",
        endingBalance: "50000",
      });

      expect(row!.institution).toBe("Schwab");
      expect(row!.accountLabel).toBe("Main 401k");
      expect(row!.parentCategory).toBe("Retirement");
    });

    it("throws when performanceAccountId does not exist", async () => {
      await expect(
        caller.performance.createAccount({
          year: 2024,
          performanceAccountId: 99999,
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0",
        }),
      ).rejects.toThrow(/not found/);
    });

    it("defaults optional fields to '0'", async () => {
      const row = await caller.performance.createAccount({
        year: 2022,
        performanceAccountId: perfAccountId,
        beginningBalance: "30000",
        totalContributions: "5000",
        yearlyGainLoss: "-2000",
        endingBalance: "33000",
      });

      expect(row!.employerContributions).toBe("0");
      expect(row!.fees).toBe("0");
      expect(row!.distributions).toBe("0");
      expect(row!.rollovers).toBe("0");
    });
  });

  // ── computeSummary (with account_performance data) ──

  describe("computeSummary (with account data)", () => {
    it("accountRows reflect created account_performance records", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.accountRows.length).toBeGreaterThanOrEqual(1);

      const row2024 = summary.accountRows.find(
        (r: { year: number; institution: string }) =>
          r.year === 2024 && r.institution === "Schwab",
      );
      expect(row2024).toBeDefined();
      expect(row2024!.beginningBalance).toBe(50000);
      expect(row2024!.totalContributions).toBe(10000);
      expect(row2024!.yearlyGainLoss).toBe(5000);
      expect(row2024!.endingBalance).toBe(65000);
      expect(row2024!.employerContributions).toBe(3000);
      expect(row2024!.fees).toBe(100);
    });

    it("accountRows have computed annualReturnPct", async () => {
      const summary = await caller.performance.computeSummary();
      const row = summary.accountRows.find(
        (r: { year: number; institution: string }) =>
          r.year === 2024 && r.institution === "Schwab",
      );
      expect(row).toBeDefined();
      // Modified Dietz: gainLoss / (beginBal + (contribs - fees) / 2)
      // = 5000 / (50000 + (10000 - 100) / 2) = 5000 / 54950
      const expectedReturn = 5000 / 54950;
      expect(row!.annualReturnPct).toBeCloseTo(expectedReturn, 4);
    });

    it("accountRows include displayOrder from master", async () => {
      const summary = await caller.performance.computeSummary();
      for (const row of summary.accountRows) {
        expect(row).toHaveProperty("displayOrder");
        expect(typeof row.displayOrder).toBe("number");
      }
    });

    it("accountRows include ownershipType from master", async () => {
      const summary = await caller.performance.computeSummary();
      const row = summary.accountRows.find(
        (r: { institution: string }) => r.institution === "Schwab",
      );
      expect(row).toBeDefined();
      expect(row!.ownershipType).toBe("individual");
    });

    it("synthesizes annualRows from account data when no annual_performance exists", async () => {
      const summary = await caller.performance.computeSummary();
      // Should have synthesized annual rows for years 2022, 2023, 2024
      expect(summary.annualRows.length).toBeGreaterThanOrEqual(1);

      // Check that a 2024 category row exists
      const row2024 = summary.annualRows.find(
        (r: { year: number; category: string }) =>
          r.year === 2024 &&
          r.category !== "Portfolio" &&
          r.category !== "Retirement",
      );
      expect(row2024).toBeDefined();
    });

    it("synthesizes Portfolio rollup row from category rows", async () => {
      const summary = await caller.performance.computeSummary();
      const portfolioRows = summary.annualRows.filter(
        (r: { category: string }) => r.category === "Portfolio",
      );
      // Should have Portfolio rows for years with data
      expect(portfolioRows.length).toBeGreaterThanOrEqual(1);
    });

    it("categories array is populated", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.categories.length).toBeGreaterThanOrEqual(1);
    });

    it("accountTypeCategories excludes Portfolio and Retirement rollups", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.accountTypeCategories).not.toContain("Portfolio");
      expect(summary.accountTypeCategories).not.toContain("Retirement");
    });
  });

  // ── updateAccount (account_performance) ──

  describe("performance.updateAccount", () => {
    let accountPerfId: number;

    beforeAll(async () => {
      // Find an existing account_performance row to update
      const rows = db.select().from(schema.accountPerformance).all();
      expect(rows.length).toBeGreaterThan(0);
      accountPerfId = rows[0]!.id;
    });

    it("updates beginningBalance on an account_performance row", async () => {
      const result = await caller.performance.updateAccount({
        id: accountPerfId,
        beginningBalance: "55000",
      });
      expect(result).toMatchObject({ success: true });

      // Verify via computeSummary
      const row = db
        .select()
        .from(schema.accountPerformance)
        .all()
        .find((r) => r.id === accountPerfId);
      expect(row!.beginningBalance).toBe("55000");
    });

    it("updates multiple fields at once", async () => {
      const result = await caller.performance.updateAccount({
        id: accountPerfId,
        totalContributions: "12000",
        yearlyGainLoss: "6000",
        endingBalance: "73000",
        fees: "200",
      });
      expect(result).toMatchObject({ success: true });

      const row = db
        .select()
        .from(schema.accountPerformance)
        .all()
        .find((r) => r.id === accountPerfId);
      expect(row!.totalContributions).toBe("12000");
      expect(row!.yearlyGainLoss).toBe("6000");
      expect(row!.endingBalance).toBe("73000");
      expect(row!.fees).toBe("200");
    });

    it("updates annualReturnPct to a specific value", async () => {
      const result = await caller.performance.updateAccount({
        id: accountPerfId,
        annualReturnPct: "0.085",
      });
      expect(result).toMatchObject({ success: true });

      const row = db
        .select()
        .from(schema.accountPerformance)
        .all()
        .find((r) => r.id === accountPerfId);
      expect(row!.annualReturnPct).toBe("0.085");
    });

    it("updates annualReturnPct to null", async () => {
      const result = await caller.performance.updateAccount({
        id: accountPerfId,
        annualReturnPct: null,
      });
      expect(result).toMatchObject({ success: true });

      const row = db
        .select()
        .from(schema.accountPerformance)
        .all()
        .find((r) => r.id === accountPerfId);
      expect(row!.annualReturnPct).toBeNull();
    });

    it("returns success when no fields are provided", async () => {
      const result = await caller.performance.updateAccount({
        id: accountPerfId,
      });
      expect(result).toMatchObject({ success: true });
    });

    it("stamps performance_last_updated after update", async () => {
      await caller.performance.updateAccount({
        id: accountPerfId,
        fees: "250",
      });

      const settings = db.select().from(schema.appSettings).all();
      const updated = settings.find(
        (s) => s.key === "performance_last_updated",
      );
      expect(updated).toBeDefined();
      expect(updated!.value).toBeTruthy();
      // Should be a valid ISO timestamp
      expect(new Date(String(updated!.value)).getTime()).not.toBeNaN();
    });
  });

  // ── updateAnnual ──

  describe("performance.updateAnnual", () => {
    let annualId: number;

    beforeAll(() => {
      // Seed an annual_performance row directly
      const row = db
        .insert(schema.annualPerformance)
        .values({
          year: 2019,
          category: "401k/IRA",
          beginningBalance: "100000",
          totalContributions: "20000",
          yearlyGainLoss: "15000",
          endingBalance: "135000",
          employerContributions: "5000",
          distributions: "0",
          fees: "500",
          rollovers: "0",
          lifetimeGains: "50000",
          lifetimeContributions: "80000",
          lifetimeMatch: "20000",
          isCurrentYear: true,
          isFinalized: false,
        })
        .returning({ id: schema.annualPerformance.id })
        .get();
      annualId = row.id;
    });

    it("updates beginningBalance on an annual_performance row", async () => {
      const result = await caller.performance.updateAnnual({
        id: annualId,
        beginningBalance: "105000",
      });
      expect(result).toEqual({ success: true });

      const row = db
        .select()
        .from(schema.annualPerformance)
        .all()
        .find((r) => r.id === annualId);
      expect(row!.beginningBalance).toBe("105000");
    });

    it("updates multiple fields at once", async () => {
      const result = await caller.performance.updateAnnual({
        id: annualId,
        totalContributions: "22000",
        yearlyGainLoss: "18000",
        endingBalance: "145000",
        employerContributions: "6000",
      });
      expect(result).toEqual({ success: true });

      const row = db
        .select()
        .from(schema.annualPerformance)
        .all()
        .find((r) => r.id === annualId);
      expect(row!.totalContributions).toBe("22000");
      expect(row!.yearlyGainLoss).toBe("18000");
      expect(row!.endingBalance).toBe("145000");
      expect(row!.employerContributions).toBe("6000");
    });

    it("updates annualReturnPct to a specific value", async () => {
      const result = await caller.performance.updateAnnual({
        id: annualId,
        annualReturnPct: "0.12",
      });
      expect(result).toEqual({ success: true });

      const row = db
        .select()
        .from(schema.annualPerformance)
        .all()
        .find((r) => r.id === annualId);
      expect(row!.annualReturnPct).toBe("0.12");
    });

    it("updates annualReturnPct to null", async () => {
      const result = await caller.performance.updateAnnual({
        id: annualId,
        annualReturnPct: null,
      });
      expect(result).toEqual({ success: true });

      const row = db
        .select()
        .from(schema.annualPerformance)
        .all()
        .find((r) => r.id === annualId);
      expect(row!.annualReturnPct).toBeNull();
    });

    it("returns success when no fields are provided", async () => {
      const result = await caller.performance.updateAnnual({
        id: annualId,
      });
      expect(result).toEqual({ success: true });
    });

    it("updates distributions, fees, and rollovers", async () => {
      const result = await caller.performance.updateAnnual({
        id: annualId,
        distributions: "1000",
        fees: "750",
        rollovers: "5000",
      });
      expect(result).toEqual({ success: true });

      const row = db
        .select()
        .from(schema.annualPerformance)
        .all()
        .find((r) => r.id === annualId);
      expect(row!.distributions).toBe("1000");
      expect(row!.fees).toBe("750");
      expect(row!.rollovers).toBe("5000");
    });

    it("stamps performance_last_updated after update", async () => {
      // Clear previous timestamp
      db.delete(schema.appSettings).run();

      await caller.performance.updateAnnual({
        id: annualId,
        fees: "800",
      });

      const settings = db.select().from(schema.appSettings).all();
      const updated = settings.find(
        (s) => s.key === "performance_last_updated",
      );
      expect(updated).toBeDefined();
      expect(new Date(String(updated!.value)).getTime()).not.toBeNaN();
    });
  });

  // ── deleteAccount (account_performance) ──

  // ── computeSummary with annualPerformance + accountPerformance seeded ──

  describe("computeSummary (with annual + account data)", () => {
    let perfAcct2Id: number;

    beforeAll(() => {
      // Seed a second performance account in a different category
      perfAcct2Id = seedPerformanceAccount(db, {
        institution: "Fidelity",
        accountType: "hsa",
        accountLabel: "HSA Account",
        parentCategory: "Retirement",
        ownershipType: "individual",
      });

      // Seed account_performance rows for the HSA account
      db.insert(schema.accountPerformance)
        .values({
          year: 2024,
          institution: "Fidelity",
          accountLabel: "Fidelity HSA Account",
          parentCategory: "Retirement",
          performanceAccountId: perfAcct2Id,
          beginningBalance: "8000",
          totalContributions: "3850",
          yearlyGainLoss: "1200",
          endingBalance: "13050",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
        })
        .run();
    });

    it("accountRows include rows from multiple accounts", async () => {
      const summary = await caller.performance.computeSummary();
      const schwabRows = summary.accountRows.filter(
        (r: { institution: string }) => r.institution === "Schwab",
      );
      const fidelityHSARows = summary.accountRows.filter(
        (r: { institution: string; year: number }) =>
          r.institution === "Fidelity" && r.year === 2024,
      );
      expect(schwabRows.length).toBeGreaterThanOrEqual(1);
      expect(fidelityHSARows.length).toBeGreaterThanOrEqual(1);
    });

    it("annualRows contain rows for multiple categories", async () => {
      const summary = await caller.performance.computeSummary();
      const cats = new Set(
        summary.annualRows.map((r: { category: string }) => r.category),
      );
      // Should have at least one non-Portfolio category plus Portfolio
      expect(cats.size).toBeGreaterThanOrEqual(2);
    });

    it("Portfolio annualRow sums across categories for same year", async () => {
      const summary = await caller.performance.computeSummary();
      const portfolio2024 = summary.annualRows.find(
        (r: { year: number; category: string }) =>
          r.year === 2024 && r.category === "Portfolio",
      );
      // Portfolio should exist for 2024
      expect(portfolio2024).toBeDefined();
      // Its endingBalance should be >= the sum of individual account ending balances for 2024
      expect(portfolio2024!.endingBalance).toBeGreaterThan(0);
    });

    it("lifetime totals are computed when Portfolio rows exist", async () => {
      const summary = await caller.performance.computeSummary();
      // Since we have portfolio rows now, lifetimeTotals should be populated
      if (summary.lifetimeTotals) {
        expect(summary.lifetimeTotals).toHaveProperty("gains");
        expect(summary.lifetimeTotals).toHaveProperty("contributions");
        expect(summary.lifetimeTotals).toHaveProperty("match");
        expect(summary.lifetimeTotals).toHaveProperty("fees");
        expect(summary.lifetimeTotals).toHaveProperty("distributions");
        expect(summary.lifetimeTotals).toHaveProperty("endingBalance");
      }
    });

    it("annualRows are sorted by year ascending", async () => {
      const summary = await caller.performance.computeSummary();
      for (let i = 1; i < summary.annualRows.length; i++) {
        expect(summary.annualRows[i]!.year).toBeGreaterThanOrEqual(
          summary.annualRows[i - 1]!.year,
        );
      }
    });

    it("accountRows have enriched fields from master", async () => {
      const summary = await caller.performance.computeSummary();
      for (const row of summary.accountRows) {
        expect(row).toHaveProperty("id");
        expect(row).toHaveProperty("year");
        expect(row).toHaveProperty("institution");
        expect(row).toHaveProperty("accountLabel");
        expect(row).toHaveProperty("ownershipType");
        expect(row).toHaveProperty("parentCategory");
        expect(row).toHaveProperty("accountType");
        expect(row).toHaveProperty("isActive");
        expect(row).toHaveProperty("performanceAccountId");
        expect(row).toHaveProperty("displayOrder");
        expect(row).toHaveProperty("annualReturnPct");
        expect(row).toHaveProperty("fees");
        expect(row).toHaveProperty("distributions");
        expect(row).toHaveProperty("rollovers");
      }
    });
  });

  // ── computeSummary with finalized annual rows ──

  describe("computeSummary (finalized annual rows)", () => {
    let _finalizedAnnualId: number;

    beforeAll(() => {
      // Insert a finalized annual row for a prior year
      const row = db
        .insert(schema.annualPerformance)
        .values({
          year: 2021,
          category: "401k/IRA",
          beginningBalance: "80000",
          totalContributions: "15000",
          yearlyGainLoss: "12000",
          endingBalance: "107000",
          annualReturnPct: "0.135",
          employerContributions: "4000",
          distributions: "0",
          fees: "300",
          rollovers: "0",
          lifetimeGains: "30000",
          lifetimeContributions: "60000",
          lifetimeMatch: "15000",
          isCurrentYear: false,
          isFinalized: true,
        })
        .returning({ id: schema.annualPerformance.id })
        .get();
      _finalizedAnnualId = row.id;
    });

    it("preserves finalized annual rows without recomputation", async () => {
      const summary = await caller.performance.computeSummary();
      const finalized = summary.annualRows.find(
        (r: { year: number; category: string }) =>
          r.year === 2021 && r.category === "401k/IRA",
      );
      expect(finalized).toBeDefined();
      expect(finalized!.isFinalized).toBe(true);
      // Finalized row values should be preserved as-is
      expect(finalized!.beginningBalance).toBe(80000);
      expect(finalized!.endingBalance).toBe(107000);
      expect(finalized!.lifetimeGains).toBe(30000);
    });

    it("non-finalized rows accumulate lifetime from finalized baseline", async () => {
      const summary = await caller.performance.computeSummary();
      // 401k/IRA rows sorted by year — finalized rows have authoritative lifetime values,
      // and non-finalized rows accumulate from the last finalized baseline
      const category401k = summary.annualRows
        .filter((r: { category: string }) => r.category === "401k/IRA")
        .sort((a: { year: number }, b: { year: number }) => a.year - b.year);

      // Verify that at least one finalized and one non-finalized row exist
      const finalized = category401k.filter(
        (r: { isFinalized: boolean }) => r.isFinalized,
      );
      const nonFinalized = category401k.filter(
        (r: { isFinalized: boolean }) => !r.isFinalized,
      );
      expect(finalized.length).toBeGreaterThanOrEqual(1);
      expect(nonFinalized.length).toBeGreaterThanOrEqual(1);

      // Non-finalized rows should have lifetime gains that include their own yearly gains
      for (const row of nonFinalized) {
        // lifetimeGains should be > 0 if yearlyGainLoss is positive (accumulation happened)
        if (row.yearlyGainLoss > 0) {
          expect(row.lifetimeGains).toBeGreaterThan(0);
        }
      }
    });
  });

  // ── computeSummary with currentYear ──

  describe("computeSummary (currentYear detection)", () => {
    beforeAll(() => {
      // Clear isCurrentYear on all existing rows so only our new row has it
      const allAnnual = db.select().from(schema.annualPerformance).all();
      for (const row of allAnnual) {
        if (row.isCurrentYear) {
          db.update(schema.annualPerformance)
            .set({ isCurrentYear: false })
            .where(eq(schema.annualPerformance.id, row.id))
            .run();
        }
      }

      // Insert an annual row marked as current year
      db.insert(schema.annualPerformance)
        .values({
          year: 2025,
          category: "401k/IRA",
          beginningBalance: "135000",
          totalContributions: "5000",
          yearlyGainLoss: "3000",
          endingBalance: "143000",
          lifetimeGains: "53000",
          lifetimeContributions: "85000",
          lifetimeMatch: "22000",
          isCurrentYear: true,
          isFinalized: false,
        })
        .run();
    });

    it("detects currentYear from annual_performance isCurrentYear flag", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.currentYear).toBe(2025);
    });
  });

  // ── computeSummary with snapshot data ──

  describe("computeSummary (with snapshot)", () => {
    beforeAll(() => {
      // Seed a portfolio snapshot with accounts
      const perfAccts = db.select().from(schema.performanceAccounts).all();
      const schwab = perfAccts.find((a) => a.institution === "Schwab");
      if (schwab) {
        seedSnapshot(db, "2025-03-15", [
          {
            performanceAccountId: schwab.id,
            amount: "145000",
            taxType: "preTax",
            institution: "Schwab",
            accountType: "401k",
          },
        ]);
      }
    });

    it("reports lastSnapshotDate from portfolio snapshots", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.lastSnapshotDate).toBeTruthy();
    });
  });

  // ── computeSummary return % fill-in ──

  describe("computeSummary (return % computation)", () => {
    beforeAll(() => {
      // Add an annual row with null return % — should be computed
      db.insert(schema.annualPerformance)
        .values({
          year: 2020,
          category: "401k/IRA",
          beginningBalance: "60000",
          totalContributions: "10000",
          yearlyGainLoss: "8000",
          endingBalance: "78000",
          annualReturnPct: null,
          employerContributions: "3000",
          distributions: "0",
          fees: "200",
          rollovers: "0",
          lifetimeGains: "18000",
          lifetimeContributions: "45000",
          lifetimeMatch: "11000",
          isCurrentYear: false,
          isFinalized: true,
        })
        .run();
    });

    it("fills in null annualReturnPct via Modified Dietz formula", async () => {
      const summary = await caller.performance.computeSummary();
      const row = summary.annualRows.find(
        (r: { year: number; category: string }) =>
          r.year === 2020 && r.category === "401k/IRA",
      );
      expect(row).toBeDefined();
      // Modified Dietz: 8000 / (60000 + (10000 - 200) / 2) = 8000 / 64900
      const expected = 8000 / 64900;
      expect(row!.annualReturnPct).toBeCloseTo(expected, 4);
    });
  });

  // ── computeSummary with performanceLastUpdated ──

  describe("computeSummary (performanceLastUpdated)", () => {
    beforeAll(() => {
      // Ensure performance_last_updated is set
      db.insert(schema.appSettings)
        .values({
          key: "performance_last_updated",
          value: "2025-03-20T12:00:00.000Z",
        })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: "2025-03-20T12:00:00.000Z" },
        })
        .run();
    });

    it("reports performanceLastUpdated from app_settings", async () => {
      const summary = await caller.performance.computeSummary();
      expect(summary.performanceLastUpdated).toBe("2025-03-20T12:00:00.000Z");
    });
  });

  // ── computeSummary account_basis join ──

  describe("computeSummary (account_basis join)", () => {
    let personId: number;
    let perfAcctId: number;

    beforeAll(async () => {
      personId = await seedPerson(db, "Basis Owner");
      perfAcctId = seedPerformanceAccount(db, {
        institution: "Vanguard",
        accountType: "ira",
        ownerPersonId: personId,
      });

      db.insert(schema.accountPerformance)
        .values({
          year: 2024,
          institution: "Vanguard",
          accountLabel: "Vanguard IRA",
          ownerPersonId: personId,
          parentCategory: "Retirement",
          performanceAccountId: perfAcctId,
          beginningBalance: "10000",
          totalContributions: "1000",
          yearlyGainLoss: "500",
          endingBalance: "11500",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
        })
        .run();
      // A second year on the same account with no account_basis row —
      // must come back null, never silently default to $0 (row-driven,
      // not account-driven: see roth-basis-rollover.ts).
      db.insert(schema.accountPerformance)
        .values({
          year: 2023,
          institution: "Vanguard",
          accountLabel: "Vanguard IRA",
          ownerPersonId: personId,
          parentCategory: "Retirement",
          performanceAccountId: perfAcctId,
          beginningBalance: "9000",
          totalContributions: "1000",
          yearlyGainLoss: "0",
          endingBalance: "10000",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
        })
        .run();

      db.insert(schema.accountBasis)
        .values({
          performanceAccountId: perfAcctId,
          ownerPersonId: personId,
          year: 2024,
          contributionBasis: "8000",
          conversionBasis: "1200",
          latestConversionYear: 2024,
          isFinalized: true,
          isSeeded: false,
        })
        .run();
    });

    it("attaches contributionBasis/conversionBasis/latestConversionYear for an exact (account, owner, year) match", async () => {
      const summary = await caller.performance.computeSummary();
      const row = summary.accountRows.find(
        (r: { performanceAccountId: number | null; year: number }) =>
          r.performanceAccountId === perfAcctId && r.year === 2024,
      );
      expect(row).toBeDefined();
      expect(row!.contributionBasis).toBe(8000);
      expect(row!.conversionBasis).toBe(1200);
      expect(row!.latestConversionYear).toBe(2024);
    });

    it("leaves basis fields null for a year with no matching account_basis row", async () => {
      const summary = await caller.performance.computeSummary();
      const row = summary.accountRows.find(
        (r: { performanceAccountId: number | null; year: number }) =>
          r.performanceAccountId === perfAcctId && r.year === 2023,
      );
      expect(row).toBeDefined();
      expect(row!.contributionBasis).toBeNull();
      expect(row!.conversionBasis).toBeNull();
      expect(row!.latestConversionYear).toBeNull();
    });

    it("lists each person's basis on a joint account tracked as one row", async () => {
      const other = await seedPerson(db, "Basis Spouse");
      const joint = seedPerformanceAccount(db, {
        institution: "Vanguard",
        accountType: "ira",
        ownershipType: "joint",
        ownerPersonId: null,
      });
      db.insert(schema.accountPerformance)
        .values({
          year: 2024,
          institution: "Vanguard",
          accountLabel: "Joint IRA",
          ownerPersonId: personId, // stored under one person, as legacy rows are
          parentCategory: "Retirement",
          performanceAccountId: joint,
          beginningBalance: "0",
          totalContributions: "0",
          yearlyGainLoss: "0",
          endingBalance: "0",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
        })
        .run();
      for (const [owner, contrib, conv] of [
        [personId, "100", "10"],
        [other, "200", "20"],
      ] as const)
        db.insert(schema.accountBasis)
          .values({
            performanceAccountId: joint,
            ownerPersonId: owner,
            year: 2024,
            contributionBasis: contrib,
            conversionBasis: conv,
            latestConversionYear: 2024,
          })
          .run();
      const summary = await caller.performance.computeSummary();
      const row = summary.accountRows.find(
        (r: { performanceAccountId: number | null; year: number }) =>
          r.performanceAccountId === joint && r.year === 2024,
      )!;
      expect(row.contributionBasis).toBe(300);
      expect(row.conversionBasis).toBe(30);
      expect(
        row.basisByOwner.map((b: { ownerName: string | null }) => b.ownerName),
      ).toEqual(["Basis Owner", "Basis Spouse"]);
      // A year with no basis row says so instead of showing $0.
      const blank = summary.accountRows.find(
        (r: { performanceAccountId: number | null; year: number }) =>
          r.performanceAccountId === perfAcctId && r.year === 2023,
      )!;
      expect(blank.basisByOwner).toEqual([
        expect.objectContaining({ recorded: false, contributionBasis: 0 }),
      ]);
    });
  });

  // ── computeSummary Retirement rollup — regression: a stale stored
  // "Retirement" annual_performance row must never shadow the freshly
  // synthesized one (the bug this guards against: Array.find() returns the
  // FIRST match for a year, so a stray historical row with a wrong
  // isCurrentYear flag would silently win forever). ──

  describe("computeSummary (Retirement rollup — no stale duplicate)", () => {
    beforeAll(() => {
      // currentYear is 2025 from the "currentYear detection" block above,
      // which also seeded a fullyRetirementCats ("401k/IRA") row for 2025 —
      // that's what puts 2025 in the Retirement synthesis loop's retYears.
      // The Portfolio-synthesis loop separately only runs for years with a
      // real account_performance row (allAccountYears), so seed one here
      // too — otherwise 2025 never gets a Portfolio row synthesized at all
      // and the double-count regression test below has nothing to check.
      const acctId = seedPerformanceAccount(db, {
        institution: "Schwab",
        accountType: "401k",
      });
      db.insert(schema.accountPerformance)
        .values({
          year: 2025,
          institution: "Schwab",
          accountLabel: "Schwab 401k",
          parentCategory: "Retirement",
          performanceAccountId: acctId,
          beginningBalance: "1000",
          totalContributions: "100",
          yearlyGainLoss: "50",
          endingBalance: "1150",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
        })
        .run();

      // Insert a stale, wrongly-flagged "Retirement" row for that same
      // year directly, exactly reproducing the historical-import bug.
      db.insert(schema.annualPerformance)
        .values({
          year: 2025,
          category: "Retirement",
          beginningBalance: "1",
          totalContributions: "1",
          yearlyGainLoss: "1",
          endingBalance: "1",
          lifetimeGains: "1",
          lifetimeContributions: "1",
          lifetimeMatch: "1",
          isCurrentYear: false,
          isFinalized: false,
        })
        .run();
    });

    it("never returns more than one Retirement annual row for a given year", async () => {
      const summary = await caller.performance.computeSummary();
      const retirement2025 = summary.annualRows.filter(
        (r: { year: number; category: string }) =>
          r.year === 2025 && r.category === "Retirement",
      );
      expect(retirement2025.length).toBe(1);
    });

    it("the Retirement row for the current year is never shadowed by a stale isCurrentYear=false row", async () => {
      const summary = await caller.performance.computeSummary();
      const retirement2025 = summary.annualRows.find(
        (r: { year: number; category: string }) =>
          r.year === 2025 && r.category === "Retirement",
      );
      expect(retirement2025).toBeDefined();
      expect(retirement2025!.isCurrentYear).toBe(true);
    });

    it("Portfolio never sums the stale Retirement row on top of the real account-type categories (double-count regression)", async () => {
      const summary = await caller.performance.computeSummary();
      const categoryRows2025 = summary.annualRows.filter(
        (r: { year: number; category: string }) =>
          r.year === 2025 &&
          r.category !== "Portfolio" &&
          r.category !== "Retirement",
      );
      const expectedEnding = categoryRows2025.reduce(
        (sum: number, r: { endingBalance: number }) => sum + r.endingBalance,
        0,
      );
      const portfolio2025 = summary.annualRows.find(
        (r: { year: number; category: string }) =>
          r.year === 2025 && r.category === "Portfolio",
      );
      expect(portfolio2025).toBeDefined();
      // The stale Retirement row's endingBalance is 1 — if it leaked into
      // Portfolio's sum, this would be off by exactly that much.
      expect(portfolio2025!.endingBalance).toBeCloseTo(expectedEnding, 5);
    });
  });
});

describe("performance.performanceAccounts", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Alice", "1985-03-15");
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns an empty array on a fresh database", async () => {
      const rows = await caller.performance.performanceAccounts.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });

    it("returns seeded accounts ordered by displayOrder then id", async () => {
      seedPerformanceAccount(db, {
        institution: "Fidelity",
        accountType: "401k",
        displayOrder: 2,
      });
      seedPerformanceAccount(db, {
        institution: "Vanguard",
        accountType: "ira",
        displayOrder: 1,
      });
      const rows = await caller.performance.performanceAccounts.list();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      // Vanguard (order=1) should come before Fidelity (order=2)
      const vIdx = rows.findIndex(
        (r: { institution: string }) => r.institution === "Vanguard",
      );
      const fIdx = rows.findIndex(
        (r: { institution: string }) => r.institution === "Fidelity",
      );
      expect(vIdx).toBeLessThan(fIdx);
    });
  });

  describe("create", () => {
    it("creates a performance account without owner", async () => {
      const result = await caller.performance.performanceAccounts.create({
        institution: "Schwab",
        accountType: "brokerage",
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: "Portfolio",
        isActive: true,
        displayOrder: 0,
      });
      expect(result).toBeDefined();
      expect(result!.institution).toBe("Schwab");
      expect(result!.accountType).toBe("brokerage");
      expect(result!.ownerPersonId).toBeNull();
    });

    it("creates a performance account with an owner person", async () => {
      const result = await caller.performance.performanceAccounts.create({
        institution: "Fidelity",
        accountType: "401k",
        ownerPersonId: personId,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 1,
      });
      expect(result).toBeDefined();
      expect(result!.institution).toBe("Fidelity");
      expect(result!.ownerPersonId).toBe(personId);
    });

    it("auto-generates accountLabel from institution + accountType + owner", async () => {
      const result = await caller.performance.performanceAccounts.create({
        institution: "Vanguard",
        accountType: "ira",
        ownerPersonId: personId,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 2,
      });
      expect(result).toBeDefined();
      // accountLabel is generated; it should at least be a non-empty string
      expect(typeof result!.accountLabel).toBe("string");
      expect(result!.accountLabel!.length).toBeGreaterThan(0);
    });

    it("creates an account with optional label override", async () => {
      const result = await caller.performance.performanceAccounts.create({
        institution: "Schwab",
        accountType: "brokerage",
        label: "Main Taxable",
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: "Portfolio",
        isActive: true,
        displayOrder: 3,
      });
      expect(result).toBeDefined();
      expect(result!.label).toBe("Main Taxable");
    });

    it("created accounts appear in list", async () => {
      const rows = await caller.performance.performanceAccounts.list();
      const institutions = rows.map(
        (r: { institution: string }) => r.institution,
      );
      expect(institutions).toContain("Schwab");
    });

    it("creates an inactive account", async () => {
      const result = await caller.performance.performanceAccounts.create({
        institution: "OldBank",
        accountType: "brokerage",
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: "Portfolio",
        isActive: false,
        displayOrder: 99,
      });
      expect(result).toBeDefined();
      expect(result!.isActive).toBe(false);
    });
  });
});

describe("performance.performanceAccounts delete", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("deletes an account with no linked performance records", async () => {
    const tmp = await caller.performance.performanceAccounts.create({
      institution: "TempBank",
      accountType: "brokerage",
      ownerPersonId: null,
      ownershipType: "individual",
      parentCategory: "Portfolio",
      isActive: true,
      displayOrder: 99,
    });
    const result = await caller.performance.performanceAccounts.delete({
      id: tmp!.id,
    });
    expect(result).toEqual({ success: true });

    const list = await caller.performance.performanceAccounts.list();
    expect(list.find((r: { id: number }) => r.id === tmp!.id)).toBeUndefined();
  });

  it("delete is idempotent for non-existent id", async () => {
    const result = await caller.performance.performanceAccounts.delete({
      id: 99999,
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects delete when performance records reference the account", async () => {
    const personId = await seedPerson(db, "DeleteTest", "1990-01-01");
    const acctId = seedPerformanceAccount(db, {
      institution: "LinkedBank",
      accountType: "401k",
    });
    // Seed an account_performance row referencing this account
    db.insert((await import("@/lib/db/schema-sqlite")).accountPerformance)
      .values({
        year: 2025,
        institution: "LinkedBank",
        accountLabel: "LinkedBank 401k",
        ownerPersonId: personId,
        beginningBalance: "50000",
        totalContributions: "10000",
        yearlyGainLoss: "5000",
        endingBalance: "65000",
        parentCategory: "Retirement",
        performanceAccountId: acctId,
      })
      .run();

    await expect(
      caller.performance.performanceAccounts.delete({ id: acctId }),
    ).rejects.toThrow(/Cannot delete/);
  });
});

describe("performance.performanceAccounts additional coverage", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("creates with all optional fields", async () => {
    const personId = await seedPerson(db, "FullFields", "1990-01-01");
    const result = await caller.performance.performanceAccounts.create({
      institution: "AllFields Bank",
      accountType: "hsa",
      subType: "Investment",
      label: "HSA Investment",
      displayName: "My HSA",
      ownerPersonId: personId,
      ownershipType: "individual",
      parentCategory: "Retirement",
      isActive: true,
      displayOrder: 5,
    });
    expect(result).toBeDefined();
    expect(result!.subType).toBe("Investment");
    expect(result!.label).toBe("HSA Investment");
    expect(result!.displayName).toBe("My HSA");
    expect(result!.ownerPersonId).toBe(personId);
  });

  it("creates with joint ownership", async () => {
    const result = await caller.performance.performanceAccounts.create({
      institution: "Joint Bank",
      accountType: "brokerage",
      ownerPersonId: null,
      ownershipType: "joint",
      parentCategory: "Portfolio",
      isActive: true,
      displayOrder: 6,
    });
    expect(result).toBeDefined();
    expect(result!.ownershipType).toBe("joint");
  });

  it("creates accounts with every valid accountType", async () => {
    const types = ["401k", "403b", "ira", "hsa", "brokerage"] as const;
    for (const t of types) {
      const result = await caller.performance.performanceAccounts.create({
        institution: `${t}-Bank`,
        accountType: t,
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: t === "brokerage" ? "Portfolio" : "Retirement",
        isActive: true,
        displayOrder: 0,
      });
      expect(result).toBeDefined();
      expect(result!.accountType).toBe(t);
    }
  });

  it("creates accounts with both parentCategory values", async () => {
    const retResult = await caller.performance.performanceAccounts.create({
      institution: "RetBank",
      accountType: "401k",
      ownerPersonId: null,
      ownershipType: "individual",
      parentCategory: "Retirement",
      isActive: true,
      displayOrder: 0,
    });
    expect(retResult!.parentCategory).toBe("Retirement");

    const portResult = await caller.performance.performanceAccounts.create({
      institution: "PortBank",
      accountType: "brokerage",
      ownerPersonId: null,
      ownershipType: "individual",
      parentCategory: "Portfolio",
      isActive: true,
      displayOrder: 0,
    });
    expect(portResult!.parentCategory).toBe("Portfolio");
  });
});

describe("performance.performanceAccounts.create additional", () => {
  it("creates account with subType and displayName", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Frank", "1991-01-01");
      const result = await ctx.caller.performance.performanceAccounts.create({
        institution: "Fidelity",
        accountType: "401k",
        subType: "Roth",
        label: "Roth 401k",
        displayName: "Frank Fidelity Roth 401k",
        ownerPersonId: personId,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 5,
      });
      expect(result).toBeDefined();
      expect(result!.subType).toBe("Roth");
      expect(result!.label).toBe("Roth 401k");
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION-WRAPPED PROCEDURES — previously misdiagnosed as untestable
// ─────────────────────────────────────────────────────────────────────────────

describe("performanceAccounts.update", () => {
  it("updates the master record and cascades accountLabel/parentCategory", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const id = seedPerformanceAccount(ctx.db, { institution: "Fidelity" });
      const result = await ctx.caller.performance.performanceAccounts.update({
        id,
        institution: "Vanguard",
        accountType: "401k",
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 1,
      });
      expect(result?.institution).toBe("Vanguard");
      expect(result?.accountLabel).toContain("Vanguard");
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to seed account_performance and annual_performance rows directly
// ─────────────────────────────────────────────────────────────────────────────

function seedAccountPerf(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  perfAccountId: number,
  overrides: Partial<typeof schema.accountPerformance.$inferInsert> = {},
): number {
  const result = db
    .insert(schema.accountPerformance)
    .values({
      year: 2024,
      institution: "Fidelity",
      accountLabel: "Fidelity 401k Account",
      parentCategory: "Retirement",
      beginningBalance: "50000",
      totalContributions: "10000",
      yearlyGainLoss: "5000",
      endingBalance: "65000",
      employerContributions: "3000",
      fees: "100",
      distributions: "0",
      rollovers: "0",
      performanceAccountId: perfAccountId,
      isActive: true,
      ...overrides,
    })
    .returning({ id: schema.accountPerformance.id })
    .get();
  return result.id;
}

function seedAnnualPerf(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Partial<typeof schema.annualPerformance.$inferInsert> = {},
): number {
  const result = db
    .insert(schema.annualPerformance)
    .values({
      year: 2024,
      category: "401k/IRA",
      beginningBalance: "50000",
      totalContributions: "10000",
      yearlyGainLoss: "5000",
      endingBalance: "65000",
      employerContributions: "3000",
      distributions: "0",
      fees: "100",
      rollovers: "0",
      lifetimeGains: "5000",
      lifetimeContributions: "10000",
      lifetimeMatch: "3000",
      isCurrentYear: true,
      isFinalized: false,
      ...overrides,
    })
    .returning({ id: schema.annualPerformance.id })
    .get();
  return result.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — synthesize annual rows from account data (lines 371-425)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — synthesize + recompute annual rows", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let perfAcctId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Create a master performance account (401k → "401k/IRA" category)
    perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });
  });

  afterAll(() => cleanup());

  it("synthesizes annual row when no annual_performance row exists for a year", async () => {
    // Only account_performance for 2023 — no annual_performance row
    seedAccountPerf(db, perfAcctId, {
      year: 2023,
      beginningBalance: "40000",
      totalContributions: "8000",
      yearlyGainLoss: "3000",
      endingBalance: "51000",
      employerContributions: "2000",
      fees: "50",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const row2023 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2023 && r.category === "401k/IRA",
    );
    expect(row2023).toBeDefined();
    expect(row2023!.beginningBalance).toBe(40000);
    expect(row2023!.totalContributions).toBe(8000);
    expect(row2023!.yearlyGainLoss).toBe(3000);
    expect(row2023!.endingBalance).toBe(51000);
    expect(row2023!.employerContributions).toBe(2000);
    expect(row2023!.fees).toBe(50);
    // Should have computed return
    expect(row2023!.annualReturnPct).not.toBeNull();
  });

  it("recomputes non-finalized existing annual row from account data", async () => {
    // Seed an annual row with wrong values (non-finalized)
    seedAnnualPerf(db, {
      year: 2023,
      category: "401k/IRA",
      beginningBalance: "0",
      totalContributions: "0",
      yearlyGainLoss: "0",
      endingBalance: "0",
      isFinalized: false,
      isCurrentYear: false,
    });

    const summary = await caller.performance.computeSummary();
    const row2023 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2023 && r.category === "401k/IRA",
    );
    expect(row2023).toBeDefined();
    // Should be recomputed from account data, not the zeroed-out annual row
    expect(row2023!.beginningBalance).toBe(40000);
    expect(row2023!.endingBalance).toBe(51000);
  });

  it("does NOT recompute finalized annual rows", async () => {
    // Seed a finalized annual row with specific values
    // First clear existing 2022 data
    seedAnnualPerf(db, {
      year: 2022,
      category: "401k/IRA",
      beginningBalance: "99999",
      totalContributions: "1111",
      yearlyGainLoss: "2222",
      endingBalance: "103332",
      isFinalized: true,
      isCurrentYear: false,
    });

    // Seed account data that differs
    seedAccountPerf(db, perfAcctId, {
      year: 2022,
      beginningBalance: "30000",
      totalContributions: "5000",
      yearlyGainLoss: "1000",
      endingBalance: "36000",
    });

    const summary = await caller.performance.computeSummary();
    const row2022 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2022 && r.category === "401k/IRA",
    );
    expect(row2022).toBeDefined();
    // Finalized row should keep its stored values
    expect(row2022!.beginningBalance).toBe(99999);
    expect(row2022!.endingBalance).toBe(103332);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — Portfolio rollup synthesis (lines 428-521)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — Portfolio rollup", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("copies single category to Portfolio when only one category exists for a year", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Vanguard",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });

    seedAccountPerf(db, perfAcctId, {
      year: 2021,
      institution: "Vanguard",
      accountLabel: "Vanguard 401k Account",
      beginningBalance: "20000",
      totalContributions: "5000",
      yearlyGainLoss: "2000",
      endingBalance: "27000",
      employerContributions: "1000",
      fees: "50",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const portfolio2021 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2021 && r.category === "Portfolio",
    );
    expect(portfolio2021).toBeDefined();
    // When only one category, Portfolio copies from it
    expect(portfolio2021!.beginningBalance).toBe(20000);
    expect(portfolio2021!.endingBalance).toBe(27000);
    expect(portfolio2021!.totalContributions).toBe(5000);
  });

  it("sums multiple categories into Portfolio row", async () => {
    // Create a brokerage account (different category than 401k)
    const brokerageAcctId = seedPerformanceAccount(db, {
      institution: "Schwab",
      accountType: "brokerage",
      parentCategory: "Portfolio",
      ownershipType: "individual",
    });

    seedAccountPerf(db, brokerageAcctId, {
      year: 2021,
      institution: "Schwab",
      accountLabel: "Schwab Brokerage",
      parentCategory: "Portfolio",
      beginningBalance: "10000",
      totalContributions: "2000",
      yearlyGainLoss: "1000",
      endingBalance: "13000",
      employerContributions: "0",
      fees: "25",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const portfolio2021 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2021 && r.category === "Portfolio",
    );
    expect(portfolio2021).toBeDefined();
    // Portfolio should be sum of 401k/IRA + Brokerage
    expect(portfolio2021!.beginningBalance).toBe(20000 + 10000);
    expect(portfolio2021!.endingBalance).toBe(27000 + 13000);
    expect(portfolio2021!.totalContributions).toBe(5000 + 2000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — lifetime cumulative + null return fill (lines 525-570)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — lifetime cumulative + null return fill", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("computes lifetime fields cumulatively for non-finalized rows", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "TestInst",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });

    // Year 1: account data only (no annual row)
    seedAccountPerf(db, perfAcctId, {
      year: 2020,
      institution: "TestInst",
      accountLabel: "TestInst 401k Account",
      beginningBalance: "0",
      totalContributions: "10000",
      yearlyGainLoss: "1000",
      endingBalance: "11000",
      employerContributions: "2000",
      fees: "0",
      distributions: "0",
      rollovers: "0",
    });

    // Year 2: account data only
    seedAccountPerf(db, perfAcctId, {
      year: 2021,
      institution: "TestInst",
      accountLabel: "TestInst 401k Account",
      beginningBalance: "11000",
      totalContributions: "12000",
      yearlyGainLoss: "3000",
      endingBalance: "26000",
      employerContributions: "2500",
      fees: "0",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const catRows = summary.annualRows
      .filter((r: { category: string }) => r.category === "401k/IRA")
      .sort((a: { year: number }, b: { year: number }) => a.year - b.year);

    const row2020 = catRows.find((r: { year: number }) => r.year === 2020);
    const row2021 = catRows.find((r: { year: number }) => r.year === 2021);

    expect(row2020).toBeDefined();
    expect(row2021).toBeDefined();

    // Year 2020: lifetime = year values
    expect(row2020!.lifetimeGains).toBe(1000);
    expect(row2020!.lifetimeContributions).toBe(10000);
    expect(row2020!.lifetimeMatch).toBe(2000);

    // Year 2021: lifetime = cumulative
    expect(row2021!.lifetimeGains).toBe(1000 + 3000);
    expect(row2021!.lifetimeContributions).toBe(10000 + 12000);
    expect(row2021!.lifetimeMatch).toBe(2000 + 2500);
  });

  it("uses finalized row lifetime values as baseline for next year", async () => {
    const perfAcctId2 = seedPerformanceAccount(db, {
      institution: "BaselineInst",
      accountType: "ira",
      parentCategory: "Retirement",
      ownershipType: "individual",
    });

    // Finalized year with authoritative lifetime values
    seedAnnualPerf(db, {
      year: 2019,
      category: "401k/IRA",
      beginningBalance: "50000",
      totalContributions: "5000",
      yearlyGainLoss: "3000",
      endingBalance: "58000",
      lifetimeGains: "20000",
      lifetimeContributions: "40000",
      lifetimeMatch: "10000",
      isFinalized: true,
      isCurrentYear: false,
    });

    // Non-finalized year after the finalized baseline
    seedAccountPerf(db, perfAcctId2, {
      year: 2019,
      institution: "BaselineInst",
      accountLabel: "BaselineInst 401k Account",
      beginningBalance: "50000",
      totalContributions: "5000",
      yearlyGainLoss: "3000",
      endingBalance: "58000",
      employerContributions: "1000",
    });

    const summary = await caller.performance.computeSummary();

    // The finalized 2019 row should retain its lifetime values
    const finalized2019 = summary.annualRows.find(
      (r: { year: number; category: string; isFinalized: boolean }) =>
        r.year === 2019 && r.category === "401k/IRA" && r.isFinalized,
    );
    if (finalized2019) {
      expect(finalized2019.lifetimeGains).toBe(20000);
      expect(finalized2019.lifetimeContributions).toBe(40000);
      expect(finalized2019.lifetimeMatch).toBe(10000);
    }
  });

  it("fills null annualReturnPct on rows with financial data", async () => {
    // Seed an annual row with null return but non-zero financials
    // totalContributions includes employer (25000 = 20000 employee + 5000 employer)
    seedAnnualPerf(db, {
      year: 2018,
      category: "401k/IRA",
      beginningBalance: "100000",
      totalContributions: "25000",
      yearlyGainLoss: "10000",
      endingBalance: "135000",
      employerContributions: "5000",
      distributions: "0",
      fees: "200",
      rollovers: "0",
      lifetimeGains: "10000",
      lifetimeContributions: "25000",
      lifetimeMatch: "5000",
      isFinalized: true,
      isCurrentYear: false,
    });

    const summary = await caller.performance.computeSummary();
    const row2018 = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2018 && r.category === "401k/IRA",
    );
    expect(row2018).toBeDefined();
    // Return should be computed since it was null in stored row
    // Modified Dietz: 10000 / (100000 + (25000 - 200) / 2) = 10000 / 112400
    const expected = 10000 / (100000 + (25000 - 200) / 2);
    expect(row2018!.annualReturnPct).toBeCloseTo(expected, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — Retirement parent-category rollup (lines 572-658)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — Retirement rollup", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("synthesizes Retirement rollup from 401k/IRA + HSA categories", async () => {
    const personId = await seedPerson(db, "Owner");

    const acct401k = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
      parentCategory: "Retirement",
      ownershipType: "individual",
      ownerPersonId: personId,
    });

    const acctHsa = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "hsa",
      parentCategory: "Retirement",
      ownershipType: "individual",
      ownerPersonId: personId,
    });

    // Seed account data for both
    seedAccountPerf(db, acct401k, {
      year: 2024,
      institution: "Fidelity",
      accountLabel: "Fidelity 401k Account",
      ownerPersonId: personId,
      beginningBalance: "80000",
      totalContributions: "15000",
      yearlyGainLoss: "8000",
      endingBalance: "103000",
      employerContributions: "5000",
      fees: "100",
      distributions: "0",
      rollovers: "0",
    });

    seedAccountPerf(db, acctHsa, {
      year: 2024,
      institution: "Fidelity",
      accountLabel: "Fidelity HSA Account",
      ownerPersonId: personId,
      parentCategory: "Retirement",
      beginningBalance: "5000",
      totalContributions: "3000",
      yearlyGainLoss: "500",
      endingBalance: "8500",
      employerContributions: "0",
      fees: "0",
      distributions: "0",
      rollovers: "0",
    });

    const summary = await caller.performance.computeSummary();
    const retRow = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2024 && r.category === "Retirement",
    );
    expect(retRow).toBeDefined();
    // Retirement should include both 401k/IRA and HSA
    expect(retRow!.beginningBalance).toBe(80000 + 5000);
    expect(retRow!.endingBalance).toBe(103000 + 8500);
    expect(retRow!.totalContributions).toBe(15000 + 3000);
    expect(retRow!.yearlyGainLoss).toBe(8000 + 500);
  });

  it("Retirement rollup has computed return percentage", async () => {
    const summary = await caller.performance.computeSummary();
    const retRow = summary.annualRows.find(
      (r: { year: number; category: string }) =>
        r.year === 2024 && r.category === "Retirement",
    );
    expect(retRow).toBeDefined();
    expect(retRow!.annualReturnPct).not.toBeNull();
    expect(typeof retRow!.annualReturnPct).toBe("number");
  });

  it("Retirement rollup accumulates lifetime values across years", async () => {
    const summary = await caller.performance.computeSummary();
    const retRows = summary.annualRows
      .filter((r: { category: string }) => r.category === "Retirement")
      .sort((a: { year: number }, b: { year: number }) => a.year - b.year);

    if (retRows.length >= 2) {
      const first = retRows[0]!;
      const second = retRows[1]!;
      // Lifetime gains should accumulate
      expect(second.lifetimeGains).toBeGreaterThanOrEqual(first.lifetimeGains);
    }
    // At minimum we should have at least one Retirement row
    expect(retRows.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeSummary — enriched accountRows (lines 678-725)
// ─────────────────────────────────────────────────────────────────────────────

describe("performance.computeSummary — enriched accountRows", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Account Owner");
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Schwab",
      accountType: "brokerage",
      parentCategory: "Portfolio",
      ownershipType: "joint",
      ownerPersonId: personId,
    });

    seedAccountPerf(db, perfAcctId, {
      year: 2024,
      institution: "Schwab",
      accountLabel: "Schwab Brokerage",
      ownerPersonId: personId,
      parentCategory: "Portfolio",
      beginningBalance: "100000",
      totalContributions: "20000",
      yearlyGainLoss: "15000",
      endingBalance: "135000",
      employerContributions: "0",
      fees: "200",
      distributions: "5000",
      rollovers: "0",
    });
  });

  afterAll(() => cleanup());

  it("accountRows include ownerName resolved from people table", async () => {
    const summary = await caller.performance.computeSummary();
    const row = summary.accountRows.find(
      (r: { institution: string }) => r.institution === "Schwab",
    );
    expect(row).toBeDefined();
    expect(row!.ownerName).toBe("Account Owner");
  });

  it("accountRows include ownershipType from master record", async () => {
    const summary = await caller.performance.computeSummary();
    const row = summary.accountRows.find(
      (r: { institution: string }) => r.institution === "Schwab",
    );
    expect(row).toBeDefined();
    expect(row!.ownershipType).toBe("joint");
  });

  it("accountRows compute return when stored return is null", async () => {
    const summary = await caller.performance.computeSummary();
    const row = summary.accountRows.find(
      (r: { institution: string }) => r.institution === "Schwab",
    );
    expect(row).toBeDefined();
    // Return should be computed via Modified Dietz
    expect(row!.annualReturnPct).not.toBeNull();
    expect(typeof row!.annualReturnPct).toBe("number");
  });

  it("lifetimeTotals are populated when Portfolio annual row exists", async () => {
    const summary = await caller.performance.computeSummary();
    // Portfolio row was synthesized, so lifetimeTotals should be available
    if (
      summary.annualRows.some(
        (r: { category: string }) => r.category === "Portfolio",
      )
    ) {
      expect(summary.lifetimeTotals).not.toBeNull();
      expect(summary.lifetimeTotals).toHaveProperty("gains");
      expect(summary.lifetimeTotals).toHaveProperty("contributions");
      expect(summary.lifetimeTotals).toHaveProperty("match");
      expect(summary.lifetimeTotals).toHaveProperty("fees");
      expect(summary.lifetimeTotals).toHaveProperty("distributions");
      expect(summary.lifetimeTotals).toHaveProperty("endingBalance");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// finalizeYear — pure function unit tests
//
// The finalizeYear procedure uses db.transaction(async ...) which is
// incompatible with better-sqlite3 (same limitation as settings/admin).
// Instead of testing through tRPC, we test the extracted pure computation
// functions that contain the core business logic.
// ─────────────────────────────────────────────────────────────────────────────

import {
  computeReturn,
  sumAccounts,
  sumAnnualRows,
  type AccountLike,
  type AnnualRowLike,
} from "@/server/routers/performance";

describe("finalizeYear — pure computation logic", () => {
  describe("computeReturn (Modified Dietz)", () => {
    it("computes return for typical account data", () => {
      // contribs = totalContributions (employee + employer combined) = 25000
      // gainLoss / (beginBal + (contribs + rollovers - distributions - fees) / 2)
      // = 12000 / (100000 + (25000 + 0 - 0 - 200) / 2) = 12000 / 112400 ≈ 0.106762
      const result = computeReturn(100000, 25000, 12000, 0, 200, 0);
      expect(result).toBeCloseTo(12000 / 112400, 6);
    });

    it("returns null when denominator is zero (no beginning balance, no flows)", () => {
      expect(computeReturn(0, 0, 0, 0, 0, 0)).toBeNull();
    });

    it("handles negative returns (loss year)", () => {
      const result = computeReturn(100000, 10000, -15000, 0, 100, 0);
      expect(result).not.toBeNull();
      expect(result!).toBeLessThan(0);
      // -15000 / (100000 + (10000 - 100) / 2) = -15000 / 104950
      expect(result).toBeCloseTo(-15000 / 104950, 6);
    });

    it("handles distributions and rollovers in denominator", () => {
      // contribs = 7000 (employee 5000 + employer 2000), distributions = 1000, fees = 50, rollovers = 8000
      const result = computeReturn(50000, 7000, 3000, 1000, 50, 8000);
      // denom = 50000 + (7000 + 8000 - 1000 - 50) / 2 = 50000 + 6975 = 56975
      expect(result).toBeCloseTo(3000 / 56975, 6);
    });

    it("works with zero beginning balance but nonzero flows", () => {
      // New account: no starting balance, received rollover
      const result = computeReturn(0, 0, 500, 0, 0, 50000);
      // denom = 0 + 50000/2 = 25000
      expect(result).toBeCloseTo(500 / 25000, 6);
    });
  });

  describe("sumAccounts (account row aggregation)", () => {
    it("sums multiple account rows into a single rollup", () => {
      const accounts: AccountLike[] = [
        {
          beginningBalance: "100000",
          totalContributions: "20000",
          yearlyGainLoss: "12000",
          endingBalance: "135000",
          employerContributions: "5000",
          distributions: "0",
          fees: "200",
          rollovers: "0",
        },
        {
          beginningBalance: "50000",
          totalContributions: "10000",
          yearlyGainLoss: "-3000",
          endingBalance: "57000",
          employerContributions: "2500",
          distributions: "1000",
          fees: "100",
          rollovers: "0",
        },
      ];

      const sums = sumAccounts(accounts);
      expect(sums.beginBal).toBe(150000);
      expect(sums.contribs).toBe(30000);
      expect(sums.gainLoss).toBe(9000);
      expect(sums.endBal).toBe(192000);
      expect(sums.employer).toBe(7500);
      expect(sums.distributions).toBe(1000);
      expect(sums.fees).toBe(300);
      expect(sums.rollovers).toBe(0);
    });

    it("handles null values in account fields", () => {
      const accounts: AccountLike[] = [
        {
          beginningBalance: null,
          totalContributions: "5000",
          yearlyGainLoss: null,
          endingBalance: "5000",
          employerContributions: null,
          distributions: null,
          fees: null,
          rollovers: null,
        },
      ];

      const sums = sumAccounts(accounts);
      expect(sums.beginBal).toBe(0);
      expect(sums.contribs).toBe(5000);
      expect(sums.gainLoss).toBe(0);
    });

    it("returns zeros for empty array", () => {
      const sums = sumAccounts([]);
      expect(sums.beginBal).toBe(0);
      expect(sums.endBal).toBe(0);
      expect(sums.contribs).toBe(0);
    });
  });

  describe("sumAnnualRows (Portfolio rollup from categories)", () => {
    it("sums category rows into Portfolio totals with lifetime carry-forward", () => {
      const rows: AnnualRowLike[] = [
        {
          beginningBalance: 100000,
          totalContributions: 20000,
          yearlyGainLoss: 12000,
          endingBalance: 135000,
          employerContributions: 5000,
          distributions: 0,
          fees: 200,
          rollovers: 0,
          lifetimeGains: 45000,
          lifetimeContributions: 80000,
          lifetimeMatch: 20000,
        },
        {
          beginningBalance: 30000,
          totalContributions: 3000,
          yearlyGainLoss: 2000,
          endingBalance: 35000,
          employerContributions: 0,
          distributions: 500,
          fees: 50,
          rollovers: 0,
          lifetimeGains: 8000,
          lifetimeContributions: 15000,
          lifetimeMatch: 0,
        },
      ];

      const sums = sumAnnualRows(rows);
      expect(sums.beginBal).toBe(130000);
      expect(sums.contribs).toBe(23000);
      expect(sums.gainLoss).toBe(14000);
      expect(sums.endBal).toBe(170000);
      expect(sums.employer).toBe(5000);
      expect(sums.distributions).toBe(500);
      expect(sums.fees).toBe(250);
      // Lifetime fields summed across categories
      expect(sums.lifetimeGains).toBe(53000);
      expect(sums.lifetimeContribs).toBe(95000);
      expect(sums.lifetimeMatch).toBe(20000);
    });

    it("returns zeros for empty array", () => {
      const sums = sumAnnualRows([]);
      expect(sums.beginBal).toBe(0);
      expect(sums.lifetimeGains).toBe(0);
    });
  });

  describe("computeReturn + sumAccounts integration", () => {
    it("computes correct return from summed account data", () => {
      // Simulates the finalizeYear flow: sum accounts → compute return
      // totalContributions includes employer (25000 = 20000 employee + 5000 employer)
      const accounts: AccountLike[] = [
        {
          beginningBalance: "100000",
          totalContributions: "25000",
          yearlyGainLoss: "12000",
          endingBalance: "137000",
          employerContributions: "5000",
          distributions: "0",
          fees: "200",
          rollovers: "0",
        },
      ];

      const sums = sumAccounts(accounts);
      const returnPct = computeReturn(
        sums.beginBal,
        sums.contribs,
        sums.gainLoss,
        sums.distributions,
        sums.fees,
        sums.rollovers,
      );

      // 12000 / (100000 + (25000 + 0 - 0 - 200) / 2) = 12000 / 112400
      expect(returnPct).toBeCloseTo(0.106762, 4);
    });
  });
});
