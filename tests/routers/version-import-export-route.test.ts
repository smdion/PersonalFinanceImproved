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
vi.mock("@/lib/logger", () => ({ log: vi.fn(), logWarnOnce: vi.fn() }));
vi.mock("@/lib/db/backup/version-logic", () => ({
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
// The tRPC module itself is heavy; the route reads only its label helper.
vi.mock("@/server/trpc", () => ({
  getSessionUserLabel: (session: { user: { name: string } }) =>
    session.user.name,
}));
vi.mock("@/server/data/first-run", () => ({
  settleFirstRunGate: vi.fn().mockResolvedValue(undefined),
}));
// The browser's demo cookie (none unless a case sets one).
const demoCookie = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "demo_active_profile" && demoCookie.value !== undefined
        ? { name, value: demoCookie.value }
        : undefined,
  }),
}));

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Some environments (a developer's shell, a CI step further down the
  // pipeline) may have DEMO_ONLY set ambiently — delete it explicitly so
  // non-demo test cases are hermetic regardless of ORIGINAL_ENV's contents,
  // rather than relying on it having been unset when this file loaded.
  delete process.env.DEMO_ONLY;
  demoCookie.value = undefined;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = ORIGINAL_ENV;
});

describe("T27 — /api/versions/export ALLOW_DEV_MODE bypass", () => {
  it("rejects an unauthenticated request when NODE_ENV=production, even with ALLOW_DEV_MODE=true", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    vi.stubEnv("NODE_ENV", "production");

    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("allows an unauthenticated request when ALLOW_DEV_MODE=true and NODE_ENV=development", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    vi.stubEnv("NODE_ENV", "development");

    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("rejects an unauthenticated request when ALLOW_DEV_MODE is unset in production", async () => {
    delete process.env.ALLOW_DEV_MODE;
    vi.stubEnv("NODE_ENV", "production");

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
    vi.stubEnv("NODE_ENV", "production");

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
    vi.stubEnv("NODE_ENV", "development");

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
    vi.stubEnv("NODE_ENV", "development");

    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("import route rejects with 403 when DEMO_ONLY=true, even with ALLOW_DEV_MODE=true", async () => {
    process.env.DEMO_ONLY = "true";
    process.env.ALLOW_DEV_MODE = "true";
    vi.stubEnv("NODE_ENV", "development");

    const { POST } = await import("@/app/api/versions/import/route");
    const request = new Request("http://localhost/api/versions/import", {
      method: "POST",
      body: emptyFormData(),
    });
    const res = await POST(request);
    expect(res.status).toBe(403);
  });
});

describe("/api/versions/import settles the first-admin gate", () => {
  it("runs settleFirstRunGate after the import", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    vi.stubEnv("NODE_ENV", "development");

    const { POST } = await import("@/app/api/versions/import/route");
    const { importBackup } = await import("@/lib/db/backup/version-logic");
    const { settleFirstRunGate } = await import("@/server/data/first-run");
    const body = new FormData();
    const backup = {
      schemaVersion: "0001",
      exportedAt: "2026-01-01T00:00:00.000Z",
      tables: {},
    };
    body.append("file", new File([JSON.stringify(backup)], "backup.json"));
    const res = await POST(
      new Request("http://localhost/api/versions/import", {
        method: "POST",
        body,
      }),
    );
    expect(res.status).toBe(200);
    expect(importBackup).toHaveBeenCalled();
    expect(settleFirstRunGate).toHaveBeenCalledWith(
      expect.anything(),
      "import",
    );
  });
});

// Who may import (an admin, or a viewer with the version permission) and
// how far: anyone but an admin keeps each integration's credentials.
describe("/api/versions/import: who imports, and the connections fence", () => {
  const backupFile = () => {
    const body = new FormData();
    const backup = {
      schemaVersion: "0001",
      exportedAt: "2026-01-01T00:00:00.000Z",
      tables: {},
    };
    body.append("file", new File([JSON.stringify(backup)], "backup.json"));
    return body;
  };
  const user = (role: "admin" | "viewer", permissions: string[]) => ({
    user: { id: "u", name: "U", email: "u@test.local", role, permissions },
    expires: "2099-12-31T23:59:59.999Z",
  });

  async function importAs(session: ReturnType<typeof user>, devFlag = false) {
    vi.stubEnv("NODE_ENV", "production");
    if (devFlag) process.env.ALLOW_DEV_MODE = "true";
    else delete process.env.ALLOW_DEV_MODE;
    const { auth } = await import("@/server/auth");
    vi.mocked(auth).mockResolvedValueOnce(session as never);
    const { POST } = await import("@/app/api/versions/import/route");
    const { importBackup } = await import("@/lib/db/backup/version-logic");
    vi.mocked(importBackup).mockClear();
    const res = await POST(
      new Request("http://localhost/api/versions/import", {
        method: "POST",
        body: backupFile(),
      }),
    );
    return { res, importBackup: vi.mocked(importBackup) };
  }

  it("a viewer with the version permission imports, keeping the credentials", async () => {
    const { res, importBackup } = await importAs(user("viewer", ["version"]));
    expect(res.status).toBe(200);
    expect(importBackup).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { asAdmin: false, user: "U" },
    );
  });

  it("an admin imports the whole backup, connections included", async () => {
    const { res, importBackup } = await importAs(user("admin", []));
    expect(res.status).toBe(200);
    expect(importBackup).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { asAdmin: true, user: "U" },
    );
  });

  it("in production ALLOW_DEV_MODE doesn't make a version viewer's import an admin's", async () => {
    const { res, importBackup } = await importAs(
      user("viewer", ["version"]),
      true,
    );
    expect(res.status).toBe(200);
    expect(importBackup).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { asAdmin: false, user: "U" },
    );
  });

  it("a viewer with only the sync permission can't import", async () => {
    const { res, importBackup } = await importAs(user("viewer", ["sync"]));
    expect(res.status).toBe(403);
    expect(importBackup).not.toHaveBeenCalled();
  });
});

