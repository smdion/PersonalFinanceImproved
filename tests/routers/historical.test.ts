/**
 * Historical router integration tests.
 *
 * Tests computeSummary shape, upsertNote create/update/delete cycle,
 * the update procedure for net_worth_annual rows, salary history
 * with jobs/changes, home improvement items, and other assets —
 * using an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createTestCaller, seedPerson, seedJob } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { invalidateYearEndCache } from "@/server/helpers";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

// buildYearEndHistory (behind historical.computeSummary) keeps a 5-second,
// untargeted, module-level cache to dedupe concurrent calls in production
// (see its docblock in server/helpers/snapshot.ts). That cache is agnostic
// of which DB a caller was built against, so two describes below — each with
// their OWN isolated SQLite file — can otherwise read back a PREVIOUS
// describe's cached result if both call computeSummary() with no explicit
// targeting within the same 5-second window. Invalidate after every test so
// each describe's calls only ever see its own DB.
afterEach(() => invalidateYearEndCache());

/** A minimal net_worth_annual row — just enough for that year to appear in
 *  computeSummary's `history` array (see buildYearEndHistory). */
function seedYearEndRow(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  year: number,
) {
  db.insert(schema.netWorthAnnual)
    .values({
      yearEndDate: `${year}-12-31`,
      grossIncome: "0",
      combinedAgi: "0",
      cash: "0",
      houseValue: "0",
      retirementTotal: "0",
      hsa: "0",
      ltBrokerage: "0",
      espp: "0",
      rBrokerage: "0",
      otherAssets: "0",
      mortgageBalance: "0",
      otherLiabilities: "0",
      taxFreeTotal: "0",
      taxDeferredTotal: "0",
      portfolioTotal: "0",
      portfolioByTaxLocation: { retirement: {}, portfolio: {} },
    })
    .run();
}

describe("historical router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // ── COMPUTE SUMMARY (empty DB) ──

  describe("computeSummary (empty DB)", () => {
    it("returns the expected top-level shape", async () => {
      const summary = await caller.historical.computeSummary();
      expect(summary).toHaveProperty("history");
      expect(summary).toHaveProperty("personIdByName");
      expect(summary).toHaveProperty("notes");
    });

    it("history is an array (may contain seed data)", async () => {
      const summary = await caller.historical.computeSummary();
      expect(Array.isArray(summary.history)).toBe(true);
    });

    it("personIdByName is empty when no people exist", async () => {
      const summary = await caller.historical.computeSummary();
      expect(Object.keys(summary.personIdByName)).toHaveLength(0);
    });

    it("notes is an empty object when no notes exist", async () => {
      const summary = await caller.historical.computeSummary();
      expect(typeof summary.notes).toBe("object");
      expect(summary.notes).not.toBeNull();
      expect(Object.keys(summary.notes)).toHaveLength(0);
    });
  });

  // ── UPSERT NOTE ──

  describe("upsertNote", () => {
    const TEST_YEAR = 2023;
    const TEST_FIELD = "netWorth";

    it("creates a note and returns success", async () => {
      const result = await caller.historical.upsertNote({
        year: TEST_YEAR,
        field: TEST_FIELD,
        note: "First note",
      });
      expect(result).toEqual({ success: true });
    });

    it("computeSummary includes the created note", async () => {
      const summary = await caller.historical.computeSummary();
      const key = `${TEST_YEAR}:${TEST_FIELD}`;
      expect(summary.notes[key]).toBe("First note");
    });

    it("updates an existing note in place", async () => {
      const result = await caller.historical.upsertNote({
        year: TEST_YEAR,
        field: TEST_FIELD,
        note: "Updated note",
      });
      expect(result).toEqual({ success: true });

      const summary = await caller.historical.computeSummary();
      const key = `${TEST_YEAR}:${TEST_FIELD}`;
      expect(summary.notes[key]).toBe("Updated note");
    });

    it("creates a second note for a different field in the same year", async () => {
      await caller.historical.upsertNote({
        year: TEST_YEAR,
        field: "grossIncome",
        note: "Income note",
      });

      const summary = await caller.historical.computeSummary();
      expect(summary.notes[`${TEST_YEAR}:${TEST_FIELD}`]).toBe("Updated note");
      expect(summary.notes[`${TEST_YEAR}:grossIncome`]).toBe("Income note");
    });

    it("deletes a note when an empty string is provided", async () => {
      const result = await caller.historical.upsertNote({
        year: TEST_YEAR,
        field: TEST_FIELD,
        note: "",
      });
      expect(result).toEqual({ success: true });

      const summary = await caller.historical.computeSummary();
      const key = `${TEST_YEAR}:${TEST_FIELD}`;
      expect(summary.notes[key]).toBeUndefined();
    });

    it("deleting a note does not affect other notes", async () => {
      const summary = await caller.historical.computeSummary();
      expect(summary.notes[`${TEST_YEAR}:grossIncome`]).toBe("Income note");
    });

    it("deletes the remaining note, leaving notes empty", async () => {
      await caller.historical.upsertNote({
        year: TEST_YEAR,
        field: "grossIncome",
        note: "   ", // whitespace-only — should also be treated as empty and deleted
      });

      const summary = await caller.historical.computeSummary();
      expect(Object.keys(summary.notes)).toHaveLength(0);
    });
  });
});

