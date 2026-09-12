/**
 * resolveAuthenticatedRateLimitKey (src/server/trpc.ts) — the demo-mode
 * key-fallback fix. DEMO_ONLY collapses every visitor onto the same
 * literal "demo" session user id (see demoOnlySession in trpc.ts), so
 * keying the authenticated rate limiter by `user:${id}` there would put
 * every simultaneous demo visitor into ONE shared bucket instead of
 * separate per-visitor ones -- and raising the limit would raise a SHARED
 * ceiling for the whole demo instance, not a per-visitor one.
 *
 * `isDemoOnly` is read from `process.env.DEMO_ONLY` once at module load,
 * so each DEMO_ONLY value needs a fresh module instance -- vi.resetModules()
 * + a dynamic import, same pattern tests/db/dialect.test.ts uses for
 * DATABASE_URL-dependent modules.
 */
import "../routers/setup-mocks";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Context } from "@/server/trpc";

const originalDemoOnly = process.env.DEMO_ONLY;

afterEach(() => {
  if (originalDemoOnly !== undefined) {
    process.env.DEMO_ONLY = originalDemoOnly;
  } else {
    delete process.env.DEMO_ONLY;
  }
  vi.resetModules();
});

function fakeCtx(userId: string | undefined): Context {
  return {
    // db is never read by resolveAuthenticatedRateLimitKey.
    db: {} as Context["db"],
    session: userId
      ? {
          user: {
            id: userId,
            name: "Test",
            email: "t@t.com",
            role: "viewer",
            permissions: [],
          },
          expires: "2099-12-31T23:59:59.999Z",
        }
      : null,
    demoSchema: null,
  };
}

describe("resolveAuthenticatedRateLimitKey", () => {
  it("DEMO_ONLY unset: keys a normal session by user id", async () => {
    delete process.env.DEMO_ONLY;
    const { resolveAuthenticatedRateLimitKey } = await import("@/server/trpc");
    const key = await resolveAuthenticatedRateLimitKey(fakeCtx("42"));
    expect(key).toBe("user:42");
  });

  it("DEMO_ONLY unset, no session at all: falls back to the IP key, not a literal user id", async () => {
    delete process.env.DEMO_ONLY;
    const { resolveAuthenticatedRateLimitKey } = await import("@/server/trpc");
    const key = await resolveAuthenticatedRateLimitKey(fakeCtx(undefined));
    // next/headers is mocked to reject in every router test (see
    // setup-mocks.ts) -> getRateLimitKey()'s catch falls back to "unknown".
    expect(key).toBe("unknown");
  });

  it('DEMO_ONLY unset, but the session\'s own user id happens to literally be "demo": still falls back to IP, never `user:demo`', async () => {
    delete process.env.DEMO_ONLY;
    const { resolveAuthenticatedRateLimitKey } = await import("@/server/trpc");
    const key = await resolveAuthenticatedRateLimitKey(fakeCtx("demo"));
    expect(key).toBe("unknown");
    expect(key).not.toBe("user:demo");
  });

  it("DEMO_ONLY=true: every visitor falls back to the IP key instead of the shared `user:demo` bucket", async () => {
    process.env.DEMO_ONLY = "true";
    const { resolveAuthenticatedRateLimitKey } = await import("@/server/trpc");
    const key = await resolveAuthenticatedRateLimitKey(fakeCtx("demo"));
    expect(key).toBe("unknown");
    expect(key).not.toBe("user:demo");
  });

  it("DEMO_ONLY=true forces the IP fallback regardless of the session's own user id value", async () => {
    process.env.DEMO_ONLY = "true";
    const { resolveAuthenticatedRateLimitKey } = await import("@/server/trpc");
    // Even a session shaped like a normal user (not literally "demo") must
    // still fall back while DEMO_ONLY is on -- the module-level flag alone
    // is what matters, not just the id string.
    const key = await resolveAuthenticatedRateLimitKey(fakeCtx("42"));
    expect(key).toBe("unknown");
    expect(key).not.toBe("user:42");
  });
});
