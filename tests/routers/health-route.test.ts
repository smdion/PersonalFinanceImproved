/**
 * `/api/health` answers 200 only when the app's server code loads and the
 * database answers, and never says more than its status and version.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const m = vi.hoisted(() => ({ all: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { all: m.all },
  isPostgres: () => false,
}));

async function probe(): Promise<{ status: number; body: unknown }> {
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/server/routers");
  m.all.mockReset();
});

describe("/api/health", () => {
  it("is ok when the app loads and the database answers", async () => {
    vi.doMock("@/server/routers", () => ({ appRouter: {} }));
    const { status, body } = await probe();
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok", version: expect.any(String) });
    expect(m.all).toHaveBeenCalledTimes(1);
  });

  it("is degraded when the app's server code fails to load, on every call", async () => {
    const load = vi.fn(() => {
      throw new Error("a module failed to load");
    });
    vi.doMock("@/server/routers", load);
    const { GET } = await import("@/app/api/health/route");
    for (let call = 0; call < 2; call++) {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: "degraded",
        version: expect.any(String),
      });
    }
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("is degraded when the database doesn't answer", async () => {
    vi.doMock("@/server/routers", () => ({ appRouter: {} }));
    m.all.mockImplementation(() => {
      throw new Error("database is locked");
    });
    const { status, body } = await probe();
    expect(status).toBe(503);
    expect(body).toEqual({ status: "degraded", version: expect.any(String) });
  });
});