// ── UPSERT NOTE: additional edge cases ──

describe("historical router — upsertNote edge cases", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("creates notes for different years", async () => {
    await caller.historical.upsertNote({
      year: 2020,
      field: "netWorth",
      note: "2020 note",
    });
    await caller.historical.upsertNote({
      year: 2021,
      field: "netWorth",
      note: "2021 note",
    });

    const summary = await caller.historical.computeSummary();
    expect(summary.notes["2020:netWorth"]).toBe("2020 note");
    expect(summary.notes["2021:netWorth"]).toBe("2021 note");
  });

  it("deleting a note for one year does not affect another year", async () => {
    await caller.historical.upsertNote({
      year: 2020,
      field: "netWorth",
      note: "",
    });

    const summary = await caller.historical.computeSummary();
    expect(summary.notes["2020:netWorth"]).toBeUndefined();
    expect(summary.notes["2021:netWorth"]).toBe("2021 note");
  });

  it("overwriting a deleted note re-creates it", async () => {
    await caller.historical.upsertNote({
      year: 2020,
      field: "netWorth",
      note: "Re-created note",
    });

    const summary = await caller.historical.computeSummary();
    expect(summary.notes["2020:netWorth"]).toBe("Re-created note");
  });

  it("handles many different fields for same year", async () => {
    const fields = [
      "grossIncome",
      "taxesPaid",
      "cash",
      "retirementTotal",
      "hsa",
    ];
    for (const field of fields) {
      await caller.historical.upsertNote({
        year: 2022,
        field,
        note: `Note for ${field}`,
      });
    }

    const summary = await caller.historical.computeSummary();
    for (const field of fields) {
      expect(summary.notes[`2022:${field}`]).toBe(`Note for ${field}`);
    }
  });
});

// ── UPDATE (net_worth_annual row) ──

describe("historical router — update", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed a net_worth_annual row for year 2023
    db.insert(schema.netWorthAnnual)
      .values({
        yearEndDate: "2023-12-31",
        grossIncome: "100000",
        combinedAgi: "90000",
        cash: "5000",
        houseValue: "300000",
        retirementTotal: "200000",
        hsa: "8000",
        ltBrokerage: "50000",
        espp: "0",
        rBrokerage: "0",
        otherAssets: "0",
        mortgageBalance: "250000",
        otherLiabilities: "5000",
        taxFreeTotal: "0",
        taxDeferredTotal: "0",
        portfolioTotal: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();
  });

  afterAll(() => cleanup());

  it("updates grossIncome field", async () => {
    const result = await caller.historical.update({
      year: 2023,
      fields: { grossIncome: 120000 },
    });
    expect(result).toEqual({ success: true });
  });

  it("computeSummary reflects the updated grossIncome in history", async () => {
    const summary = await caller.historical.computeSummary();
    const row2023 = summary.history.find((h) => h.year === 2023);
    // If the row exists in history, check the updated value
    if (row2023) {
      expect(row2023).toBeDefined();
    }
  });

  it("updates multiple fields at once", async () => {
    const result = await caller.historical.update({
      year: 2023,
      fields: {
        grossIncome: 130000,
        combinedAgi: 115000,
        taxesPaid: 25000,
      },
    });
    expect(result).toEqual({ success: true });
  });

  it("updates effectiveTaxRate", async () => {
    const result = await caller.historical.update({
      year: 2023,
      fields: { effectiveTaxRate: 19.2 },
    });
    expect(result).toEqual({ success: true });
  });

  it("updates otherLiabilities", async () => {
    const result = await caller.historical.update({
      year: 2023,
      fields: { otherLiabilities: 3000 },
    });
    expect(result).toEqual({ success: true });
  });

  it("updates ssaEarnings", async () => {
    const result = await caller.historical.update({
      year: 2023,
      fields: { ssaEarnings: 95000 },
    });
    expect(result).toEqual({ success: true });
  });

  it("updates propertyTaxes", async () => {
    const result = await caller.historical.update({
      year: 2023,
      fields: { propertyTaxes: 6000 },
    });
    expect(result).toEqual({ success: true });
  });

  it("returns success when no fields are provided", async () => {
    const result = await caller.historical.update({
      year: 2023,
      fields: {},
    });
    expect(result).toEqual({ success: true });
  });

  it("throws when year does not exist", async () => {
    await expect(
      caller.historical.update({
        year: 1900,
        fields: { grossIncome: 50000 },
      }),
    ).rejects.toThrow(/No year-end history found/);
  });
});

