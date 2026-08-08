/**
 * T27 — locks in M16: the ALLOW_DEV_MODE bypass in
 * src/app/api/versions/{export,import}/route.ts must still reject requests
 * when NODE_ENV=production, even if ALLOW_DEV_MODE=true is somehow set
 * (misconfigured process manager, env set post-boot, etc — the primary
 * defense, validateEnv() at startup, is covered separately in
 * tests/pure/env.test.ts). Previously only that startup-level guard had
 * test coverage; the route handlers' own `allowDev` check had none.
 *
 * `allowDev` is computed once at module load from process.env, so each
 * case needs vi.resetModules() + a fresh dynamic import to pick up the
 * env vars set for that test (same pattern as tests/pure/env.test.ts).
 *
 * Also covers the T3 DEMO_ONLY-guard gap for these same two routes (see
 * "T3 — DEMO_ONLY guard" below).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ log: vi.fn() }));
vi.mock("@/lib/db/version-logic", () => ({
  exportBackup: vi.fn().mockResolvedValue({
    schemaVersion: "0001",
    exportedAt: "2026-01-01T00:00:00.000Z",
    tables: {},
  }),
  importBackup: vi
    .fn()
    .mockResolvedValue({ restoredTables: 0, restoredRows: 0 }),
}));
vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Some environments (a developer's shell, a CI step further down the
  // pipeline) may have DEMO_ONLY set ambiently — delete it explicitly so
  // non-demo test cases are hermetic regardless of ORIGINAL_ENV's contents,
  // rather than relying on it having been unset when this file loaded.
  delete process.env.DEMO_ONLY;
  vi.resetModules();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("T27 — /api/versions/export ALLOW_DEV_MODE bypass", () => {
  it("rejects an unauthenticated request when NODE_ENV=production, even with ALLOW_DEV_MODE=true", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    process.env.NODE_ENV = "production";

    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("allows an unauthenticated request when ALLOW_DEV_MODE=true and NODE_ENV=development", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    process.env.NODE_ENV = "development";

    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("rejects an unauthenticated request when ALLOW_DEV_MODE is unset in production", async () => {
    delete process.env.ALLOW_DEV_MODE;
    process.env.NODE_ENV = "production";

    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// Body is intentionally an empty FormData with no "file" field — the auth
// gate runs before file parsing, so these tests isolate that gate. In
// production this must 401 regardless of body; in the allowDev bypass case
// it should get PAST auth and fail later on file parsing (400 "No file
// uploaded"), proving auth — not file content — determined the response.
function emptyFormData(): FormData {
  return new FormData();
}

describe("T27 — /api/versions/import ALLOW_DEV_MODE bypass", () => {
  it("rejects an unauthenticated request when NODE_ENV=production, even with ALLOW_DEV_MODE=true", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    process.env.NODE_ENV = "production";

    const { POST } = await import("@/app/api/versions/import/route");
    const request = new Request("http://localhost/api/versions/import", {
      method: "POST",
      body: emptyFormData(),
    });
    const res = await POST(request);
    expect(res.status).toBe(401);
  });

  it("allows an unauthenticated request past the auth gate when ALLOW_DEV_MODE=true and NODE_ENV=development", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    process.env.NODE_ENV = "development";

    const { POST } = await import("@/app/api/versions/import/route");
    const request = new Request("http://localhost/api/versions/import", {
      method: "POST",
      body: emptyFormData(),
    });
    const res = await POST(request);
    // Not 401/403 — auth was bypassed. Reaches file-parsing instead.
    const body = await res.clone().json();
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("No file uploaded");
  });
});

// T3 — src/app/api/ non-tRPC routes had no DEMO_ONLY-guard coverage.
// DEMO_ONLY is checked before auth on both routes, so a demo deployment
// (read-only by design) must 403 regardless of session/ALLOW_DEV_MODE state.
describe("T3 — DEMO_ONLY guard", () => {
  it("export route rejects with 403 when DEMO_ONLY=true, even with ALLOW_DEV_MODE=true", async () => {
    process.env.DEMO_ONLY = "true";
    process.env.ALLOW_DEV_MODE = "true";
    process.env.NODE_ENV = "development";

    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("import route rejects with 403 when DEMO_ONLY=true, even with ALLOW_DEV_MODE=true", async () => {
    process.env.DEMO_ONLY = "true";
    process.env.ALLOW_DEV_MODE = "true";
    process.env.NODE_ENV = "development";

    const { POST } = await import("@/app/api/versions/import/route");
    const request = new Request("http://localhost/api/versions/import", {
      method: "POST",
      body: emptyFormData(),
    });
    const res = await POST(request);
    expect(res.status).toBe(403);
  });
});
