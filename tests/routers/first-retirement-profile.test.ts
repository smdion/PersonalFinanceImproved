/**
 * An install's first Retirement profile (adoptFirstRetirementProfile): made
 * by the first retirement settings save or onboarding completion, once, and
 * never on an install that already has a profile. An install that saved
 * settings before profiles could be made in-app (rows with no profile) is
 * adopted on its next save.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestCaller, seedPerson, seedRetirementProfile } from "./setup";
import * as schema from "@/lib/db/schema-sqlite";
import { SK_ACTIVE_RETIREMENT_PROFILE_ID } from "@/lib/constants/settings-keys";
import {
  adoptFirstRetirementProfile,
  FIRST_RETIREMENT_PROFILE_NAME,
} from "@/server/services/profiles/first-retirement-profile";
import { decimalText } from "./decimal-text";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

const anchor = {
  retirementAge: 65,
  endAge: 95,
  returnAfterRetirement: "0.05",
  annualInflation: "0.025",
  salaryAnnualIncrease: "0.03",
};

let ctx: Ctx;
let primary: number;
let partner: number;

beforeEach(async () => {
  ctx = await createTestCaller();
  primary = await seedPerson(ctx.db, "Robin");
  partner = await seedPerson(ctx.db, "Sam");
  ctx.db
    .update(schema.people)
    .set({ isPrimaryUser: true })
    .where(eq(schema.people.id, primary))
    .run();
});
afterEach(() => ctx.cleanup());

const profiles = () => ctx.db.select().from(schema.retirementProfiles).all();
const settings = () => ctx.db.select().from(schema.retirementSettings).all();
const profilePeople = () =>
  ctx.db.select().from(schema.retirementProfilePeople).all();
const activeSetting = () =>
  ctx.db
    .select()
    .from(schema.appSettings)
    .all()
    .find((s) => s.key === SK_ACTIVE_RETIREMENT_PROFILE_ID)?.value;

/** A pre-v0.9.9 install's rows: saved settings with no profile. */
function seedUnprofiledSettings(personId: number, retirementAge: number) {
  ctx.db
    .insert(schema.retirementSettings)
    .values({ personId, ...anchor, retirementAge, endAge: 92 })
    .run();
}