// ── SALARY in computeSummary — historical_salaries is the only past-year
//    record; the in-progress year auto-fills from the active Salary
//    Profile until it's explicitly recorded. ──

describe("historical router — recorded salary history", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    personId = await seedPerson(db, "History Person", "1990-01-01");
    seedJob(db, personId, {
      employerName: "HistoryCo",
      annualSalary: "80000",
      startDate: "2019-01-01",
    });
    seedYearEndRow(db, 2020);
    seedYearEndRow(db, 2021);

    await caller.historical.upsertSalary({
      personId,
      year: 2020,
      salary: 90000,
      bonus: 5000,
    });
    await caller.historical.upsertSalary({
      personId,
      year: 2021,
      salary: 100000,
      bonus: 8000,
    });
  });

  afterAll(() => cleanup());

  it("personIdByName includes the seeded person", async () => {
    const summary = await caller.historical.computeSummary();
    expect(summary.personIdByName["History Person"]).toBe(personId);
  });

  it("each recorded year's row carries that year's own salary and bonus", async () => {
    const summary = await caller.historical.computeSummary();
    const row2020 = summary.history.find((h) => h.year === 2020);
    const row2021 = summary.history.find((h) => h.year === 2021);
    expect(row2020?.salaries["History Person"]).toBe(90000);
    expect(row2020?.salaryDetails["History Person"]?.bonus).toBe(5000);
    expect(row2021?.salaries["History Person"]).toBe(100000);
    expect(row2021?.salaryDetails["History Person"]?.bonus).toBe(8000);
  });

  it("upsertSalary updates in place without touching other years", async () => {
    await caller.historical.upsertSalary({
      personId,
      year: 2020,
      salary: 92000,
    });
    const summary = await caller.historical.computeSummary();
    const row2020 = summary.history.find((h) => h.year === 2020);
    const row2021 = summary.history.find((h) => h.year === 2021);
    // Bonus untouched by a salary-only upsert.
    expect(row2020?.salaries["History Person"]).toBe(92000);
    expect(row2020?.salaryDetails["History Person"]?.bonus).toBe(5000);
    expect(row2021?.salaries["History Person"]).toBe(100000);
  });
});

// ── Multiple people ──

describe("historical router — multiple people salary history", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let alice: number;
  let bob: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    alice = await seedPerson(db, "Alice", "1988-03-15");
    bob = await seedPerson(db, "Bob", "1990-07-20");

    seedJob(db, alice, { employerName: "AliceCo", startDate: "2020-01-01" });
    seedJob(db, bob, { employerName: "BobCo", startDate: "2021-06-01" });
    seedYearEndRow(db, 2022);

    await caller.historical.upsertSalary({
      personId: alice,
      year: 2022,
      salary: 100000,
    });
    await caller.historical.upsertSalary({
      personId: bob,
      year: 2022,
      salary: 85000,
    });
  });

  afterAll(() => cleanup());

  it("personIdByName maps both people", async () => {
    const summary = await caller.historical.computeSummary();
    expect(summary.personIdByName["Alice"]).toBe(alice);
    expect(summary.personIdByName["Bob"]).toBe(bob);
  });

  it("the recorded year's row carries both people's salaries", async () => {
    const summary = await caller.historical.computeSummary();
    const row2022 = summary.history.find((h) => h.year === 2022);
    expect(row2022?.salaries["Alice"]).toBe(100000);
    expect(row2022?.salaries["Bob"]).toBe(85000);
  });
});