describe("/api/versions/import: a backup refused over its closed-set values", () => {
  it("answers 400 with the refusal's message, and settles nothing", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    vi.stubEnv("NODE_ENV", "development");
    const { POST } = await import("@/app/api/versions/import/route");
    const { importBackup } = await import("@/lib/db/backup/version-logic");
    const { settleFirstRunGate } = await import("@/server/data/first-run");
    const { ClosedSetRefusal } =
      await import("@/lib/db/backup/closed-set-columns");
    vi.mocked(settleFirstRunGate).mockClear();
    vi.mocked(importBackup).mockRejectedValueOnce(
      new ClosedSetRefusal(
        [
          {
            table: "performance_accounts",
            column: "account_type",
            value: "solo401k",
            rows: 1,
          },
        ],
        "import",
      ),
    );
    const body = new FormData();
    const backup = {
      schemaVersion: "0001",
      exportedAt: "2026-01-01T00:00:00.000Z",
      tables: {},
    };
    body.append("file", new File([JSON.stringify(backup)], "backup.json"));
    const res = await POST(
      new Request("http://localhost/api/versions/import", {
        method: "POST",
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain(
      'performance_accounts.account_type = "solo401k" (1 row)',
    );
    expect(settleFirstRunGate).not.toHaveBeenCalled();
  });
});

// SE2: with a demo profile active, every page shows the demo's schema, but
// these routes read and write the household's own data: both refuse.
describe("/api/versions/import and export while a demo profile is active", () => {
  const admin = {
    user: {
      id: "u",
      name: "U",
      email: "u@test.local",
      role: "admin",
      permissions: [],
    },
    expires: "2099-12-31T23:59:59.999Z",
  };

  async function signedInAsAdmin() {
    vi.stubEnv("NODE_ENV", "production");
    const { auth } = await import("@/server/auth");
    vi.mocked(auth).mockResolvedValueOnce(admin as never);
  }

  it("import answers 409 and imports nothing", async () => {
    demoCookie.value = "single-income";
    await signedInAsAdmin();
    const { POST } = await import("@/app/api/versions/import/route");
    const { importBackup } = await import("@/lib/db/backup/version-logic");
    vi.mocked(importBackup).mockClear();
    const body = new FormData();
    body.append(
      "file",
      new File(
        [JSON.stringify({ schemaVersion: "1", exportedAt: "x", tables: {} })],
        "backup.json",
      ),
    );
    const res = await POST(
      new Request("http://localhost/api/versions/import", {
        method: "POST",
        body,
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "A demo profile is active. Leave the demo to import a backup.",
    );
    expect(importBackup).not.toHaveBeenCalled();
  });

  it("export answers 409 and reads nothing", async () => {
    demoCookie.value = "single-income";
    await signedInAsAdmin();
    const { GET } = await import("@/app/api/versions/export/route");
    const { exportBackup } = await import("@/lib/db/backup/version-logic");
    vi.mocked(exportBackup).mockClear();
    const res = await GET();
    expect(res.status).toBe(409);
    expect(exportBackup).not.toHaveBeenCalled();
  });

  it("a cookie naming no demo profile doesn't refuse (tRPC reads the household's data then too)", async () => {
    demoCookie.value = "not-a-profile";
    await signedInAsAdmin();
    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("an unsigned request still answers 401 first", async () => {
    demoCookie.value = "single-income";
    vi.stubEnv("NODE_ENV", "production");
    const { GET } = await import("@/app/api/versions/export/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// SE1: the version permission manages the household's data, not access.
describe("/api/versions/export: who exports how much", () => {
  const as = (role: "admin" | "viewer", permissions: string[]) => ({
    user: { id: "u", name: "U", email: "u@test.local", role, permissions },
    expires: "2099-12-31T23:59:59.999Z",
  });

  async function exportAs(session: ReturnType<typeof as>) {
    vi.stubEnv("NODE_ENV", "production");
    const { auth } = await import("@/server/auth");
    vi.mocked(auth).mockResolvedValueOnce(session as never);
    const { GET } = await import("@/app/api/versions/export/route");
    const { exportBackup } = await import("@/lib/db/backup/version-logic");
    vi.mocked(exportBackup).mockClear();
    const res = await GET();
    return { res, exportBackup: vi.mocked(exportBackup) };
  }

  it("a viewer with the version permission exports the household's data only", async () => {
    const { res, exportBackup } = await exportAs(as("viewer", ["version"]));
    expect(res.status).toBe(200);
    expect(exportBackup).toHaveBeenCalledWith(expect.anything(), {
      asAdmin: false,
    });
  });

  it("an admin exports the full backup", async () => {
    const { res, exportBackup } = await exportAs(as("admin", []));
    expect(res.status).toBe(200);
    expect(exportBackup).toHaveBeenCalledWith(expect.anything(), {
      asAdmin: true,
    });
  });
});

describe("/api/versions/import: a household-only export", () => {
  it("keeps its householdOnly mark through validation", async () => {
    process.env.ALLOW_DEV_MODE = "true";
    vi.stubEnv("NODE_ENV", "development");
    const { POST } = await import("@/app/api/versions/import/route");
    const { importBackup } = await import("@/lib/db/backup/version-logic");
    vi.mocked(importBackup).mockClear();
    const body = new FormData();
    const backup = {
      schemaVersion: "0001",
      exportedAt: "2026-01-01T00:00:00.000Z",
      tables: {},
      householdOnly: true,
    };
    body.append("file", new File([JSON.stringify(backup)], "backup.json"));
    const res = await POST(
      new Request("http://localhost/api/versions/import", {
        method: "POST",
        body,
      }),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(importBackup).mock.calls[0]![1]).toMatchObject({
      householdOnly: true,
    });
  });
});

describe("/api/versions/import: a body past the size limit", () => {
  async function importRequest(request: Request) {
    process.env.ALLOW_DEV_MODE = "true";
    vi.stubEnv("NODE_ENV", "development");
    const { POST } = await import("@/app/api/versions/import/route");
    const { importBackup } = await import("@/lib/db/backup/version-logic");
    vi.mocked(importBackup).mockClear();
    return { res: await POST(request), importBackup: vi.mocked(importBackup) };
  }

  it("answers 413 on a declared length past the limit, before reading the body", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("the body was read");
      },
    });
    const { res, importBackup } = await importRequest(
      new Request("http://localhost/api/versions/import", {
        method: "POST",
        body,
        headers: {
          "content-length": String(51 * 1024 * 1024),
          "content-type": "multipart/form-data; boundary=x",
        },
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(importBackup).not.toHaveBeenCalled();
  });

  it("answers 413 on an undeclared length once the stream passes the limit", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 60) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const { res, importBackup } = await importRequest(
      new Request("http://localhost/api/versions/import", {
        method: "POST",
        body,
        headers: { "content-type": "multipart/form-data; boundary=x" },
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    // Refused at the limit: the rest of the stream is never pulled.
    expect(sent).toBeLessThan(60);
    expect(importBackup).not.toHaveBeenCalled();
  });
});
