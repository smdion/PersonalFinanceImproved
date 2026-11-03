/**
 * A production install with no Authentik signs in with a local admin, so
 * src/server/trpc.ts must load there: every tRPC call goes through it.
 */
import "../routers/setup-mocks";
import { describe, it, expect, vi, afterEach } from "vitest";

// Module load is under test, not the database.
vi.mock("@/lib/db", () => ({ db: {}, pool: null }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("trpc.ts in production", () => {
  it("loads with no AUTH_AUTHENTIK_ISSUER (local admin only)", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", undefined);
    vi.stubEnv("DEMO_ONLY", undefined);
    vi.stubEnv("AUTH_AUTHENTIK_ISSUER", undefined);
    vi.stubEnv("AUTH_AUTHENTIK_ID", undefined);
    vi.stubEnv("AUTH_AUTHENTIK_SECRET", undefined);

    const trpc = await import("@/server/trpc");
    expect(trpc.publicProcedure).toBeDefined();
    expect(trpc.adminProcedure).toBeDefined();
  });
});