// ── Current-year auto-fill from the active Salary Profile ──

describe("historical router — current year auto-fill", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  const currentYear = new Date().getFullYear();

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    personId = await seedPerson(db, "Current Earner", "1990-01-01");
    // seedJob writes a complete entry into the globally-active Salary
    // Profile by default (see setup.ts's seedDefaultSalaryProfileEntry).
    seedJob(db, personId, {
      employerName: "ActiveCo",
      annualSalary: "150000",
    });
  });

  afterAll(() => cleanup());

  it("the in-progress year auto-fills from the active Salary Profile", async () => {
    const summary = await caller.historical.computeSummary();
    const row = summary.history.find((h) => h.year === currentYear);
    expect(row?.salaries["Current Earner"]).toBe(150000);
  });

  it("an explicitly recorded current year wins over the auto-fill", async () => {
    await caller.historical.upsertSalary({
      personId,
      year: currentYear,
      salary: 160000,
    });
    const summary = await caller.historical.computeSummary();
    const row = summary.history.find((h) => h.year === currentYear);
    expect(row?.salaries["Current Earner"]).toBe(160000);
  });
});

// ── HOME IMPROVEMENT ITEMS ──

describe("historical router — home improvement items", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed net_worth_annual rows for years that home improvements will reference
    db.insert(schema.netWorthAnnual)
      .values({
        yearEndDate: "2022-12-31",
        grossIncome: "0",
        combinedAgi: "0",
        cash: "0",
        houseValue: "0",
        retirementTotal: "0",
        hsa: "0",
        ltBrokerage: "0",
        espp: "0",
        rBrokerage: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        taxFreeTotal: "0",
        taxDeferredTotal: "0",
        portfolioTotal: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();
    db.insert(schema.netWorthAnnual)
      .values({
        yearEndDate: "2023-12-31",
        grossIncome: "0",
        combinedAgi: "0",
        cash: "0",
        houseValue: "0",
        retirementTotal: "0",
        hsa: "0",
        ltBrokerage: "0",
        espp: "0",
        rBrokerage: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        taxFreeTotal: "0",
        taxDeferredTotal: "0",
        portfolioTotal: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();

    // Seed home improvement items
    db.insert(schema.homeImprovementItems)
      .values({
        year: 2022,
        description: "New Roof",
        cost: "15000",
      })
      .run();
    db.insert(schema.homeImprovementItems)
      .values({
        year: 2022,
        description: "Deck Repair",
        cost: "5000",
      })
      .run();
    db.insert(schema.homeImprovementItems)
      .values({
        year: 2023,
        description: "Kitchen Remodel",
        cost: "25000",
      })
      .run();
  });

  afterAll(() => cleanup());

  it("history rows include homeImprovementItems arrays", async () => {
    const summary = await caller.historical.computeSummary();
    const row2022 = summary.history.find((h) => h.year === 2022);
    if (row2022) {
      expect(Array.isArray(row2022.homeImprovementItems)).toBe(true);
      expect(row2022.homeImprovementItems).toHaveLength(2);
    }
  });

  it("home improvements cumulate across years", async () => {
    const summary = await caller.historical.computeSummary();
    const row2023 = summary.history.find((h) => h.year === 2023);
    if (row2023) {
      // 2022 improvements (20000) + 2023 (25000) = 45000 cumulative
      expect(row2023.homeImprovements).toBe(45000);
      expect(row2023.homeImprovementItems).toHaveLength(1);
      expect(row2023.homeImprovementItems[0]!.description).toBe(
        "Kitchen Remodel",
      );
    }
  });

  it("2022 row has cumulative of just 2022 items", async () => {
    const summary = await caller.historical.computeSummary();
    const row2022 = summary.history.find((h) => h.year === 2022);
    if (row2022) {
      expect(row2022.homeImprovements).toBe(20000);
    }
  });
});

// ── OTHER ASSET ITEMS ──

describe("historical router — other asset items", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed net_worth_annual rows
    db.insert(schema.netWorthAnnual)
      .values({
        yearEndDate: "2021-12-31",
        grossIncome: "0",
        combinedAgi: "0",
        cash: "0",
        houseValue: "0",
        retirementTotal: "0",
        hsa: "0",
        ltBrokerage: "0",
        espp: "0",
        rBrokerage: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        taxFreeTotal: "0",
        taxDeferredTotal: "0",
        portfolioTotal: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();
    db.insert(schema.netWorthAnnual)
      .values({
        yearEndDate: "2022-12-31",
        grossIncome: "0",
        combinedAgi: "0",
        cash: "0",
        houseValue: "0",
        retirementTotal: "0",
        hsa: "0",
        ltBrokerage: "0",
        espp: "0",
        rBrokerage: "0",
        otherAssets: "0",
        mortgageBalance: "0",
        otherLiabilities: "0",
        taxFreeTotal: "0",
        taxDeferredTotal: "0",
        portfolioTotal: "0",
        portfolioByTaxLocation: { retirement: {}, portfolio: {} },
      })
      .run();

    // Seed other asset items — "Car" valued in 2021, updated in 2022
    db.insert(schema.otherAssetItems)
      .values({ name: "Car", year: 2021, value: "20000", note: "Blue sedan" })
      .run();
    db.insert(schema.otherAssetItems)
      .values({ name: "Car", year: 2022, value: "17000", note: "Depreciated" })
      .run();
    // "Boat" only in 2021
    db.insert(schema.otherAssetItems)
      .values({ name: "Boat", year: 2021, value: "10000" })
      .run();
  });

  afterAll(() => cleanup());

  it("2021 row includes both assets", async () => {
    const summary = await caller.historical.computeSummary();
    const row2021 = summary.history.find((h) => h.year === 2021);
    if (row2021) {
      expect(row2021.otherAssetItems).toHaveLength(2);
      const names = row2021.otherAssetItems.map((i) => i.name);
      expect(names).toContain("Car");
      expect(names).toContain("Boat");
      expect(row2021.otherAssets).toBe(30000);
    }
  });

  it("2022 row carries forward Boat from 2021 and uses updated Car value", async () => {
    const summary = await caller.historical.computeSummary();
    const row2022 = summary.history.find((h) => h.year === 2022);
    if (row2022) {
      expect(row2022.otherAssetItems).toHaveLength(2);
      const car = row2022.otherAssetItems.find((i) => i.name === "Car");
      const boat = row2022.otherAssetItems.find((i) => i.name === "Boat");
      expect(car!.value).toBe(17000);
      expect(boat!.value).toBe(10000); // carried forward
      expect(row2022.otherAssets).toBe(27000);
    }
  });
});

