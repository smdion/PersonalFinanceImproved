/**
 * Onboarding router tests — isOnboardingComplete, completeOnboarding,
 * createLocalAdmin, testOidcConnection.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedAppSetting,
  adminSession,
} from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed-password-mock"),
}));

// ─────────────────────────────────────────────────────────────────────────────
// isOnboardingComplete
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.isOnboardingComplete", () => {
  it("returns { complete: false } on a fresh database", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.isOnboardingComplete();
      expect(result).toEqual({ complete: false });
    } finally {
      cleanup();
    }
  });

  it("returns { complete: true } when people exist", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      await seedPerson(db, "Test User", "1990-01-01");
      const result = await caller.settings.isOnboardingComplete();
      expect(result).toEqual({ complete: true });
    } finally {
      cleanup();
    }
  });

  it("returns { complete: true } when onboarding_completed setting exists", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedAppSetting(db, "onboarding_completed", true);
      const result = await caller.settings.isOnboardingComplete();
      expect(result).toEqual({ complete: true });
    } finally {
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// completeOnboarding
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.completeOnboarding", () => {
  it("sets onboarding_completed and returns { ok: true }", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.settings.completeOnboarding();
      expect(result).toEqual({ ok: true });

      // Now isOnboardingComplete should return true
      const check = await caller.settings.isOnboardingComplete();
      expect(check.complete).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("is idempotent — calling twice doesn't throw", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await caller.settings.completeOnboarding();
      await caller.settings.completeOnboarding();
      const check = await caller.settings.isOnboardingComplete();
      expect(check.complete).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// testOidcConnection
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.testOidcConnection", () => {
  it("returns configured: false when env vars are not set", async () => {
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
});
