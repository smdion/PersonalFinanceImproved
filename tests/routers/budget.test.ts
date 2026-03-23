/**
 * Budget router integration tests.
 *
 * Tests CRUD operations, input validation, and business logic
 * using an isolated SQLite database per test suite.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  viewerSession,
  createViewerSessionWithPermissions,
} from "./setup";

describe("budget router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("listProfiles", () => {
    it("returns empty array when no profiles exist", async () => {
      const profiles = await caller.budget.listProfiles();
      expect(profiles).toEqual([]);
    });
  });

  describe("createProfile", () => {
    it("creates a profile with default column labels", async () => {
      const profile = await caller.budget.createProfile({
        name: "Main Budget",
      });
      expect(profile.name).toBe("Main Budget");
      expect(profile.id).toBeGreaterThan(0);
    });

    it("creates a profile with custom column labels", async () => {
      const profile = await caller.budget.createProfile({
        name: "Multi-Column",
        columnLabels: ["Standard", "Lean", "Emergency"],
      });
      expect(profile.name).toBe("Multi-Column");
    });

    it("trims whitespace from name", async () => {
      const profile = await caller.budget.createProfile({
        name: "  Trimmed  ",
      });
      expect(profile.name).toBe("Trimmed");
    });

    it("rejects empty name", async () => {
      await expect(caller.budget.createProfile({ name: "" })).rejects.toThrow();
    });

    it("rejects whitespace-only name", async () => {
      await expect(
        caller.budget.createProfile({ name: "   " }),
      ).rejects.toThrow();
    });
  });

  describe("renameProfile", () => {
    it("renames an existing profile", async () => {
      const profile = await caller.budget.createProfile({
        name: "Old Name",
      });
      await caller.budget.renameProfile({
        id: profile.id,
        name: "New Name",
      });
      const profiles = await caller.budget.listProfiles();
      const renamed = profiles.find((p: { id: number }) => p.id === profile.id);
      expect(renamed?.name).toBe("New Name");
    });

    it("rejects empty name on rename", async () => {
      const profile = await caller.budget.createProfile({
        name: "Valid Name",
      });
      await expect(
        caller.budget.renameProfile({ id: profile.id, name: "" }),
      ).rejects.toThrow();
    });
  });

  describe("listProfiles (populated)", () => {
    it("includes annual total and column count", async () => {
      const profiles = await caller.budget.listProfiles();
      expect(profiles.length).toBeGreaterThan(0);
      for (const p of profiles) {
        expect(p).toHaveProperty("annualTotal");
        expect(p).toHaveProperty("columnCount");
        expect(typeof p.annualTotal).toBe("number");
        expect(typeof p.columnCount).toBe("number");
      }
    });
  });
});

describe("budget router — auth", () => {
  it("viewer without budget permission cannot create profiles", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      await expect(
        caller.budget.createProfile({ name: "Unauthorized" }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("viewer with budget permission can create profiles", async () => {
    const session = createViewerSessionWithPermissions(["budget"]);
    const { caller, cleanup } = await createTestCaller(session);
    try {
      const profile = await caller.budget.createProfile({
        name: "Authorized Budget",
      });
      expect(profile.name).toBe("Authorized Budget");
    } finally {
      cleanup();
    }
  });

  it("viewer can list profiles (read-only)", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      const profiles = await caller.budget.listProfiles();
      expect(Array.isArray(profiles)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
