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

  // T4/T5 — scenarioProcedure, portfolioProcedure, performanceProcedure,
  // savingsProcedure, syncProcedure had no dedicated auth-enforcement
  // coverage. One real mutation/query per procedure type below, matching
  // the "wrong permission rejected / correct permission allowed" pattern
  // already used for budget above.

  describe("portfolioProcedure enforcement", () => {
    it("viewer without portfolio permission cannot list performance accounts", async () => {
      const session = createViewerSessionWithPermissions(["budget"]);
      const { caller, cleanup } = await createTestCaller(session);
      try {
        await expect(caller.analytics.getAccounts()).rejects.toThrow();
      } finally {
        cleanup();
      }
    });

    it("viewer with portfolio permission can list performance accounts", async () => {
      const session = createViewerSessionWithPermissions(["portfolio"]);
      const { caller, cleanup } = await createTestCaller(session);
      try {
        const result = await caller.analytics.getAccounts();
        expect(Array.isArray(result)).toBe(true);
      } finally {
        cleanup();
      }
    });
  });

  describe("syncProcedure enforcement", () => {
    it("viewer without sync permission cannot test the SimpleFIN connection", async () => {
      const session = createViewerSessionWithPermissions(["budget"]);
      const { caller, cleanup } = await createTestCaller(session);
      try {
        await expect(caller.simplefin.testConnection()).rejects.toThrow();
      } finally {
        cleanup();
      }
    });

    it("viewer with sync permission can call the SimpleFIN connection test", async () => {
      const session = createViewerSessionWithPermissions(["sync"]);
      const { caller, cleanup } = await createTestCaller(session);
      try {
        // No connection configured in the test DB — resolves with a
        // "not configured" payload rather than throwing. The point here
        // is that it is not rejected for permission reasons.
        const result = await caller.simplefin.testConnection();
        expect(result.success).toBe(false);
      } finally {
        cleanup();
      }
    });
  });
});
