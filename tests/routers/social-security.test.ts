/**
 * Social Security claiming-age sweep — `sweepSocialSecurityClaimingAges`
 * router endpoint.
 *
 * Mirrors `withdrawal-bracket-optimizer.test.ts`'s pattern: null result
 * when unseeded, a real result shape with seeded data, a check that the
 * router's output matches a direct call to the underlying calculator for
 * the same resolved engine input, and auth gating.
 *
 * `pia` is a caller-supplied router input; `birthYear` is NOT (server-
 * derived from `perPersonSettings` — see social-security.ts's own
 * docblock for why). No `retirement_profile_people.social_security_pia`
 * row is needed to exercise this endpoint, unlike the build-engine-payload
 * tests that exercise the PIA persistence path itself.
 *
 * Note: `seedStandardDataset`'s person is born 1990, which happens to
 * share the SAME Full Retirement Age (67) as 1963 — both are in the
 * "1960+" FRA band. Don't hardcode a different birthYear in a comparison
 * call expecting it to diverge from what the router derives; it won't,
 * for this fixture, and that already once masked a real staleness bug in
 * an earlier version of this file (a hardcoded 1963 that had no effect
 * once birthYear became server-derived, because both years land on the
 * same FRA bucket).
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
import { sweepClaimingAges } from "@/lib/calculators/social-security";
import {
  decumulationDefaultsInputSchema,
  buildDecumulationDefaults,
} from "@/server/routers/projection/_shared";
import type {
  AccumulationOverride,
  DecumulationOverride,
} from "@/lib/calculators/types";

/** Same shape as withdrawal-bracket-optimizer.test.ts's
 *  seedFullProjectionData — duplicated locally rather than imported (not
 *  exported), matching this directory's convention for single-endpoint
 *  test files. */
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
      householdSize: 1,
      filingStatus: "Single",
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

  return { personId };
}

describe("projection router — sweepSocialSecurityClaimingAges", () => {
  it("returns null result when no retirement data is seeded", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const response = await caller.projection.sweepSocialSecurityClaimingAges({
        personId: 1,
        pia: 30000,
      });
      expect(response).toEqual({ result: null });
    } finally {
      cleanup();
    }
  });

  it("returns a ClaimingAgeSweepResult shape with seeded data", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      const response = await caller.projection.sweepSocialSecurityClaimingAges({
        personId,
        pia: 30000,
      });
      expect(response.result).not.toBeNull();
      expect(response.result).toHaveProperty("recommendedAge");
      // Default sweep is every age 62-70 inclusive.
      expect(response.result?.candidates.length).toBe(9);
      for (const c of response.result?.candidates ?? []) {
        expect(c).toHaveProperty("claimingAge");
        expect(c).toHaveProperty("adjustedAnnualBenefit");
        expect(c).toHaveProperty("finalNetWorth");
        expect(c).toHaveProperty("depleted");
      }
    } finally {
      cleanup();
    }
  });

  it("honors a caller-supplied subset of ages", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      const response = await caller.projection.sweepSocialSecurityClaimingAges({
        personId,
        pia: 30000,
        ages: [62, 70],
      });
      expect(
        response.result?.candidates.map((c) => c.claimingAge).sort(),
      ).toEqual([62, 70]);
    } finally {
      cleanup();
    }
  });

  it("returns exactly what a direct call to sweepClaimingAges produces for the same resolved engine input", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      const response = await caller.projection.sweepSocialSecurityClaimingAges({
        personId,
        pia: 30000,
        ages: [62, 67],
      });

      const data = await fetchRetirementData(db, {});
      const payload = await buildEnginePayload(db, data, {});
      if (!payload) throw new Error("expected a payload for seeded data");
      const {
        settings,
        distributionTaxRates,
        baseEngineInput,
        perPersonSettings,
      } = payload;
      const person = perPersonSettings.find((p) => p.personId === personId);
      if (!person)
        throw new Error("expected the seeded person in perPersonSettings");
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
      // birthYear comes from the SAME perPersonSettings lookup the router
      // itself uses — not hardcoded — so this test can't be fooled by two
      // different birth years landing on the same FRA bucket (see this
      // file's own docblock for why that already happened once).
      const direct = sweepClaimingAges({
        input: engineInput,
        personId,
        pia: 30000,
        birthYear: person.birthYear,
        ages: [62, 67],
      });

      expect(response.result).toEqual(direct);
    } finally {
      cleanup();
    }
  });

  it("rejects a personId that doesn't belong to this household", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedFullProjectionData(db);

      await expect(
        caller.projection.sweepSocialSecurityClaimingAges({
          personId: 999999,
          pia: 30000,
        }),
      ).rejects.toThrow(/No person with id/);
    } finally {
      cleanup();
    }
  });

  it("rejects a non-positive PIA at the input boundary", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      await expect(
        caller.projection.sweepSocialSecurityClaimingAges({
          personId,
          pia: 0,
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("rejects an out-of-range claiming age at the input boundary", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { personId } = seedFullProjectionData(db);

      await expect(
        caller.projection.sweepSocialSecurityClaimingAges({
          personId,
          pia: 30000,
          ages: [60], // below the 62 minimum
        }),
      ).rejects.toThrow();
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
        caller.projection.sweepSocialSecurityClaimingAges({
          personId: 1,
          pia: 30000,
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});
