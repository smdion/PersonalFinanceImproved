/**
 * auth-mode.ts is the one rule for "development build" and "skip sign-in",
 * read by Dev Login, every request's session, the dashboard layout and the
 * version routes. Skipping sign-in is `next dev` only, whatever else is or
 * isn't configured (Authentik's absence never meant "development").
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { devBypass, isDevelopmentBuild } from "@/server/auth-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth-mode", () => {
  it("production never skips sign-in, even with ALLOW_DEV_MODE or no Authentik", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_MODE", "true");
    vi.stubEnv("AUTH_AUTHENTIK_ISSUER", undefined);
    expect(devBypass()).toBeNull();
    expect(isDevelopmentBuild()).toBe(false);
  });

  it("tests sign in for real (only next dev skips it)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_DEV_MODE", "true");
    expect(devBypass()).toBeNull();
    expect(isDevelopmentBuild()).toBe(true);
  });

  it("next dev: a viewer session, admin only with ALLOW_DEV_MODE", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_MODE", undefined);
    expect(devBypass()).toBe("viewer");
    vi.stubEnv("ALLOW_DEV_MODE", "true");
    expect(devBypass()).toBe("admin");
  });
});
