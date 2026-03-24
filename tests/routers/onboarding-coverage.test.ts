/**
 * Onboarding router coverage tests — targets uncovered lines:
 * - 59-86: createLocalAdmin (input validation, guard, hash, insert)
 * - 103-114: testOidcConnection with env vars set (fetch branch)
 */
import "./setup-mocks";
import { vi, describe, it, expect, afterEach } from "vitest";
import { createTestCaller, adminSession } from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
}));

// ─────────────────────────────────────────────────────────────────────────────
// createLocalAdmin (lines 59-86)
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.createLocalAdmin", () => {
  it("creates a local admin on a fresh database", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.createLocalAdmin({
        name: "Admin User",
        email: "admin@example.com",
        password: "SecurePass123!",
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("id");
      expect(typeof result.id).toBe("number");
    } finally {
      cleanup();
    }
  });

  it("throws when a local admin already exists", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      // Create the first admin
      await caller.settings.createLocalAdmin({
        name: "First Admin",
        email: "first@example.com",
        password: "SecurePass123!",
      });

      // Attempting to create a second should throw
      await expect(
        caller.settings.createLocalAdmin({
          name: "Second Admin",
          email: "second@example.com",
          password: "AnotherPass456!",
        }),
      ).rejects.toThrow(/local admin account already exists/i);
    } finally {
      cleanup();
    }
  });

  it("normalizes email to lowercase and trims name", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.createLocalAdmin({
        name: "  Padded Name  ",
        email: "UPPER@Example.COM",
        password: "SecurePass123!",
      });
      expect(result).toHaveProperty("id");

      // Verify via direct DB query
      const sqliteSchema = await import("@/lib/db/schema-sqlite");
      const rows = db.select().from(sqliteSchema.localAdmins).all();
      const admin = rows.find((r: { id: number }) => r.id === result.id);
      expect(admin).toBeDefined();
      expect(admin!.email).toBe("upper@example.com");
      expect(admin!.name).toBe("Padded Name");
    } finally {
      cleanup();
    }
  });

  it("stores the hashed password (not the plaintext)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.createLocalAdmin({
        name: "Hash Test",
        email: "hash@example.com",
        password: "SecurePass123!",
      });

      const sqliteSchema = await import("@/lib/db/schema-sqlite");
      const rows = db.select().from(sqliteSchema.localAdmins).all();
      const admin = rows.find((r: { id: number }) => r.id === result.id);
      expect(admin).toBeDefined();
      // hashPassword mock returns "hashed"
      expect(admin!.passwordHash).toBe("hashed");
    } finally {
      cleanup();
    }
  });

  it("rejects password shorter than 12 characters", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.createLocalAdmin({
          name: "Short Pass",
          email: "short@example.com",
          password: "Short1A",
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("rejects password without uppercase letter or digit", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.createLocalAdmin({
          name: "No Upper",
          email: "noupper@example.com",
          password: "alllowercase!",
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("rejects empty name", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.createLocalAdmin({
          name: "",
          email: "valid@example.com",
          password: "SecurePass123!",
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });

  it("rejects invalid email", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.settings.createLocalAdmin({
          name: "Valid Name",
          email: "not-an-email",
          password: "SecurePass123!",
        }),
      ).rejects.toThrow();
    } finally {
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// testOidcConnection — with env vars set (lines 103-114)
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.testOidcConnection — with env vars", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("returns configured: true and reachable: false when fetch fails", async () => {
    process.env.AUTH_AUTHENTIK_ISSUER = "https://auth.example.com";
    process.env.AUTH_AUTHENTIK_ID = "test-client-id";
    process.env.AUTH_AUTHENTIK_SECRET = "test-client-secret";

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.testOidcConnection();
      expect(result.configured).toBe(true);
      // fetch will fail since the URL is not reachable
      expect(result.reachable).toBe(false);
      expect(result.issuer).toBe("https://auth.example.com");
    } finally {
      cleanup();
    }
  });

  it("returns configured: false when only some env vars are set", async () => {
    process.env.AUTH_AUTHENTIK_ISSUER = "https://auth.example.com";
    // Missing ID and SECRET
    delete process.env.AUTH_AUTHENTIK_ID;
    delete process.env.AUTH_AUTHENTIK_SECRET;

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.testOidcConnection();
      expect(result.configured).toBe(false);
      expect(result.reachable).toBe(false);
      expect(result.issuer).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns configured: false when issuer is missing", async () => {
    delete process.env.AUTH_AUTHENTIK_ISSUER;
    process.env.AUTH_AUTHENTIK_ID = "test-client-id";
    process.env.AUTH_AUTHENTIK_SECRET = "test-client-secret";

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.testOidcConnection();
      expect(result.configured).toBe(false);
    } finally {
      cleanup();
    }
  });
});
