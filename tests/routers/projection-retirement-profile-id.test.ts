/**
 * Regression coverage for a real cross-file gap: the Retirement page's
 * Assumptions band lets you VIEW a non-active Retirement Profile without activating
 * it (same "view without activating" contract computeProjection/
 * computeStrategyComparison already honor via retirementProfileId), but
 * computeMonteCarloProjection/computeCoastFire/computeCoastFireMC/
 * computeCoastFireProbe never accepted that field at all — so the band's
 * "view a non-active profile" silently never reached the actual
 * chart/table data, which kept showing the globally-active profile's
 * numbers regardless of what the band was viewing.
 *
 * This tests the two representative, now-fixed procedures directly
 * (computeMonteCarloProjection with a small trial count for speed, and
 * computeCoastFire which is deterministic) — both thread through the same
 * baseSharedInput object client-side (use-projection-queries.ts) and the
 * same buildEnginePayload({ retirementProfileId }) call server-side as
 * computeCoastFireMC/computeCoastFireProbe, so proving these two honor it
 * is strong evidence the shared plumbing is correct for all four.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedStandardDataset } from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";

describe("projection router — retirementProfileId (view a non-active Retirement Profile)", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let firstProfileId: number;
  let secondProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const { personId } = seedStandardDataset(db);

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

    // First profile — migration-style backfill (real installs get this
    // from drizzle/0032; tests bootstrap it the same way, see
    // seedRetirementProfile's own docblock).
    firstProfileId = db
      .insert(schema.retirementProfiles)
      .values({ name: "Current Plan" })
      .returning({ id: schema.retirementProfiles.id })
      .get().id;
    db.update(schema.retirementSettings)
      .set({ profileId: firstProfileId })
      .run();
    db.insert(schema.retirementProfilePeople)
      .values({
        profileId: firstProfileId,
        personId,
        retirementAge: 65,
        endAge: 90,
      })
      .run();

    // Second profile — a materially different retirement age, so the
    // resolved engine settings genuinely diverge from the first.
    const secondProfile = await caller.retirement.retirementProfiles.duplicate({
      sourceProfileId: firstProfileId,
      name: "Retire Early",
    });
    secondProfileId = secondProfile!.id;
    await caller.retirement.retirementSettings.upsert({
      personId,
      profileId: secondProfileId,
      retirementAge: 55,
      endAge: 90,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.02",
    });
    await caller.retirement.retirementProfilePeople.upsertPerson({
      profileId: secondProfileId,
      personId,
      retirementAge: 55,
    });
  });

  afterAll(() => cleanup());

  it("computeMonteCarloProjection resolves the SPECIFIED profile's retirementAge, not the globally-active one", async () => {
    const active = await caller.projection.computeMonteCarloProjection({
      numTrials: 100,
      accumulationOverrides: [],
      decumulationOverrides: [],
    });
    const viewed = await caller.projection.computeMonteCarloProjection({
      numTrials: 100,
      accumulationOverrides: [],
      decumulationOverrides: [],
      retirementProfileId: secondProfileId,
    });

    expect(active.simulationInputs?.retirementAge).toBe(65);
    expect(viewed.simulationInputs?.retirementAge).toBe(55);
  });

  it("computeCoastFire resolves the SPECIFIED profile's retirementAge, not the globally-active one", async () => {
    const active = await caller.projection.computeCoastFire({
      accumulationOverrides: [],
      decumulationOverrides: [],
    });
    const viewed = await caller.projection.computeCoastFire({
      accumulationOverrides: [],
      decumulationOverrides: [],
      retirementProfileId: secondProfileId,
    });

    // Different retirement ages produce different accumulation windows, so
    // a real, structural difference is expected between the two runs.
    expect(active.result).not.toBeNull();
    expect(viewed.result).not.toBeNull();
    expect(JSON.stringify(active.result)).not.toEqual(
      JSON.stringify(viewed.result),
    );
  });
});
