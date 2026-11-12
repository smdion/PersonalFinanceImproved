/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * Projection router coverage tests.
 *
 * Targets uncovered procedures: computeProjection (full result path),
 * computeMonteCarloProjection, and computeStrategyComparison.
 * Supplements projection.test.ts without duplicating its tests.
 */
import "./setup-mocks";
import {
  vi,
  describe,
  it,
  expect,
  assert,
  beforeEach,
  afterEach,
} from "vitest";
import {
  createTestCaller,
  seedStandardDataset,
  seedPerformanceAccount,
  seedSnapshot,
  seedContributionProfile,
  seedJob,
  adminSession,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";
import { eq } from "drizzle-orm";
import { clearSimulationPresets } from "../helpers/db-harness";
import { DEFAULT_SIMULATION } from "@/lib/constants";
import { defaultDecumulationConfig } from "@/lib/config/account-types";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// The simulation runs in-process with a handful of trials instead of on the
// worker thread at full size. These tests check the routers and the
// projection cache, not the simulation's statistics (pure/simulation/
// monte-carlo* and the worker client have their own tests), and a full-size
// run here cost minutes. The real engine still runs, so results are real;
// `mcRuns` counts runs so cache tests can prove a hit doesn't recompute.
const mcRuns = vi.hoisted(() => ({ count: 0 }));
// The cache blocks count runs and compare results, never a rate, so they
// run 5 trials (`fewTrialsForCacheTests`); every other case runs 25.
const mcTrialCap = vi.hoisted(() => ({ value: 25 }));
vi.mock("@/server/services/simulation/monte-carlo-worker-client", async () => {
  const { calculateMonteCarlo } =
    await import("@/lib/pure/simulation/monte-carlo");
  return {
    runMonteCarloOffThread: async (
      input: Parameters<typeof calculateMonteCarlo>[0],
    ) => {
      mcRuns.count++;
      return calculateMonteCarlo({
        ...input,
        numTrials: Math.min(input.numTrials, mcTrialCap.value),
      });
    },
    getMonteCarloProgress: () => null,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** For a cache describe block: its cases run 5 trials, then back to 25. */
function fewTrialsForCacheTests() {
  beforeEach(() => {
    mcTrialCap.value = 5;
  });
  afterEach(() => {
    mcTrialCap.value = 25;
  });
}

/** Two asset class rows (in place of the shipped ones) so glide path FK
 *  references work. */
function seedAssetClasses(db: BetterSQLite3Database<typeof sqliteSchema>) {
  clearSimulationPresets(db);
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
  const { personId, jobId, perfAcctId, snapId } = seedStandardDataset(db);

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
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      isActive: true,
      personId,
      performanceAccountId: perfAcctId,
      parentCategory: "Retirement",
    })
    .run();

  return { personId, jobId, perfAcctId, snapId };
}

type Caller = Awaited<ReturnType<typeof createTestCaller>>["caller"];
type ProjectionInput = Parameters<Caller["projection"]["computeProjection"]>[0];
const NO_OVERRIDES = { accumulationOverrides: [], decumulationOverrides: [] };

/** Year rows of a deterministic projection; fails if it didn't run. */
async function projectionRows(
  caller: Caller,
  input: Partial<ProjectionInput> = {},
) {
  const response = await caller.projection.computeProjection({
    ...NO_OVERRIDES,
    ...input,
  });
  expect(response.result).not.toBeNull();
  return response.result!.projectionByYear;
}

/** Year-end balances of a deterministic projection. */
async function balances(caller: Caller, input: Partial<ProjectionInput> = {}) {
  return (await projectionRows(caller, input)).map((y) => y.allAccountsBalance);
}

/** The resolved decumulation config the engine used in `year`. */
function decumulationConfig(
  rows: Awaited<ReturnType<typeof projectionRows>>,
  year: number,
) {
  const row = rows.find((r) => r.year === year)!;
  expect(row.phase).toBe("decumulation");
  return row.config as {
    withdrawalRate: number;
    withdrawalRoutingMode: string;
  };
}

// ---------------------------------------------------------------------------
// computeProjection — persistent projection cache
// ---------------------------------------------------------------------------

describe("projection router — computeProjection cache", () => {
  it("a second identical call is served from cache (same result, one cache row)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      const input = { accumulationOverrides: [], decumulationOverrides: [] };

      const first = await caller.projection.computeProjection(input);
      const second = await caller.projection.computeProjection(input);

      expect(second.result).toEqual(first.result);
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("a changed input misses the cache and computes fresh (different hash rows)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });
      await caller.projection.computeProjection({
        selection: { accumulationBudget: { annualExpenses: 50000 } },
        accumulationOverrides: [],
        decumulationOverrides: [],
      });

      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it("the metadata query does not read or write the cache", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response = await caller.projection.getProjectionMetadata({});

      expect(response.result).toBeNull();
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("the metadata query is computeProjection's response with no result", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      const full = await caller.projection.computeProjection({});
      const meta = await caller.projection.getProjectionMetadata({});
      expect(full.result).not.toBeNull();
      expect(meta).toEqual({ ...full, result: null });
    } finally {
      cleanup();
    }
  });

  it("forceRefresh bypasses an existing cache hit and recomputes", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      const input = { accumulationOverrides: [], decumulationOverrides: [] };

      await caller.projection.computeProjection(input);
      const before = db.select().from(schema.projectionCache).all();
      expect(before).toHaveLength(1);
      const computedAtBefore = before[0]!.computedAt;

      await caller.projection.computeProjection({
        ...input,
        forceRefresh: true,
      });

      const after = db.select().from(schema.projectionCache).all();
      expect(after).toHaveLength(1);
      expect(after[0]!.computedAt.getTime()).toBeGreaterThanOrEqual(
        computedAtBefore.getTime(),
      );
    } finally {
      cleanup();
    }
  });
});

describe("projection router — computeProjection edge cases (continued)", () => {
  it("no return rate at or below the current age: a typed state, not a throw", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      // Only the age-65 breakpoint is left, past the household's age.
      db.delete(schema.returnRateTable)
        .where(eq(schema.returnRateTable.age, 35))
        .run();
      expect(await caller.projection.computeProjection({})).toEqual({
        result: null,
        notConfigured: "no_return_rate",
      });
      expect(await caller.projection.computeCoastFire({})).toEqual({
        result: null,
        notConfigured: "no_return_rate",
      });
    } finally {
      cleanup();
    }
  });

  it("no return rate: a metadata read still gets settings and budgets", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      db.delete(schema.returnRateTable).run();
      const meta = await caller.projection.getProjectionMetadata({});
      expect(meta).not.toHaveProperty("notConfigured");
      expect(meta).toHaveProperty("settings");
    } finally {
      cleanup();
    }
  });

  it("no return rate: the strategy comparison says to set one", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      db.delete(schema.returnRateTable).run();
      expect(await caller.projection.computeStrategyComparison()).toEqual({
        strategies: [],
        activeStrategy: null,
        notConfigured: "no_return_rate",
      });
    } finally {
      cleanup();
    }
  });

  it("client decumulation defaults set the routing mode, not the rate", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const rows = await projectionRows(caller, {
        decumulationDefaults: { withdrawalRoutingMode: "waterfall" },
      });

      // The client's routing mode wins over the household setting; the
      // withdrawal rate always comes from retirement_settings (4%).
      const retired = rows.filter((r) => r.phase === "decumulation");
      expect(retired.length).toBeGreaterThan(0);
      for (const r of retired) {
        expect(decumulationConfig(rows, r.year)).toMatchObject({
          withdrawalRate: 0.04,
          withdrawalRoutingMode: "waterfall",
        });
      }
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

      seedJob(db, personId, {
        employerName: "TestCo",
        startDate: "2020-01-01",
        annualSalary: "120000",
      });

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
          filingStatus: "MFJ",
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
      expect(response.result).not.toBeNull();
      expect(response.result!.warnings.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("an accumulation contribution rate caps savings from its year on", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const base = await projectionRows(caller);
      const capped = await projectionRows(caller, {
        accumulationOverrides: [
          {
            year: 2030,
            contributionRate: 0.15,
            routingMode: "waterfall",
            notes: "Cap savings",
          },
        ],
      });

      // The fixture saves ~25% of pay (401k + savings goal); contributionRate
      // is the total-savings ceiling, so 15% from 2030 saves less — and
      // leaves earlier years alone.
      const at = (rows: typeof base, year: number) =>
        rows.find((r) => r.year === year)!.allAccountsBalance;
      expect(at(capped, 2029)).toBe(at(base, 2029));
      expect(at(capped, 2030)).toBeLessThan(at(base, 2030));
    } finally {
      cleanup();
    }
  });

  it("applies decumulation overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const rows = await projectionRows(caller, {
        decumulationOverrides: [
          {
            year: 2060,
            withdrawalRoutingMode: "waterfall",
            notes: "Switch routing",
          },
        ],
      });

      // Sticky-forward from 2060; the year before keeps the household's
      // default (bracket filling).
      const mode = (year: number) =>
        decumulationConfig(rows, year).withdrawalRoutingMode;
      expect(mode(2059)).not.toBe("waterfall");
      expect(mode(2060)).toBe("waterfall");
      expect(mode(2070)).toBe("waterfall");
    } finally {
      cleanup();
    }
  });

  it("exercises budget expense override paths", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const base = await balances(caller);
      const response = await caller.projection.computeProjection({
        selection: {
          accumulationBudget: { annualExpenses: 50000 },
          decumulationBudget: { annualExpenses: 40000 },
        },
        ...NO_OVERRIDES,
      });

      expect(response.result).not.toBeNull();
      expect(
        response.result!.projectionByYear.map((y) => y.allAccountsBalance),
      ).not.toEqual(base);
    } finally {
      cleanup();
    }
  });

  it("uses snapshotId parameter", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { perfAcctId, snapId } = seedFullProjectionData(db);

      // A newer, richer snapshot becomes the default...
      seedSnapshot(db, "2025-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "200000",
          taxType: "preTax",
        },
      ]);

      const latest = await balances(caller);
      // ...and snapshotId picks the original $100k one instead.
      const older = await balances(caller, { snapshotId: snapId });

      expect(older[0]!).toBeLessThan(latest[0]!);
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
    } finally {
      cleanup();
    }
  });

  it("Custom's clamp bounds are saved and the simulation reads them", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      await caller.projection.updateClampBounds({
        preset: "custom",
        returnClampMin: -0.2,
        returnClampMax: 0.4,
      });
      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        taxMode: "simple",
        seed: 42,
      });
      expect(response.simulationInputs).toMatchObject({
        returnClampMin: -0.2,
        returnClampMax: 0.4,
      });
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

      expect(response.result).not.toBeNull();
      expect(response.result!.successRate).toBeGreaterThanOrEqual(0);
      expect(response.result!.successRate).toBeLessThanOrEqual(1);
      expect(response.simulationInputs!.retirementAge).toBe(65);
      expect(
        response.simulationInputs!.assetClasses.map((a) => a.name),
      ).toEqual(["Stocks", "Bonds"]);
      expect(response.simulationInputs!.preset).toBe("custom");
      expect(response.simulationInputs!.presetLabel).toBe("Custom");
      expect(response.simulationInputs!.taxMode).toBe("simple");
    } finally {
      cleanup();
    }
  });

  it("the deterministic line compounds below the mix's arithmetic mean (SIM baseline, D5)", async () => {
    // From 65 the seeded glide path holds 40/60 (Stocks 10% ± 18%, Bonds
    // 4% ± 6%): arithmetic mean 6.4%. A compounding (median) rate sits
    // below it whenever there's volatility (SP-10; the portfolio's own
    // σ²/2 is about 0.27 points here, the classes' Σ w·σ²/2 about 0.69),
    // so the line is under 6.2% and over 5%. November's S27 (compound the
    // arithmetic means) survived every test. Which median is right is
    // v0.11's (answer key K6, decision F2).
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
      const retired =
        response.result!.deterministicProjection.projectionByYear.filter(
          (y) => y.age >= 65,
        );
      expect(retired.length).toBeGreaterThan(0);
      for (const y of retired) {
        expect(y.returnRate, `${y.year}`).toBeLessThan(0.062);
        expect(y.returnRate, `${y.year}`).toBeGreaterThan(0.05);
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

      expect(response.result).not.toBeNull();
      expect(response.simulationInputs!.taxMode).toBe("advanced");
    } finally {
      cleanup();
    }
  });

  it("Simple tax mode counts retirement money only: a Portfolio brokerage changes nothing", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId, snapId } = seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const run = (taxMode: "simple" | "advanced") =>
        caller.projection.computeMonteCarloProjection({
          numTrials: 100,
          preset: "custom",
          taxMode,
          seed: 42,
          forceRefresh: true,
        });
      const before = await run("simple");

      // $1M Portfolio brokerage, saving into it every year.
      const [perf] = db
        .insert(schema.performanceAccounts)
        .values({
          institution: "Vanguard",
          accountType: "brokerage",
          accountLabel: "Vanguard Brokerage",
          ownershipType: "individual",
          ownerPersonId: personId,
          parentCategory: "Portfolio",
        })
        .returning()
        .all();
      db.insert(schema.portfolioAccounts)
        .values({
          snapshotId: snapId,
          performanceAccountId: perf!.id,
          amount: "1000000",
          taxType: "afterTax",
          institution: "Vanguard",
          accountType: "brokerage",
          ownerPersonId: personId,
          parentCategory: "Portfolio",
        })
        .run();
      db.insert(schema.contributionAccounts)
        .values({
          accountType: "brokerage",
          taxTreatment: "after_tax",
          employerMatchType: "none",
          isActive: true,
          personId,
          performanceAccountId: perf!.id,
          parentCategory: "Portfolio",
        })
        .run();

      const after = await run("simple");
      expect(after.simulationInputs!.startingBalance).toBe(
        before.simulationInputs!.startingBalance,
      );
      expect(after.simulationInputs!.annualContributions).toBeCloseTo(
        before.simulationInputs!.annualContributions,
        2,
      );
      expect(after.result!.successRate).toBe(before.result!.successRate);
      expect(after.result!.percentileBands).toEqual(
        before.result!.percentileBands,
      );
      // The assumptions panel shows retirement money in Advanced too.
      expect((await run("advanced")).simulationInputs!.startingBalance).toBe(
        before.simulationInputs!.startingBalance,
      );
    } finally {
      cleanup();
    }
  });

  it("runs a named preset from mc_presets", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);

      // Seed a named preset in mc_presets table
      db.insert(schema.simulationPresets)
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

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "default",
        seed: 42,
      });
      expect(response.result).not.toBeNull();
      expect(response.simulationInputs!.preset).toBe("default");
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

      expect(response.result).not.toBeNull();
      expect(response.simulationInputs!.hasAssetClassOverrides).toBe(true);
      const stockClass = response.simulationInputs!.assetClasses.find(
        (ac: { id: number }) => ac.id === 1,
      );
      expect(stockClass?.meanReturn).toBeCloseTo(0.12);
      expect(stockClass?.stdDev).toBeCloseTo(0.2);
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
      ).rejects.toThrow(/no longer active/);
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
          value: { stdDev: 0.015 } as unknown as string,
        })
        .run();

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
      });

      expect(response.result).not.toBeNull();
      expect(response.savedOverrides.assetClassOverrides).toHaveLength(1);
      // Saved overrides are applied to the run, not just echoed back.
      const stocks = response.simulationInputs!.assetClasses.find(
        (ac: { id: number }) => ac.id === 1,
      );
      expect(stocks?.meanReturn).toBeCloseTo(0.11);
      expect(response.simulationInputs!.inflationRisk.stdDev).toBeCloseTo(
        0.015,
      );
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
          value: { stdDev: 0.02 } as unknown as string,
        })
        .run();

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        seed: 42,
        inflationRisk: { stdDev: 0.008 },
      });

      expect(response.result).not.toBeNull();
      // The explicit inflationRisk should take priority
      expect(response.simulationInputs!.inflationRisk.stdDev).toBeCloseTo(
        0.008,
      );
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
        selection: {
          accumulationBudget: { annualExpenses: 50000 },
          decumulationBudget: { annualExpenses: 40000 },
        },
        numTrials: 100,
        preset: "custom",
        seed: 42,
      });

      expect(response.result).not.toBeNull();
      expect(response.simulationInputs!.accumulationExpenseOverride).toBe(
        50000,
      );
      expect(response.simulationInputs!.decumulationExpenseOverride).toBe(
        40000,
      );
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

      const run = (extra: object) =>
        caller.projection.computeMonteCarloProjection({
          numTrials: 100,
          preset: "custom",
          seed: 42,
          ...extra,
        });
      const base = await run({});
      const response = await run({
        accumulationOverrides: [
          { year: 2030, contributionRate: 0.2, notes: "Boost savings" },
        ],
        decumulationOverrides: [
          { year: 2060, withdrawalRoutingMode: "waterfall" },
        ],
      });

      expect(response.result).not.toBeNull();
      // Same seed, different plan → the simulated bands move.
      expect(response.result!.percentileBands).not.toEqual(
        base.result!.percentileBands,
      );
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// getSimulationSummary — the dashboard tile's slice of a cached run
// ---------------------------------------------------------------------------

