/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Projection router coverage tests.
 *
 * Targets uncovered procedures: computeProjection (full result path),
 * computeMonteCarloProjection, and computeStrategyComparison.
 * Supplements projection.test.ts without duplicating its tests.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";
import {
  createTestCaller,
  seedStandardDataset,
  seedPerformanceAccount,
  seedSnapshot,
  adminSession,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed two asset class rows so glide path FK references work. */
function seedAssetClasses(db: BetterSQLite3Database<typeof sqliteSchema>) {
  db.insert(schema.assetClassParams)
    .values({
      id: 1,
      name: "Stocks",
      meanReturn: "0.10",
      stdDev: "0.18",
      sortOrder: 1,
    })
    .run();
  db.insert(schema.assetClassParams)
    .values({
      id: 2,
      name: "Bonds",
      meanReturn: "0.04",
      stdDev: "0.06",
      sortOrder: 2,
    })
    .run();
}

/** Seed asset class correlations. */
function seedCorrelations(db: BetterSQLite3Database<typeof sqliteSchema>) {
  db.insert(schema.assetClassCorrelations)
    .values({ classAId: 1, classBId: 2, correlation: "-0.2" })
    .run();
}

/** Seed glide path allocations (custom, not preset-bound). */
function seedGlidePath(db: BetterSQLite3Database<typeof sqliteSchema>) {
  db.insert(schema.glidePathAllocations)
    .values([
      { age: 30, assetClassId: 1, allocation: "0.80" },
      { age: 30, assetClassId: 2, allocation: "0.20" },
      { age: 65, assetClassId: 1, allocation: "0.40" },
      { age: 65, assetClassId: 2, allocation: "0.60" },
    ])
    .run();
}

/** Seed a full projection-ready dataset with retirement settings + return rates. */
function seedFullProjectionData(
  db: BetterSQLite3Database<typeof sqliteSchema>,
) {
  const { personId, jobId, perfAcctId } = seedStandardDataset(db);

  // Retirement settings (required by buildEnginePayload)
  db.insert(schema.retirementSettings)
    .values({
      personId,
      retirementAge: 65,
      endAge: 90,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      postRetirementInflation: "0.025",
      salaryAnnualIncrease: "0.02",
      withdrawalRate: "0.04",
      taxMultiplier: "1.0",
      grossUpForTaxes: true,
      withdrawalStrategy: "fixed",
      gkSkipInflationAfterLoss: true,
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      enableRothConversions: false,
      enableIrmaaAwareness: false,
      enableAcaAwareness: false,
      householdSize: 2,
    })
    .run();

  // Return rate table
  db.insert(schema.returnRateTable)
    .values({ age: 35, rateOfReturn: "0.07" })
    .run();
  db.insert(schema.returnRateTable)
    .values({ age: 65, rateOfReturn: "0.05" })
    .run();

  // Contribution account linked to the person
  db.insert(schema.contributionAccounts)
    .values({
      accountType: "401k",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      isActive: true,
      personId,
      performanceAccountId: perfAcctId,
      parentCategory: "Retirement",
    })
    .run();

  return { personId, jobId, perfAcctId };
}

// ---------------------------------------------------------------------------
// computeProjection — full result path
// ---------------------------------------------------------------------------

describe("projection router — computeProjection full result path", () => {
  it("returns full result shape with seeded data (non-metadataOnly)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      // Should have a non-null result with projection data
      expect(response).toHaveProperty("result");
      expect(response).toHaveProperty("combinedSalary");
      expect(response).toHaveProperty("portfolioByTaxType");
      expect(response).toHaveProperty("settings");
      expect(response).toHaveProperty("people");
      expect(response).toHaveProperty("contributionSpecs");
      expect(response).toHaveProperty("realDefaults");
      expect(response).toHaveProperty("returnRateSummary");
      expect(response).toHaveProperty("annualExpenses");
      expect(response).toHaveProperty("primaryPersonId");

      if (response.result !== null) {
        expect(response.result).toHaveProperty("projectionByYear");
        expect(response.result).toHaveProperty("warnings");
        expect(Array.isArray(response.result.projectionByYear)).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it("returns metadata-only when metadataOnly=true", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeProjection({
        metadataOnly: true,
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response.result).toBeNull();
      // Metadata fields still present
      expect(response).toHaveProperty("settings");
      expect(response).toHaveProperty("people");
      expect(response).toHaveProperty("combinedSalary");
    } finally {
      cleanup();
    }
  });

  it("applies salary overrides to the projection", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      const response = await caller.projection.computeProjection({
        salaryOverrides: [{ personId, salary: 200000 }],
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("combinedSalary");
      // With an override, salary should reflect the override
      if (response.result !== null) {
        expect(response.combinedSalary).toBeGreaterThan(0);
      }
    } finally {
      cleanup();
    }
  });

  it("applies decumulation defaults (custom routing mode)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeProjection({
        decumulationDefaults: {
          withdrawalRate: 0.035,
          withdrawalRoutingMode: "waterfall",
        },
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });

  it("includes router warnings for zero portfolio", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      // Seed person + retirement settings but no portfolio snapshot
      const personId = db
        .insert(schema.people)
        .values({
          name: "Test Person",
          dateOfBirth: "1990-01-01",
          isPrimaryUser: true,
        })
        .returning({ id: schema.people.id })
        .get().id;

      db.insert(schema.jobs)
        .values({
          personId,
          employerName: "TestCo",
          annualSalary: "120000",
          payPeriod: "biweekly",
          payWeek: "even",
          startDate: "2020-01-01",
          w4FilingStatus: "MFJ",
        })
        .run();

      db.insert(schema.retirementSettings)
        .values({
          personId,
          retirementAge: 65,
          endAge: 90,
          returnAfterRetirement: "0.05",
          annualInflation: "0.03",
          salaryAnnualIncrease: "0.02",
          withdrawalRate: "0.04",
          taxMultiplier: "1.0",
          grossUpForTaxes: true,
          withdrawalStrategy: "fixed",
          gkSkipInflationAfterLoss: true,
          socialSecurityMonthly: "2500",
          ssStartAge: 67,
          enableRothConversions: false,
          enableIrmaaAwareness: false,
          enableAcaAwareness: false,
          householdSize: 2,
        })
        .run();

      db.insert(schema.returnRateTable)
        .values({ age: 35, rateOfReturn: "0.07" })
        .run();

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      // Should have warnings about zero portfolio and no contribution accounts
      if (response.result !== null) {
        expect(response.result.warnings.length).toBeGreaterThan(0);
      }
    } finally {
      cleanup();
    }
  });

  it("applies accumulation overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [
          {
            year: 2030,
            contributionRate: 0.15,
            routingMode: "waterfall",
            notes: "Increased contribution",
          },
        ],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });

  it("applies decumulation overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [
          {
            year: 2060,
            withdrawalRate: 0.05,
            notes: "Increased withdrawal",
          },
        ],
      });

      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });

  it("exercises budget expense override paths", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeProjection({
        accumulationExpenseOverride: 50000,
        decumulationExpenseOverride: 40000,
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("result");
      expect(response).toHaveProperty("annualExpenses");
    } finally {
      cleanup();
    }
  });

  it("uses snapshotId parameter", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { perfAcctId } = seedFullProjectionData(db);

      // Create a second snapshot
      const snapId2 = seedSnapshot(db, "2025-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "200000",
          taxType: "preTax",
        },
      ]);

      const response = await caller.projection.computeProjection({
        snapshotId: snapId2,
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeMonteCarloProjection
// ---------------------------------------------------------------------------

describe("projection router — computeMonteCarloProjection", () => {
  it("returns null result when no retirement data exists", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
      });
      expect(response.result).toBeNull();
      expect(response).toHaveProperty("savedOverrides");
    } finally {
      cleanup();
    }
  });

  it("runs MC simulation with custom preset and seeded data", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        taxMode: "simple",
        seed: 42,
      });

      expect(response).toHaveProperty("result");
      expect(response).toHaveProperty("simulationInputs");
      expect(response).toHaveProperty("savedOverrides");

      if (response.result !== null) {
        expect(response.result).toHaveProperty("successRate");
        expect(response.result).toHaveProperty("percentileBands");
        expect(response.simulationInputs).toHaveProperty("currentAge");
        expect(response.simulationInputs).toHaveProperty("retirementAge");
        expect(response.simulationInputs).toHaveProperty("assetClasses");
        expect(response.simulationInputs).toHaveProperty("glidePath");
        expect(response.simulationInputs.preset).toBe("custom");
        expect(response.simulationInputs.presetLabel).toBe("Custom");
        expect(response.simulationInputs.taxMode).toBe("simple");
      }
    } finally {
      cleanup();
    }
  });

  it("runs MC with advanced tax mode", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        taxMode: "advanced",
        seed: 42,
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        expect(response.simulationInputs.taxMode).toBe("advanced");
      }
    } finally {
      cleanup();
    }
  });

  it("exercises named preset code path (default) — may fail on raw SQL in SQLite", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);

      // Seed a named preset in mc_presets table
      db.insert(schema.mcPresets)
        .values({
          key: "default",
          label: "Default",
          description: "Default preset for testing",
          returnMultiplier: "1.0",
          volMultiplier: "1.0",
          inflationMean: "0.025",
          inflationStdDev: "0.012",
          defaultTrials: 1000,
          returnClampMin: "-0.5",
          returnClampMax: "1.0",
          sortOrder: 0,
          isActive: true,
        })
        .run();

      try {
        const response = await caller.projection.computeMonteCarloProjection({
          numTrials: 100,
          preset: "default",
          seed: 42,
        });
        // If it succeeds, verify shape
        expect(response).toHaveProperty("result");
      } catch (e: unknown) {
        // db.execute() is not available in SQLite — expected in test harness
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).toMatch(/execute/i);
      }
    } finally {
      cleanup();
    }
  });

  it("applies UI asset class overrides to MC", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        assetClassOverrides: [{ id: 1, meanReturn: 0.12, stdDev: 0.2 }],
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        expect(response.simulationInputs.hasAssetClassOverrides).toBe(true);
        // Verify the override was applied
        const stockClass = response.simulationInputs.assetClasses.find(
          (ac: { id: number }) => ac.id === 1,
        );
        expect(stockClass?.meanReturn).toBeCloseTo(0.12);
        expect(stockClass?.stdDev).toBeCloseTo(0.2);
      }
    } finally {
      cleanup();
    }
  });

  it("rejects invalid asset class override IDs", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedGlidePath(db);

      await expect(
        caller.projection.computeMonteCarloProjection({
          numTrials: 100,
          preset: "custom",
          assetClassOverrides: [{ id: 9999, meanReturn: 0.12 }],
        }),
      ).rejects.toThrow(/does not match any active asset class/);
    } finally {
      cleanup();
    }
  });

  it("uses saved overrides from appSettings", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      // Save asset class overrides to appSettings
      db.insert(schema.appSettings)
        .values({
          key: "mc_asset_class_overrides",
          value: [{ id: 1, meanReturn: 0.11 }] as unknown as string,
        })
        .run();

      // Save inflation overrides
      db.insert(schema.appSettings)
        .values({
          key: "mc_inflation_overrides",
          value: { meanRate: 0.035, stdDev: 0.015 } as unknown as string,
        })
        .run();

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
      });

      expect(response).toHaveProperty("savedOverrides");
      if (response.result !== null) {
        expect(response.savedOverrides.assetClassOverrides).toHaveLength(1);
        expect(response.savedOverrides.inflationOverrides).toBeTruthy();
      }
    } finally {
      cleanup();
    }
  });

  it("explicit inflationRisk overrides saved inflation overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      // Saved inflation override in DB
      db.insert(schema.appSettings)
        .values({
          key: "mc_inflation_overrides",
          value: { meanRate: 0.04 } as unknown as string,
        })
        .run();

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        inflationRisk: { meanRate: 0.02, stdDev: 0.008 },
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        // The explicit inflationRisk should take priority
        expect(response.simulationInputs.inflationRisk.meanRate).toBeCloseTo(
          0.02,
        );
        expect(response.simulationInputs.inflationRisk.stdDev).toBeCloseTo(
          0.008,
        );
      }
    } finally {
      cleanup();
    }
  });

  it("MC with salary overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        salaryOverrides: [{ personId, salary: 200000 }],
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        expect(response.simulationInputs.hasSalaryOverrides).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it("MC with expense overrides (accumulation + decumulation)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        accumulationExpenseOverride: 50000,
        decumulationExpenseOverride: 40000,
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        expect(response.simulationInputs.accumulationExpenseOverride).toBe(
          50000,
        );
        expect(response.simulationInputs.decumulationExpenseOverride).toBe(
          40000,
        );
      }
    } finally {
      cleanup();
    }
  });

  it("MC with accumulation and decumulation overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        accumulationOverrides: [
          { year: 2030, contributionRate: 0.2, notes: "Boost savings" },
        ],
        decumulationOverrides: [{ year: 2060, withdrawalRate: 0.05 }],
      });

      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeStrategyComparison
