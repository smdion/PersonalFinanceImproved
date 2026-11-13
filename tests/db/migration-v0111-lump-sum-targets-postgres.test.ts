/**
 * The lump-sum-targets tag through the real migrator on PostgreSQL
 * (db-migrate.ts's runPostgres, run as the image runs it): an install at the
 * tag before it gains the account id beside each saved lump sum's name that
 * matches one account and keeps every other lump sum as stored, as a pending
 * migration and in a squash replay, twice over; run twice more over its own
 * output, the converter writes nothing.
 * Only when TEST_DATABASE_URL names a throwaway database (CI's PostgreSQL
 * job): it drops the database's schemas.
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
import {
  LUMP_SUM_TARGETS_CONVERTER,
  LUMP_SUM_TARGETS_TAG,
} from "@/lib/db/migrate/v0111-lump-sum-targets";
import { expectPgReplaySafe } from "./converter-replay";
import { SETS, seedStatements } from "./lump-sum-targets-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

describe.skipIf(skipWithoutPostgres)(
  "the lump-sum-targets tag through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-lump-sum-targets");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(
        path.join(tmpdir(), "ledgr-migration-lump-sum-targets-pg-"),
      );
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
    function migrate(): void {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const key of Object.keys(env))
        if (key.startsWith("VITEST")) delete env[key];
      const r = spawnSync(TSX, [path.join(REPO, "db-migrate.ts")], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 180_000,
      });
      if (r.status !== 0)
        throw new Error(
          `db-migrate.ts exited ${r.status}:\n${r.stderr}\n${r.stdout}`,
        );
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
        journal.entries.findIndex((e) => e.tag === LUMP_SUM_TARGETS_TAG),
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      for (const [sql, params] of seedStatements()) {
        let n = 0;
        await client.query(
          sql.replace(/\?/g, () => `$${++n}`),
          params,
        );
      }
      fs.writeFileSync(journalPath(), shipped);
    }

    const roots = async () =>
      (
        await client.query<{ overrides: unknown }>(
          "SELECT overrides FROM projection_overrides WHERE id >= 701 ORDER BY id",
        )
      ).rows.map((r) => r.overrides);

    it("converts as a pending migration, and a later start writes nothing", async () => {
      await installBefore();
      migrate();
      expect(await roots()).toEqual(SETS.map((c) => c.after));
      migrate();
      expect(await roots()).toEqual(SETS.map((c) => c.after));
    });

    it("a squash replay (a cleared journal) twice over writes nothing", async () => {
      await installBefore();
      migrate();
      for (let run = 0; run < 2; run++) {
        await client.query("DELETE FROM drizzle.__drizzle_migrations");
        migrate();
        expect(await roots()).toEqual(SETS.map((c) => c.after));
      }
    });

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrate();
      await expectPgReplaySafe(client, LUMP_SUM_TARGETS_CONVERTER);
      expect(await roots()).toEqual(SETS.map((c) => c.after));
    });
  },
);