describe("projection router — getSimulationSummary", () => {
  it("returns the cached run's success rate, today's bands and run time, never running trials", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const input = {
        numTrials: 100,
        preset: "custom",
        taxMode: "simple",
        seed: 42,
      } as const;
      const runsBefore = mcRuns.count;
      const empty = await caller.projection.getSimulationSummary(input);
      expect(empty).toEqual({ result: null, computedAt: null });
      expect(mcRuns.count).toBe(runsBefore);

      await caller.projection.computeMonteCarloProjection(input);
      // What the full query's peek returns (the cache keeps whole seconds).
      const full = await caller.projection.computeMonteCarloProjection({
        ...input,
        peekOnly: true,
      });
      assert(full.result && "simulationInputs" in full);
      const peek = await caller.projection.getSimulationSummary(input);
      expect(mcRuns.count).toBe(runsBefore + 1);
      expect(peek).toEqual({
        result: {
          successRate: full.result.successRate,
          // Today's dollars (deflated per trial), not the nominal bands.
          todayBands: full.result.today.percentileBands.map(
            ({ age, year, p25, p50, p75 }) => ({ age, year, p25, p50, p75 }),
          ),
        },
        computedAt: full.simulationInputs.computedAt,
      });
      expect(peek.result!.todayBands).not.toEqual(
        full.result.percentileBands.map(({ age, year, p25, p50, p75 }) => ({
          age,
          year,
          p25,
          p50,
          p75,
        })),
      );
    } finally {
      cleanup();
    }
  });

  it("rejects what the full query's input rejects", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.projection.getSimulationSummary({ numTrials: 5 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeMonteCarloProjection — persistent projection cache
// ---------------------------------------------------------------------------

describe("projection router — computeMonteCarloProjection cache", () => {
  fewTrialsForCacheTests();

  it("a second identical unseeded call reuses the same minted seed and result", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const input = { numTrials: 100, preset: "custom" as const };

      const first = await caller.projection.computeMonteCarloProjection(input);
      const second = await caller.projection.computeMonteCarloProjection(input);

      expect(second.simulationInputs!.seed).toBe(first.simulationInputs!.seed);
      expect(second.result).toEqual(first.result);
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("an explicit seed is honored on a miss and reproducible on a hit", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const input = { numTrials: 100, preset: "custom" as const, seed: 777 };

      const first = await caller.projection.computeMonteCarloProjection(input);
      const second = await caller.projection.computeMonteCarloProjection(input);

      expect(first.simulationInputs!.seed).toBe(777);
      expect(second.simulationInputs!.seed).toBe(777);
      expect(second.result).toEqual(first.result);
    } finally {
      cleanup();
    }
  });

  it("forceRefresh mints a new seed and writes a fresh row", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const input = { numTrials: 100, preset: "custom" as const };

      const first = await caller.projection.computeMonteCarloProjection(input);
      const refreshed = await caller.projection.computeMonteCarloProjection({
        ...input,
        forceRefresh: true,
      });

      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
      expect(refreshed.simulationInputs!.seed).not.toBe(
        first.simulationInputs!.seed,
      );
    } finally {
      cleanup();
    }
  });

  it("peekOnly returns a null result and never writes a cache row on a miss", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const response = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "custom",
        peekOnly: true,
      });

      expect(response.result).toBeNull();
      expect(response.simulationInputs!.seed).toBeNull();
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("peekOnly returns the cached result without recomputing on a hit", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const input = { numTrials: 100, preset: "custom" as const };

      const real = await caller.projection.computeMonteCarloProjection(input);
      const peeked = await caller.projection.computeMonteCarloProjection({
        ...input,
        peekOnly: true,
      });

      expect(peeked.result).toEqual(real.result);
      expect(peeked.simulationInputs!.seed).toBe(real.simulationInputs!.seed);
      expect(peeked.simulationInputs!.computedAt).not.toBeNull();
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  /**
   * Regression test: forceRefresh + peekOnly together used to silently
   * discard the real cached result. forceRefresh forced the cache read to
   * null unconditionally, so a peekOnly request that ALSO happened to set
   * forceRefresh fell into the "no cache, peekOnly" branch and returned an
   * empty peek — even though a real cached run existed and peekOnly's own
   * contract is "report what's cached, never compute." peekOnly must win:
   * it always reads the real cache, regardless of forceRefresh.
   */
  it("the dashboard's peek finds the Retirement page's default run, with and without saved Changes by year", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      seedDefaultMcPreset(db);
      // Both build from usePlanEngineInput; the page adds the default
      // simulation's settings, the dashboard sends none of them.
      const plan = {
        decumulationDefaults: {
          withdrawalTaxPreference:
            defaultDecumulationConfig().withdrawalTaxPreference,
        },
      };
      const page = {
        ...plan,
        numTrials: DEFAULT_SIMULATION.numTrials,
        preset: DEFAULT_SIMULATION.preset,
        taxMode: DEFAULT_SIMULATION.taxMode,
      };
      const dashboardPeek = () =>
        caller.projection.computeMonteCarloProjection({
          ...plan,
          peekOnly: true,
        });

      const run = await caller.projection.computeMonteCarloProjection(page);
      expect((await dashboardPeek()).result).toEqual(run.result);

      // Saved Changes by year: the page leaves them out until edited (the
      // server applies the saved rows) — the peek still hits, and it
      // reflects them.
      const year = new Date().getFullYear() + 2;
      await caller.retirement.projectionOverrides.save({
        overrideType: "accumulation",
        overrides: [{ year, contributionRate: 0 }],
      });
      const withSaved =
        await caller.projection.computeMonteCarloProjection(page);
      expect(withSaved.result).not.toEqual(run.result);
      expect((await dashboardPeek()).result).toEqual(withSaved.result);
    } finally {
      cleanup();
    }
  });

  it("peekOnly still returns the cached result even when forceRefresh is also set", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const input = { numTrials: 100, preset: "custom" as const };

      const real = await caller.projection.computeMonteCarloProjection(input);
      const peeked = await caller.projection.computeMonteCarloProjection({
        ...input,
        peekOnly: true,
        forceRefresh: true,
      });

      expect(peeked.result).toEqual(real.result);
      expect(peeked.simulationInputs!.seed).toBe(real.simulationInputs!.seed);
      // Still exactly one row — peekOnly+forceRefresh together must not
      // trigger a fresh computation/write.
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeStrategyComparison
// ---------------------------------------------------------------------------

describe("projection router — computeStrategyComparison", () => {
  type Comparison = Awaited<
    ReturnType<Caller["projection"]["computeStrategyComparison"]>
  >;
  const fixedOf = (c: Comparison) =>
    c.strategies.find((st) => st.strategy === "fixed")!;

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
      clearSimulationPresets(db);

      const response = await caller.projection.computeStrategyComparison();

      // The full comparison, not the empty early return.
      assert("retirementAge" in response);
      expect(response.strategies.length).toBeGreaterThan(0);
      expect(response.activeStrategy).toBe("fixed");
      expect(response.retirementAge).toBe(65);

      for (const strat of response.strategies) {
        expect(strat.label).not.toBe("");
        expect(strat).not.toHaveProperty("sustainableWithdrawal");
        expect(strat.minAnnualWithdrawal).toBeLessThanOrEqual(
          strat.avgAnnualWithdrawal,
        );
        expect(strat.avgAnnualWithdrawal).toBeLessThanOrEqual(
          strat.maxAnnualWithdrawal,
        );
        expect(strat.yearByYear.length).toBeGreaterThan(0);
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
      // The Default preset the run names, using the glide path above.
      seedDefaultMcPreset(db);

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

  it("strategy comparison with expense overrides", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      // year1Withdrawal comes from the deterministic projection: no
      // simulation needs to run.
      clearSimulationPresets(db);

      const base = await caller.projection.computeStrategyComparison();
      const response = await caller.projection.computeStrategyComparison({
        selection: {
          accumulationBudget: { annualExpenses: 60000 },
          decumulationBudget: { annualExpenses: 45000 },
        },
      });

      expect(fixedOf(response).year1Withdrawal).not.toBe(
        fixedOf(base).year1Withdrawal,
      );
    } finally {
      cleanup();
    }
  });

  it("strategy comparison with snapshot override", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { perfAcctId, snapId } = seedFullProjectionData(db);
      // endRetirementBalance comes from the deterministic projection: no
      // simulation needs to run.
      clearSimulationPresets(db);

      // A newer $300k snapshot is the default; snapshotId picks the $100k one.
      seedSnapshot(db, "2025-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "300000",
          taxType: "preTax",
        },
      ]);

      const latest = await caller.projection.computeStrategyComparison();
      const older = await caller.projection.computeStrategyComparison({
        snapshotId: snapId,
      });

      expect(fixedOf(older).endRetirementBalance).toBeLessThan(
        fixedOf(latest).endRetirementBalance,
      );
    } finally {
      cleanup();
    }
  });

  it("a newly saved Changes by year row reaches the comparison (no stale cache hit)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      // endRetirementBalance comes from the deterministic projection: no
      // simulation needs to run.
      clearSimulationPresets(db);
      const fixedEnd = async () =>
        (await caller.projection.computeStrategyComparison()).strategies.find(
          (st) => st.strategy === "fixed",
        )!.endRetirementBalance;
      const before = await fixedEnd();
      await caller.retirement.projectionOverrides.save({
        overrideType: "accumulation",
        overrides: [
          { year: new Date().getFullYear() + 2, contributionRate: 0 },
        ],
      });
      expect(await fixedEnd()).toBeLessThan(before);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeStrategyComparison — persistent projection cache
// ---------------------------------------------------------------------------

describe("projection router — computeStrategyComparison cache", () => {
  fewTrialsForCacheTests();

  it("a second identical call is served from cache (same result, one cache row)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      const first = await caller.projection.computeStrategyComparison();
      const runsAfterFirst = mcRuns.count;
      const second = await caller.projection.computeStrategyComparison();

      expect(second).toEqual(first);
      // The hit ran no simulation at all.
      expect(runsAfterFirst).toBeGreaterThan(0);
      expect(mcRuns.count).toBe(runsAfterFirst);
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  // computeStrategyComparison runs a full MC per withdrawal strategy (6+
  // strategies); this test runs it TWICE for real (cache miss both times
  // by design). Comfortably under the default 10s locally, but marginal
  // in CI's coverage-instrumented run (V8 coverage collection adds real
  // per-call overhead) — timed out there, not a correctness issue.
  it("a changed input misses the cache and computes fresh (different hash rows)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      await caller.projection.computeStrategyComparison();
      await caller.projection.computeStrategyComparison({
        selection: { decumulationBudget: { annualExpenses: 45000 } },
      });

      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(2);
    } finally {
      cleanup();
    }
  }, 30000);

  it("forceRefresh bypasses an existing cache hit and recomputes", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      // The Default preset the run names, using the glide path above.
      seedDefaultMcPreset(db);

      await caller.projection.computeStrategyComparison();
      const before = db.select().from(schema.projectionCache).all();
      expect(before).toHaveLength(1);
      const computedAtBefore = before[0]!.computedAt;
      const runsBefore = mcRuns.count;

      await caller.projection.computeStrategyComparison({
        forceRefresh: true,
      });

      const after = db.select().from(schema.projectionCache).all();
      expect(after).toHaveLength(1);
      expect(after[0]!.computedAt.getTime()).toBeGreaterThanOrEqual(
        computedAtBefore.getTime(),
      );
      // It actually recomputed (the timestamp alone can't prove that).
      expect(mcRuns.count).toBeGreaterThan(runsBefore);
    } finally {
      cleanup();
    }
  }, 30000);

  // Regression test for a real bug: the cache
  // key used to hash `activeStrategy, userStrategyParams` instead of the
  // full resolved `decumulationDefaults`, so it omitted
  // `settings.withdrawalRoutingMode` (and distributionTaxRates) entirely —
  // changing a household's Withdrawal Routing setting silently served a
  // stale comparison computed under the OLD mode until the cache expired.
  it("changing withdrawalRoutingMode invalidates the cache (was a live bug)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      await caller.projection.computeStrategyComparison();
      db.update(schema.retirementSettings)
        .set({ withdrawalRoutingMode: "waterfall" })
        .run();
      await caller.projection.computeStrategyComparison();

      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(2);
    } finally {
      cleanup();
    }
  }, 30000);

  // Same class of bug, different field: rmdExcessHandling/qcdMaximize/
  // rmdSmoothingEnabled/discretionaryWithdrawalOrder were silently dropped
  // to engine defaults (not read from settings at all, not just excluded
  // from the cache key) — this proves both halves of the fix: the fields
  // are now READ (buildDecumulationDefaults) and the cache key now
  // reflects a change to one of them.
  it("changing discretionaryWithdrawalOrder invalidates the cache", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      await caller.projection.computeStrategyComparison();
      db.update(schema.retirementSettings)
        .set({ discretionaryWithdrawalOrder: "brokerage_first" })
        .run();
      await caller.projection.computeStrategyComparison();

      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(2);
    } finally {
      cleanup();
    }
  }, 30000);

  // Persisted `withdrawal_order` — now read via buildDecumulationDefaults
  // (no client override sent by this procedure) and folded into the hashed
  // `decumulationDefaults`, so a change to the household's saved order must
  // invalidate the comparison cache the same way.
  it("changing the persisted withdrawalOrder invalidates the cache", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      await caller.projection.computeStrategyComparison();
      db.update(schema.retirementSettings)
        .set({ withdrawalOrder: ["brokerage", "401k", "403b", "ira", "hsa"] })
        .run();
      await caller.projection.computeStrategyComparison();

      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(2);
    } finally {
      cleanup();
    }
  }, 30000);
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
      seedJob(db, person1Id, {
        employerName: "Company A",
        startDate: "2020-01-01",
        annualSalary: "100000",
      });
      seedJob(db, person2Id, {
        employerName: "Company B",
        startDate: "2020-01-01",
        annualSalary: "80000",
      });

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
          filingStatus: "MFJ",
        })
        .run();

      db.insert(schema.returnRateTable)
        .values({ age: 35, rateOfReturn: "0.07" })
        .run();

      const response = await caller.projection.computeProjection({
        accumulationOverrides: [],
        decumulationOverrides: [],
      });
      if (!("settings" in response)) throw new Error("no metadata");

      expect(response).toHaveProperty("people");
      expect(response.people!.length).toBeGreaterThanOrEqual(1);
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
        accountLabel: "Roth 401k",
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

      const rothContribAcct = db
        .insert(schema.contributionAccounts)
        .values({
          accountType: "401k",
          taxTreatment: "tax_free",
          employerMatchType: "none",
          isActive: true,
          personId,
          performanceAccountId: rothPerfAcctId,
          parentCategory: "Retirement",
        })
        .returning({ id: schema.contributionAccounts.id })
        .get();

      const profileId = seedContributionProfile(db, {
        name: "Roth Test Profile",
        contributionActiveFields: {
          contributionAccounts: {
            [String(rothContribAcct.id)]: {
              contributionValue: "0.05",
              contributionMethod: "percent_of_salary",
            },
          },
        },
      });

      const response = await caller.projection.computeProjection({
        selection: { contribution: profileId },
        accumulationOverrides: [],
        decumulationOverrides: [],
      });
      if (!("settings" in response)) throw new Error("no metadata");

      expect(response.result).not.toBeNull();
      expect(response.contributionSpecs!.length).toBeGreaterThanOrEqual(1);
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
      if (!("settings" in response)) throw new Error("no metadata");

      const summary = response.returnRateSummary;
      expect(summary!.retirementRate).toBeCloseTo(0.05);
      // The glide from 7% (35) to 5% (65) averages in between.
      expect(summary!.avgAccumulation).toBeLessThan(0.07);
      expect(summary!.avgAccumulation).toBeGreaterThan(0.05);
      expect(summary!.schedule.length).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeMonteCarloProjection — edge cases