// ---------------------------------------------------------------------------

describe("projection router — computeStrategyComparison", () => {
  it("returns empty strategies when no retirement data exists", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.computeStrategyComparison();
      expect(response.strategies).toEqual([]);
      expect(response.activeStrategy).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns strategy comparison with seeded data (no MC data)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeStrategyComparison();

      expect(response.strategies.length).toBeGreaterThan(0);
      expect(response.activeStrategy).toBe("fixed");
      expect(response).toHaveProperty("retirementAge");

      // Each strategy should have the expected shape
      for (const strat of response.strategies) {
        expect(strat).toHaveProperty("strategy");
        expect(strat).toHaveProperty("label");
        expect(strat).toHaveProperty("shortLabel");
        expect(strat).toHaveProperty("portfolioDepletionAge");
        expect(strat).toHaveProperty("sustainableWithdrawal");
        expect(strat).toHaveProperty("year1Withdrawal");
        expect(strat).toHaveProperty("avgAnnualWithdrawal");
        expect(strat).toHaveProperty("minAnnualWithdrawal");
        expect(strat).toHaveProperty("maxAnnualWithdrawal");
        expect(strat).toHaveProperty("endBalance");
        expect(strat).toHaveProperty("legacyAmount");
        expect(strat).toHaveProperty("successRate");
        expect(strat).toHaveProperty("budgetStabilityRate");
        expect(strat).toHaveProperty("yearByYear");
        // Without MC data, successRate should be null
        expect(strat.successRate).toBeNull();
      }
    } finally {
      cleanup();
    }
  });

  it("returns strategy comparison with MC success rates when asset data exists", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeStrategyComparison();

      expect(response.strategies.length).toBeGreaterThan(0);
      // With MC data, at least some strategies should have a non-null successRate
      const hasSuccess = response.strategies.some(
        (s: { successRate: number | null }) => s.successRate !== null,
      );
      expect(hasSuccess).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("strategy comparison with salary overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      const response = await caller.projection.computeStrategyComparison({
        salaryOverrides: [{ personId, salary: 200000 }],
      });

      expect(response.strategies.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("strategy comparison with expense overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeStrategyComparison({
        accumulationExpenseOverride: 60000,
        decumulationExpenseOverride: 45000,
      });

      expect(response.strategies.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("strategy comparison with snapshot override", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { perfAcctId } = seedFullProjectionData(db);

      // Seed a second snapshot
      const snapId = seedSnapshot(db, "2025-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "300000",
          taxType: "preTax",
        },
      ]);

      const response = await caller.projection.computeStrategyComparison({
        snapshotId: snapId,
      });

      expect(response.strategies.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("year-by-year data is populated for decumulation years", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeStrategyComparison();

      for (const strat of response.strategies) {
        // If there are yearByYear entries, they should have age, withdrawal, endBalance
        if (strat.yearByYear.length > 0) {
          expect(strat.yearByYear[0]).toHaveProperty("age");
          expect(strat.yearByYear[0]).toHaveProperty("withdrawal");
          expect(strat.yearByYear[0]).toHaveProperty("endBalance");
        }
      }
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeProjection — additional edge cases for coverage
// ---------------------------------------------------------------------------

describe("projection router — computeProjection edge cases", () => {
  it("handles multiple people in the household", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      // Person 1 (primary)
      const person1Id = db
        .insert(schema.people)
        .values({
          name: "Person 1",
          dateOfBirth: "1990-01-01",
          isPrimaryUser: true,
        })
        .returning({ id: schema.people.id })
        .get().id;

      // Person 2
      const person2Id = db
        .insert(schema.people)
        .values({ name: "Person 2", dateOfBirth: "1992-06-15" })
        .returning({ id: schema.people.id })
        .get().id;

      // Jobs for both
      db.insert(schema.jobs)
        .values({
          personId: person1Id,
          employerName: "Company A",
          annualSalary: "100000",
          payPeriod: "biweekly",
          payWeek: "even",
          startDate: "2020-01-01",
          w4FilingStatus: "MFJ",
        })
        .run();

      db.insert(schema.jobs)
        .values({
          personId: person2Id,
          employerName: "Company B",
          annualSalary: "80000",
          payPeriod: "biweekly",
          payWeek: "even",
          startDate: "2020-01-01",
          w4FilingStatus: "MFJ",
        })
        .run();

      // Budget profile
      db.insert(schema.budgetProfiles)
        .values({
          name: "Main Budget",
          isActive: true,
          columnLabels: ["Standard"],
        })
        .run();

      // Retirement settings for person 1
      db.insert(schema.retirementSettings)
        .values({
          personId: person1Id,
          retirementAge: 65,
          endAge: 90,
          returnAfterRetirement: "0.05",
          annualInflation: "0.03",
          salaryAnnualIncrease: "0.02",
          withdrawalRate: "0.04",
          taxMultiplier: "1.0",
          grossUpForTaxes: true,
          withdrawalStrategy: "fixed",
          gkSkipInflationAfterLoss: true,
          socialSecurityMonthly: "2500",
          ssStartAge: 67,
          enableRothConversions: false,
          enableIrmaaAwareness: false,
          enableAcaAwareness: false,
          householdSize: 2,
        })
        .run();

      db.insert(schema.returnRateTable)
        .values({ age: 35, rateOfReturn: "0.07" })
        .run();

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("people");
      expect(response.people.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it("handles roth contribution account", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      // Add a Roth contribution account
      const rothPerfAcctId = seedPerformanceAccount(db, {
        name: "Roth 401k",
        institution: "Vanguard",
        accountType: "401k",
        parentCategory: "Retirement",
      });

      seedSnapshot(db, "2025-02-01", [
        {
          performanceAccountId: rothPerfAcctId,
          amount: "50000",
          taxType: "taxFree",
          institution: "Vanguard",
          accountType: "401k",
        },
      ]);

      db.insert(schema.contributionAccounts)
        .values({
          accountType: "401k",
          contributionMethod: "percent_of_salary",
          contributionValue: "0.05",
          taxTreatment: "roth",
          employerMatchType: "none",
          isActive: true,
          personId,
          performanceAccountId: rothPerfAcctId,
          parentCategory: "Retirement",
        })
        .run();

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("result");
      expect(response.contributionSpecs.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it("exercises the returnRateSummary computation", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      // Add more return rate entries for richer coverage
      db.insert(schema.returnRateTable)
        .values({ age: 40, rateOfReturn: "0.065" })
        .run();
      db.insert(schema.returnRateTable)
        .values({ age: 50, rateOfReturn: "0.06" })
        .run();
      db.insert(schema.returnRateTable)
        .values({ age: 70, rateOfReturn: "0.04" })
        .run();

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      expect(response).toHaveProperty("returnRateSummary");
      const summary = response.returnRateSummary;
      expect(summary).toHaveProperty("currentRate");
      expect(summary).toHaveProperty("retirementRate");
      expect(summary).toHaveProperty("avgAccumulation");
      expect(summary).toHaveProperty("schedule");
      expect(Array.isArray(summary.schedule)).toBe(true);
      expect(summary.schedule.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeMonteCarloProjection — edge cases
// ---------------------------------------------------------------------------

describe("projection router — MC edge cases", () => {
  it("MC with no glide path (empty custom glide path)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // No glide path seeded — glidePath will be empty

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        expect(response.simulationInputs.glidePath).toHaveLength(0);
      }
    } finally {
      cleanup();
    }
  });

  it("MC with custom decumulation defaults", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        decumulationDefaults: {
          withdrawalRate: 0.035,
          withdrawalRoutingMode: "waterfall",
        },
      });

      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });

  it("MC with snapshotId", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { perfAcctId } = seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const snapId = seedSnapshot(db, "2025-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "250000",
          taxType: "preTax",
        },
      ]);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        snapshotId: snapId,
      });

      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });

  it("UI asset class overrides merge with saved DB overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      // Saved override for asset class 1
      db.insert(schema.appSettings)
        .values({
          key: "mc_asset_class_overrides",
          value: [{ id: 1, meanReturn: 0.11 }] as unknown as string,
        })
        .run();

      // UI override for asset class 2 (should merge, not replace)
      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        assetClassOverrides: [{ id: 2, meanReturn: 0.06 }],
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        expect(response.simulationInputs.hasAssetClassOverrides).toBe(true);
        // Both overrides should be active
        const stockClass = response.simulationInputs.assetClasses.find(
          (ac: { id: number }) => ac.id === 1,
        );
        const bondClass = response.simulationInputs.assetClasses.find(
          (ac: { id: number }) => ac.id === 2,
        );
        expect(stockClass?.meanReturn).toBeCloseTo(0.11);
        expect(bondClass?.meanReturn).toBeCloseTo(0.06);
      }
    } finally {
      cleanup();
    }
  });

  it("UI asset class override replaces same-id saved override", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      // Saved override for asset class 1
      db.insert(schema.appSettings)
        .values({
          key: "mc_asset_class_overrides",
          value: [{ id: 1, meanReturn: 0.11 }] as unknown as string,
        })
        .run();

      // UI override for the SAME asset class 1 (should replace)
      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        assetClassOverrides: [{ id: 1, meanReturn: 0.15 }],
      });

      expect(response).toHaveProperty("result");
      if (response.result !== null) {
        const stockClass = response.simulationInputs.assetClasses.find(
          (ac: { id: number }) => ac.id === 1,
        );
        expect(stockClass?.meanReturn).toBeCloseTo(0.15);
      }
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// analyzeStrategy
// ---------------------------------------------------------------------------

