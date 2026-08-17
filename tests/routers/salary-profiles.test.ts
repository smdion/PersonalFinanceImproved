/**
 * Salary Profiles router + helpers.
 *
 * Covers the behavior that moved off contribution_profiles when salary became
 * its own first-class entity — CRUD, delete guards (last-remaining,
 * globally-active, Plan-pinned) — plus the PRESENCE encoding that replaced
 * the `{mode:...}` discriminator: a field that is set pins that value, a
 * field that is absent resolves live, an entry that pins nothing contributes
 * NOTHING to the salary override map, and the merge into an existing map is
 * gaps-only per FIELD.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

import { createTestCaller, adminSession, seedPerson, seedJob } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  applySalaryProfileRow,
  loadAndApplySalaryProfile,
  fetchSalaryProfile,
  pinnedSalaries,
  pinnedFields,
  resolveCompensation,
} from "@/server/helpers/salary";
import { canDeleteSalaryProfile } from "@/lib/pure/profiles";

function seedSalaryProfile(
  db: Parameters<typeof seedPerson>[0],
  overrides: Partial<typeof sqliteSchema.salaryProfiles.$inferInsert> = {},
) {
  return db
    .insert(sqliteSchema.salaryProfiles)
    .values({
      name: "Test Salary Profile",
      salaries: {},
      ...overrides,
    })
    .returning({ id: sqliteSchema.salaryProfiles.id })
    .get().id;
}

describe("salaryProfile router", () => {
  describe("list", () => {
    it("returns real rows only — no synthetic id-0 entry", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        // The 0008 migration seeds exactly one ordinary baseline row.
        const seeded = await caller.salaryProfile.list();
        expect(seeded).toHaveLength(1);
        expect(seeded[0]!.id).toBeGreaterThan(0);
        expect(seeded[0]!.pinnedCount).toBe(0);

        seedSalaryProfile(db, { name: "Another" });
        const profiles = await caller.salaryProfile.list();
        expect(profiles.map((p: { id: number }) => p.id)).not.toContain(0);
        expect(profiles).toHaveLength(2);
      } finally {
        cleanup();
      }
    });

    it("counts people with any pin, sums only pinned salaries", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        seedSalaryProfile(db, {
          name: "MixedModes",
          salaries: {
            "1": { salary: 150000 },
            "2": { salary: 160000 },
            "3": {},
            // A bonus-only pin counts as a pinned PERSON but adds nothing
            // to the pinned-salary total.
            "4": { bonusPercent: 0.15 },
          },
        });

        const profiles = await caller.salaryProfile.list();
        const p = profiles.find(
          (x: { name: string }) => x.name === "MixedModes",
        );
        expect(p).toBeDefined();
        expect(p!.pinnedCount).toBe(3);
        expect(p!.pinnedSalaryTotal).toBe(310000);
      } finally {
        cleanup();
      }
    });
  });

  describe("getById", () => {
    it("reports a pinned salary as the effective salary", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, {
          employerName: "TestCorp",
          annualSalary: "100000",
        });
        const profileId = seedSalaryProfile(db, {
          name: "Raise",
          salaries: { [String(personId)]: { salary: 200000 } },
        });

        const result = await caller.salaryProfile.getById({ id: profileId });
        expect(result).not.toBeNull();
        expect(result!.salaryDetails.length).toBe(1);
        const sd = result!.salaryDetails[0]!;
        expect(sd.personName).toBe("Alex");
        expect(sd.employerName).toBe("TestCorp");
        expect(sd.jobSalary).toBe(100000);
        expect(sd.pinnedSalary).toBe(200000);
        expect(sd.effectiveSalary).toBe(200000);
        // Bonus terms were not pinned, so they still resolve live.
        expect(sd.pinnedBonusPercent).toBeNull();
      } finally {
        cleanup();
      }
    });

    it("reports an unpinned person's live job salary as their effective salary", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { annualSalary: "120000" });
        const profileId = seedSalaryProfile(db, {
          name: "Baseline",
          salaries: { [String(personId)]: {} },
        });

        const result = await caller.salaryProfile.getById({ id: profileId });
        const sd = result!.salaryDetails[0]!;
        expect(sd.pinnedSalary).toBeNull();
        expect(sd.jobSalary).toBe(120000);
        expect(sd.effectiveSalary).toBe(120000);
      } finally {
        cleanup();
      }
    });

    it("defaults a person with no entry yet to following their job", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Newcomer");
        seedJob(db, personId, { annualSalary: "90000" });
        // Profile created before this person existed — empty map.
        const profileId = seedSalaryProfile(db, {
          name: "Older",
          salaries: {},
        });

        const result = await caller.salaryProfile.getById({ id: profileId });
        const sd = result!.salaryDetails[0]!;
        expect(sd.pinnedSalary).toBeNull();
        expect(sd.effectiveSalary).toBe(90000);
      } finally {
        cleanup();
      }
    });

    it("returns null for an unknown id — 0 included, it is not a sentinel", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        expect(await caller.salaryProfile.getById({ id: 9999 })).toBeNull();
        expect(await caller.salaryProfile.getById({ id: 0 })).toBeNull();
      } finally {
        cleanup();
      }
    });
  });

  describe("create / update", () => {
    it("creates a profile with explicit entries", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const profile = await caller.salaryProfile.create({
          name: "Full Pin",
          description: "Has everything",
          salaries: {
            "1": { salary: 150000 },
            "2": {},
          },
        });
        expect(profile.name).toBe("Full Pin");
        const s = profile.salaries as Record<string, { salary?: number }>;
        expect(s["1"]).toEqual({ salary: 150000 });
        // An entry that pins nothing is normalized away on write — it means
        // the same as having no key, so only one representation is stored.
        expect(s["2"]).toBeUndefined();
      } finally {
        cleanup();
      }
    });

    it("defaults to pinning nothing — never inherits another profile's pins", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const alex = await seedPerson(db, "Alex");
        const sam = await seedPerson(db, "Sam");
        // An existing profile with pins must not leak into the new one.
        seedSalaryProfile(db, {
          name: "Pinned",
          salaries: { [String(alex)]: { salary: 999999 } },
        });

        const profile = await caller.salaryProfile.create({ name: "Fresh" });
        expect(profile.description).toBeNull();
        // Empty IS complete under the presence encoding: it says "this
        // profile pins nothing", so there is no per-person enumeration to
        // go stale when someone is added later.
        expect(profile.salaries).toEqual({});
        expect(sam).toBeGreaterThan(0);
      } finally {
        cleanup();
      }
    });

    it("updates entries on an existing profile", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedSalaryProfile(db, { name: "EntryUpdate" });
        const updated = await caller.salaryProfile.update({
          id: profileId,
          salaries: { "1": { salary: 200000 } },
        });
        expect((updated.salaries as Record<string, unknown>)["1"]).toEqual({
          salary: 200000,
        });
      } finally {
        cleanup();
      }
    });

    it("the migration-seeded baseline profile is an ordinary, editable row", async () => {
      // The formerly-synthetic "Live" entry is now a normal row: it can be
      // renamed and can carry pins like any other profile.
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const [seeded] = await caller.salaryProfile.list();
        const renamed = await caller.salaryProfile.update({
          id: seeded!.id,
          name: "My Baseline",
          salaries: { "1": { salary: 123456 } },
        });
        expect(renamed.name).toBe("My Baseline");
        expect((renamed.salaries as Record<string, unknown>)["1"]).toEqual({
          salary: 123456,
        });
      } finally {
        cleanup();
      }
    });

    it("throws when updating a profile that does not exist", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        await expect(
          caller.salaryProfile.update({ id: 9999, name: "x" }),
        ).rejects.toThrow("Profile not found");
      } finally {
        cleanup();
      }
    });
  });

  describe("delete", () => {
    it("deletes an unreferenced profile when others remain", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        // A migration-seeded profile already exists, so this one is deletable.
        const profileId = seedSalaryProfile(db, { name: "Doomed" });
        expect(await caller.salaryProfile.delete({ id: profileId })).toEqual({
          success: true,
        });
        expect(
          await caller.salaryProfile.getById({ id: profileId }),
        ).toBeNull();
      } finally {
        cleanup();
      }
    });

    it("refuses to delete the last remaining profile", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const [only] = await caller.salaryProfile.list();
        await expect(
          caller.salaryProfile.delete({ id: only!.id }),
        ).rejects.toThrow("only remaining");
      } finally {
        cleanup();
      }
    });

    it("refuses to delete a profile pinned by a Plan", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const profileId = seedSalaryProfile(db, { name: "Pinned" });
        db.insert(sqliteSchema.scenarios)
          .values({
            name: "My Plan",
            overrides: {},
            isBaseline: false,
            salaryProfileId: profileId,
          })
          .run();

        await expect(
          caller.salaryProfile.delete({ id: profileId }),
        ).rejects.toThrow("pinned by 1 Plan");
      } finally {
        cleanup();
      }
    });
  });
});

describe("canDeleteSalaryProfile", () => {
  it("blocks the last remaining profile and the globally-active one", () => {
    expect(canDeleteSalaryProfile(null, 1, 1).allowed).toBe(false);
    expect(canDeleteSalaryProfile(5, 5, 3).allowed).toBe(false);
    expect(canDeleteSalaryProfile(5, 6, 3).allowed).toBe(true);
    expect(canDeleteSalaryProfile(null, 6, 3).allowed).toBe(true);
  });
});

describe("salary profile merge helpers", () => {
  const profile = {
    id: 1,
    name: "Raise",
    description: null,
    salaries: {
      "1": { salary: 200000 },
      "2": { salary: 90000 },
      // Pins nothing — the presence-encoding equivalent of the old
      // {mode:"job"}. Must never reach the map.
      "3": {},
      // Pins ONLY bonus terms. Has a map entry (something IS pinned) but no
      // salary, which is the distinction `.has()` cannot express.
      "4": { bonusPercent: 0.25 },
    },
    createdAt: new Date(),
  };

  it("fills gaps only — existing (Plan) entries win", () => {
    const planMap = new Map([[1, { salary: 111111 }]]);
    const merged = applySalaryProfileRow(profile, planMap);
    expect(merged.get(1)?.salary).toBe(111111); // Plan override wins
    expect(merged.get(2)?.salary).toBe(90000); // gap filled from the profile
  });

  it("merges gaps PER FIELD, not per person", () => {
    // A Plan pins salary only. The profile's bonus pin for that same person
    // must survive — a per-person merge would silently discard it, and the
    // two pins are independent facts.
    const planMap = new Map([[4, { salary: 123456 }]]);
    const merged = applySalaryProfileRow(profile, planMap);
    expect(merged.get(4)?.salary).toBe(123456);
    expect(merged.get(4)?.bonusPercent).toBe(0.25);
  });

  it("NEVER populates the map for a person who pins nothing", () => {
    // The core invariant. A key in this map means "has at least one pin";
    // an entry that pins nothing must produce no key at all, or every
    // `.has()` call site reads an override that carries no value.
    const merged = applySalaryProfileRow(profile, new Map());
    expect(merged.has(3)).toBe(false);
    expect([...merged.keys()].sort()).toEqual([1, 2, 4]);
  });

  it("a map key does NOT imply the salary is pinned", () => {
    // Person 4 pins bonus terms only. Anything reading `.has()` as "salary
    // is pinned" gets this wrong; `?.salary !== undefined` gets it right.
    const merged = applySalaryProfileRow(profile, new Map());
    expect(merged.has(4)).toBe(true);
    expect(merged.get(4)?.salary).toBeUndefined();
  });

  it("pinnedSalaries keeps only people whose SALARY is pinned", () => {
    expect(pinnedSalaries(profile.salaries)).toEqual({
      "1": 200000,
      "2": 90000,
    });
    expect(pinnedSalaries({ "9": {} })).toEqual({});
    // Bonus-only pins are not salaries and must not be collapsed into one.
    expect(pinnedSalaries({ "9": { bonusPercent: 0.1 } })).toEqual({});
    expect(pinnedSalaries(null)).toEqual({});
  });

  it("pinnedFields drops empty, null and non-finite values", () => {
    expect(pinnedFields({})).toBeUndefined();
    expect(pinnedFields(null)).toBeUndefined();
    expect(pinnedFields({ salary: 100 })).toEqual({ salary: 100 });
    expect(pinnedFields({ salary: undefined, bonusPercent: 0.1 })).toEqual({
      bonusPercent: 0.1,
    });
    expect(pinnedFields({ salary: NaN })).toBeUndefined();
  });

  it("a profile that pins nothing leaves the map completely untouched", () => {
    const nothing = { ...profile, salaries: { "1": {}, "2": {} } };
    expect(applySalaryProfileRow(nothing, new Map()).size).toBe(0);
  });

  it("does not mutate the input map", () => {
    const planMap = new Map([[1, { salary: 111111 }]]);
    applySalaryProfileRow(profile, planMap);
    expect(planMap.size).toBe(1);
  });

  it("is a no-op for a null/undefined profile", () => {
    const planMap = new Map([[1, { salary: 111111 }]]);
    expect(applySalaryProfileRow(null, planMap)).toBe(planMap);
    expect(applySalaryProfileRow(undefined, planMap)).toBe(planMap);
  });

  it("treats null/undefined as 'no profile selected', a missing id as not found", async () => {
    const { db, cleanup } = await createTestCaller(adminSession);
    try {
      // Drizzle ORM: the helper is typed against the Postgres db instance,
      // but the test harness's SQLite instance is structurally compatible
      // for the simple select/insert calls these helpers make.
      // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM dual-driver test harness
      const dbAny = db as unknown as Parameters<typeof fetchSalaryProfile>[0];
      expect(await fetchSalaryProfile(dbAny, null)).toBeNull();
      expect(await fetchSalaryProfile(dbAny, undefined)).toBeNull();
      // 0 is no longer a sentinel — it's just an id that doesn't exist.
      expect(await fetchSalaryProfile(dbAny, 0)).toBeNull();

      const map = new Map([[1, { salary: 5 }]]);
      expect(await loadAndApplySalaryProfile(dbAny, null, map)).toBe(map);
      expect(await loadAndApplySalaryProfile(dbAny, 9999, map)).toBe(map);
    } finally {
      cleanup();
    }
  });

  it("loads a stored profile and merges it gaps-only", async () => {
    const { db, cleanup } = await createTestCaller(adminSession);
    try {
      // Drizzle ORM: the helper is typed against the Postgres db instance,
      // but the test harness's SQLite instance is structurally compatible
      // for the simple select/insert calls these helpers make.
      // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM dual-driver test harness
      const dbAny = db as unknown as Parameters<typeof fetchSalaryProfile>[0];
      const profileId = seedSalaryProfile(db, {
        name: "Loaded",
        salaries: {
          "1": { salary: 200000 },
          "2": { salary: 90000 },
          "3": {},
        },
      });
      const merged = await loadAndApplySalaryProfile(
        dbAny,
        profileId,
        new Map([[1, { salary: 111111 }]]),
      );
      expect(merged.get(1)?.salary).toBe(111111);
      expect(merged.get(2)?.salary).toBe(90000);
      expect(merged.has(3)).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("resolveCompensation — the single definition of pay under a profile", () => {
  const job = {
    bonusPercent: "0.1",
    bonusMultiplier: "1",
    monthsInBonusYear: 12,
  };

  it("pins nothing: salary and bonus both resolve live", () => {
    const c = resolveCompensation(job, 100000, undefined, null);
    expect(c).toMatchObject({
      salary: 100000,
      bonus: 10000,
      totalComp: 110000,
    });
  });

  it("a pinned salary KEEPS its bonus, scaled to the pinned salary", () => {
    // The shipped bug: this used to produce totalComp === 200000, dropping
    // the bonus entirely, while the profile editor displayed 220000.
    const c = resolveCompensation(job, 100000, { salary: 200000 }, null);
    expect(c).toMatchObject({
      salary: 200000,
      bonus: 20000,
      totalComp: 220000,
    });
  });

  it("pinned bonus terms apply to a live salary", () => {
    const c = resolveCompensation(job, 100000, { bonusPercent: 0.25 }, null);
    expect(c).toMatchObject({
      salary: 100000,
      bonus: 25000,
      totalComp: 125000,
    });
  });

  it("pinned salary and pinned terms compose", () => {
    const c = resolveCompensation(
      job,
      100000,
      { salary: 200000, bonusPercent: 0.25, bonusMultiplier: 2 },
      null,
    );
    expect(c.totalComp).toBe(200000 + 200000 * 0.25 * 2);
  });

  it("a job_bonus_overrides pin short-circuits the formula, pinned or not", () => {
    expect(
      resolveCompensation(job, 100000, { salary: 200000 }, 4000),
    ).toMatchObject({ bonus: 4000, totalComp: 204000 });
    expect(resolveCompensation(job, 100000, undefined, 4000)).toMatchObject({
      bonus: 4000,
      totalComp: 104000,
    });
  });

  it("monthsInBonusYear prorates, live or pinned", () => {
    expect(
      resolveCompensation(
        { ...job, monthsInBonusYear: 6 },
        100000,
        undefined,
        null,
      ).bonus,
    ).toBe(5000);
    expect(
      resolveCompensation(job, 100000, { monthsInBonusYear: 6 }, null).bonus,
    ).toBe(5000);
  });
});