// ---------------------------------------------------------------------------

describe("projection router — MC edge cases", () => {
  it("every shipped preset can run", async () => {
    const { db, cleanup } = await createTestCaller(adminSession);
    try {
      const { buildSimulationInputs } =
        await import("@/server/services/simulation/mc-inputs");
      for (const key of ["aggressive", "default", "conservative"] as const)
        expect(
          (await buildSimulationInputs(db as never, key)).notConfigured,
          key,
        ).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("a named preset the database lacks never runs Custom's mix under its name", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      const mc = await caller.projection.computeMonteCarloProjection({
        numTrials: 100,
        preset: "aggressive",
        seed: 42,
      });
      expect(mc).toMatchObject({ result: null, notConfigured: "no_presets" });
      const comparison = await caller.projection.computeStrategyComparison({
        preset: "aggressive",
      });
      expect(comparison).toMatchObject({ notConfigured: "no_presets" });
      const analysis = await caller.projection.computeStrategyAnalysis({
        preset: "aggressive",
      });
      expect(analysis).toMatchObject({
        baseline: null,
        notConfigured: "no_presets",
      });
    } finally {
      cleanup();
    }
  });

  it("MC with no glide path (empty custom glide path) says so instead of running", async () => {
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

      expect(response.result).toBeNull();
      expect(response).toMatchObject({ notConfigured: "no_glide_path" });
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
          withdrawalRoutingMode: "waterfall",
        },
      });

      expect(response.result).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("MC with snapshotId", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { perfAcctId, snapId } = seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);

      // A newer $250k snapshot is the default; snapshotId picks the $100k one.
      seedSnapshot(db, "2025-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "250000",
          taxType: "preTax",
        },
      ]);

      const run = (extra: object) =>
        caller.projection.computeMonteCarloProjection({
          numTrials: 100,
          preset: "custom",
          seed: 42,
          ...extra,
        });
      const latest = await run({});
      const older = await run({ snapshotId: snapId });

      expect(older.result).not.toBeNull();
      expect(older.result!.percentileBands).not.toEqual(
        latest.result!.percentileBands,
      );
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

      expect(response.result).not.toBeNull();
      expect(response.simulationInputs!.hasAssetClassOverrides).toBe(true);
      // Both overrides should be active
      const stockClass = response.simulationInputs!.assetClasses.find(
        (ac: { id: number }) => ac.id === 1,
      );
      const bondClass = response.simulationInputs!.assetClasses.find(
        (ac: { id: number }) => ac.id === 2,
      );
      expect(stockClass?.meanReturn).toBeCloseTo(0.11);
      expect(bondClass?.meanReturn).toBeCloseTo(0.06);
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

      expect(response.result).not.toBeNull();
      const stockClass = response.simulationInputs!.assetClasses.find(
        (ac: { id: number }) => ac.id === 1,
      );
      expect(stockClass?.meanReturn).toBeCloseTo(0.15);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeStrategyAnalysis
