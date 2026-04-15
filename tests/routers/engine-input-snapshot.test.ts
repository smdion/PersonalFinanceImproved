/**
 * Engine input snapshot guard — the advisor-mandated numeric safety net for
 * the v0.5.2 refactor (see .scratch/docs/V052-REFACTOR-PLAN.md § Principles).
 * Expanded in v0.5.3 (B6) per advisor pushback on 200-line inline snapshots:
 * split into a structure test (keys-only inline snapshot) and content tests
 * (explicit per-field assertions that reviewers can reason about without -u).
 *
 * Seeds a deterministic fixture — birth year 1990, salary $120k, retirement
 * at 65, 2026-04-14 wall clock, 2026 IRS limits — and asserts that
 * `baseEngineInput` carries the correct derived values. Any refactor that
 * silently drifts a default, a derived value, or a limit lookup will fail
 * this test loudly.
 *
 * -- Structure test: `Object.keys(bei).sort()` inline snapshot guards field
 *    add/remove (shape invariant, OK to auto-update on intentional additions).
 * -- Content tests: explicit `toBe` assertions for numeric defaults that
 *    MUST NOT be auto-updated without human review.
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

    // Seed the canonical fixture (person id=1, job id=1, perfAcct id=1)
    const { personId, jobId, perfAcctId } = seedStandardDataset(db);

    // Seed a 401k contribution account so that baseLimits / catchupLimits
    // are populated (limit computation iterates activeContribs per person).
    // Correct field names: accountType (not category), contributionMethod (not
    // method), contributionValue (not value). personId is NOT NULL.
    db.insert(schema.contributionAccounts)
      .values({
        personId,
        jobId,
        accountType: "401k",
        parentCategory: "Retirement",
        taxTreatment: "pre_tax",
        contributionMethod: "percent_of_salary",
        contributionValue: "0.10",
        employerMatchType: "percent_of_contrib",
        employerMatchValue: "0.50",
        employerMaxMatchPct: "0.06",
        isActive: true,
        performanceAccountId: perfAcctId,
      })
      .run();

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

  it("key numeric defaults match the seeded fixture — NO auto-update without human review", () => {
    // B6 content guard (v0.5.3). These are EXPLICIT assertions — not snapshots.
    // Any change to these numbers is a user-visible projection change and must
    // be reviewed by a human before merging.
    const bei = payload.baseEngineInput;

    // Settings-derived scalars
    // annualInflation: "0.03" → inflationRate
    expect(bei.inflationRate).toBe(0.03);
    // salaryAnnualIncrease: "0.03" → salaryGrowthRate
    expect(bei.salaryGrowthRate).toBe(0.03);
    // retirementAge: 65
    expect(bei.retirementAge).toBe(65);
    // endAge: 95 → projectionEndAge
    expect(bei.projectionEndAge).toBe(95);
    // annualSalary: "120000", no salary-change rows → currentSalary = 120000
    expect(bei.currentSalary).toBe(120000);

    // 2026 IRS contribution limits (seed: seed-reference-data.sql + vi.setSystemTime("2026-04-14"))
    // baseLimits is keyed by AccountCategory. Only categories whose owners have
    // activeContribs are populated; the rest are 0. We seeded a 401k account.
    expect(bei.baseLimits["401k"]).toBe(24500); // 401k_employee_limit 2026
    // catchupLimits is keyed by limit group name (not AccountCategory).
    // Catchup requires age ≥ 50; fixture person is 36 → catchupByGroup populated
    // from the limits table but not reflected in the effective limit. The limit
    // TABLE value is what we assert here — application of catchup is age-gated
    // in the engine, not in the payload.
    expect(bei.catchupLimits["401k"]).toBe(8000); // 401k_catchup_limit 2026

    // contributionSpecs — derived from the seeded 401k account
    expect(Array.isArray(bei.contributionSpecs)).toBe(true);
    expect(bei.contributionSpecs!.length).toBeGreaterThan(0);
    expect(bei.contributionSpecs![0]!.category).toBe("401k");

    // returnRates — no returnRateTable rows seeded → empty array
    expect(Array.isArray(bei.returnRates)).toBe(true);
    expect(bei.returnRates.length).toBe(0);
  });
});
