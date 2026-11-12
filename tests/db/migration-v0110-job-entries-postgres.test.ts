/**
 * The job-entries tag through the real migrator on PostgreSQL (db-migrate.ts's
 * runPostgres, run as the image runs it): an install at the tag before it
 * loses each Salary Profile entry for a deleted job and keeps every other
 * entry as stored, as a pending migration and in a squash replay, twice
 * over; run twice more over its own output, the converter writes nothing.
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
  JOB_ENTRIES_CONVERTER,
  JOB_ENTRIES_TAG,
} from "@/lib/db/migrate/v0110-job-entries";
import { expectPgReplaySafe } from "./converter-replay";
import { JOBS, PERSON, PROFILES } from "./job-entries-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

describe.skipIf(skipWithoutPostgres)(
  "the job-entries tag through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-job-entries");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(
        path.join(tmpdir(), "ledgr-migration-job-entries-pg-"),
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
        journal.entries.findIndex((e) => e.tag === JOB_ENTRIES_TAG),
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      await client.query(
        "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES ($1, $2, '1980-01-01', true)",
        [PERSON.id, PERSON.name],
      );
      for (const job of JOBS)
        await client.query(
          "INSERT INTO jobs (id, person_id, employer_name, start_date, is_speculative) VALUES ($1, $2, $3, $4, false)",
          [job.id, job.person_id, job.employer_name, job.start_date],
        );
      for (const c of PROFILES)
        await client.query(
          "INSERT INTO salary_profiles (id, name, salaries) VALUES ($1, $2, $3::jsonb)",
          [c.id, `Invented ${c.id}`, JSON.stringify(c.before)],
        );
      fs.writeFileSync(journalPath(), shipped);
    }

    const roots = async () =>
      (
        await client.query<{ salaries: unknown }>(
          "SELECT salaries FROM salary_profiles WHERE name LIKE 'Invented %' ORDER BY id",
        )
      ).rows.map((r) => r.salaries);

    it("converts as a pending migration, and a later start writes nothing", async () => {
      await installBefore();
      migrate();
      expect(await roots()).toEqual(PROFILES.map((c) => c.after));
      migrate();
      expect(await roots()).toEqual(PROFILES.map((c) => c.after));
    });

    it("a squash replay (a cleared journal) twice over writes nothing", async () => {
      await installBefore();
      migrate();
      for (let run = 0; run < 2; run++) {
        await client.query("DELETE FROM drizzle.__drizzle_migrations");
        migrate();
        expect(await roots()).toEqual(PROFILES.map((c) => c.after));
      }
    });

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrate();
      await expectPgReplaySafe(client, JOB_ENTRIES_CONVERTER);
      expect(await roots()).toEqual(PROFILES.map((c) => c.after));
    });
  },
);