// ---------------------------------------------------------------------------

describe("projection router — computeStrategyAnalysis", () => {
  it("returns empty recommendations when no retirement data exists", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.computeStrategyAnalysis();
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
      // No asset classes or glide path
      clearSimulationPresets(db);
      const response = await caller.projection.computeStrategyAnalysis();
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
      // The Default preset the run names, using the glide path above.
      seedDefaultMcPreset(db);
      seedCorrelations(db);

      const response = await caller.projection.computeStrategyAnalysis();

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
      // The Default preset the run names, using the glide path above.
      seedDefaultMcPreset(db);
      seedCorrelations(db);

      // Switch strategy to guyton_klinger
      db.update(schema.retirementSettings)
        .set({ withdrawalStrategy: "guyton_klinger" })
        .run();

      const response = await caller.projection.computeStrategyAnalysis();

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
        selection: {
          accumulationBudget: { annualExpenses: 5000 },
          decumulationBudget: { annualExpenses: 4000 },
        },
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
      const r = response.result!;
      expect(r).not.toBeNull();
      // Earliest age contributions can stop: between today (35, the
      // engine's current age) and the retirement age (65) for this fixture.
      expect(r.coastFireAge).toBeGreaterThanOrEqual(35);
      expect(r.coastFireAge).toBeLessThan(65);
      expect(r.projectedExpensesAtRetirementToday).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("accepts a client decumulation routing override", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);

      const response = await caller.projection.computeCoastFire({
        decumulationDefaults: { withdrawalRoutingMode: "waterfall" },
      });
      expect(response.result).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeCoastFireSimulation
// ---------------------------------------------------------------------------
// computeCoastFireSimulation fetches `mc_preset_glide_paths` via raw SQL
// (coast-fire.ts). This call site was missed by the original F5 fix
// (commit 53c9fa5) because it uses a generic type parameter —
// `ctx.db.execute<{...}>(...)` — which the grep used to find F5's other
// call sites (`\.execute\(`) doesn't match (the `(` comes after the `<...>`
// closes). Found via this test file during T14 work and fixed in a
// follow-up commit by switching to compat.ts's queryRaw(), same as F5.

describe("projection router — computeCoastFireSimulation", () => {
  it("says there are no simulation presets instead of unreachable", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      clearSimulationPresets(db);
      const response = await caller.projection.computeCoastFireSimulation({});
      expect(response).toEqual({
        result: null,
        computedAt: null,
        notConfigured: "no_presets",
      });
    } finally {
      cleanup();
    }
  });

  it("refuses a glide path whose active classes don't add up to 100%", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      seedGlidePath(db);
      seedDefaultMcPreset(db);
      // Bonds (class 2) holds part of every age's mix.
      db.update(schema.assetClassParams)
        .set({ isActive: false })
        .where(eq(schema.assetClassParams.id, 2))
        .run();
      const response = await caller.projection.computeCoastFireSimulation({});
      expect(response).toMatchObject({ notConfigured: "glide_path_mismatch" });
    } finally {
      cleanup();
    }
  });

  it("the probe says why too", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      clearSimulationPresets(db);
      const response = await caller.projection.computeCoastFireProbe({
        probeAge: 40,
      });
      expect(response).toMatchObject({
        result: null,
        notConfigured: "no_presets",
      });
    } finally {
      cleanup();
    }
  });

  it("says there are no asset classes when the Default preset has none", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      clearSimulationPresets(db);
      seedDefaultMcPreset(db);
      const response = await caller.projection.computeCoastFireSimulation({});
      expect(response).toMatchObject({ notConfigured: "no_asset_classes" });
    } finally {
      cleanup();
    }
  });

  it("returns a null result when no data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.computeCoastFireSimulation({});
      expect(response).toEqual({ result: null, computedAt: null });
    } finally {
      cleanup();
    }
  });

  it("returns a result with seeded data and a default MC preset", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);

      db.insert(schema.simulationPresets)
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

      const response = await caller.projection.computeCoastFireSimulation({});
      expect(response.result).not.toBeNull();
      expect(typeof response.result?.successRate).toBe("number");
    } finally {
      cleanup();
    }
  });

  it("accepts decumulationDefaults override input without a schema-validation error", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);
      db.insert(schema.simulationPresets)
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

      const response = await caller.projection.computeCoastFireSimulation({
        decumulationDefaults: { withdrawalRoutingMode: "waterfall" },
      });
      expect(response.result).not.toBeNull();
      expect(typeof response.result?.successRate).toBe("number");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeCoastFireProbe (Coast FIRE "Custom Age" picker)
