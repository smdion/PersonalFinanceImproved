/**
 * Salary Profiles router + helpers.
 *
 * Covers CRUD, delete guards (last-remaining, globally-active, Plan-pinned),
 * and the complete-entry encoding: a profile's `salaries` map is jobId →
 * COMPLETE entry (`{salary, bonusPercent, bonusMultiplier,
 * monthsInBonusYear}`, all four, always). A job either has a real entry or
 * (no key at all) the profile says nothing about it and it contributes $0 —
 * there is no partial/pinned state and no live fallback, because a job has
 * no salary of its own to fall back to.
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
  resolveCompensation,
} from "@/server/helpers/salary";
import { canDeleteSalaryProfile } from "@/lib/pure/profiles";

/** A complete entry — every field required, matching the stored shape. */
function entry(
  overrides: Partial<{
    salary: number;
    bonusPercent: number;
    bonusMultiplier: number;
    monthsInBonusYear: number;
  }> = {},
) {
  return {
    salary: 0,
    bonusPercent: 0,
    bonusMultiplier: 1,
    monthsInBonusYear: 12,
    ...overrides,
  };
}

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

    it("counts jobs with an entry, sums only their salaries", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        seedSalaryProfile(db, {
          name: "Mixed",
          salaries: {
            "1": entry({ salary: 150000 }),
            "2": entry({ salary: 160000 }),
          },
        });

        const profiles = await caller.salaryProfile.list();
        const p = profiles.find((x: { name: string }) => x.name === "Mixed");
        expect(p).toBeDefined();
        expect(p!.pinnedCount).toBe(2);
        expect(p!.pinnedSalaryTotal).toBe(310000);
      } finally {
        cleanup();
      }
    });
  });

  describe("getById", () => {
    it("reports a job's complete entry as its effective salary", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const jobId = seedJob(db, personId, {
          employerName: "TestCorp",
          annualSalary: "100000",
        });
        const profileId = seedSalaryProfile(db, {
          name: "Raise",
          salaries: { [String(jobId)]: entry({ salary: 200000 }) },
        });

        const result = await caller.salaryProfile.getById({ id: profileId });
        expect(result).not.toBeNull();
        expect(result!.salaryDetails.length).toBe(1);
        const sd = result!.salaryDetails[0]!;
        expect(sd.personName).toBe("Alex");
        expect(sd.employerName).toBe("TestCorp");
        expect(sd.hasEntry).toBe(true);
        expect(sd.salary).toBe(200000);
        expect(sd.effectiveSalary).toBe(200000);
      } finally {
        cleanup();
      }
    });

    it("never defaults the selected job to the speculative one, even though both have no endDate", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        const realJobId = seedJob(db, personId, {
          employerName: "RealCorp",
          annualSalary: "120000",
          startDate: "2020-01-01",
        });
        // Created AFTER the real job (more recent startDate), the way the
        // auto-provisioning migration/people.create would — this is exactly
        // the ordering that would wrongly win a naive "most recent job with
        // no endDate" default-selection.
        seedJob(db, personId, {
          employerName: "Speculative (What-If Planning)",
          annualSalary: "0",
          startDate: "2026-01-01",
          isSpeculative: true,
        });
        const profileId = seedSalaryProfile(db, {
          name: "Fresh",
          salaries: { [String(realJobId)]: entry({ salary: 120000 }) },
        });

        const result = await caller.salaryProfile.getById({ id: profileId });
        const sd = result!.salaryDetails[0]!;
        expect(sd.jobId).toBe(realJobId);
        expect(sd.employerName).toBe("RealCorp");
        // The speculative job still shows up as a pickable option.
        expect(
          sd.jobOptions.some((jo: { employerName: string }) =>
            jo.employerName.includes("Speculative"),
          ),
        ).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("reports $0/no entry for a job the profile doesn't mention", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const personId = await seedPerson(db, "Alex");
        seedJob(db, personId, { annualSalary: "120000" });
        const profileId = seedSalaryProfile(db, {
          name: "Empty",
          salaries: {},
        });

        const result = await caller.salaryProfile.getById({ id: profileId });
        const sd = result!.salaryDetails[0]!;
        expect(sd.hasEntry).toBe(false);
        expect(sd.salary).toBe(0);
        expect(sd.effectiveSalary).toBe(0);
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
    it("creates a profile with explicit complete entries", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const profile = await caller.salaryProfile.create({
          name: "Full Entries",
          description: "Has one job",
          salaries: {
            "1": entry({ salary: 150000 }),
          },
        });
        expect(profile.name).toBe("Full Entries");
        const s = profile.salaries as Record<
          string,
          { salary: number; bonusPercent: number }
        >;
        expect(s["1"]).toEqual(entry({ salary: 150000 }));
      } finally {
        cleanup();
      }
    });

    it("defaults to empty — never inherits another profile's entries", async () => {
      const { caller, db, cleanup } = await createTestCaller(adminSession);
      try {
        const alex = await seedPerson(db, "Alex");
        const sam = await seedPerson(db, "Sam");
        // An existing profile with entries must not leak into the new one.
        seedSalaryProfile(db, {
          name: "Loaded",
          salaries: { [String(alex)]: entry({ salary: 999999 }) },
        });

        const profile = await caller.salaryProfile.create({ name: "Fresh" });
        expect(profile.description).toBeNull();
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
          salaries: { "1": entry({ salary: 200000 }) },
        });
        expect((updated.salaries as Record<string, unknown>)["1"]).toEqual(
          entry({ salary: 200000 }),
        );
      } finally {
        cleanup();
      }
    });

    it("the migration-seeded baseline profile is an ordinary, editable row", async () => {
      const { caller, cleanup } = await createTestCaller(adminSession);
      try {
        const [seeded] = await caller.salaryProfile.list();
        const renamed = await caller.salaryProfile.update({
          id: seeded!.id,
          name: "My Baseline",
          salaries: { "1": entry({ salary: 123456 }) },
        });
        expect(renamed.name).toBe("My Baseline");
        expect((renamed.salaries as Record<string, unknown>)["1"]).toEqual(
          entry({ salary: 123456 }),
        );
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
  // Keys are jobIds — a Salary Profile targets a specific job's terms, not
  // "whichever job this person currently has".
  const profile = {
    id: 1,
    name: "Raise",
    description: null,
    salaries: {
      "101": entry({ salary: 200000 }),
      "102": entry({ salary: 90000 }),
    },
    createdAt: new Date(),
  };

  it("builds a jobId-keyed map from the profile's entries", () => {
    const map = applySalaryProfileRow(profile);
    expect(map.get(101)?.salary).toBe(200000);
    expect(map.get(102)?.salary).toBe(90000);
  });

  it("has no key at all for a job the profile doesn't mention", () => {
    const map = applySalaryProfileRow(profile);
    expect(map.has(103)).toBe(false);
    expect([...map.keys()].sort()).toEqual([101, 102]);
  });

  it("is an empty map for a profile with no entries at all", () => {
    expect(applySalaryProfileRow({ ...profile, salaries: {} }).size).toBe(0);
  });

  it("is an empty map for a null/undefined profile", () => {
    expect(applySalaryProfileRow(null).size).toBe(0);
    expect(applySalaryProfileRow(undefined).size).toBe(0);
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

      expect((await loadAndApplySalaryProfile(dbAny, null)).size).toBe(0);
      expect((await loadAndApplySalaryProfile(dbAny, 9999)).size).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("loads a stored profile into a jobId-keyed map", async () => {
    const { db, cleanup } = await createTestCaller(adminSession);
    try {
      // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM dual-driver test harness
      const dbAny = db as unknown as Parameters<typeof fetchSalaryProfile>[0];
      const profileId = seedSalaryProfile(db, {
        name: "Loaded",
        salaries: {
          "201": entry({ salary: 200000 }),
          "202": entry({ salary: 90000 }),
        },
      });
      const map = await loadAndApplySalaryProfile(dbAny, profileId);
      expect(map.get(201)?.salary).toBe(200000);
      expect(map.get(202)?.salary).toBe(90000);
      expect(map.has(203)).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("resolveCompensation — the single definition of pay under a profile", () => {
  it("no entry: salary and bonus are both zero", () => {
    const c = resolveCompensation(new Map(), 1);
    expect(c).toMatchObject({ salary: 0, bonus: 0, totalComp: 0 });
  });

  it("a complete entry resolves salary and bonus together", () => {
    const map = new Map([[1, entry({ salary: 200000, bonusPercent: 0.1 })]]);
    const c = resolveCompensation(map, 1);
    expect(c).toMatchObject({
      salary: 200000,
      bonus: 20000,
      totalComp: 220000,
    });
  });

  it("bonusMultiplier scales the bonus", () => {
    const map = new Map([
      [1, entry({ salary: 200000, bonusPercent: 0.25, bonusMultiplier: 2 })],
    ]);
    expect(resolveCompensation(map, 1).totalComp).toBe(
      200000 + 200000 * 0.25 * 2,
    );
  });

  it("monthsInBonusYear prorates the bonus", () => {
    const map = new Map([
      [1, entry({ salary: 100000, bonusPercent: 0.1, monthsInBonusYear: 6 })],
    ]);
    expect(resolveCompensation(map, 1).bonus).toBe(5000);
  });

  it("an entry for a DIFFERENT job never applies", () => {
    const map = new Map([[11, entry({ salary: 90000 })]]);
    expect(resolveCompensation(map, 1)).toMatchObject({ salary: 0, bonus: 0 });
  });
});
