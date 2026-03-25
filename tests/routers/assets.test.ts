/**
 * Assets router integration tests.
 *
 * Tests computeSummary shape, home improvement CRUD, other asset CRUD,
 * upsertNote create/update/delete, and listPropertyTaxes.
 * Uses an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller } from "./setup";

describe("assets router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // ── COMPUTE SUMMARY SHAPE ──

  describe("computeSummary", () => {
    it("returns required top-level keys", async () => {
      const summary = await caller.assets.computeSummary();
      expect(summary).toHaveProperty("current");
      expect(summary).toHaveProperty("history");
      expect(summary).toHaveProperty("homeImprovements");
      expect(summary).toHaveProperty("notes");
    });

    it("current has expected numeric fields", async () => {
      const { current } = await caller.assets.computeSummary();
      expect(typeof current.cash).toBe("number");
      expect(typeof current.houseValue).toBe("number");
      expect(typeof current.mortgageBalance).toBe("number");
      expect(typeof current.houseEquity).toBe("number");
      expect(typeof current.homeImprovements).toBe("number");
      expect(typeof current.otherAssetsTotal).toBe("number");
      expect(typeof current.totalAssets).toBe("number");
    });

    it("current has boolean sync flags", async () => {
      const { current } = await caller.assets.computeSummary();
      expect(typeof current.houseValueSynced).toBe("boolean");
      expect(typeof current.mortgageSynced).toBe("boolean");
    });

    it("current.otherAssetItems is an array", async () => {
      const { current } = await caller.assets.computeSummary();
      expect(Array.isArray(current.otherAssetItems)).toBe(true);
    });

    it("history is an array", async () => {
      const { history } = await caller.assets.computeSummary();
      expect(Array.isArray(history)).toBe(true);
    });

    it("homeImprovements is an empty array when none exist", async () => {
      const { homeImprovements } = await caller.assets.computeSummary();
      expect(Array.isArray(homeImprovements)).toBe(true);
      expect(homeImprovements).toHaveLength(0);
    });

    it("notes is an object (key-value map)", async () => {
      const { notes } = await caller.assets.computeSummary();
      expect(typeof notes).toBe("object");
      expect(notes).not.toBeNull();
      expect(Array.isArray(notes)).toBe(false);
    });
  });

  // ── HOME IMPROVEMENT CRUD ──

  describe("home improvement CRUD", () => {
    const currentYear = new Date().getFullYear();
    let improvementId: number;

    it("adds a home improvement", async () => {
      const result = await caller.assets.addHomeImprovement({
        year: currentYear,
        description: "New roof",
        cost: 15000,
        note: "Asphalt shingles",
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary reflects the new home improvement", async () => {
      const { homeImprovements } = await caller.assets.computeSummary();
      expect(homeImprovements.length).toBeGreaterThanOrEqual(1);
      const found = homeImprovements.find(
        (hi: { description: string }) => hi.description === "New roof",
      );
      expect(found).toBeDefined();
      expect(found!.cost).toBe(15000);
      expect(found!.note).toBe("Asphalt shingles");
      improvementId = found!.id;
    });

    it("adds a second home improvement", async () => {
      const result = await caller.assets.addHomeImprovement({
        year: currentYear,
        description: "Kitchen remodel",
        cost: 25000,
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary lists both home improvements", async () => {
      const { homeImprovements } = await caller.assets.computeSummary();
      expect(homeImprovements.length).toBeGreaterThanOrEqual(2);
    });

    it("updates a home improvement description and cost", async () => {
      const result = await caller.assets.updateHomeImprovement({
        id: improvementId,
        description: "New roof (upgraded)",
        cost: 17500,
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary reflects the update", async () => {
      const { homeImprovements } = await caller.assets.computeSummary();
      const found = homeImprovements.find(
        (hi: { id: number }) => hi.id === improvementId,
      );
      expect(found).toBeDefined();
      expect(found!.description).toBe("New roof (upgraded)");
      expect(found!.cost).toBe(17500);
    });

    it("deletes a home improvement", async () => {
      const result = await caller.assets.deleteHomeImprovement({
        id: improvementId,
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary no longer contains deleted home improvement", async () => {
      const { homeImprovements } = await caller.assets.computeSummary();
      const found = homeImprovements.find(
        (hi: { id: number }) => hi.id === improvementId,
      );
      expect(found).toBeUndefined();
    });
  });

  // ── OTHER ASSET CRUD ──

  describe("other asset CRUD", () => {
    const currentYear = new Date().getFullYear();
    let assetId: number;

    it("upserts an other asset (create)", async () => {
      const result = await caller.assets.upsertOtherAsset({
        name: "Collector Car",
        year: currentYear,
        value: 30000,
        note: "1967 Mustang",
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary includes the new other asset in current state", async () => {
      const { current } = await caller.assets.computeSummary();
      const found = current.otherAssetItems.find(
        (a: { name: string }) => a.name === "Collector Car",
      );
      expect(found).toBeDefined();
      expect(found!.value).toBe(30000);
      expect(found!.note).toBe("1967 Mustang");
      assetId = found!.id;
    });

    it("current.otherAssetsTotal reflects the new asset", async () => {
      const { current } = await caller.assets.computeSummary();
      expect(current.otherAssetsTotal).toBeGreaterThanOrEqual(30000);
    });

    it("upserts the same asset (update via conflict)", async () => {
      const result = await caller.assets.upsertOtherAsset({
        name: "Collector Car",
        year: currentYear,
        value: 32000,
        note: "1967 Mustang - appraised",
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary reflects the updated value", async () => {
      const { current } = await caller.assets.computeSummary();
      const found = current.otherAssetItems.find(
        (a: { name: string }) => a.name === "Collector Car",
      );
      expect(found).toBeDefined();
      expect(found!.value).toBe(32000);
      expect(found!.note).toBe("1967 Mustang - appraised");
    });

    it("deletes the other asset", async () => {
      const result = await caller.assets.deleteOtherAsset({ id: assetId });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary no longer includes the deleted other asset", async () => {
      const { current } = await caller.assets.computeSummary();
      const found = current.otherAssetItems.find(
        (a: { name: string }) => a.name === "Collector Car",
      );
      expect(found).toBeUndefined();
    });
  });

  // ── UPSERT NOTE (create / update / delete via empty string) ──

  describe("upsertNote", () => {
    const noteYear = 2020;
    const noteField = "houseValue";

    it("creates a note", async () => {
      const result = await caller.assets.upsertNote({
        year: noteYear,
        field: noteField,
        note: "Estimated by agent",
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary notes map contains the new note", async () => {
      const { notes } = await caller.assets.computeSummary();
      expect(notes[`${noteYear}:${noteField}`]).toBe("Estimated by agent");
    });

    it("updates the note via upsert", async () => {
      const result = await caller.assets.upsertNote({
        year: noteYear,
        field: noteField,
        note: "Zillow estimate",
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary notes map reflects the updated note", async () => {
      const { notes } = await caller.assets.computeSummary();
      expect(notes[`${noteYear}:${noteField}`]).toBe("Zillow estimate");
    });

    it("deletes the note by upserting an empty string", async () => {
      const result = await caller.assets.upsertNote({
        year: noteYear,
        field: noteField,
        note: "",
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary notes map no longer contains the deleted note", async () => {
      const { notes } = await caller.assets.computeSummary();
      expect(notes[`${noteYear}:${noteField}`]).toBeUndefined();
    });
  });

  // ── PROPERTY TAXES ──

  describe("listPropertyTaxes", () => {
    it("returns an array when no data exists", async () => {
      const taxes = await caller.assets.listPropertyTaxes();
      expect(Array.isArray(taxes)).toBe(true);
    });

    it("returns an array when filtered by a non-existent loanId", async () => {
      const taxes = await caller.assets.listPropertyTaxes({ loanId: 999 });
      expect(Array.isArray(taxes)).toBe(true);
      expect(taxes).toHaveLength(0);
    });
  });

  // ── PROPERTY TAX CRUD ──

  describe("property tax CRUD", () => {
    // Property taxes require a mortgageLoans row due to the loanId foreign key.
    // We seed a mortgage loan directly via the db before running these tests.
    let loanId: number;
    let taxId: number;
    let db: Awaited<ReturnType<typeof createTestCaller>>["db"];

    beforeAll(async () => {
      // Access the raw db to seed a mortgage loan for FK satisfaction
      const ctx = await createTestCaller();
      // We need a shared caller that has the seeded loan — re-use the suite's caller
      // but we need the db handle. Re-create a fresh context for this nested suite.
      // Since we need the db handle, we create a separate context here.
      // NOTE: This is a separate db from the outer suite — property tax tests are self-contained.
      caller = ctx.caller;
      db = ctx.db;
      cleanup = ctx.cleanup;

      // Seed a mortgage loan so upsertPropertyTax FK constraint is satisfied
      const { mortgageLoans } = await import("@/lib/db/schema-sqlite");
      const row = db
        .insert(mortgageLoans)
        .values({
          name: "Test Loan",
          isActive: true,
          interestRate: "6.5",
          termYears: 30,
          originalLoanAmount: "300000",
          principalAndInterest: "1896",
          firstPaymentDate: "2020-02-01",
          propertyValuePurchase: "380000",
        })
        .returning({ id: mortgageLoans.id })
        .get();
      loanId = row.id;
    });

    it("upserts a property tax record (create)", async () => {
      const result = await caller.assets.upsertPropertyTax({
        loanId,
        year: 2023,
        assessedValue: 360000,
        taxAmount: 4200,
        note: "County assessment",
      });
      expect(result).toEqual({ success: true });
    });

    it("listPropertyTaxes returns the new record", async () => {
      const taxes = await caller.assets.listPropertyTaxes({ loanId });
      expect(taxes.length).toBeGreaterThanOrEqual(1);
      const found = taxes.find((t: { year: number }) => t.year === 2023);
      expect(found).toBeDefined();
      expect(found!.taxAmount).toBe(4200);
      expect(found!.assessedValue).toBe(360000);
      taxId = found!.id;
    });

    it("upserts the same record (update)", async () => {
      const result = await caller.assets.upsertPropertyTax({
        loanId,
        year: 2023,
        assessedValue: 365000,
        taxAmount: 4350,
        note: "Revised",
      });
      expect(result).toEqual({ success: true });
    });

    it("listPropertyTaxes reflects the updated values", async () => {
      const taxes = await caller.assets.listPropertyTaxes({ loanId });
      const found = taxes.find((t: { year: number }) => t.year === 2023);
      expect(found).toBeDefined();
      expect(found!.taxAmount).toBe(4350);
      expect(found!.assessedValue).toBe(365000);
    });

    it("deletes the property tax record", async () => {
      const result = await caller.assets.deletePropertyTax({ id: taxId });
      expect(result).toEqual({ success: true });
    });

    it("listPropertyTaxes no longer contains the deleted record", async () => {
      const taxes = await caller.assets.listPropertyTaxes({ loanId });
      const found = taxes.find((t: { id: number }) => t.id === taxId);
      expect(found).toBeUndefined();
    });
  });
});
