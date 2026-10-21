/**
 * Projection router integration tests.
 *
 * Covers MC user preset CRUD, return-rate table upserts, glide-path allocation
 * replace, clamp bounds, inflation risk, asset-class overrides, inflation
 * overrides, and a best-effort computeProjection smoke test.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestCaller,
  seedContributionProfile,
  seedPerformanceAccount,
  seedStandardDataset,
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

// ---------------------------------------------------------------------------
// updateGlidePathAllocations
// ---------------------------------------------------------------------------

describe("projection router — updateGlidePathAllocations", () => {
  it("replaces glide path with new entries and returns row count", async () => {
    const { caller: c, db: testDb, cleanup } = await createTestCaller();
    try {
      seedAssetClasses(testDb);
      const result = await c.projection.updateGlidePathAllocations({
        entries: [
          { age: 30, allocations: { 1: 0.8, 2: 0.2 } },
          { age: 50, allocations: { 1: 0.5, 2: 0.5 } },
          { age: 65, allocations: { 1: 0.2, 2: 0.8 } },
        ],
      });
      // 3 entries × 2 asset classes = 6 rows
      expect(result.updated).toBe(6);
    } finally {
      cleanup();
    }
  });

  it("clears the glide path when called with empty entries", async () => {
    const { caller: c, db: testDb, cleanup } = await createTestCaller();
    try {
      seedAssetClasses(testDb);
      // First seed some data
      await c.projection.updateGlidePathAllocations({
        entries: [{ age: 30, allocations: { 1: 1.0 } }],
      });
      // Now clear it
      const result = await c.projection.updateGlidePathAllocations({
        entries: [],
      });
      expect(result.updated).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("replaces (delete+insert) existing allocations on second call", async () => {
    const { caller: c, db: testDb, cleanup } = await createTestCaller();
    try {
      seedAssetClasses(testDb);
      await c.projection.updateGlidePathAllocations({
        entries: [{ age: 40, allocations: { 1: 0.7, 2: 0.3 } }],
      });
      // Replace with different allocations — should not throw a unique-constraint error
      const result = await c.projection.updateGlidePathAllocations({
        entries: [{ age: 40, allocations: { 1: 0.6, 2: 0.4 } }],
      });
      expect(result.updated).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("ignores non-numeric asset class keys", async () => {
    const { caller: c, db: testDb, cleanup } = await createTestCaller();
    try {
      seedAssetClasses(testDb);
      const result = await c.projection.updateGlidePathAllocations({
        entries: [
          {
            age: 30,
            // "bad" key is NaN → skipped, "1" is valid
            allocations: { bad: 0.5, "1": 0.5 } as Record<string, number>,
          },
        ],
      });
      // Only the valid numeric key produces a row
      expect(result.updated).toBe(1);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateClampBounds
// ---------------------------------------------------------------------------

describe("projection router — updateClampBounds", () => {
  it("updates clamp bounds for the custom preset row and returns success", async () => {
    const { caller: c, db, cleanup } = await createTestCaller();
    try {
      // Seed a custom mc_preset row so the update has a target
      db.insert(schema.mcPresets)
        .values({
          key: "custom",
          label: "Custom",
          description: "Custom preset",
          returnMultiplier: "1.0",
          volMultiplier: "1.0",
          inflationMean: "0.025",
          inflationStdDev: "0.012",
          defaultTrials: 1000,
          returnClampMin: "-0.5",
          returnClampMax: "1.0",
          sortOrder: 99,
          isActive: true,
        })
        .run();

      const result = await c.projection.updateClampBounds({
        preset: "custom",
        returnClampMin: -0.4,
        returnClampMax: 0.8,
      });
      expect(result.updated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("rejects preset values other than 'custom'", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      await expect(
        c.projection.updateClampBounds({
          // @ts-expect-error — testing invalid input
          preset: "aggressive",
          returnClampMin: -0.5,
          returnClampMax: 1.0,
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateInflationRisk
// ---------------------------------------------------------------------------

describe("projection router — updateInflationRisk", () => {
  it("updates inflation risk for a named preset row", async () => {
    const { caller: c, db, cleanup } = await createTestCaller();
    try {
      // Seed a default mc_preset row
      db.insert(schema.mcPresets)
        .values({
          key: "default",
          label: "Default",
          description: "Default preset",
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

      const result = await c.projection.updateInflationRisk({
        preset: "default",
        inflationMean: 0.03,
        inflationStdDev: 0.015,
      });
      expect(result.updated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("accepts all four named preset keys", async () => {
    for (const key of ["aggressive", "default", "conservative"] as const) {
      const { caller: c, db, cleanup } = await createTestCaller();
      try {
        db.insert(schema.mcPresets)
          .values({
            key,
            label: key,
            description: `${key} preset`,
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

        const result = await c.projection.updateInflationRisk({
          preset: key,
          inflationMean: 0.03,
          inflationStdDev: 0.015,
        });
        expect(result.updated).toBe(true);
      } finally {
        cleanup();
      }
    }
  });

  it("rejects an invalid preset key", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      await expect(
        c.projection.updateInflationRisk({
          // @ts-expect-error — testing invalid input
          preset: "unknown_preset",
          inflationMean: 0.03,
          inflationStdDev: 0.015,
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateAssetClassOverrides
// ---------------------------------------------------------------------------

describe("projection router — updateAssetClassOverrides", () => {
  it("persists overrides to appSettings and returns count", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      const result = await c.projection.updateAssetClassOverrides([
        { id: 1, meanReturn: 0.08, stdDev: 0.16 },
        { id: 2, meanReturn: 0.04, stdDev: 0.05 },
      ]);
      expect(result.updated).toBe(true);
      expect(result.count).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("clears overrides when called with empty array", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      // Seed some overrides first
      await c.projection.updateAssetClassOverrides([
        { id: 1, meanReturn: 0.08 },
      ]);
      // Now clear
      const result = await c.projection.updateAssetClassOverrides([]);
      expect(result.updated).toBe(true);
      expect(result.count).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("upserts (idempotent) — second write replaces first", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      await c.projection.updateAssetClassOverrides([
        { id: 1, meanReturn: 0.07 },
      ]);
      const result = await c.projection.updateAssetClassOverrides([
        { id: 1, meanReturn: 0.09 },
        { id: 2, stdDev: 0.2 },
      ]);
      expect(result.count).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("allows partial overrides (only meanReturn or only stdDev)", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      const result = await c.projection.updateAssetClassOverrides([
        { id: 3, meanReturn: 0.06 },
        { id: 4, stdDev: 0.12 },
      ]);
      expect(result.updated).toBe(true);
      expect(result.count).toBe(2);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateInflationOverrides
// ---------------------------------------------------------------------------

describe("projection router — updateInflationOverrides", () => {
  it("persists inflation overrides to appSettings", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      const result = await c.projection.updateInflationOverrides({
        meanRate: 0.035,
        stdDev: 0.012,
      });
      expect(result.updated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("upserts — second call replaces first without error", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      await c.projection.updateInflationOverrides({ meanRate: 0.03 });
      const result = await c.projection.updateInflationOverrides({
        meanRate: 0.04,
        stdDev: 0.015,
      });
      expect(result.updated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("clears overrides when called with no fields", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      await c.projection.updateInflationOverrides({ meanRate: 0.03 });
      // Empty object → isEmpty = true → deletes the row
      const result = await c.projection.updateInflationOverrides({});
      expect(result.updated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("accepts meanRate-only override", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      const result = await c.projection.updateInflationOverrides({
        meanRate: 0.025,
      });
      expect(result.updated).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("accepts stdDev-only override", async () => {
    const { caller: c, cleanup } = await createTestCaller();
    try {
      const result = await c.projection.updateInflationOverrides({
        stdDev: 0.01,
      });
      expect(result.updated).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeProjection — smoke test with seeded data
// ---------------------------------------------------------------------------

describe("projection router — computeProjection", () => {
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

  /**
   * Seeds the minimal data required for buildEnginePayload to return a non-null
   * payload: a primary person with retirement settings and a return-rate entry.
   * Adds a job, portfolio snapshot, and contribution account for richer coverage.
   */
  function seedProjectionData() {
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
        filingStatus: "MFJ",
      })
      .run();

    // Return rate table (at least one entry for schedule)
    db.insert(schema.returnRateTable)
      .values({ age: 35, rateOfReturn: "0.07" })
      .run();
    db.insert(schema.returnRateTable)
      .values({ age: 65, rateOfReturn: "0.05" })
      .run();

    // Contribution account linked to the person's job
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

  it("returns result: null when metadataOnly is true (no engine run)", async () => {
    seedProjectionData();
    const response = await caller.projection.computeProjection({
      metadataOnly: true,
      accumulationOverrides: [],
      decumulationOverrides: [],
    });
    expect(response.result).toBeNull();
  });

  it("returns null result when no retirement settings exist (empty DB)", async () => {
    const { caller: emptyCtx, cleanup: emptyCleanup } =
      await createTestCaller();
    try {
      const response = await emptyCtx.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });
      // No person → buildEnginePayload returns null → result is null
      expect(response.result).toBeNull();
    } finally {
      emptyCleanup();
    }
  });

  it("runs the engine on the seeded household", async () => {
    const response = await caller.projection.computeProjection({
      accumulationOverrides: [],
      decumulationOverrides: [],
    });
    expect(response.result).not.toBeNull();
    expect(response.combinedSalary).toBe(120000);
    expect(response.people).toHaveLength(1);
    expect(response.primaryPersonId).toBe(response.people[0]!.id);
    expect(response.annualExpenses).toBeGreaterThan(0);
    expect(response.result!.projectionByYear.length).toBeGreaterThan(0);
  });

  it("echoes the saved unspent-RMD account (the Retirement settings picker reads it)", async () => {
    const brokerage = seedPerformanceAccount(db, {
      name: "Echo brokerage",
      accountType: "brokerage",
      parentCategory: "Retirement",
    });
    db.update(schema.retirementSettings)
      .set({ rmdExcessTargetPerformanceAccountId: brokerage })
      .run();
    try {
      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });
      expect(response.settings?.rmdExcessTargetPerformanceAccountId).toBe(
        brokerage,
      );
    } finally {
      db.update(schema.retirementSettings)
        .set({ rmdExcessTargetPerformanceAccountId: null })
        .run();
    }
  });

  it("a saved unspent-RMD account that's no longer a Retirement brokerage falls back with a warning", async () => {
    const moved = seedPerformanceAccount(db, {
      name: "Moved brokerage",
      accountType: "brokerage",
      parentCategory: "Portfolio",
    });
    db.update(schema.retirementSettings)
      .set({ rmdExcessTargetPerformanceAccountId: moved })
      .run();
    try {
      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });
      expect(
        response.result!.warnings.filter((w) =>
          w.includes("no longer a Retirement brokerage"),
        ),
      ).toHaveLength(1);
    } finally {
      db.update(schema.retirementSettings)
        .set({ rmdExcessTargetPerformanceAccountId: null })
        .run();
    }
  });

  it("the contribution rate counts retirement contributions only", async () => {
    const rate = async (contributionProfileId: number) => {
      const r = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
        contributionProfileId,
      });
      return r.result!.projectionByYear.find((y) => y.phase === "accumulation")!
        .config.contributionRate;
    };
    // Contributions count through the active Contribution Profile.
    const person = db.select().from(schema.people).get()!;
    const job = db.select().from(schema.jobs).get()!;
    const retirement401k = db.select().from(schema.contributionAccounts).get()!;
    // A percent-of-salary contribution is measured against its job's pay.
    db.update(schema.contributionAccounts)
      .set({ jobId: job.id })
      .where(eq(schema.contributionAccounts.id, retirement401k.id))
      .run();
    const portfolioPerf = seedPerformanceAccount(db, {
      name: "Long-term brokerage",
      accountType: "brokerage",
      parentCategory: "Portfolio",
    });
    const portfolioBrokerage = db
      .insert(schema.contributionAccounts)
      .values({
        accountType: "brokerage",
        taxTreatment: "after_tax",
        employerMatchType: "none",
        isActive: true,
        personId: person.id,
        jobId: job.id,
        performanceAccountId: portfolioPerf,
        parentCategory: "Portfolio",
      })
      .returning()
      .get();
    const profile = (withPortfolio: boolean, retirementPct = "10") =>
      seedContributionProfile(db, {
        name: `${withPortfolio ? "With Portfolio savings" : "Retirement only"} ${retirementPct}%`,
        isActive: false,
        contributionActiveFields: {
          contributionAccounts: {
            [String(retirement401k.id)]: {
              contributionMethod: "percent_of_salary",
              contributionValue: retirementPct,
            },
            ...(withPortfolio
              ? {
                  [String(portfolioBrokerage.id)]: {
                    contributionMethod: "fixed_monthly",
                    contributionValue: "1000",
                  },
                }
              : {}),
          },
          deductions: {},
        },
      });
    const retirementOnly = await rate(profile(false));
    const withPortfolio = await rate(profile(true));
    // 10% of salary either way; the $12,000 a year of Portfolio savings
    // isn't a retirement contribution.
    expect(retirementOnly).toBeCloseTo(0.1, 2);
    expect(withPortfolio).toBeCloseTo(retirementOnly, 6);
    // Saving only into Portfolio money is a 0% retirement rate — not the
    // 25% fallback for missing data (it invented retirement contributions
    // wherever the rate path runs, e.g. Simple tax mode).
    expect(await rate(profile(true, "0"))).toBe(0);
  });
});