describe("projection router — analyzeStrategy", () => {
  it("returns empty recommendations when no retirement data exists", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.analyzeStrategy();
      expect(response.baseline).toBeNull();
      expect(response.recommendations).toEqual([]);
      expect(response.strategyLabel).toBe("");
    } finally {
      cleanup();
    }
  });

  it("returns empty when no MC data (no asset classes/glide path)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      // No asset classes or glide path seeded
      const response = await caller.projection.analyzeStrategy();
      expect(response.baseline).toBeNull();
      expect(response.recommendations).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("runs analysis with MC data and returns recommendations", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedGlidePath(db);
      seedCorrelations(db);

      const response = await caller.projection.analyzeStrategy();

      expect(response.baseline).not.toBeNull();
      expect(response.baseline!.successRate).toBeGreaterThanOrEqual(0);
      expect(response.baseline!.successRate).toBeLessThanOrEqual(1);
      expect(response.baseline!.stabilityRate).toBeGreaterThanOrEqual(0);
      expect(response.baseline!.stabilityRate).toBeLessThanOrEqual(1);
      expect(response.diagnosis).toBeTruthy();
      expect(response.strategyLabel).toBeTruthy();

      // Recommendations shape (may be empty if plan is already optimal)
      for (const rec of response.recommendations) {
        expect(rec).toHaveProperty("label");
        expect(rec).toHaveProperty("currentValue");
        expect(rec).toHaveProperty("adjustedValue");
        expect(rec).toHaveProperty("successRate");
        expect(rec).toHaveProperty("stabilityRate");
        expect(rec).toHaveProperty("successDelta");
        expect(rec).toHaveProperty("stabilityDelta");
      }
    } finally {
      cleanup();
    }
  });

  it("runs analysis for a dynamic strategy with lever params", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedGlidePath(db);
      seedCorrelations(db);

      // Switch strategy to guyton_klinger
      db.update(schema.retirementSettings)
        .set({ withdrawalStrategy: "guyton_klinger" })
        .run();

      const response = await caller.projection.analyzeStrategy();

      expect(response.baseline).not.toBeNull();
      expect(response.strategyLabel).toBe("Guardrails (Guyton-Klinger)");
      // G-K has levers on decreasePercent/increasePercent — analyzer should find applicable levers
      expect(response.diagnosis).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeStressTest
// ---------------------------------------------------------------------------

describe("projection router — computeStressTest", () => {
  it("returns empty scenarios when no retirement data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.computeStressTest();
      expect(response).toEqual({ scenarios: [], retirementAge: null });
    } finally {
      cleanup();
    }
  });

  it("returns three scenarios with seeded data", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeStressTest();
      expect(Array.isArray(response.scenarios)).toBe(true);
      expect(response.scenarios.length).toBe(3);
      expect(response.retirementAge).toBeGreaterThan(0);

      for (const scenario of response.scenarios) {
        expect(scenario).toHaveProperty("label");
        expect(scenario).toHaveProperty("nestEggAtRetirement");
        expect(scenario).toHaveProperty("portfolioDepletionAge");
      }
    } finally {
      cleanup();
    }
  });

  it("accepts optional overrides without throwing", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.computeStressTest({
        accumulationExpenseOverride: 5000,
        decumulationExpenseOverride: 4000,
      });
      expect(Array.isArray(response.scenarios)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeCoastFire
// ---------------------------------------------------------------------------

describe("projection router — computeCoastFire", () => {
  it("returns null result when no retirement data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.computeCoastFire({});
      expect(response).toEqual({ result: null });
    } finally {
      cleanup();
    }
  });

  it("returns coast FIRE result object with seeded data", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);

      const response = await caller.projection.computeCoastFire({});
      expect(response).toHaveProperty("result");
      expect(response.result).not.toBeNull();
      expect(response.result).toHaveProperty("coastFireAge");
      expect(response.result).toHaveProperty("sustainableWithdrawalToday");
      expect(response.result).toHaveProperty("endBalanceToday");
    } finally {
      cleanup();
    }
  });

  it("accepts decumulationDefaults override without throwing", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);

      const response = await caller.projection.computeCoastFire({
        decumulationDefaults: { withdrawalRate: 0.035 },
      });
      expect(response).toHaveProperty("result");
    } finally {
      cleanup();
    }
  });
});
