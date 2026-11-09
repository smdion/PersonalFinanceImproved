/**
 * `loadActiveRetirementSettings` (server/data/retirement-settings.ts): the
 * one read of the active profile's household row that the high-income line,
 * the caps and Relocation share. Guards profile independence (RULES): the
 * active profile's row, the lowest id when the setting is unset or stale,
 * and the primary person's row within the profile.
 */
import "../../helpers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as schema from "@/lib/db/schema-sqlite";
import { loadActiveRetirementSettings } from "@/server/data/retirement-settings";
import { createTestDb, type TestDbContext } from "../../helpers/db-harness";

describe("loadActiveRetirementSettings", () => {
  let ctx: TestDbContext;
  let primaryId: number;
  let firstProfile: number;
  let secondProfile: number;

  beforeAll(async () => {
    ctx = await createTestDb();
    const person = (name: string, isPrimaryUser: boolean) =>
      ctx.db
        .insert(schema.people)
        .values({ name, dateOfBirth: "1980-06-15", isPrimaryUser })
        .returning({ id: schema.people.id })
        .get().id;
    const spouseId = person("Spouse", false);
    primaryId = person("Primary", true);
    const profile = (name: string) =>
      ctx.db
        .insert(schema.retirementProfiles)
        .values({ name })
        .returning({ id: schema.retirementProfiles.id })
        .get().id;
    firstProfile = profile("First");
    secondProfile = profile("Second");
    const row = (personId: number, profileId: number, retirementAge: number) =>
      ctx.db
        .insert(schema.retirementSettings)
        .values({
          personId,
          profileId,
          retirementAge,
          endAge: 95,
          returnAfterRetirement: "0.05",
          annualInflation: "0.03",
          salaryAnnualIncrease: "0.03",
        })
        .run();
    // The spouse's row first: array order must not pick it.
    row(spouseId, firstProfile, 60);
    row(primaryId, firstProfile, 62);
    row(spouseId, secondProfile, 66);
    row(primaryId, secondProfile, 67);
  });

  afterAll(() => ctx.cleanup());

  const setting = (value: unknown) => [
    { key: "active_retirement_profile_id", value },
  ];

  it("reads the active profile's primary-person row", async () => {
    const row = await loadActiveRetirementSettings(
      ctx.rawDb,
      setting(secondProfile),
      primaryId,
    );
    expect(row?.retirementAge).toBe(67);
  });

  it("falls back to the lowest profile id when the setting is unset or stale", async () => {
    for (const appSettings of [[], setting(9999)]) {
      const row = await loadActiveRetirementSettings(
        ctx.rawDb,
        appSettings,
        primaryId,
      );
      expect(row?.retirementAge).toBe(62);
    }
  });
});