// ---------------------------------------------------------------------------

describe("projection router — computeCoastFireProbe", () => {
  it("returns a null result when no data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.computeCoastFireProbe({
        probeAge: 40,
      });
      expect(response).toEqual({ result: null, computedAt: null });
    } finally {
      cleanup();
    }
  });

  it("returns a CoastFireProbeResult (not a CoastFireSimulationResult) for an in-range age", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);
      db.insert(schema.simulationPresets)
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

      const response = await caller.projection.computeCoastFireProbe({
        probeAge: 40,
      });
      expect(response.result).not.toBeNull();
      expect(response.result?.probeAge).toBe(40);
      expect(typeof response.result?.successRate).toBe("number");
      expect(typeof response.result?.passes).toBe("boolean");
      // Deliberately NOT a CoastFireSimulationResult shape -- see coast-fire-probe.ts's
      // docblock (status: "found" can't represent a failing probe).
      expect(response.result).not.toHaveProperty("status");
      expect(response.result).not.toHaveProperty("coastFireAge");
      expect(response.result).not.toHaveProperty("warning");
      expect(response.result).not.toHaveProperty("stopNowSuccessRate");
    } finally {
      cleanup();
    }
  });

  it("rejects an out-of-range probeAge (>= retirementAge) with BAD_REQUEST", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db); // retirementAge: 65
      seedAssetClasses(db);
      seedCorrelations(db);
      db.insert(schema.simulationPresets)
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

      await expect(
        caller.projection.computeCoastFireProbe({ probeAge: 65 }),
      ).rejects.toThrow();
      await expect(
        caller.projection.computeCoastFireProbe({ probeAge: 200 }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("rejects an unauthenticated caller", async () => {
    const { caller, cleanup } = await createTestCaller({
      user: null as never,
      expires: "",
    } as never);
    try {
      await expect(
        caller.projection.computeCoastFireProbe({ probeAge: 40 }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeCoastFireSimulation — persistent projection cache
// ---------------------------------------------------------------------------

function seedDefaultMcPreset(db: BetterSQLite3Database<typeof sqliteSchema>) {
  db.insert(schema.simulationPresets)
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
}

describe("projection router — computeCoastFireSimulation cache", () => {
  fewTrialsForCacheTests();

  it("a second identical call is served from cache (same result, one cache row)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);
      seedDefaultMcPreset(db);

      const first = await caller.projection.computeCoastFireSimulation({});
      const runsAfterFirst = mcRuns.count;
      const second = await caller.projection.computeCoastFireSimulation({});

      expect(second.result).toEqual(first.result);
      expect(runsAfterFirst).toBeGreaterThan(0);
      expect(mcRuns.count).toBe(runsAfterFirst);
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("forceRefresh bypasses an existing cache hit and re-searches", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);
      seedDefaultMcPreset(db);

      await caller.projection.computeCoastFireSimulation({});
      const before = db.select().from(schema.projectionCache).all();
      expect(before).toHaveLength(1);
      const computedAtBefore = before[0]!.computedAt;
      const runsBefore = mcRuns.count;

      await caller.projection.computeCoastFireSimulation({
        forceRefresh: true,
      });

      const after = db.select().from(schema.projectionCache).all();
      expect(after).toHaveLength(1);
      expect(after[0]!.computedAt.getTime()).toBeGreaterThanOrEqual(
        computedAtBefore.getTime(),
      );
      expect(mcRuns.count).toBeGreaterThan(runsBefore);
    } finally {
      cleanup();
    }
  }, 30000);

  it("peekOnly returns a null result and never runs the search on a miss", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);
      seedDefaultMcPreset(db);

      const runsBefore = mcRuns.count;
      const response = await caller.projection.computeCoastFireSimulation({
        peekOnly: true,
      });

      expect(response.result).toBeNull();
      expect(response.computedAt).toBeNull();
      expect(mcRuns.count).toBe(runsBefore);
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("peekOnly returns the cached result without re-searching on a hit", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);
      seedAssetClasses(db);
      seedCorrelations(db);
      // A named preset with no glide path of its own uses the household's.
      seedGlidePath(db);
      seedDefaultMcPreset(db);

      const real = await caller.projection.computeCoastFireSimulation({});
      const runsAfterReal = mcRuns.count;
      const peeked = await caller.projection.computeCoastFireSimulation({
        peekOnly: true,
      });

      expect(peeked.result).toEqual(real.result);
      expect(peeked.computedAt).not.toBeNull();
      expect(mcRuns.count).toBe(runsAfterReal);
      const rows = db.select().from(schema.projectionCache).all();
      expect(rows).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});
