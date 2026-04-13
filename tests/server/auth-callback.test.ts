import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * auth.ts JWT callback contract (v0.5.x test backfill).
 *
 * The full src/server/auth.ts module pulls in NextAuth + the live db
 * connection at import time, which is why it sits on the coverage exclude
 * list with the comment "requires real Next.js/NextAuth runtime."
 *
 * The role-assignment + permission-mapping logic underneath, however, is
 * pure — given a token, user, account, and a group-loader function, it
 * returns the updated token. That logic is now exported as
 * assignRoleAndPermissions() so this test file can drive every branch:
 *
 *   1. No user → token returned untouched (refresh case)
 *   2. local-admin provider → admin role, no permissions, authMethod=local
 *   3. authentik provider + admin group → admin role, no permissions
 *   4. authentik provider + viewer groups → viewer role, mapped permissions
 *   5. authentik provider + unknown groups → viewer role, empty permissions
 *   6. authentik provider + no groups → viewer role, empty permissions
 *   7. credentials provider in dev → admin role
 *   8. credentials provider in production → falls through to safe default
 *   9. unknown provider → viewer role with safe defaults
 *
 * The callback wrapper in fullAuthConfig is a thin pass-through; testing
 * the underlying helper covers the contract a regression would break.
 *
 * The schema/db imports get mocked because importing auth.ts top-level
 * pulls in db, schema, drizzle-orm, password verification, etc. We only
 * need the exported helper, not the side effects.
 */

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn() },
}));
vi.mock("@/lib/db/schema", () => ({
  appSettings: {},
  localAdmins: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  log: vi.fn(),
}));
// next-auth and the local config import; the side effect of NextAuth(fullConfig)
// runs at module load, but with everything mocked it's a no-op.
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: () => ({}),
}));
vi.mock("@/server/auth.config", () => ({
  authConfig: {
    providers: [],
    pages: {},
    callbacks: {},
  },
}));

import { assignRoleAndPermissions, type Permission } from "@/server/auth";

const mockGroups = async () => ({
  adminGroup: "ledgr-admin",
  groupToPermission: {
    "ledgr-scenario": "scenario" as Permission,
    "ledgr-portfolio": "portfolio" as Permission,
    "ledgr-budget": "budget" as Permission,
    "ledgr-sync": "sync" as Permission,
  },
});

