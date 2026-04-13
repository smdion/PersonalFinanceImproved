import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * env.ts production invariants (v0.5.x test backfill).
 *
 * env.ts runs validation at module import time (the top-level
 * `export const env = validateEnv()` call), so each test needs
 * `vi.resetModules()` to force a fresh import with the current
 * process.env state. Tests save/restore process.env to avoid bleeding
 * state between cases.
 *
 * Covers the five carve-outs and three hard failures that the module
 * has to handle correctly for the container to boot:
 *
 *   1. Valid prod env (all required vars present) → passes
 *   2. Missing CRON_SECRET in prod → throws
 *   3. ALLOW_DEV_MODE=true in prod → throws
 *   4. Missing ENCRYPTION_KEY in prod → throws
 *   5. Invalid ENCRYPTION_KEY length → throws
 *   6. NEXT_PHASE=phase-production-build → skips all invariants
 *      (so `next build`'s page-data collection doesn't crash)
 *   7. DEMO_ONLY=true → skips all invariants
 *      (demoOnlyGuard middleware makes the invariants non-load-bearing)
 *   8. NODE_ENV !== "production" → skips all invariants
 *      (dev environment doesn't need the secrets)
 */

// Generate a valid 32-byte base64 key once for reuse across tests.
// Buffer.alloc(32, x) gives us a deterministic 32-byte buffer, and
// encoding it as base64 produces the 44-char string env.ts requires.
const VALID_ENCRYPTION_KEY = Buffer.alloc(32, "a").toString("base64");
const VALID_CRON_SECRET = "a".repeat(40);
const VALID_NEXTAUTH_SECRET = "a".repeat(40);

/** Snapshot process.env and restore it after each test. */
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Clear env vars this module reads so each test starts from a clean slate.
  // Leave unrelated vars (PATH, HOME, etc.) alone.
  for (const key of [
    "NODE_ENV",
    "NEXT_PHASE",
    "DEMO_ONLY",
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "AUTH_TRUST_HOST",
    "AUTH_AUTHENTIK_ISSUER",
    "AUTH_AUTHENTIK_ID",
    "AUTH_AUTHENTIK_SECRET",
    "CRON_SECRET",
    "ENCRYPTION_KEY",
    "ALLOW_DEV_MODE",
    "SQLITE_PATH",
  ]) {
    delete process.env[key];
  }
  // Minimum required for Zod schema validation to pass (NEXTAUTH_SECRET is
  // required at the base schema level — always need it regardless of mode).
  process.env.NEXTAUTH_SECRET = VALID_NEXTAUTH_SECRET;
  process.env.AUTH_TRUST_HOST = "true";
  // Clear the module cache so the next dynamic import re-runs validateEnv().
  vi.resetModules();
});

