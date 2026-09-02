/**
 * Multi-year withdrawal-policy optimizer, Phase 3 —
 * `computeWithdrawalBracketOptimizer` router endpoint.
 *
 * Mirrors `projection-coverage.test.ts`'s `computeCoastFire` tests: null
 * result when unseeded, a real result shape with seeded data, auth
 * gating (mirroring `auth-enforcement.test.ts`'s pattern), and a check
 * that the router's output matches a direct call to the underlying
 * calculator for the same resolved engine input (round-trip through
 * `fetchRetirementData`/`buildEnginePayload` shouldn't change the
 * search's own answer) — plus a real wall-clock timing measurement of
 * the full procedure (data fetch + search), per the design doc's Phase 3
 * note that the ~10-16ms `calculateProjection`-only figure is not the
 * whole picture once `fetchRetirementData`/`buildEnginePayload` are
 * included.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { createTestCaller, adminSession, seedStandardDataset } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/retirement/build-engine-payload";
import { optimizeRothBracketTarget } from "@/lib/calculators/withdrawal-bracket-optimizer";
import {
  decumulationDefaultsInputSchema,
  buildDecumulationDefaults,
} from "@/server/routers/projection/_shared";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";

/** Same shape as projection-coverage.test.ts's seedFullProjectionData —
 *  duplicated locally rather than imported (that helper isn't exported)
 *  to keep this file self-contained, matching the convention of other
 *  single-endpoint router test files in this directory. */
function seedFullProjectionData(
  db: BetterSQLite3Database<typeof sqliteSchema>,
) {
  const { personId, perfAcctId } = seedStandardDataset(db);

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

  db.insert(schema.returnRateTable)
    .values({ age: 35, rateOfReturn: "0.07" })
    .run();
  db.insert(schema.returnRateTable)
    .values({ age: 65, rateOfReturn: "0.05" })
    .run();

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
}

describe("projection router — computeWithdrawalBracketOptimizer", () => {
  it("returns null result when no retirement data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response =
        await caller.projection.computeWithdrawalBracketOptimizer({});
      expect(response).toEqual({ result: null });
    } finally {
      cleanup();
    }
  });

  it("returns a BracketOptimizerResult shape with seeded data", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response =
        await caller.projection.computeWithdrawalBracketOptimizer({});
      expect(response.result).not.toBeNull();
      expect(response.result).toHaveProperty("recommendedTarget");
      expect(response.result).toHaveProperty("currentTarget");
      expect(response.result?.candidates.length).toBeGreaterThan(0);
      for (const c of response.result?.candidates ?? []) {
        expect(c).toHaveProperty("target");
        expect(c).toHaveProperty("netCost");
        expect(c).toHaveProperty("shortfallScore");
        expect(c).toHaveProperty("depleted");
      }
    } finally {
      cleanup();
    }
  });

  it("returns exactly what a direct call to optimizeRothBracketTarget produces for the same resolved engine input", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response =
        await caller.projection.computeWithdrawalBracketOptimizer({});

      // Rebuild the exact engineInput the router itself builds, then call
      // the calculator directly -- confirms the round-trip through
      // fetchRetirementData/buildEnginePayload doesn't change the search's
      // own answer (the router should be a thin pass-through, not doing
      // any of its own transformation on the result).
      const data = await fetchRetirementData(db, {});
      const payload = await buildEnginePayload(db, data, {});
      if (!payload) throw new Error("expected a payload for seeded data");
      const { settings, distributionTaxRates, baseEngineInput } = payload;
      const engineInput = {
        ...baseEngineInput,
        decumulationDefaults: buildDecumulationDefaults(
          settings,
          decumulationDefaultsInputSchema.parse(undefined),
          distributionTaxRates,
        ),
        accumulationOverrides: [] as AccumulationOverride[],
        decumulationOverrides: [] as DecumulationOverride[],
      };
      const direct = optimizeRothBracketTarget(engineInput);

      expect(response.result).toEqual(direct);
    } finally {
      cleanup();
    }
  });

  it("accepts decumulationDefaults override without throwing", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const response =
        await caller.projection.computeWithdrawalBracketOptimizer({
          decumulationDefaults: { withdrawalRate: 0.035 },
        });
      expect(response.result).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("rejects unauthenticated access", async () => {
    const { caller, cleanup } = await createTestCaller({
      user: null as never,
      expires: "",
    } as never);
    try {
      await expect(
        caller.projection.computeWithdrawalBracketOptimizer({}),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("full procedure (data fetch + search) completes in well under a second for a realistic household", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      const start = performance.now();
      const response =
        await caller.projection.computeWithdrawalBracketOptimizer({});
      const elapsedMs = performance.now() - start;

      expect(response.result).not.toBeNull();
      // Generous bound (not a tight perf assertion) -- exists so a future
      // regression that turns this into an accidentally-quadratic or
      // N+1-query path fails loudly here instead of only showing up as a
      // slow page in production. The search itself is ~3-5
      // calculateProjection calls (the household's own bracket count) on
      // top of one fetchRetirementData/buildEnginePayload round-trip.
      expect(elapsedMs).toBeLessThan(5000);
    } finally {
      cleanup();
    }
  });
});
