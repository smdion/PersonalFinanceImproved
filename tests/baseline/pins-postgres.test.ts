/**
 * The pins v0.10.3 added (plan commit 3; owner Q15: on PostgreSQL too), on
 * PostgreSQL against the files SQLite wrote: `sync.getPreview` after the
 * two replayed syncs (`__sync__/<service>.preview.json`), the rows
 * `performance.finalizeYear` writes (`__sync__/finalize/`) and the engine
 * result's text and flags (`__text__/`). Each run is pin-runs.ts's, the
 * same as the SQLite files', on a database migrated from empty by the real
 * migrator; rows are read through the app's PostgreSQL schema
 * (tableRowsPg).
 *
 * Compared as figures, as part c compares (router-baseline-postgres): a
 * number written as text is read as its number (PostgreSQL's numeric
 * keeps its scale, "0.00" where SQLite keeps "0"), a call that threw must
 * still throw (the database's own error text differs), and a finalize's
 * written rows are compared as a set. Everything else must match exactly.
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (ending in
 * `_test`), holding the test database's lock (setup-postgres.ts). CI runs
 * it in the PostgreSQL job. The files are only ever written from SQLite.
 */
// First: the PostgreSQL harness's mocks, then the baseline's.
import {
  closeAppPool,
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as path from "node:path";
import pg from "pg";
import type { Session } from "next-auth";
import { runMigrator } from "../routers/fresh-install-cases";
import { seedHousehold, type Caller } from "./seed";
import { HOUSEHOLDS } from "./households";
import { BASELINE_NOW } from "./router-suite";
import { tableRowsPg } from "./table-rows";
import {
  PIN_DIRS,
  finalizeWrites,
  prepareSync,
  projectionText,
  readPin,
  replay,
  runSyncs,
  withoutTimestamps,
  type Service,
} from "./pin-runs";

const NUMBER_TEXT = /^-?\d+(\.\d+)?$/;

/** A pin as figures: number text read as numbers, a throw as thrown, and
 *  (`rowSets`) each `written` list in one fixed order. */
function figures(value: unknown, rowSets = false): unknown {
  if (typeof value === "string")
    return NUMBER_TEXT.test(value) ? Number(value) : value;
  if (Array.isArray(value)) return value.map((v) => figures(v, rowSets));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = k === "$threw" ? "threw" : figures(v, rowSets);
  if (rowSets && Array.isArray(out.written))
    out.written = out.written
      .map(
        (row) =>
          [
            JSON.stringify(row, Object.keys(row as object).sort()),
            row,
          ] as const,
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, row]) => row);
  return out;
}

const adminSession: Session = {
  user: {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@test.local",
    role: "admin",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

describe.skipIf(skipWithoutPostgres)("the added pins on PostgreSQL", () => {
  let restoreEnv: () => void = () => {};
  let admin: pg.Client;

  /** An empty, migrated database and an admin caller on it. */
  const open = async () => {
    await dropAllSchemas(admin);
    runMigrator();
    const { appRouter } = await import("@/server/routers");
    const { createCallerFactory } = await import("@/server/trpc");
    const { db } = await import("@/lib/db");
    const { invalidateYearEndCache } =
      await import("@/server/services/net-worth/year-end-history");
    // The pool outlives each household: drop what was read from the last.
    invalidateYearEndCache();
    const caller: Caller = createCallerFactory(appRouter)({
      db,
      session: adminSession,
      demoSchema: null,
    });
    return { caller, read: () => tableRowsPg(db) };
  };

  beforeAll(async () => {
    const testDatabase = pointAtTestDatabase("pins-pg");
    restoreEnv = testDatabase.restore;
    delete process.env.DEMO_ONLY;
    admin = new pg.Client({ connectionString: testDatabase.url });
    await admin.connect();
    vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await admin?.end();
    await closeAppPool();
    restoreEnv();
  });

  const household = (key: string) => HOUSEHOLDS.find((h) => h.key === key)!;

  it.each<Service>(["ynab", "actual"])(
    "sync.getPreview after the recorded %s syncs",
    async (service) => {
      vi.setSystemTime(BASELINE_NOW);
      vi.stubGlobal("fetch", replay(service));
      const { resetActualWrapperGates } =
        await import("@/lib/budget-api/actual-client");
      resetActualWrapperGates();
      const { caller } = await open();
      const ids = await seedHousehold(caller, household("e2e-b"));
      await prepareSync(caller, service, ids);
      await runSyncs(caller, service);
      const preview = withoutTimestamps(
        await caller.sync.getPreview({ service }),
      );
      const file = path.join(PIN_DIRS.sync, `${service}.preview.json`);
      expect(figures(preview)).toEqual(figures(readPin(file)));
    },
    300_000,
  );

  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "finalizeYear's writes: %s",
    async (key, h) => {
      vi.setSystemTime(BASELINE_NOW);
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
      );
      const { caller, read } = await open();
      const ids = await seedHousehold(caller, h);
      const written = await finalizeWrites(caller, h, ids, read);
      const file = path.join(PIN_DIRS.finalize, `${key}.json`);
      expect(figures(written, true)).toEqual(figures(readPin(file), true));
    },
    300_000,
  );

  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "the engine result's text and flags: %s",
    async (key, h) => {
      vi.setSystemTime(BASELINE_NOW);
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
      );
      const { caller } = await open();
      const ids = await seedHousehold(caller, h);
      const text = await projectionText(caller, h, ids);
      const file = path.join(PIN_DIRS.text, `${key}.json`);
      expect(text).toEqual(readPin(file));
    },
    300_000,
  );
});
