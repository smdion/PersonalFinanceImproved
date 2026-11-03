/**
 * Which sign-in providers auth.config.ts registers. Dev Login (any name, no
 * password) must never exist in a production build or on a DEMO_ONLY
 * instance: the NextAuth secret is shared with the demo, so a token it
 * minted there would be valid on another install.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

async function providerNames(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { authConfig } = await import("@/server/auth.config");
  // Credentials() keeps the configured name under `options`.
  return authConfig.providers.map((p) => {
    const provider = p as { name?: string; options?: { name?: string } };
    return provider.options?.name ?? provider.name ?? "(unnamed)";
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth.config providers", () => {
  it("development build without Authentik: Dev Login", async () => {
    expect(
      await providerNames({
        NODE_ENV: "development",
        DEMO_ONLY: undefined,
        AUTH_AUTHENTIK_ISSUER: undefined,
      }),
    ).toEqual(["Dev Login"]);
  });

  it("production build without Authentik: no Dev Login", async () => {
    expect(
      await providerNames({
        NODE_ENV: "production",
        DEMO_ONLY: undefined,
        AUTH_AUTHENTIK_ISSUER: undefined,
      }),
    ).toEqual([]);
  });

  it("production build with Authentik: Authentik only", async () => {
    expect(
      await providerNames({
        NODE_ENV: "production",
        DEMO_ONLY: undefined,
        AUTH_AUTHENTIK_ISSUER: "https://auth.example.test/application/o/ledgr/",
      }),
    ).toEqual(["Authentik"]);
  });

  it("DEMO_ONLY registers nothing, in any build", async () => {
    for (const NODE_ENV of ["development", "production"])
      expect(
        await providerNames({
          NODE_ENV,
          DEMO_ONLY: "true",
          AUTH_AUTHENTIK_ISSUER: undefined,
        }),
      ).toEqual([]);
  });
});
