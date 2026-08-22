/**
 * Contribution Profiles router integration tests.
 *
 * Tests list, getById, create, update, delete, and resolve
 * using an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller } from "./setup";

describe("contributionProfiles router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  // ── LIST ──

  describe("list", () => {
    it("returns only real rows — the migration seeds one ordinary baseline", async () => {
      const profiles = await caller.contributionProfile.list();
      expect(Array.isArray(profiles)).toBe(true);
      expect(profiles.length).toBeGreaterThanOrEqual(1);
      // No synthetic id-0 entry is prepended any more.
      expect(profiles.map((p: { id: number }) => p.id)).not.toContain(0);
      expect(profiles.every((p: { id: number }) => p.id > 0)).toBe(true);
      expect(profiles[0]!.activeFieldCount).toBe(0);
    });

    it("each profile has summary with numeric fields", async () => {
      const profiles = await caller.contributionProfile.list();
      const first = profiles[0]!;
      expect(typeof first.summary.combinedSalary).toBe("number");
      expect(typeof first.summary.annualContributions).toBe("number");
      expect(typeof first.summary.annualEmployerMatch).toBe("number");
    });
  });

  // ── GETBYID — id 0 is no longer a sentinel ──

  describe("getById (id=0)", () => {
    it("returns null — 0 is just an id that does not exist", async () => {
      expect(await caller.contributionProfile.getById({ id: 0 })).toBeNull();
    });

    it("the migration-seeded baseline resolves like any other profile", async () => {
      const [seeded] = await caller.contributionProfile.list();
      const profile = await caller.contributionProfile.getById({
        id: seeded!.id,
      });
      expect(profile).not.toBeNull();
      expect(Array.isArray(profile!.accountDetails)).toBe(true);
      expect(Array.isArray(profile!.deductionDetails)).toBe(true);
      expect(typeof profile!.resolved.combinedSalary).toBe("number");
    });
  });

  // ── CREATE ──

  describe("create", () => {
    it("creates a new profile and returns it", async () => {
      const profile = await caller.contributionProfile.create({
        name: "Test Profile",
        description: "For testing",
        contributionActiveFields: { contributionAccounts: {} },
      });
      expect(profile).toBeDefined();
      expect(profile.name).toBe("Test Profile");
      expect(profile.description).toBe("For testing");
    });

    it("created profile has a valid numeric id", async () => {
      const profile = await caller.contributionProfile.create({
        name: "Second Profile",
        description: "Another test",
        contributionActiveFields: { contributionAccounts: {} },
      });
      expect(typeof profile.id).toBe("number");
      expect(profile.id).toBeGreaterThan(0);
    });
  });

  // ── LIST (after create) ──

  describe("list (after create)", () => {
    it("includes the newly created profile", async () => {
      const profiles = await caller.contributionProfile.list();
      const found = profiles.find(
        (p: { name: string }) => p.name === "Test Profile",
      );
      expect(found).toBeDefined();
    });

    it("still returns real rows only", async () => {
      const profiles = await caller.contributionProfile.list();
      expect(profiles.map((p: { id: number }) => p.id)).not.toContain(0);
    });
  });

  // ── GETBYID — REAL PROFILE ──

  describe("getById (real created profile)", () => {
    let profileId: number;

    beforeAll(async () => {
      const profiles = await caller.contributionProfile.list();
      const found = profiles.find(
        (p: { name: string; id: number }) => p.name === "Test Profile",
      )!;
      profileId = found.id;
    });

    it("returns the real profile by id", async () => {
      const profile = await caller.contributionProfile.getById({
        id: profileId,
      });
      expect(profile).toBeDefined();
      expect(profile!.id).toBe(profileId);
      expect(profile!.name).toBe("Test Profile");
    });

    it("returns null for a non-existent id", async () => {
      const profile = await caller.contributionProfile.getById({ id: 99999 });
      expect(profile).toBeNull();
    });
  });

  // ── UPDATE ──

  describe("update", () => {
    let profileId: number;

    beforeAll(async () => {
      const profiles = await caller.contributionProfile.list();
      const found = profiles.find(
        (p: { name: string; id: number }) => p.name === "Test Profile",
      )!;
      profileId = found.id;
    });

    it("updates the profile name", async () => {
      const updated = await caller.contributionProfile.update({
        id: profileId,
        name: "Updated Profile Name",
      });
      expect(updated).toBeDefined();
      expect(updated.name).toBe("Updated Profile Name");
    });

    it("updates the profile description", async () => {
      const updated = await caller.contributionProfile.update({
        id: profileId,
        description: "Updated description text",
      });
      expect(updated).toBeDefined();
      expect(updated.description).toBe("Updated description text");
    });

    it("throws when updating a non-existent profile", async () => {
      await expect(
        caller.contributionProfile.update({ id: 99999, name: "Ghost" }),
      ).rejects.toThrow("Profile not found");
    });
  });

  // ── DELETE ──

  describe("delete", () => {
    let deletableId: number;

    beforeAll(async () => {
      // Create a dedicated profile for deletion so other tests are unaffected
      const profile = await caller.contributionProfile.create({
        name: "Profile To Delete",
        description: "Will be deleted",
        contributionActiveFields: { contributionAccounts: {} },
      });
      deletableId = profile.id;
    });

    it("deletes an ordinary profile successfully", async () => {
      const result = await caller.contributionProfile.delete({
        id: deletableId,
      });
      expect(result).toEqual({ success: true });
    });

    it("deleted profile no longer appears in list", async () => {
      const profiles = await caller.contributionProfile.list();
      const found = profiles.find((p: { id: number }) => p.id === deletableId);
      expect(found).toBeUndefined();
    });

    it("throws for id 0 — no longer a sentinel, just a missing row", async () => {
      await expect(
        caller.contributionProfile.delete({ id: 0 }),
      ).rejects.toThrow("Profile not found");
    });
  });

  // ── RESOLVE ──

  describe("resolve", () => {
    let profileId: number;

    beforeAll(async () => {
      const profile = await caller.contributionProfile.create({
        name: "Resolve Test Profile",
        description: "Used to test resolve",
        contributionActiveFields: { contributionAccounts: {} },
      });
      profileId = profile.id;
    });

    it("returns null for a non-existent profile id", async () => {
      const result = await caller.contributionProfile.resolve({ id: 99999 });
      expect(result).toBeNull();
    });

    it("returns aggregate totals for an existing profile", async () => {
      const result = await caller.contributionProfile.resolve({
        id: profileId,
      });
      expect(result).toBeDefined();
      expect(typeof result!.combinedSalary).toBe("number");
      expect(typeof result!.annualContributions).toBe("number");
      expect(typeof result!.annualEmployerMatch).toBe("number");
    });

    it("resolve result includes contribByCategory and employerMatchByCategory", async () => {
      const result = await caller.contributionProfile.resolve({
        id: profileId,
      });
      expect(result).toBeDefined();
      expect(typeof result!.contribByCategory).toBe("object");
      expect(typeof result!.employerMatchByCategory).toBe("object");
    });
  });

  // Write-time bracket validation for w4FilingStatus/w4Box2cChecked moved
  // to salaryProfile.create/update (assertSalaryEntryTaxBracketsExist in
  // salary-profiles.ts) — the Contribution Profile `jobs` bucket that used
  // to carry these fields is deleted wholesale. See
  // tests/routers/salary-profiles.test.ts for that coverage.
});