afterEach(() => {
  // Restore the original env so subsequent test files start clean.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("env.ts production invariants", () => {
  describe("valid production env", () => {
    it("loads cleanly when all required vars are present", async () => {
      process.env.NODE_ENV = "production";
      process.env.CRON_SECRET = VALID_CRON_SECRET;
      process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
      // SQLite path — DATABASE_URL is optional in sqlite mode.
      process.env.SQLITE_PATH = "data/ledgr.db";

      await expect(import("@/lib/env")).resolves.toBeDefined();
    });
  });

  describe("CRON_SECRET", () => {
    it("throws when missing in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
      process.env.SQLITE_PATH = "data/ledgr.db";
      // CRON_SECRET intentionally unset.

      await expect(import("@/lib/env")).rejects.toThrow(
        /CRON_SECRET is required in production/,
      );
    });

    it("is not enforced when NODE_ENV is not 'production'", async () => {
      process.env.NODE_ENV = "development";
      process.env.SQLITE_PATH = "data/ledgr.db";
      // No CRON_SECRET, no ENCRYPTION_KEY — dev mode.

      await expect(import("@/lib/env")).resolves.toBeDefined();
    });

    it("rejects a CRON_SECRET shorter than 32 chars via the Zod schema", async () => {
      process.env.NODE_ENV = "production";
      process.env.CRON_SECRET = "short"; // under 32 chars
      process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
      process.env.SQLITE_PATH = "data/ledgr.db";

      // Schema validation fires before the post-validate block, so the
      // error message comes from Zod's prettifyError rather than the
      // custom message.
      await expect(import("@/lib/env")).rejects.toThrow(/environment/i);
    });
  });

  describe("ENCRYPTION_KEY", () => {
    it("throws when missing in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.CRON_SECRET = VALID_CRON_SECRET;
      process.env.SQLITE_PATH = "data/ledgr.db";
      // ENCRYPTION_KEY intentionally unset.

      await expect(import("@/lib/env")).rejects.toThrow(
        /ENCRYPTION_KEY is required in production/,
      );
    });

    it("throws when the key decodes to the wrong byte length", async () => {
      process.env.NODE_ENV = "production";
      process.env.CRON_SECRET = VALID_CRON_SECRET;
      // 16-byte key — decodes to 16 bytes, not 32.
      process.env.ENCRYPTION_KEY = Buffer.alloc(16, "x").toString("base64");
      process.env.SQLITE_PATH = "data/ledgr.db";

      await expect(import("@/lib/env")).rejects.toThrow(
        /must decode to exactly 32 bytes \(got 16\)/,
      );
    });

    it("accepts a valid 32-byte base64 key", async () => {
      process.env.NODE_ENV = "production";
      process.env.CRON_SECRET = VALID_CRON_SECRET;
      process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
      process.env.SQLITE_PATH = "data/ledgr.db";

      await expect(import("@/lib/env")).resolves.toBeDefined();
    });
  });

  describe("ALLOW_DEV_MODE safeguard", () => {
    it("throws when ALLOW_DEV_MODE=true is set in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.CRON_SECRET = VALID_CRON_SECRET;
      process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
      process.env.SQLITE_PATH = "data/ledgr.db";
      process.env.ALLOW_DEV_MODE = "true";

      await expect(import("@/lib/env")).rejects.toThrow(
        /ALLOW_DEV_MODE=true is not permitted in production/,
      );
    });

    it("allows ALLOW_DEV_MODE=true in development", async () => {
      process.env.NODE_ENV = "development";
      process.env.SQLITE_PATH = "data/ledgr.db";
      process.env.ALLOW_DEV_MODE = "true";

      await expect(import("@/lib/env")).resolves.toBeDefined();
    });
  });

  describe("build-phase carve-out (NEXT_PHASE)", () => {
    it("skips all production invariants when NEXT_PHASE=phase-production-build", async () => {
      process.env.NODE_ENV = "production";
      process.env.NEXT_PHASE = "phase-production-build";
      process.env.SQLITE_PATH = "data/ledgr.db";
      // Missing CRON_SECRET, ENCRYPTION_KEY, AUTH_AUTHENTIK_* — all OK
      // because Next.js build-time module eval can't have real secrets.

      await expect(import("@/lib/env")).resolves.toBeDefined();
    });
  });

  describe("DEMO_ONLY carve-out", () => {
    it("skips all production invariants when DEMO_ONLY=true", async () => {
      process.env.NODE_ENV = "production";
      process.env.DEMO_ONLY = "true";
      process.env.SQLITE_PATH = "data/ledgr.db";
      // Missing CRON_SECRET, ENCRYPTION_KEY — load-bearing carve-out:
      // demoOnlyGuard blocks every non-demo.* mutation at the tRPC layer,
      // so api_connections can't receive user credentials and there's
      // nothing for ENCRYPTION_KEY to protect. See src/lib/env.ts comment
      // block for the full threat-model reasoning.

      await expect(import("@/lib/env")).resolves.toBeDefined();
    });

    it("allows ALLOW_DEV_MODE=true when DEMO_ONLY=true (neither check runs)", async () => {
      process.env.NODE_ENV = "production";
      process.env.DEMO_ONLY = "true";
      process.env.ALLOW_DEV_MODE = "true";
      process.env.SQLITE_PATH = "data/ledgr.db";

      await expect(import("@/lib/env")).resolves.toBeDefined();
    });
  });
});
