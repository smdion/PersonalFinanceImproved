/**
 * Auth enforcement integration tests.
 *
 * Validates that permission-gated procedures properly reject
 * unauthorized users across all major routers.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import {
  createTestCaller,
  viewerSession,
  createViewerSessionWithPermissions,
} from "./setup";

describe("auth enforcement", () => {
  describe("unauthenticated access", () => {
    it("rejects unauthenticated users from protected procedures", async () => {
      const { caller, cleanup } = await createTestCaller({
        user: null as never,
        expires: "",
      } as never);
      // Passing null session — should fail on any protected route
      try {
        // The tRPC middleware checks ctx.session — null session should throw UNAUTHORIZED
        await expect(caller.budget.listProfiles()).rejects.toThrow();
      } finally {
        cleanup();
      }
    });
  });

  describe("viewer cannot mutate without permissions", () => {
    it("viewer cannot create budget profiles", async () => {
      const { caller, cleanup } = await createTestCaller(viewerSession);
      try {
        await expect(
          caller.budget.createProfile({ name: "Unauthorized" }),
        ).rejects.toThrow();
      } finally {
        cleanup();
      }
    });

    it("viewer cannot rename budget profiles", async () => {
      const { caller, cleanup } = await createTestCaller(viewerSession);
      try {
        await expect(
          caller.budget.renameProfile({ id: 1, name: "Renamed" }),
        ).rejects.toThrow();
      } finally {
        cleanup();
      }
    });
  });

  describe("viewer with specific permissions can mutate", () => {
    it("budget permission grants budget mutations", async () => {
      const session = createViewerSessionWithPermissions(["budget"]);
      const { caller, cleanup } = await createTestCaller(session);
      try {
        const profile = await caller.budget.createProfile({
          name: "Permitted Budget",
        });
        expect(profile.name).toBe("Permitted Budget");
      } finally {
        cleanup();
      }
    });

    it("wrong permission does not grant budget mutations", async () => {
      const session = createViewerSessionWithPermissions(["scenario"]);
      const { caller, cleanup } = await createTestCaller(session);
      try {
        await expect(
          caller.budget.createProfile({ name: "Wrong Permission" }),
        ).rejects.toThrow();
      } finally {
        cleanup();
      }
    });
  });

  describe("viewer can read all protected data", () => {
    it("can list budget profiles", async () => {
      const { caller, cleanup } = await createTestCaller(viewerSession);
      try {
        const result = await caller.budget.listProfiles();
        expect(Array.isArray(result)).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("can read mortgage summary", async () => {
      const { caller, cleanup } = await createTestCaller(viewerSession);
      try {
        const result = await caller.mortgage.computeActiveSummary();
        expect(result).toBeDefined();
      } finally {
        cleanup();
      }
    });

    it("can list versions", async () => {
      const { caller, cleanup } = await createTestCaller(viewerSession);
      try {
        const result = await caller.version.list();
        expect(Array.isArray(result)).toBe(true);
      } finally {
        cleanup();
      }
    });

    it("can read contribution data", async () => {
      const { caller, cleanup } = await createTestCaller(viewerSession);
      try {
        const result = await caller.contribution.computeSummary();
        expect(result).toBeDefined();
      } finally {
        cleanup();
      }
    });
  });
});