describe("first Retirement profile", () => {
  it("the first save makes it, with a row per person, and makes it active", async () => {
    const saved = await ctx.caller.retirement.retirementSettings.upsert({
      personId: primary,
      ...anchor,
    });
    const [profile] = profiles();
    expect(profiles()).toHaveLength(1);
    expect(profile!.name).toBe(FIRST_RETIREMENT_PROFILE_NAME);
    expect(saved!.profileId).toBe(profile!.id);
    // Every person gets a settings row in it; the partner's is the primary's.
    expect(
      settings().map((r) => [r.personId, r.profileId, r.retirementAge]),
    ).toEqual(
      expect.arrayContaining([
        [primary, profile!.id, 65],
        [partner, profile!.id, 65],
      ]),
    );
    expect(settings()).toHaveLength(2);
    expect(activeSetting()).toBe(profile!.id);
    // The partner has no row of their own: the primary's figures.
    expect(
      profilePeople()
        .map((r) => [r.personId, r.retirementAge, r.endAge])
        .sort(),
    ).toEqual(
      [
        [primary, 65, 95],
        [partner, 65, 95],
      ].sort(),
    );
  });

  it("repeated saves keep one profile and write into it", async () => {
    for (const retirementAge of [64, 63])
      await ctx.caller.retirement.retirementSettings.upsert({
        personId: primary,
        ...anchor,
        retirementAge,
      });
    await ctx.caller.retirement.retirementSettings.upsert({
      personId: partner,
      ...anchor,
    });
    expect(profiles()).toHaveLength(1);
    const id = profiles()[0]!.id;
    expect(settings().every((r) => r.profileId === id)).toBe(true);
    expect(settings()).toHaveLength(2);
    expect(settings().find((r) => r.personId === primary)?.retirementAge).toBe(
      63,
    );
  });

  it("two first saves at once make one profile", async () => {
    await Promise.all([
      ctx.caller.retirement.retirementSettings.upsert({
        personId: primary,
        ...anchor,
      }),
      ctx.caller.retirement.retirementSettings.upsert({
        personId: partner,
        ...anchor,
        retirementAge: 60,
      }),
    ]);
    expect(profiles()).toHaveLength(1);
    const id = profiles()[0]!.id;
    expect(settings().map((r) => r.profileId)).toEqual([id, id]);
    expect(profilePeople()).toHaveLength(2);
  });

  it("adopts an install with saved settings and no profile on its next save", async () => {
    seedUnprofiledSettings(primary, 60);
    seedUnprofiledSettings(partner, 58);
    // The UI sends the profile its figures came from: null here.
    await ctx.caller.retirement.retirementSettings.upsert({
      personId: primary,
      profileId: null,
      ...anchor,
      retirementAge: 61,
    });
    expect(profiles()).toHaveLength(1);
    const id = profiles()[0]!.id;
    expect(
      settings().map((r) => [r.personId, r.profileId, r.retirementAge]),
    ).toEqual(
      expect.arrayContaining([
        [primary, id, 61],
        [partner, id, 58],
      ]),
    );
    expect(settings()).toHaveLength(2);
    // Each person's own figures, not the primary's.
    expect(
      profilePeople().find((r) => r.personId === partner)?.retirementAge,
    ).toBe(58);
    expect(activeSetting()).toBe(id);
  });

  it("onboarding completion adopts saved settings, and the next save adds no profile", async () => {
    seedUnprofiledSettings(primary, 60);
    await ctx.caller.settings.completeOnboarding();
    expect(profiles()).toHaveLength(1);
    await ctx.caller.settings.completeOnboarding();
    await ctx.caller.retirement.retirementSettings.upsert({
      personId: primary,
      ...anchor,
    });
    expect(profiles()).toHaveLength(1);
    expect(settings()).toHaveLength(2);
  });

  it("a person with no saved settings can be edited in the first profile", async () => {
    await ctx.caller.retirement.retirementSettings.upsert({
      personId: primary,
      ...anchor,
    });
    const profileId = profiles()[0]!.id;
    await ctx.caller.retirement.retirementSettings.upsertPersonRaiseRate({
      profileId,
      personId: partner,
      salaryAnnualIncrease: "0.045",
    });
    expect(
      decimalText(
        settings().find((r) => r.personId === partner)?.salaryAnnualIncrease,
      ),
    ).toBe("0.045");
    expect(
      decimalText(
        settings().find((r) => r.personId === primary)?.salaryAnnualIncrease,
      ),
    ).toBe("0.03");
  });

  it("onboarding completion before any settings makes no profile", async () => {
    await ctx.caller.settings.completeOnboarding();
    expect(profiles()).toHaveLength(0);
    expect(activeSetting()).toBeUndefined();
  });

  it("leaves an install that already has a profile untouched", async () => {
    const existing = await seedRetirementProfile(ctx.db, "Our Plan");
    // A stray row with no profile stays as it is.
    seedUnprofiledSettings(partner, 58);
    expect(await adoptFirstRetirementProfile(ctx.rawDb)).toBeNull();
    await ctx.caller.retirement.retirementSettings.upsert({
      personId: primary,
      profileId: null,
      ...anchor,
    });
    await ctx.caller.settings.completeOnboarding();
    expect(profiles().map((p) => [p.id, p.name])).toEqual([
      [existing, "Our Plan"],
    ]);
    expect(settings().filter((r) => r.profileId == null)).toHaveLength(2);
    expect(profilePeople()).toHaveLength(0);
    expect(activeSetting()).toBeUndefined();
  });
});
