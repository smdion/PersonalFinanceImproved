/**
 * `retirementProfilePeople.upsertPerson` — `socialSecurityPia` field.
 *
 * Step 6 of SOCIAL-SECURITY-OPTIMIZATION-PLAN.md — the router-level write
 * path for the column added in step 3. Self-contained (own setup) rather
 * than folded into retirement-crud.test.ts's larger multi-profile fixture,
 * matching this directory's convention for a single, narrow addition.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  adminSession,
  seedPerson,
  seedRetirementProfile,
  seedRetirementProfilePerson,
} from "./setup";

describe("retirementProfilePeople.upsertPerson — socialSecurityPia", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let profileId: number;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
    personId = await seedPerson(ctx.db, "Pat", "1963-04-10");
    profileId = await seedRetirementProfile(ctx.db);
    await seedRetirementProfilePerson(ctx.db, profileId, personId, {
      retirementAge: 65,
      endAge: 95,
    });
  });

  afterAll(() => cleanup());

  it("persists a PIA value", async () => {
    const result = await caller.retirement.retirementProfilePeople.upsertPerson(
      {
        profileId,
        personId,
        socialSecurityPia: "4000",
      },
    );
    expect(result!.socialSecurityPia).toBe("4000");
  });

  it("leaves socialSecurityMonthly untouched when only socialSecurityPia is sent — the two fields are independent", async () => {
    await caller.retirement.retirementProfilePeople.upsertPerson({
      profileId,
      personId,
      socialSecurityMonthly: "2500",
    });
    const withMonthly =
      await caller.retirement.retirementProfilePeople.upsertPerson({
        profileId,
        personId,
        socialSecurityPia: "4200",
      });
    expect(withMonthly!.socialSecurityPia).toBe("4200");
    expect(withMonthly!.socialSecurityMonthly).toBe("2500");
  });

  it("can be cleared back to null (opt-out)", async () => {
    await caller.retirement.retirementProfilePeople.upsertPerson({
      profileId,
      personId,
      socialSecurityPia: "4000",
    });
    const cleared =
      await caller.retirement.retirementProfilePeople.upsertPerson({
        profileId,
        personId,
        socialSecurityPia: null,
      });
    expect(cleared!.socialSecurityPia).toBeNull();
  });

  it("rejects a non-numeric value at the input boundary", async () => {
    await expect(
      caller.retirement.retirementProfilePeople.upsertPerson({
        profileId,
        personId,
        socialSecurityPia: "not-a-number",
      }),
    ).rejects.toThrow();
  });

  it("rejects an empty string at the input boundary (zDecimal's own refinement)", async () => {
    await expect(
      caller.retirement.retirementProfilePeople.upsertPerson({
        profileId,
        personId,
        socialSecurityPia: "",
      }),
    ).rejects.toThrow();
  });
});
