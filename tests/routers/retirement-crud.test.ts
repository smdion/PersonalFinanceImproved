/**
 * Retirement router CRUD integration tests.
 *
 * Tests CRUD operations for:
 *   - retirement.retirementSettings (list / upsert)
 *   - retirement.retirementSalaryOverrides (list / create / update / delete)
 *   - retirement.retirementBudgetOverrides (list / create / update / delete)
 *   - retirement.returnRates (list / upsert / delete)
 *
 * Moved from routers/settings/retirement.ts to routers/retirement.ts (audit
 * Batch 11 Finding 1 — page-ownership rule, RULES.md's "Settings Belong on
 * Their Pages") — this file moved alongside it (2026-08-20).
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedRetirementProfile,
  seedRetirementProfilePerson,
  viewerSession,
  adminSession,
} from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// RETIREMENT SETTINGS
// ---------------------------------------------------------------------------

describe("retirement.retirementSettings", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db);
  });

  afterAll(() => cleanup());

  const baseSettings = () => ({
    personId: personId,
    retirementAge: 65,
    endAge: 95,
    returnAfterRetirement: "0.04",
    annualInflation: "0.03",
    salaryAnnualIncrease: "0.03",
  });

  describe("list", () => {
    it("returns empty array initially", async () => {
      const rows = await caller.retirement.retirementSettings.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("upsert (insert)", () => {
    it("inserts retirement settings for a person", async () => {
      const result =
        await caller.retirement.retirementSettings.upsert(baseSettings());
      expect(result).toBeDefined();
      expect(result!.personId).toBe(personId);
      expect(result!.retirementAge).toBe(65);
      expect(result!.endAge).toBe(95);
    });

    it("list returns the inserted settings", async () => {
      const rows = await caller.retirement.retirementSettings.list();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.personId).toBe(personId);
    });
  });

  describe("upsert (update)", () => {
    it("updates existing settings for the same person", async () => {
      const result = await caller.retirement.retirementSettings.upsert({
        ...baseSettings(),
        retirementAge: 60,
        endAge: 90,
        withdrawalRate: "0.035",
      });
      expect(result!.retirementAge).toBe(60);
      expect(result!.endAge).toBe(90);
      expect(result!.withdrawalRate).toBe("0.035");
    });

    it("still only one row after update", async () => {
      const rows = await caller.retirement.retirementSettings.list();
      expect(rows).toHaveLength(1);
    });
  });

  describe("upsert with optional fields", () => {
    it("accepts all optional fields", async () => {
      const result = await caller.retirement.retirementSettings.upsert({
        ...baseSettings(),
        postRetirementInflation: "0.025",
        salaryCap: "200000",
        withdrawalRate: "0.04",
        taxMultiplier: "1.25",
        grossUpForTaxes: true,
        socialSecurityMonthly: "2500",
        ssStartAge: 67,
        filingStatus: "MFJ",
      });
      expect(result!.postRetirementInflation).toBe("0.025");
      expect(result!.salaryCap).toBe("200000");
      expect(result!.socialSecurityMonthly).toBe("2500");
      expect(result!.ssStartAge).toBe(67);
    });
  });

  // Regression: "Plan Through" is ONE household control (sections/timeline.tsx)
  // but retirement_settings is per-person and the engine reads
  // Math.max(...perPersonSettings.map(p => p.endAge)) (build-engine-payload.ts:380).
  // Writing only the caller's row let a two-person household save endAge 90
  // against a sibling row still holding 95, so max() stayed 95 and the
  // projection silently ignored the edit (found 2026-08-30).
  describe("household field fan-out", () => {
    let secondPersonId: number;

    it("propagates endAge to every person's row, not just the caller's", async () => {
      secondPersonId = await seedPerson(db);
      await caller.retirement.retirementSettings.upsert({
        ...baseSettings(),
        personId: secondPersonId,
        endAge: 95,
      });

      // Edit "Plan Through" as the FIRST person — the household control.
      await caller.retirement.retirementSettings.upsert({
        ...baseSettings(),
        endAge: 90,
      });

      const rows = await caller.retirement.retirementSettings.list();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      // Every row agrees, so the engine's max() reflects the edit.
      expect(rows.map((r) => r.endAge)).toEqual(rows.map(() => 90));
      expect(Math.max(...rows.map((r) => r.endAge))).toBe(90);
    });

    it("does NOT fan out salaryAnnualIncrease — it is genuinely per-person", async () => {
      // build-engine-payload.ts:1020-1025 reads this per person, and its
      // docblock records that applying the primary's rate to everyone
      // "silently produced the wrong number". Fanning it out would
      // re-introduce an already-fixed bug.
      await caller.retirement.retirementSettings.upsert({
        ...baseSettings(),
        personId: secondPersonId,
        endAge: 90,
        salaryAnnualIncrease: "0.07",
      });
      await caller.retirement.retirementSettings.upsert({
        ...baseSettings(),
        endAge: 90,
        salaryAnnualIncrease: "0.02",
      });

      const rows = await caller.retirement.retirementSettings.list();
      const byPerson = new Map(
        rows.map((r) => [r.personId, r.salaryAnnualIncrease]),
      );
      expect(byPerson.get(personId)).toBe("0.02");
      expect(byPerson.get(secondPersonId)).toBe("0.07");
    });
  });

  describe("auth", () => {
    it("viewer can list retirement settings", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const rows = await viewerCaller.retirement.retirementSettings.list();
        expect(Array.isArray(rows)).toBe(true);
      } finally {
        vc();
      }
    });

    it("viewer cannot upsert retirement settings", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewerCaller.retirement.retirementSettings.upsert(baseSettings()),
        ).rejects.toThrow();
      } finally {
        vc();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT SALARY OVERRIDES
// ---------------------------------------------------------------------------

describe("retirement.retirementSalaryOverrides", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db);
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    let overrideId: number;

    it("list is empty initially", async () => {
      const rows = await caller.retirement.retirementSalaryOverrides.list();
      expect(rows).toHaveLength(0);
    });

    it("creates a salary override", async () => {
      const created = await caller.retirement.retirementSalaryOverrides.create({
        personId,
        projectionYear: 2030,
        overrideSalary: "150000",
        notes: "Promotion expected",
      });
      expect(created).toBeDefined();
      expect(created!.projectionYear).toBe(2030);
      expect(created!.overrideSalary).toBe("150000");
      expect(created!.createdBy).toContain("Test Admin");
      overrideId = created!.id;
    });

    it("creates a second override for a different year", async () => {
      await caller.retirement.retirementSalaryOverrides.create({
        personId,
        projectionYear: 2035,
        overrideSalary: "180000",
      });
      const rows = await caller.retirement.retirementSalaryOverrides.list();
      expect(rows.length).toBe(2);
    });

    it("list returns overrides ordered by projectionYear", async () => {
      const rows = await caller.retirement.retirementSalaryOverrides.list();
      expect(rows[0]!.projectionYear).toBeLessThanOrEqual(
        rows[1]!.projectionYear,
      );
    });

    it("updates a salary override", async () => {
      const updated = await caller.retirement.retirementSalaryOverrides.update({
        id: overrideId,
        personId,
        projectionYear: 2030,
        overrideSalary: "160000",
        notes: "Revised promotion",
      });
      expect(updated!.overrideSalary).toBe("160000");
      expect(updated!.updatedBy).toContain("Test Admin");
    });

    it("deletes a salary override", async () => {
      await caller.retirement.retirementSalaryOverrides.delete({
        id: overrideId,
      });
      const rows = await caller.retirement.retirementSalaryOverrides.list();
      expect(rows.every((r) => r.id !== overrideId)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT BUDGET OVERRIDES
// ---------------------------------------------------------------------------

describe("retirement.retirementBudgetOverrides", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db);
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    let overrideId: number;

    it("list is empty initially", async () => {
      const rows = await caller.retirement.retirementBudgetOverrides.list();
      expect(rows).toHaveLength(0);
    });

    it("creates a budget override", async () => {
      const created = await caller.retirement.retirementBudgetOverrides.create({
        personId,
        projectionYear: 2032,
        overrideMonthlyBudget: "5000",
        notes: "Lower spending after mortgage paid off",
      });
      expect(created).toBeDefined();
      expect(created!.overrideMonthlyBudget).toBe("5000");
      expect(created!.createdBy).toContain("Test Admin");
      overrideId = created!.id;
    });

    it("list returns created overrides", async () => {
      const rows = await caller.retirement.retirementBudgetOverrides.list();
      expect(rows.length).toBe(1);
    });

    it("updates a budget override", async () => {
      const updated = await caller.retirement.retirementBudgetOverrides.update({
        id: overrideId,
        personId,
        projectionYear: 2032,
        overrideMonthlyBudget: "4500",
        notes: "Revised estimate",
      });
      expect(updated!.overrideMonthlyBudget).toBe("4500");
      expect(updated!.updatedBy).toContain("Test Admin");
    });

    it("deletes a budget override", async () => {
      await caller.retirement.retirementBudgetOverrides.delete({
        id: overrideId,
      });
      const rows = await caller.retirement.retirementBudgetOverrides.list();
      expect(rows).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT SCENARIOS
// ---------------------------------------------------------------------------

// retirement.retirementScenarios CRUD tests removed alongside the router
// (Retirement Profiles step B, 2026-08-30). The router had no UI callers and
// wrote columns the engine no longer reads; the four distribution tax rates
// it carried are now on retirement_settings. The table itself survives only
// for the relocation comparison's withdrawal_rate read.

// ---------------------------------------------------------------------------
// RETURN RATES
// ---------------------------------------------------------------------------

describe("retirement.returnRates", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("CRUD", () => {
    it("list is empty initially", async () => {
      const rows = await caller.retirement.returnRates.list();
      expect(rows).toHaveLength(0);
    });

    it("upsert inserts a new return rate", async () => {
      const result = await caller.retirement.returnRates.upsert({
        age: 30,
        rateOfReturn: "0.08",
      });
      expect(result).toBeDefined();
      expect(result!.age).toBe(30);
      expect(result!.rateOfReturn).toBe("0.08");
    });

    it("upsert inserts a second rate for a different age", async () => {
      await caller.retirement.returnRates.upsert({
        age: 60,
        rateOfReturn: "0.05",
      });
      const rows = await caller.retirement.returnRates.list();
      expect(rows.length).toBe(2);
    });

    it("list returns rates ordered by age", async () => {
      const rows = await caller.retirement.returnRates.list();
      expect(rows[0]!.age).toBeLessThan(rows[1]!.age);
    });

    it("upsert updates an existing rate for the same age", async () => {
      const result = await caller.retirement.returnRates.upsert({
        age: 30,
        rateOfReturn: "0.07",
      });
      expect(result!.rateOfReturn).toBe("0.07");

      // Still only two rows
      const rows = await caller.retirement.returnRates.list();
      expect(rows.length).toBe(2);
    });

    it("deletes a return rate by id", async () => {
      const rows = await caller.retirement.returnRates.list();
      const target = rows.find((r) => r.age === 60)!;
      await caller.retirement.returnRates.delete({ id: target.id });
      const afterRows = await caller.retirement.returnRates.list();
      expect(afterRows.length).toBe(1);
      expect(afterRows[0]!.age).toBe(30);
    });
  });

  describe("auth", () => {
    it("viewer can list return rates", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const rows = await viewerCaller.retirement.returnRates.list();
        expect(Array.isArray(rows)).toBe(true);
      } finally {
        vc();
      }
    });

    it("viewer cannot upsert return rates", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewerCaller.retirement.returnRates.upsert({
            age: 40,
            rateOfReturn: "0.06",
          }),
        ).rejects.toThrow();
      } finally {
        vc();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// RETIREMENT PROFILES (multiple profiles + the Plan field).
//
// Every real household starts with exactly one profile ("Current Plan"),
// created by step A's migration backfill against pre-existing data. There is
// no bare `create` on this router -- retirement_settings has too many
// NOT NULL columns with no sensible blank default, so `duplicate` is the
// only creation path (matching the design plan's own recommendation that
// "duplicate to compare" be the primary action). Tests here bootstrap their
// first profile the same way the real migration did: seedRetirementProfile
// inserts the retirement_profiles row directly and points existing
// retirement_settings rows at it.
// ---------------------------------------------------------------------------

describe("retirement.retirementProfiles", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let personA: number;
  let personB: number;
  let firstProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
    personA = await seedPerson(ctx.db, "Person A");
    personB = await seedPerson(ctx.db, "Person B");

    await caller.retirement.retirementSettings.upsert({
      personId: personA,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.06",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
    });
    await caller.retirement.retirementSettings.upsert({
      personId: personB,
      retirementAge: 62,
      endAge: 90,
      returnAfterRetirement: "0.06",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.02",
    });

    firstProfileId = await seedRetirementProfile(ctx.db, "Current Plan");
    await seedRetirementProfilePerson(ctx.db, firstProfileId, personA, {
      retirementAge: 65,
      endAge: 95,
      ssStartAge: 67,
    });
    await seedRetirementProfilePerson(ctx.db, firstProfileId, personB, {
      retirementAge: 62,
      endAge: 90,
      ssStartAge: 65,
    });
  });

  afterAll(() => cleanup());

  it("list returns the seeded profile", async () => {
    const rows = await caller.retirement.retirementProfiles.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Current Plan");
    expect(rows[0]!.id).toBe(firstProfileId);
  });

  it("duplicate refuses a source profile that doesn't exist", async () => {
    await expect(
      caller.retirement.retirementProfiles.duplicate({
        sourceProfileId: 999,
        name: "Won't work",
      }),
    ).rejects.toThrow();
  });

  let secondProfileId: number;

  it("duplicate creates a second profile", async () => {
    const created = await caller.retirement.retirementProfiles.duplicate({
      sourceProfileId: firstProfileId,
      name: "Retire Early",
      description: "What if we both stop at 60?",
    });
    expect(created).toBeDefined();
    expect(created!.name).toBe("Retire Early");
    secondProfileId = created!.id;

    const rows = await caller.retirement.retirementProfiles.list();
    expect(rows).toHaveLength(2);
  });

  it("duplicate clones household settings from the PRIMARY person's row, not each person's own", async () => {
    // personA has retirementAge 65, personB has 62 -- they DISAGREE on this
    // household-grain field (matching the real-world drift
    // pickProfileSettingsRow's docblock documents). Neither person is
    // flagged isPrimaryUser here, so getPrimaryPerson falls back to the
    // first person in id order -- personA. Both new rows must carry
    // personA's retirementAge (65), not a per-person mix.
    const settings = await caller.retirement.retirementSettings.list();
    const newRows = settings.filter((s) => s.profileId === secondProfileId);
    expect(newRows).toHaveLength(2);
    expect(newRows.every((r) => r.retirementAge === 65)).toBe(true);
  });

  it("duplicate creates a retirement_profile_people row for every person (completeness invariant), sourced from the primary person", async () => {
    const rows = await caller.retirement.retirementProfilePeople.list();
    const newRows = rows.filter((r) => r.profileId === secondProfileId);
    expect(newRows).toHaveLength(2);
    // personA (first by id, no isPrimaryUser set on either) is the source
    // for BOTH new rows -- personB's own distinct retirementAge (62) must
    // NOT appear on personB's new row, same rule as the household-settings
    // assertion above.
    expect(newRows.every((r) => r.retirementAge === 65)).toBe(true);
    expect(newRows.every((r) => r.ssStartAge === 67)).toBe(true);
    expect(new Set(newRows.map((r) => r.personId))).toEqual(
      new Set([personA, personB]),
    );
  });

  // Regression: retirementSettings.upsert / retirementProfilePeople.upsertPerson
  // used to scope their writes by personId ALONE. Once a person can hold one
  // row per profile (this describe block: personA/personB each have a row in
  // BOTH firstProfileId and secondProfileId), an edit to one profile matched
  // and silently overwrote every profile's row for that person (found
  // 2026-08-30, phase 4 of the Retirement Profiles migration).
  describe("profile-scoped writes", () => {
    it("retirementSettings.upsert only touches the targeted profile's row", async () => {
      const before = await caller.retirement.retirementSettings.list();
      const firstRow = before.find(
        (s) => s.personId === personA && s.profileId === firstProfileId,
      )!;
      const secondRow = before.find(
        (s) => s.personId === personA && s.profileId === secondProfileId,
      )!;
      expect(firstRow.annualInflation).toBe(secondRow.annualInflation);

      await caller.retirement.retirementSettings.upsert({
        personId: personA,
        profileId: firstProfileId,
        retirementAge: firstRow.retirementAge,
        endAge: firstRow.endAge,
        returnAfterRetirement: firstRow.returnAfterRetirement,
        annualInflation: "0.05",
        salaryAnnualIncrease: firstRow.salaryAnnualIncrease,
      });

      const after = await caller.retirement.retirementSettings.list();
      const firstAfter = after.find(
        (s) => s.personId === personA && s.profileId === firstProfileId,
      )!;
      const secondAfter = after.find(
        (s) => s.personId === personA && s.profileId === secondProfileId,
      )!;
      expect(firstAfter.annualInflation).toBe("0.05");
      // The OTHER profile's row for the same person must be untouched.
      expect(secondAfter.annualInflation).toBe(secondRow.annualInflation);
    });

    it("retirementSettings.upsert's endAge fan-out stays within one profile", async () => {
      // Edit personA's endAge in firstProfileId; personB's row in
      // secondProfileId must not move.
      const before = await caller.retirement.retirementSettings.list();
      const secondPersonBRow = before.find(
        (s) => s.personId === personB && s.profileId === secondProfileId,
      )!;

      await caller.retirement.retirementSettings.upsert({
        personId: personA,
        profileId: firstProfileId,
        retirementAge: 65,
        endAge: 80,
        returnAfterRetirement: "0.06",
        annualInflation: "0.05",
        salaryAnnualIncrease: "0.03",
      });

      const after = await caller.retirement.retirementSettings.list();
      const firstPersonBRow = after.find(
        (s) => s.personId === personB && s.profileId === firstProfileId,
      )!;
      const secondPersonBAfter = after.find(
        (s) => s.personId === personB && s.profileId === secondProfileId,
      )!;
      // Fanned out WITHIN firstProfileId...
      expect(firstPersonBRow.endAge).toBe(80);
      // ...but secondProfileId's row for the same person is untouched.
      expect(secondPersonBAfter.endAge).toBe(secondPersonBRow.endAge);
    });

    it("retirementProfilePeople.upsertPerson only touches the targeted profile's row", async () => {
      await caller.retirement.retirementProfilePeople.upsertPerson({
        profileId: firstProfileId,
        personId: personA,
        retirementAge: 68,
      });
      const rows = await caller.retirement.retirementProfilePeople.list();
      const firstRow = rows.find(
        (r) => r.personId === personA && r.profileId === firstProfileId,
      )!;
      const secondRow = rows.find(
        (r) => r.personId === personA && r.profileId === secondProfileId,
      )!;
      expect(firstRow.retirementAge).toBe(68);
      // The clone in the other profile must not have moved.
      expect(secondRow.retirementAge).toBe(65);
    });

    it("retirementProfilePeople.upsertHouseholdFields fans endAge to every person WITHIN one profile only", async () => {
      await caller.retirement.retirementProfilePeople.upsertHouseholdFields({
        profileId: firstProfileId,
        endAge: 92,
      });
      const rows = await caller.retirement.retirementProfilePeople.list();
      const firstProfileRows = rows.filter(
        (r) => r.profileId === firstProfileId,
      );
      const secondProfileRows = rows.filter(
        (r) => r.profileId === secondProfileId,
      );
      expect(firstProfileRows.every((r) => r.endAge === 92)).toBe(true);
      // secondProfileId's rows are untouched by the fan-out.
      expect(secondProfileRows.some((r) => r.endAge === 92)).toBe(false);
    });

    // R53: before this, the only "Pre-Retirement Raise" control wrote the
    // primary person's retirement_settings row via `upsert` — a second
    // household member's `salary_annual_increase` was unreachable from the
    // UI. `upsertPersonRaiseRate` targets one (profile, person) and writes
    // ONLY that column.
    describe("upsertPersonRaiseRate (R53 — per-person Pre-Retirement Raise)", () => {
      it("sets a second household member's raise rate independently, touching nothing else", async () => {
        const before = await caller.retirement.retirementSettings.list();
        const personARow = before.find(
          (s) => s.personId === personA && s.profileId === firstProfileId,
        )!;
        const personBOtherProfile = before.find(
          (s) => s.personId === personB && s.profileId === secondProfileId,
        )!;

        await caller.retirement.retirementSettings.upsertPersonRaiseRate({
          profileId: firstProfileId,
          personId: personB,
          salaryAnnualIncrease: "0.045",
        });

        const after = await caller.retirement.retirementSettings.list();
        const personBAfter = after.find(
          (s) => s.personId === personB && s.profileId === firstProfileId,
        )!;
        const personAAfter = after.find(
          (s) => s.personId === personA && s.profileId === firstProfileId,
        )!;
        const personBOtherAfter = after.find(
          (s) => s.personId === personB && s.profileId === secondProfileId,
        )!;

        // Person B's rate in this profile is now the value we set — and it's
        // genuinely distinct from person A's (the whole point of R53).
        expect(personBAfter.salaryAnnualIncrease).toBe("0.045");
        expect(personAAfter.salaryAnnualIncrease).toBe(
          personARow.salaryAnnualIncrease,
        );
        expect(personAAfter.salaryAnnualIncrease).not.toBe("0.045");
        // The other profile's row for the same person is untouched.
        expect(personBOtherAfter.salaryAnnualIncrease).toBe(
          personBOtherProfile.salaryAnnualIncrease,
        );
        // No fan-out: only the one row moved, every other column on it too.
        expect(personBAfter.retirementAge).toBe(
          before.find(
            (s) => s.personId === personB && s.profileId === firstProfileId,
          )!.retirementAge,
        );
      });

      it("throws when no retirement_settings row exists for that (profile, person)", async () => {
        await expect(
          caller.retirement.retirementSettings.upsertPersonRaiseRate({
            profileId: 999999,
            personId: personA,
            salaryAnnualIncrease: "0.03",
          }),
        ).rejects.toThrow();
      });
    });
  });

  it("update renames a profile", async () => {
    const updated = await caller.retirement.retirementProfiles.update({
      id: secondProfileId,
      name: "Retire Early (renamed)",
    });
    expect(updated!.name).toBe("Retire Early (renamed)");
  });

  // R43: taxParamsYear pins the profile's resolveTaxParams base year.
  // Reachable via this mutation (advisor-caught gap: the column existed
  // and was read correctly, but nothing could ever set it).
  it("update sets and clears taxParamsYear", async () => {
    const pinned = await caller.retirement.retirementProfiles.update({
      id: secondProfileId,
      taxParamsYear: 2025,
    });
    expect(pinned!.taxParamsYear).toBe(2025);

    const cleared = await caller.retirement.retirementProfiles.update({
      id: secondProfileId,
      taxParamsYear: null,
    });
    expect(cleared!.taxParamsYear).toBeNull();
  });

  it("update rejects an out-of-range taxParamsYear", async () => {
    await expect(
      caller.retirement.retirementProfiles.update({
        id: secondProfileId,
        taxParamsYear: 1900,
      }),
    ).rejects.toThrow();
  });

  it("delete refuses to remove the only remaining profile", async () => {
    // secondProfileId still exists alongside firstProfileId at this point,
    // so deleting ONE of two is fine -- but deleting the last one left must
    // fail. Delete secondProfileId first, then assert the guard on the last.
    await caller.retirement.retirementProfiles.delete({ id: secondProfileId });
    const rows = await caller.retirement.retirementProfiles.list();
    expect(rows).toHaveLength(1);

    await expect(
      caller.retirement.retirementProfiles.delete({ id: firstProfileId }),
    ).rejects.toThrow(/only remaining/);
  });

  it("delete refuses to remove the active profile", async () => {
    const recreated = await caller.retirement.retirementProfiles.duplicate({
      sourceProfileId: firstProfileId,
      name: "Second profile again",
    });
    await caller.settings.appSettings.upsert({
      key: "active_retirement_profile_id",
      value: firstProfileId,
    });
    await expect(
      caller.retirement.retirementProfiles.delete({ id: firstProfileId }),
    ).rejects.toThrow(/active profile/);
    // Cleanup for the next test -- the non-active one deletes fine.
    await caller.retirement.retirementProfiles.delete({ id: recreated!.id });
  });

  it("delete refuses to remove a profile a Plan is set to", async () => {
    const recreated = await caller.retirement.retirementProfiles.duplicate({
      sourceProfileId: firstProfileId,
      name: "Pinned by a Plan",
    });
    const plan = await caller.settings.scenarios.create({
      name: "Test Plan",
      retirementProfileId: recreated!.id,
    });
    await expect(
      caller.retirement.retirementProfiles.delete({ id: recreated!.id }),
    ).rejects.toThrow(/active in/);
    // Clear the Plan's pin so cleanup doesn't leave a dangling reference.
    await caller.settings.scenarios.setRetirementProfilePin({
      id: plan!.id,
      retirementProfileId: null,
    });
    await caller.retirement.retirementProfiles.delete({ id: recreated!.id });
  });

  describe("auth", () => {
    it("viewer can list retirement profiles", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const rows = await viewerCaller.retirement.retirementProfiles.list();
        expect(Array.isArray(rows)).toBe(true);
      } finally {
        vc();
      }
    });

    it("viewer cannot duplicate a retirement profile", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        await expect(
          viewerCaller.retirement.retirementProfiles.duplicate({
            sourceProfileId: firstProfileId,
            name: "Nope",
          }),
        ).rejects.toThrow();
      } finally {
        vc();
      }
    });
  });
});
