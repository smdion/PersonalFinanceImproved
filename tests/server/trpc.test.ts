/* eslint-disable no-restricted-syntax -- as unknown as casts required for Drizzle ORM test type coercion */
/**
 * tRPC middleware and auth guard tests.
 *
 * Tests getSessionUserLabel (pure), and auth guard behavior for
 * protectedProcedure, adminProcedure, and permission-gated procedures
 * using actual router calls with different sessions.
 */
import "../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { getSessionUserLabel } from "@/server/trpc";
import {
  createTestCaller,
  adminSession,
  viewerSession,
  createViewerSessionWithPermissions,
} from "../routers/setup";
import type { Session } from "next-auth";

// ---------------------------------------------------------------------------
// getSessionUserLabel (pure)
// ---------------------------------------------------------------------------

describe("getSessionUserLabel", () => {
  it("returns user name when available", () => {
    expect(getSessionUserLabel(adminSession)).toBe("Test Admin");
  });

  it("falls back to email when name is missing", () => {
    const session = {
      user: {
        id: "1",
        name: null,
        email: "test@test.com",
        role: "admin",
        permissions: [],
      },
      expires: "2099-12-31",
    } as unknown as Session;
    expect(getSessionUserLabel(session)).toBe("test@test.com");
  });

  it("falls back to 'unknown' when both are missing", () => {
    const session = {
      user: {
        id: "1",
        name: null,
        email: null,
        role: "admin",
        permissions: [],
      },
      expires: "2099-12-31",
    } as unknown as Session;
    expect(getSessionUserLabel(session)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// protectedProcedure guard
// ---------------------------------------------------------------------------

describe("protectedProcedure guard", () => {
  it("allows admin to call protected procedures", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      // version.list is a protectedProcedure
      const result = await caller.version.list();
      expect(Array.isArray(result)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("allows viewer to call protected procedures", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      const result = await caller.version.list();
      expect(Array.isArray(result)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("rejects unauthenticated calls to protected procedures", async () => {
    const noSession = {
      user: undefined,
      expires: "2099-12-31",
    } as unknown as Session;
    const { caller, cleanup } = await createTestCaller(noSession);
    try {
      await expect(caller.version.list()).rejects.toThrow("Not authenticated");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// adminProcedure guard
// ---------------------------------------------------------------------------

describe("adminProcedure guard", () => {
  it("allows admin to call admin procedures", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      // version.delete is an admin procedure (via versionProcedure which passes for admin)
      // Using a non-existent ID — should succeed silently (no row to delete)
      const result = await caller.version.delete({ id: 99999 });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });

  it("rejects viewer from admin procedures", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      await expect(caller.version.delete({ id: 99999 })).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Permission-gated procedure guard
// ---------------------------------------------------------------------------

describe("permission-gated procedure guard", () => {
  it("allows admin to call permission-gated procedures", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.version.getRetention();
      expect(result).toHaveProperty("retentionCount");
    } finally {
      cleanup();
    }
  });

  it("allows viewer with correct permission", async () => {
    const session = createViewerSessionWithPermissions(["version"]);
    const { caller, cleanup } = await createTestCaller(session);
    try {
      // version.delete is versionProcedure — requires "version" permission
      const result = await caller.version.delete({ id: 99999 });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });

  it("rejects viewer without the required permission", async () => {
    const session = createViewerSessionWithPermissions(["budget"]);
    const { caller, cleanup } = await createTestCaller(session);
    try {
      await expect(caller.version.delete({ id: 99999 })).rejects.toThrow(
        "version permission required",
      );
    } finally {
      cleanup();
    }
  });

  it("rejects viewer with empty permissions", async () => {
    const { caller, cleanup } = await createTestCaller(viewerSession);
    try {
      await expect(caller.version.delete({ id: 99999 })).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});
