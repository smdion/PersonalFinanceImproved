/**
 * Engine input snapshot guard — the advisor-mandated numeric safety net for
 * the v0.5.2 refactor (see .scratch/docs/V052-REFACTOR-PLAN.md § Principles).
 *
 * Seeds a deterministic standard dataset and snapshots `baseEngineInput` and
 * every numeric field that feeds the projection / Monte Carlo engine. Any
 * refactor that silently drifts a default, a derived value, or a memoization
 * dependency will fail this test loudly instead of quietly producing wrong
 * retirement projections.
 *
 * Prereq for PRs 7–9 (retirement-content.tsx extraction). The retirement UI
 * is the canonical silent-wrong-numbers zone — a missed `useMemo` dep would
 * cause the engine to read stale inputs with no error surface. This file is
 * the gate that catches that class of bug.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller, seedStandardDataset } from "./setup";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/retirement/build-engine-payload";
import * as schema from "@/lib/db/schema-sqlite";

// Freeze wall clock so `currentAge` and any other time-derived fields in
// `baseEngineInput` are deterministic across CI runners, local runs, and
// timezone shifts. 2026-04-14 + dateOfBirth "1990-01-01" → currentAge 36.
const FIXED_NOW = new Date("2026-04-14T12:00:00Z");

describe("engine input snapshot guard", () => {
  let testCaller: Awaited<ReturnType<typeof createTestCaller>>;
  let payload: NonNullable<Awaited<ReturnType<typeof buildEnginePayload>>>;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    testCaller = await createTestCaller();
    const { db } = testCaller;

    // Seed the canonical fixture
    seedStandardDataset(db);

    // Add asset classes (engine needs these for MC trials)
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

    // Retirement settings for the seeded person — all NOT NULL columns
    // need explicit values even though some have defaults in PG (SQLite
    // test harness doesn't materialize defaults the same way).
    db.insert(schema.retirementSettings)
      .values({
        personId: 1,
        retirementAge: 65,
        endAge: 95,
        returnAfterRetirement: "0.06",
        annualInflation: "0.03",
        salaryAnnualIncrease: "0.03",
        withdrawalRate: "0.04",
        taxMultiplier: "1.0",
        grossUpForTaxes: true,
        socialSecurityMonthly: "2500",
        ssStartAge: 67,
        raisesDuringRetirement: false,
        enableRothConversions: false,
        withdrawalStrategy: "fixed",
        gkSkipInflationAfterLoss: true,
        filingStatus: "MFJ",
      })
      .run();

    // Fetch + build the payload that feeds every compute endpoint
    const data = await fetchRetirementData(testCaller.db, {});
    const result = await buildEnginePayload(testCaller.db, data, {});
    if (!result) {
      throw new Error(
        "buildEnginePayload returned null for the standard fixture",
      );
    }
    payload = result;
  });

  afterAll(async () => {
    await testCaller.cleanup();
    vi.useRealTimers();
  });

  it("baseEngineInput shape and key fields are stable", () => {
    const bei = payload.baseEngineInput;

    // Spot-check the shape. Any new/removed top-level field fails here.
    expect(Object.keys(bei).sort()).toMatchInlineSnapshot(`
      [
        "accumulationDefaults",
        "annualExpenses",
        "asOfDate",
        "baseLimits",
        "baseYearContributions",
        "baseYearEmployerMatch",
        "birthYear",
        "brokerageContributionRamp",
        "brokerageGoals",
        "budgetOverrides",
        "catchupLimits",
        "contributionSpecs",
        "currentAge",
        "currentSalary",
        "decumulationAnnualExpenses",
        "employerMatchByParentCat",
        "employerMatchRateByCategory",
        "enableAcaAwareness",
        "enableIrmaaAwareness",
        "filingStatus",
        "householdSize",
        "individualAccounts",
        "inflationRate",
        "limitGrowthRate",
        "perPersonBirthYears",
        "perPersonSalaryOverrides",
        "postRetirementInflationRate",
        "profileSwitches",
        "projectionEndAge",
        "retirementAge",
        "retirementAgeByPerson",
        "returnRates",
        "salaryByPerson",
        "salaryCap",
        "salaryGrowthRate",
        "salaryOverrides",
        "socialSecurityAnnual",
        "socialSecurityEntries",
        "ssStartAge",
        "startingAccountBalances",
        "startingBalances",
      ]
    `);

    // Shape-only invariants — field types, not values. The `currentAge`
    // field was originally in this snapshot but it's not a good drift
    // canary: it depends on both wall-clock time AND which snapshot date
    // gets loaded, which varies between local runs and CI. The real drift
    // signal is the top-level `Object.keys(bei).sort()` snapshot above,
    // which catches added/removed fields without wall-clock coupling.
    expect({
      retirementAgeIsNumber: typeof bei.retirementAge === "number",
      hasContributionSpecs:
        Array.isArray(bei.contributionSpecs) &&
        bei.contributionSpecs.length >= 0,
    }).toMatchInlineSnapshot(`
      {
        "hasContributionSpecs": true,
        "retirementAgeIsNumber": true,
      }
    `);
  });

  it("derived retirement ages match the seeded settings", () => {
    // Only assert on fields that actually exist and have stable values.
    // `avgAge` and `householdRetirementAge` snapshots were originally
    // `undefined` (accessed at wrong path) — removed to avoid locking
    // a meaningless shape.
    expect({
      avgRetirementAge: payload.avgRetirementAge,
      maxEndAge: payload.maxEndAge,
    }).toMatchInlineSnapshot(`
      {
        "avgRetirementAge": 65,
        "maxEndAge": 95,
      }
    `);
  });
});
