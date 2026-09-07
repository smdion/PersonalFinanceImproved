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
import {
  createTestCaller,
  adminSession,
  seedStandardDataset,
  seedPerson,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";
import {
  buildEnginePayload,
  fetchRetirementData,
} from "@/server/retirement/build-engine-payload";
import { sweepClaimingAges } from "@/lib/calculators/social-security";
import { buildSocialSecurityEntries } from "@/server/retirement/social-security-entries";
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

/**
 * Two-person MFJ household. `workerId` (born 1990, from
 * `seedStandardDataset`) is the swept person and the PIA-providing worker
 * — the one whose "has this person filed yet" status gates the spouse's
 * spousal top-up (see social-security-entries.ts). `spouseId` (born 1994 —
 * same FRA-67 band as 1990, so the spousal reduction SCHEDULE is identical
 * for both; only the filed-gate's calendar-year math varies) claims at a
 * FIXED age 62 (year 2056), chosen to land strictly between the worker's
 * two swept extremes' filing years (62 -> 2052, 70 -> 2060) so the two
 * candidates land on opposite sides of the "has the worker filed yet"
 * gate. Mirrors build-engine-payload.test.ts's two-person fixture shape,
 * adapted to this file's schema import (`schema-sqlite` vs the dynamic
 * `@/lib/db/schema` import build-engine-payload.test.ts uses).
 */
async function seedMfjPiaHousehold(
  db: BetterSQLite3Database<typeof sqliteSchema>,
) {
  const { personId: workerId, perfAcctId } = seedStandardDataset(db);
  const spouseId = await seedPerson(db, "Spouse", "1994-04-10");

  db.insert(schema.retirementSettings)
    .values({
      personId: workerId,
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
      socialSecurityMonthly: "0",
      ssStartAge: 62,
      enableRothConversions: false,
      enableIrmaaAwareness: false,
      enableAcaAwareness: false,
      householdSize: 2,
      filingStatus: "MFJ",
    })
    .run();
  db.insert(schema.retirementSettings)
    .values({
      personId: spouseId,
      retirementAge: 62,
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
      socialSecurityMonthly: "500", // $6000/yr flat, low -> spousal will dominate
      ssStartAge: 62,
      enableRothConversions: false,
      enableIrmaaAwareness: false,
      enableAcaAwareness: false,
      householdSize: 2,
      filingStatus: "MFJ",
    })
    .run();

  const profileId = db
    .insert(schema.retirementProfiles)
    .values({ name: "Current Plan" })
    .returning({ id: schema.retirementProfiles.id })
    .get().id;
  db.update(schema.retirementSettings).set({ profileId }).run();
  db.insert(schema.retirementProfilePeople)
    .values([
      {
        profileId,
        personId: workerId,
        retirementAge: 65,
        endAge: 90,
        socialSecurityMonthly: "0",
        ssStartAge: 62,
        // No stored PIA — the sweep's `pia` input is a what-if override for
        // this person, same as the single-person tests above.
      },
      {
        profileId,
        personId: spouseId,
        retirementAge: 62,
        endAge: 90,
        socialSecurityMonthly: "500",
        ssStartAge: 62, // claims early, fixed (not swept)
      },
    ])
    .run();

  // Multi-person households compute currentAge as an average across both
  // people — worker (born 1990) and spouse (born 1994) average to ~33,
  // below the single 35 breakpoint `seedFullProjectionData` gets away
  // with, so this fixture needs a lower breakpoint too.
  db.insert(schema.returnRateTable)
    .values({ age: 0, rateOfReturn: "0.07" })
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
      personId: workerId,
      performanceAccountId: perfAcctId,
      parentCategory: "Retirement",
    })
    .run();

  return { workerId, spouseId, profileId };
}

describe("projection router — sweepSocialSecurityClaimingAges, MFJ two-person household", () => {
  it("rebuilds the WHOLE household's entries per candidate age (spousal top-up responds to the swept worker's age), matching a direct call exactly", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { workerId } = await seedMfjPiaHousehold(db);

      const response = await caller.projection.sweepSocialSecurityClaimingAges({
        personId: workerId,
        pia: 48000,
        ages: [62, 70],
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
      const worker = perPersonSettings.find((p) => p.personId === workerId);
      if (!worker)
        throw new Error("expected the seeded worker in perPersonSettings");
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

      // Mirrors exactly what the router's own buildCandidateInput does:
      // rebuild every person's entry through buildSocialSecurityEntries,
      // with only the swept worker overridden per candidate age.
      const direct = sweepClaimingAges({
        input: engineInput,
        personId: workerId,
        pia: 48000,
        birthYear: worker.birthYear,
        ages: [62, 70],
        buildCandidateInput: (claimingAge) => ({
          ...engineInput,
          socialSecurityEntries: buildSocialSecurityEntries(
            perPersonSettings,
            settings.filingStatus,
            0,
            new Map([[workerId, { pia: 48000, startAge: claimingAge }]]),
          ),
        }),
      });

      expect(response.result).toEqual(direct);

      // And prove the two candidates actually diverge because of the
      // SPOUSE's (non-swept) entry, not just the worker's own
      // claiming-age-adjusted amount: at 62 the worker has filed by the
      // time the spouse claims (both in the same year), so the spouse
      // gets a spousal top-up; at 70 the worker hasn't filed yet when the
      // spouse claims at 62, so the spouse gets none. Before the fix, the
      // spouse's entry was frozen across every candidate and this
      // wouldn't have moved for that reason.
      const at62 = direct.candidates.find((c) => c.claimingAge === 62)!;
      const at70 = direct.candidates.find((c) => c.claimingAge === 70)!;
      expect(at62.finalNetWorth).not.toBeCloseTo(at70.finalNetWorth, -3);
    } finally {
      cleanup();
    }
  });
});

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
