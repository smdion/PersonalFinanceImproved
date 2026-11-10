/**
 * The five `X-Cron-Secret` routes run `cronRoute`, after their own
 * DEMO_ONLY check. Each answers, in this order:
 *   - DEMO_ONLY set → 403, whatever the secret
 *   - CRON_SECRET missing or under 32 characters → 500 "Server
 *     misconfiguration" (+ the `cron_secret_misconfigured` error log)
 *   - wrong or absent header → 401 "Unauthorized"
 *   - right header → the route's work runs (mocked here) and answers 200.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const SECRET = "s".repeat(32);

const m = vi.hoisted(() => ({
  log: vi.fn(),
  runSimplefinSync: vi.fn(),
  checkForTaxDataUpdate: vi.fn(),
  createVersion: vi.fn(),
  syncSecurityFacts: vi.fn(),
  backfillJointPersonId: vi.fn(),
}));

// versions/daily reads app settings, then looks for today's auto version.
// Both queries return no rows, so the default "daily" schedule creates one.
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "from", "where"]) chain[k] = () => chain;
  chain.limit = () => Promise.resolve([]);
  chain.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);
  return { db: chain };
});
vi.mock("@/lib/db/schema", () => ({
  appSettings: {},
  stateVersions: { id: {}, versionType: {}, name: {} },
}));
vi.mock("@/lib/logger", () => ({ log: m.log, logWarnOnce: vi.fn() }));
vi.mock("@/server/services/sync/simplefin/sync", () => ({
  getSimplefinConnection: vi.fn().mockResolvedValue({ id: 1 }),
  hasSyncedToday: vi.fn().mockResolvedValue(false),
  runSimplefinSync: m.runSimplefinSync,
}));
vi.mock("@/server/services/tax/tax-data-sync", () => ({
  taxDataSyncOffReason: vi.fn().mockResolvedValue(null),
  taxDataCheckDue: vi.fn().mockResolvedValue(true),
  checkForTaxDataUpdate: m.checkForTaxDataUpdate,
}));
vi.mock("@/lib/db/backup/version-logic", () => ({
  createVersion: m.createVersion,
}));
vi.mock("@/lib/sec/connection", () => ({
  getSecConnection: vi.fn().mockResolvedValue({ id: 1 }),
}));
vi.mock("@/server/services/investments/sec-facts", () => ({
  secFactsRefreshDue: vi.fn().mockResolvedValue(true),
  syncSecurityFacts: m.syncSecurityFacts,
}));
vi.mock("@/lib/db/migrate/backfill-joint-person-id", () => ({
  backfillJointPersonId: m.backfillJointPersonId,
}));

type Route = {
  name: string;
  path: string;
  load: () => Promise<{ GET: (request: Request) => Promise<Response> }>;
  work: ReturnType<typeof vi.fn>;
};

const ROUTES: Route[] = [
  {
    name: "simplefin/daily",
    path: "/api/simplefin/daily",
    load: () => import("@/app/api/simplefin/daily/route"),
    work: m.runSimplefinSync,
  },
  {
    name: "tax-data/weekly",
    path: "/api/tax-data/weekly",
    load: () => import("@/app/api/tax-data/weekly/route"),
    work: m.checkForTaxDataUpdate,
  },
  {
    name: "versions/daily",
    path: "/api/versions/daily",
    load: () => import("@/app/api/versions/daily/route"),
    work: m.createVersion,
  },
  {
    name: "sec/weekly",
    path: "/api/sec/weekly",
    load: () => import("@/app/api/sec/weekly/route"),
    work: m.syncSecurityFacts,
  },
  {
    name: "startup",
    path: "/api/startup",
    load: () => import("@/app/api/startup/route"),
    work: m.backfillJointPersonId,
  },
];

const ORIGINAL_ENV = { ...process.env };

function request(path: string, secret?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: secret ? { "X-Cron-Secret": secret } : {},
  });
}

function misconfigLogged(): boolean {
  return m.log.mock.calls.some(
    (c) => c[0] === "error" && c[1] === "cron_secret_misconfigured",
  );
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.DEMO_ONLY;
  vi.clearAllMocks();
  m.runSimplefinSync.mockResolvedValue({});
  m.checkForTaxDataUpdate.mockResolvedValue({});
  m.createVersion.mockResolvedValue({ id: 1 });
  m.syncSecurityFacts.mockResolvedValue({});
  m.backfillJointPersonId.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe.each(ROUTES)("/api/$name cron secret", (route) => {
  it("DEMO_ONLY → 403 before the secret is checked, nothing logged", async () => {
    process.env.DEMO_ONLY = "true";
    delete process.env.CRON_SECRET;
    const { GET } = await route.load();

    const res = await GET(request(route.path));

    expect(res.status).toBe(403);
    expect(misconfigLogged()).toBe(false);
    expect(route.work).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["shorter than 32 characters", "s".repeat(31)],
  ])("CRON_SECRET %s → 500, work not run", async (_label, envSecret) => {
    if (envSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = envSecret;
    const { GET } = await route.load();

    const res = await GET(request(route.path, envSecret ?? SECRET));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server misconfiguration" });
    expect(misconfigLogged()).toBe(true);
    expect(route.work).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong", "w".repeat(32)],
    ["absent", undefined],
  ])("%s X-Cron-Secret header → 401, work not run", async (_label, header) => {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await route.load();

    const res = await GET(request(route.path, header));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(misconfigLogged()).toBe(false);
    expect(route.work).not.toHaveBeenCalled();
  });

  it("right X-Cron-Secret header → work runs, 200", async () => {
    process.env.CRON_SECRET = SECRET;
    const { GET } = await route.load();

    const res = await GET(request(route.path, SECRET));

    expect(res.status).toBe(200);
    expect(route.work).toHaveBeenCalledTimes(1);
  });
});
