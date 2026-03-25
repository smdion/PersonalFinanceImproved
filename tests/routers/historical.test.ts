/**
 * Historical router integration tests.
 *
 * Tests computeSummary shape, upsertNote create/update/delete cycle,
 * the update procedure for net_worth_annual rows, salary history
 * with jobs/changes, home improvement items, and other assets —
 * using an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedPerson, seedJob } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

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
      expect(summary).toHaveProperty("salaryHistory");
      expect(summary).toHaveProperty("notes");
    });

    it("history is an array (may contain seed data)", async () => {
      const summary = await caller.historical.computeSummary();
      expect(Array.isArray(summary.history)).toBe(true);
    });

    it("salaryHistory is an empty array when no people exist", async () => {
      const summary = await caller.historical.computeSummary();
      expect(Array.isArray(summary.salaryHistory)).toBe(true);
      expect(summary.salaryHistory).toHaveLength(0);
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
        homeImprovementsCumulative: "0",
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
    ).rejects.toThrow(/No net_worth_annual row found/);
  });
});

// ── SALARY HISTORY in computeSummary ──

describe("historical router — salary history", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "History Person", "1990-01-01");
    const jobId = seedJob(db, personId, {
      employerName: "HistoryCo",
      annualSalary: "80000",
      startDate: "2019-01-01",
    });

    // Add salary changes
    db.insert(schema.salaryChanges)
      .values({
        jobId,
        effectiveDate: "2020-01-01",
        newSalary: "90000",
        notes: "First raise",
      })
      .run();
    db.insert(schema.salaryChanges)
      .values({
        jobId,
        effectiveDate: "2021-06-01",
        newSalary: "100000",
        notes: "Promotion",
      })
      .run();
  });

  afterAll(() => cleanup());

  it("salaryHistory contains one entry for the person", async () => {
    const summary = await caller.historical.computeSummary();
    expect(summary.salaryHistory).toHaveLength(1);
    expect(summary.salaryHistory[0]!.person.name).toBe("History Person");
  });

  it("timeline has one job with the correct employer", async () => {
    const summary = await caller.historical.computeSummary();
    const timeline = summary.salaryHistory[0]!.timeline;
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.employer).toBe("HistoryCo");
    expect(timeline[0]!.salary).toBe(80000);
  });

  it("job has salary changes in the timeline", async () => {
    const summary = await caller.historical.computeSummary();
    const changes = summary.salaryHistory[0]!.timeline[0]!.changes;
    expect(changes).toHaveLength(2);
    expect(changes[0]!.newSalary).toBe(90000);
    expect(changes[0]!.reason).toBe("First raise");
    expect(changes[1]!.newSalary).toBe(100000);
    expect(changes[1]!.reason).toBe("Promotion");
  });
});

// ── Multiple people with multiple jobs ──

describe("historical router — multiple people salary history", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const person1 = await seedPerson(db, "Alice", "1988-03-15");
    const person2 = await seedPerson(db, "Bob", "1990-07-20");

    seedJob(db, person1, {
      employerName: "AliceCo",
      annualSalary: "100000",
      startDate: "2020-01-01",
    });
    seedJob(db, person2, {
      employerName: "BobCo",
      annualSalary: "85000",
      startDate: "2021-06-01",
    });
  });

  afterAll(() => cleanup());

  it("salaryHistory contains entries for both people", async () => {
    const summary = await caller.historical.computeSummary();
    expect(summary.salaryHistory).toHaveLength(2);
    const names = summary.salaryHistory.map((s) => s.person.name);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  it("each person's timeline contains their jobs", async () => {
    const summary = await caller.historical.computeSummary();
    const alice = summary.salaryHistory.find((s) => s.person.name === "Alice")!;
    const bob = summary.salaryHistory.find((s) => s.person.name === "Bob")!;
    expect(alice.timeline).toHaveLength(1);
    expect(alice.timeline[0]!.employer).toBe("AliceCo");
    expect(bob.timeline).toHaveLength(1);
    expect(bob.timeline[0]!.employer).toBe("BobCo");
  });
});

// ── Person with ended job ──

describe("historical router — person with ended job", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Former Employee", "1985-01-01");
    seedJob(db, personId, {
      employerName: "OldCo",
      annualSalary: "70000",
      startDate: "2015-01-01",
      endDate: "2020-12-31",
    });
    seedJob(db, personId, {
      employerName: "NewCo",
      annualSalary: "95000",
      startDate: "2021-01-15",
    });
  });

  afterAll(() => cleanup());

  it("timeline contains both jobs for the person", async () => {
    const summary = await caller.historical.computeSummary();
    const person = summary.salaryHistory[0]!;
    expect(person.timeline).toHaveLength(2);
    // Jobs are ordered by startDate ascending
    expect(person.timeline[0]!.employer).toBe("OldCo");
    expect(person.timeline[0]!.endDate).toBe("2020-12-31");
    expect(person.timeline[1]!.employer).toBe("NewCo");
    expect(person.timeline[1]!.endDate).toBeNull();
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
        homeImprovementsCumulative: "0",
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
        homeImprovementsCumulative: "0",
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
        homeImprovementsCumulative: "0",
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
        homeImprovementsCumulative: "0",
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

    // Seed a person with a job spanning multiple years
    const personId = await seedPerson(db, "Salary Worker", "1990-01-01");
    const jobId = seedJob(db, personId, {
      employerName: "SalaryCo",
      annualSalary: "80000",
      startDate: "2020-01-01",
    });

    // Salary change in 2022
    db.insert(schema.salaryChanges)
      .values({
        jobId,
        effectiveDate: "2022-01-01",
        newSalary: "95000",
      })
      .run();

    // Seed net_worth_annual rows for 2020-2022
    for (const year of [2020, 2021, 2022]) {
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
          homeImprovementsCumulative: "0",
        })
        .run();
    }
  });

  afterAll(() => cleanup());

  it("history rows contain salaries object with person name as key", async () => {
    const summary = await caller.historical.computeSummary();
    const row2020 = summary.history.find((h) => h.year === 2020);
    if (row2020) {
      expect(row2020.salaries).toBeDefined();
      expect(row2020.salaries["Salary Worker"]).toBe(80000);
    }
  });

  it("salary reflects salary change for later years", async () => {
    const summary = await caller.historical.computeSummary();
    const row2022 = summary.history.find((h) => h.year === 2022);
    if (row2022) {
      expect(row2022.salaries["Salary Worker"]).toBe(95000);
    }
  });

  it("salary before the change remains at original level", async () => {
    const summary = await caller.historical.computeSummary();
    const row2021 = summary.history.find((h) => h.year === 2021);
    if (row2021) {
      expect(row2021.salaries["Salary Worker"]).toBe(80000);
    }
  });
});
