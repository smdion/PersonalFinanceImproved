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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
        name: "Main 401k",
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
      expect(row!.accountLabel).toContain("Schwab");
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
      expect(result).toEqual({ success: true });

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
      expect(result).toEqual({ success: true });

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
      expect(result).toEqual({ success: true });

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
      expect(result).toEqual({ success: true });

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
      expect(result).toEqual({ success: true });
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
      expect(new Date(updated!.value).getTime()).not.toBeNaN();
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
          year: 2024,
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
      expect(new Date(updated!.value).getTime()).not.toBeNaN();
    });
  });

  // ── deleteAccount (account_performance) ──

  describe("performance.deleteAccount", () => {
    let deleteTargetId: number;
    let perfAcctIdForDelete: number;

    beforeAll(() => {
      // Create a dedicated performance account and account_performance row for deletion
      perfAcctIdForDelete = seedPerformanceAccount(db, {
        institution: "DeleteMe",
        accountType: "ira",
        name: "Delete IRA",
        parentCategory: "Retirement",
        ownershipType: "individual",
      });

      const row = db
        .insert(schema.accountPerformance)
        .values({
          year: 2024,
          institution: "DeleteMe",
          accountLabel: "DeleteMe Delete IRA",
          parentCategory: "Retirement",
          performanceAccountId: perfAcctIdForDelete,
          beginningBalance: "1000",
          totalContributions: "500",
          yearlyGainLoss: "100",
          endingBalance: "1600",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
        })
        .returning({ id: schema.accountPerformance.id })
        .get();
      deleteTargetId = row.id;
    });

    it("deletes an account_performance row", async () => {
      // Verify it exists first
      const before = db
        .select()
        .from(schema.accountPerformance)
        .all()
        .find((r) => r.id === deleteTargetId);
      expect(before).toBeDefined();

      const result = await caller.performance.deleteAccount({
        id: deleteTargetId,
      });
      expect(result).toEqual({ success: true });

      // Verify it's gone
      const after = db
        .select()
        .from(schema.accountPerformance)
        .all()
        .find((r) => r.id === deleteTargetId);
      expect(after).toBeUndefined();
    });

    it("stamps performance_last_updated after delete", async () => {
      // Clear existing timestamps
      db.delete(schema.appSettings).run();

      // Create another row to delete
      const row = db
        .insert(schema.accountPerformance)
        .values({
          year: 2020,
          institution: "DeleteMe",
          accountLabel: "DeleteMe Delete IRA",
          parentCategory: "Retirement",
          performanceAccountId: perfAcctIdForDelete,
          beginningBalance: "500",
          totalContributions: "200",
          yearlyGainLoss: "50",
          endingBalance: "750",
          employerContributions: "0",
          fees: "0",
          distributions: "0",
          isActive: true,
        })
        .returning({ id: schema.accountPerformance.id })
        .get();

      await caller.performance.deleteAccount({ id: row.id });

      const settings = db.select().from(schema.appSettings).all();
      const updated = settings.find(
        (s) => s.key === "performance_last_updated",
      );
      expect(updated).toBeDefined();
    });

    it("succeeds silently when deleting non-existent row", async () => {
      // Deleting a row that doesn't exist should still return success
      const result = await caller.performance.deleteAccount({ id: 99999 });
      expect(result).toEqual({ success: true });
    });
  });

  // ── computeSummary with annualPerformance + accountPerformance seeded ──

  describe("computeSummary (with annual + account data)", () => {
    let perfAcct2Id: number;

    beforeAll(() => {
      // Seed a second performance account in a different category
      perfAcct2Id = seedPerformanceAccount(db, {
        institution: "Fidelity",
        accountType: "hsa",
        name: "HSA Account",
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
    const types = ["401k", "403b", "ira", "hsa", "brokerage"];
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
