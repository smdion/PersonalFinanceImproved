/**
 * The credentials tag through the real migrator on PostgreSQL
 * (db-migrate.ts's runPostgres, run as the image runs it): an install at
 * the tag before it gets every stored credential of credentials-cases.ts
 * encrypted (a JSON string scalar holding one unwrapped), its stored
 * versions' copies too, as a pending migration and in a squash replay,
 * twice over; run again over its own output it writes nothing; without
 * ENCRYPTION_KEY the start is refused and nothing changes. Only when
 * TEST_DATABASE_URL names a throwaway database (CI's PostgreSQL job): it
 * drops the database's schemas.
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
  CREDENTIALS_CONVERTER,
  CREDENTIALS_TAG,
} from "@/lib/db/migrate/v0106-credentials";
import { expectPgReplaySafe } from "./converter-replay";
import {
  CONNECTIONS,
  KEY_TEXT,
  OTHER_TABLE_ROWS,
  SECRETS,
  VERSION_COPIES,
  expectConverted,
  expectCopiesConverted,
} from "./credentials-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

describe.skipIf(skipWithoutPostgres)(
  "the credentials tag through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-credentials");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(
        path.join(tmpdir(), "ledgr-migration-credentials-pg-"),
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

    /** `tsx db-migrate.ts` in the scratch folder: runPostgres for real,
     *  with `key` as ENCRYPTION_KEY (none when undefined). */
    function migrate(key: string | undefined = KEY_TEXT) {
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const name of Object.keys(env))
        if (name.startsWith("VITEST")) delete env[name];
      if (key === undefined) delete env["ENCRYPTION_KEY"];
      else env["ENCRYPTION_KEY"] = key;
      return spawnSync(TSX, [path.join(REPO, "db-migrate.ts")], {
        cwd: dir,
        env,
        encoding: "utf8",
        timeout: 180_000,
      });
    }
    function migrated(): string {
      const r = migrate();
      if (r.status !== 0)
        throw new Error(
          `db-migrate.ts exited ${r.status}:\n${r.stderr}\n${r.stdout}`,
        );
      return r.stdout;
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
      for (const c of CONNECTIONS)
        await client.query(
          "INSERT INTO api_connections (id, service, config) VALUES ($1, $2, $3::jsonb)",
          [c.id, c.service, JSON.stringify(c.stored)],
        );
      for (const id of [1, 2])
        await client.query(
          "INSERT INTO state_versions (id, name, version_type, schema_version, table_count, total_rows, created_by) VALUES ($1, 'Invented', 'manual', '0017_v0102_match_value', 2, 5, 'invented')",
          [id],
        );
      const copies = JSON.stringify(Object.values(VERSION_COPIES));
      const copy = (id: number, version: number, table: string, data: string) =>
        client.query(
          "INSERT INTO state_version_tables (id, version_id, table_name, row_count, data) VALUES ($1, $2, $3, 1, $4::jsonb)",
          [id, version, table, data],
        );
      await copy(1, 1, "api_connections", copies);
      await copy(2, 1, "people", JSON.stringify(OTHER_TABLE_ROWS));
      await copy(3, 2, "api_connections", copies);
      fs.writeFileSync(journalPath(), shipped);
    }

    /** Each config and version copy as the app reads it (node-pg's value). */
    const state = async () => {
      const configs = new Map(
        (
          await client.query<{ id: number; config: unknown }>(
            "SELECT id, config FROM api_connections",
          )
        ).rows.map((r) => [r.id, r.config]),
      );
      const versions = (
        await client.query<{ id: number; data: unknown[] }>(
          "SELECT id, data FROM state_version_tables ORDER BY id",
        )
      ).rows;
      const recorded = Number(
        (
          await client.query<{ n: string }>(
            "SELECT count(*) AS n FROM drizzle.__drizzle_migrations",
          )
        ).rows[0]!.n,
      );
      return { configs, versions, recorded };
    };

    function expectAllConverted(s: Awaited<ReturnType<typeof state>>) {
      expectConverted(s.configs);
      const [first, other, second] = s.versions;
      expectCopiesConverted(first!.data);
      expectCopiesConverted(second!.data);
      expect(other!.data).toEqual(OTHER_TABLE_ROWS);
    }

    it("converts as a pending migration, and a later start changes nothing", async () => {
      await installBefore();
      expect(migrated()).toMatch(
        new RegExp(
          `"event":"migration_conversion".*"tag":"${CREDENTIALS_TAG}"`,
        ),
      );
      const first = await state();
      expectAllConverted(first);
      migrated();
      expect(await state()).toEqual(first);
    });

    it.each([
      [
        "a recorded hash that no longer matches",
        "UPDATE drizzle.__drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)",
      ],
      ["a cleared journal", "DELETE FROM drizzle.__drizzle_migrations"],
    ])(
      "a squash replay (%s), twice over, changes nothing",
      async (_, damage) => {
        await installBefore();
        migrated();
        const converted = await state();
        expectAllConverted(converted);
        for (let run = 0; run < 2; run++) {
          await client.query(damage);
          migrated();
          const after = await state();
          expect(after.configs).toEqual(converted.configs);
          expect(after.versions).toEqual(converted.versions);
        }
      },
    );

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrated();
      await expectPgReplaySafe(client, [CREDENTIALS_CONVERTER]);
    });

    it("without ENCRYPTION_KEY the start is refused, naming no value, and nothing changes", async () => {
      await installBefore();
      const before = await state();
      const r = migrate(undefined);
      expect(r.status).not.toBe(0);
      const output = `${r.stdout}\n${r.stderr}`;
      expect(output).toContain(
        "Stored credentials must be encrypted, and ENCRYPTION_KEY is missing",
      );
      for (const secret of SECRETS) expect(output).not.toContain(secret);
      expect(await state()).toEqual(before);
    });
  },
);
