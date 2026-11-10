/**
 * The credentials tag's cached-months step through the real migrator on
 * PostgreSQL (db-migrate.ts's runPostgres, run as the image runs it): an
 * install at the tag before it gets every cached month of the active
 * service harvested into savings_monthly once and every cached month
 * purged, and a later start changes nothing; run again over its own output
 * it writes nothing. Only when TEST_DATABASE_URL names a throwaway database
 * (CI's PostgreSQL job): it drops the database's schemas.
 */
// First: its mocks must be in place before any app module loads.
import {
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { CREDENTIALS_TAG } from "@/lib/db/migrate/v0106-credentials";
import { CACHED_MONTHS_CONVERTER } from "@/lib/db/migrate/v0106-cached-months";
import { expectPgReplaySafe } from "./converter-replay";
import {
  CACHE,
  GOALS,
  HARVESTED,
  HELD,
  KEPT_CACHE_IDS,
  LINKS,
  SETTINGS,
} from "./cached-months-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

describe.skipIf(skipWithoutPostgres)(
  "the cached-months step through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-months");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-months-pg-"));
      fs.cpSync(path.join(REPO, "drizzle"), path.join(dir, "drizzle"), {
        recursive: true,
      });
      for (const data of ["tax-data", "reference-data"])
        fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
    });
    afterAll(async () => {
      if (client) await dropAllSchemas(client);
      await client?.end();
      testDb?.restore();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    const journalPath = () =>
      path.join(dir, "drizzle", "meta", "_journal.json");

    /** `tsx db-migrate.ts` in the scratch folder: runPostgres for real. */
    function migrate() {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const name of Object.keys(env))
        if (name.startsWith("VITEST")) delete env[name];
      return spawnSync(TSX, [path.join(REPO, "db-migrate.ts")], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 180_000,
      });
    }
    function migrated() {
      const r = migrate();
      if (r.status !== 0)
        throw new Error(
          `db-migrate.ts exited ${r.status}:\n${r.stderr}\n${r.stdout}`,
        );
    }

    async function insert(table: string, rows: readonly object[]) {
      for (const row of rows) {
        const cols = Object.keys(row);
        await client.query(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          Object.values(row).map((v: unknown) =>
            typeof v === "object" && v !== null ? JSON.stringify(v) : v,
          ),
        );
      }
    }

    /** An empty database migrated to just before the tag, holding the
     *  cases' rows; the journal is then the shipped one. */
    async function installBefore() {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(
        path.join(REPO, "drizzle", "meta", "_journal.json"),
        "utf8",
      );
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(
        journal.entries.findIndex((e) => e.tag === CREDENTIALS_TAG),
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrated();
      await insert(
        "app_settings",
        SETTINGS.map((s) => ({ ...s, value: JSON.stringify(s.value) })),
      );
      await insert("savings_goals", GOALS);
      await insert("savings_goal_category_links", LINKS);
      await insert("savings_monthly", HELD);
      await insert("budget_api_cache", CACHE);
      fs.writeFileSync(journalPath(), shipped);
    }

    const state = async () => ({
      monthly: (
        await client.query<{ goal_id: number; month_date: string }>(
          "SELECT goal_id, to_char(month_date, 'YYYY-MM-DD') AS month_date, balance::text AS balance FROM savings_monthly ORDER BY id",
        )
      ).rows,
      cache: (
        await client.query<{ id: number }>(
          "SELECT id FROM budget_api_cache ORDER BY id",
        )
      ).rows.map((r) => r.id),
    });

    it("harvests and purges, and a later start changes nothing", async () => {
      await installBefore();
      migrated();
      const first = await state();
      expect(first.monthly).toEqual(
        [
          { goal_id: 1, month_date: "2026-09-01", balance: "100" },
          ...HARVESTED,
        ].map((r) => ({ ...r, balance: Number(r.balance).toFixed(2) })),
      );
      expect(first.cache).toEqual(KEPT_CACHE_IDS);
      migrated();
      expect(await state()).toEqual(first);
    });

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrated();
      await expectPgReplaySafe(client, [CACHED_MONTHS_CONVERTER]);
    });
  },
);
