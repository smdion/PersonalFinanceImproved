/**
 * The credentials tag's joint step through the real migrator on PostgreSQL
 * (db-migrate.ts's runPostgres, run as the image runs it): an install at
 * the tag before it gets every joint contribution account's person cleared,
 * and a later start changes nothing; run again over its own output it
 * writes nothing; an undecidable row refuses the start, naming its id and
 * no name, and nothing changes. Only when TEST_DATABASE_URL names a
 * throwaway database (CI's PostgreSQL job): it drops the database's schemas.
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
import { JOINT_PERSON_IDS_CONVERTER } from "@/lib/db/migrate/v0106-joint-person-ids";
import { expectPgReplaySafe } from "./converter-replay";
import {
  ACCOUNT_CASES,
  JOBS,
  NAMES,
  PEOPLE,
  PROFILES,
  UNDECIDABLE,
} from "./joint-person-ids-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

describe.skipIf(skipWithoutPostgres)(
  "the joint step through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-joint");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-joint-pg-"));
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
    async function installBefore(extra: object[] = []) {
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
      await insert("people", PEOPLE);
      await insert("jobs", JOBS);
      await insert("contribution_accounts", [
        ...ACCOUNT_CASES.map((c) => c.row),
        ...extra,
      ]);
      await insert("contribution_profiles", PROFILES);
      fs.writeFileSync(journalPath(), shipped);
    }

    const personIds = async () =>
      (
        await client.query<{ person_id: number | null }>(
          "SELECT person_id FROM contribution_accounts ORDER BY id",
        )
      ).rows.map((r) => r.person_id);

    it("clears each joint row's person, and a later start changes nothing", async () => {
      await installBefore();
      migrated();
      expect(await personIds()).toEqual(ACCOUNT_CASES.map((c) => c.after));
      migrated();
      expect(await personIds()).toEqual(ACCOUNT_CASES.map((c) => c.after));
    });

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrated();
      await expectPgReplaySafe(client, [JOINT_PERSON_IDS_CONVERTER]);
    });

    it("an undecidable row refuses the start, naming its id only, and nothing changes", async () => {
      await installBefore([UNDECIDABLE]);
      const before = await personIds();
      const r = migrate();
      expect(r.status).not.toBe(0);
      const output = `${r.stdout}\n${r.stderr}`;
      expect(output).toContain(
        `rows: contribution_accounts ${UNDECIDABLE.id})`,
      );
      for (const name of NAMES) expect(output).not.toContain(name);
      expect(await personIds()).toEqual(before);
    });
  },
);