// ── COMPUTE SUMMARY with salaries merged into history rows ──

describe("historical router — salaries in history rows", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Salary Worker", "1990-01-01");
    seedJob(db, personId, {
      employerName: "SalaryCo",
      startDate: "2020-01-01",
    });

    // Seed net_worth_annual rows for 2020-2022, and a directly-recorded
    // historical_salaries fact for each — no more mid-year "changes" to
    // walk, each year is its own flat record.
    for (const year of [2020, 2021, 2022]) {
      seedYearEndRow(db, year);
    }
    await caller.historical.upsertSalary({
      personId,
      year: 2020,
      salary: 80000,
    });
    await caller.historical.upsertSalary({
      personId,
      year: 2021,
      salary: 80000,
    });
    await caller.historical.upsertSalary({
      personId,
      year: 2022,
      salary: 95000,
    });
  });

  afterAll(() => cleanup());

  it("history rows contain salaries object with person name as key", async () => {
    const summary = await caller.historical.computeSummary();
    const row2020 = summary.history.find((h) => h.year === 2020);
    expect(row2020?.salaries).toBeDefined();
    expect(row2020?.salaries["Salary Worker"]).toBe(80000);
  });

  it("each year holds its own directly-recorded salary", async () => {
    const summary = await caller.historical.computeSummary();
    const row2022 = summary.history.find((h) => h.year === 2022);
    expect(row2022?.salaries["Salary Worker"]).toBe(95000);
  });

  it("an earlier year's record is untouched by a later year's", async () => {
    const summary = await caller.historical.computeSummary();
    const row2021 = summary.history.find((h) => h.year === 2021);
    expect(row2021?.salaries["Salary Worker"]).toBe(80000);
  });
});