describe("assignRoleAndPermissions (M18 / auth.ts contract)", () => {
  let token: Record<string, unknown>;

  beforeEach(() => {
    token = {};
  });

  describe("no-user case (token refresh)", () => {
    it("returns the token untouched when user is undefined", async () => {
      token.role = "viewer";
      token.permissions = ["budget"];
      const result = await assignRoleAndPermissions(
        token,
        undefined,
        { provider: "authentik" },
        mockGroups,
      );
      expect(result.role).toBe("viewer");
      expect(result.permissions).toEqual(["budget"]);
    });
  });

  describe("local-admin provider", () => {
    it("assigns admin role with empty permissions and authMethod=local", async () => {
      const result = await assignRoleAndPermissions(
        token,
        { id: "local:1", name: "Admin", email: "a@b.c" },
        { provider: "local-admin" },
        mockGroups,
      );
      expect(result.role).toBe("admin");
      expect(result.permissions).toEqual([]);
      expect(result.authMethod).toBe("local");
    });
  });

  describe("authentik (OIDC) provider", () => {
    it("assigns admin role when the user is in the configured admin group", async () => {
      const result = await assignRoleAndPermissions(
        token,
        {
          id: "auth:1",
          name: "Admin",
          email: "a@b.c",
          groups: ["ledgr-admin", "ledgr-scenario"],
        },
        { provider: "authentik" },
        mockGroups,
      );
      expect(result.role).toBe("admin");
      expect(result.permissions).toEqual([]);
      expect(result.authMethod).toBe("oidc");
    });

    it("assigns viewer role with mapped permissions for non-admin users", async () => {
      const result = await assignRoleAndPermissions(
        token,
        {
          id: "auth:2",
          name: "Viewer",
          email: "v@b.c",
          groups: ["ledgr-budget", "ledgr-sync"],
        },
        { provider: "authentik" },
        mockGroups,
      );
      expect(result.role).toBe("viewer");
      expect(result.permissions).toEqual(["budget", "sync"]);
      expect(result.authMethod).toBe("oidc");
    });

    it("filters out unknown groups silently — only mapped groups become permissions", async () => {
      const result = await assignRoleAndPermissions(
        token,
        {
          id: "auth:3",
          name: "Mixed",
          email: "m@b.c",
          groups: ["ledgr-budget", "random-group", "ledgr-portfolio"],
        },
        { provider: "authentik" },
        mockGroups,
      );
      expect(result.role).toBe("viewer");
      // random-group is dropped; budget + portfolio survive
      expect(result.permissions).toEqual(["budget", "portfolio"]);
    });

    it("returns viewer with empty permissions when groups is missing entirely", async () => {
      const result = await assignRoleAndPermissions(
        token,
        { id: "auth:4", name: "NoGroups", email: "n@b.c" },
        { provider: "authentik" },
        mockGroups,
      );
      expect(result.role).toBe("viewer");
      expect(result.permissions).toEqual([]);
    });

    it("returns viewer with empty permissions when groups is an empty array", async () => {
      const result = await assignRoleAndPermissions(
        token,
        { id: "auth:5", name: "Empty", email: "e@b.c", groups: [] },
        { provider: "authentik" },
        mockGroups,
      );
      expect(result.role).toBe("viewer");
      expect(result.permissions).toEqual([]);
    });

    it("does NOT grant admin from a group that only matches by substring", async () => {
      // Regression guard: the check is exact-match via Array.includes(),
      // not substring search. A group named "ledgr-admin-helper" must not
      // grant admin.
      const result = await assignRoleAndPermissions(
        token,
        {
          id: "auth:6",
          name: "Pretender",
          email: "p@b.c",
          groups: ["ledgr-admin-helper"],
        },
        { provider: "authentik" },
        mockGroups,
      );
      expect(result.role).toBe("viewer");
    });
  });

  describe("dev credentials provider", () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
    afterEach(() => {
      // Restore so other tests aren't affected
      if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    it("grants admin in development", async () => {
      process.env.NODE_ENV = "development";
      const result = await assignRoleAndPermissions(
        token,
        { id: "dev:1", name: "Dev" },
        { provider: "credentials" },
        mockGroups,
      );
      expect(result.role).toBe("admin");
      expect(result.authMethod).toBe("local");
    });

    it("does NOT grant admin in production (falls through to safe default)", async () => {
      process.env.NODE_ENV = "production";
      const result = await assignRoleAndPermissions(
        token,
        { id: "dev:2", name: "Dev" },
        { provider: "credentials" },
        mockGroups,
      );
      // The credentials branch is gated on NODE_ENV !== production, so
      // in production it falls through to the unknown-provider branch
      // and the token gets the safe default.
      expect(result.role).toBe("viewer");
      expect(result.permissions).toEqual([]);
    });
  });

  describe("unknown provider (safe default)", () => {
    it("assigns viewer role with empty permissions", async () => {
      const result = await assignRoleAndPermissions(
        token,
        { id: "?:1", name: "?" },
        { provider: "some-future-provider" },
        mockGroups,
      );
      expect(result.role).toBe("viewer");
      expect(result.permissions).toEqual([]);
    });

    it("preserves existing role/permissions on the token rather than clobbering", async () => {
      // The unknown-provider branch uses ?? to fall back to existing
      // values. Tests that existing role survives if the user object is
      // supplied without a recognized provider.
      token.role = "admin";
      token.permissions = ["budget"];
      const result = await assignRoleAndPermissions(
        token,
        { id: "x" },
        { provider: "some-other" },
        mockGroups,
      );
      expect(result.role).toBe("admin");
      expect(result.permissions).toEqual(["budget"]);
    });
  });
});

// vitest's afterEach is import-able from the global setup file; declare it
// here to keep the tests self-contained.
import { afterEach } from "vitest";
