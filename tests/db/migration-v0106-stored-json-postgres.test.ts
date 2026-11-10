/**
 * The v0.10.6 stored-JSON tag through the real migrator on PostgreSQL
 * (db-migrate.ts's runPostgres, run as the image runs it): an install at
 * the tag before it gets salary-entries-cases.ts' roots (a JSON string
 * scalar root included) as a pending migration and in a squash replay,
 * twice over, each entry read as before; run twice more over its own
 * output, the converters write nothing; an entry the entry schema refuses
 * refuses the start. Only when TEST_DATABASE_URL names a throwaway
 * database (CI's PostgreSQL job): it drops the database's schemas.
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
import { tagConverters } from "@/lib/db/migrate/migration-converters";
import { STORED_JSON_TAG } from "@/lib/db/migrate/v0106-stored-json";
import { expectPgReplaySafe } from "./converter-replay";
import {
  PROFILES,
  REFUSED,
  JOBS,
  SNAPSHOT_PERSON,
  profileReads,
  profileReadsBeforeTag,
  type SalaryCase,
} from "./salary-entries-cases";
import {
  ACCOUNTS,
  PROFILES as CONTRIBUTION_PROFILES,
  REFUSED as REFUSED_FIELDS,
  type ActiveFieldsCase,
} from "./active-fields-cases";
import {
  PERFORMANCE_ACCOUNTS,
  YEARS,
  yearRows,
} from "./performance-category-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");

describe.skipIf(skipWithoutPostgres)(
  "the stored-JSON tag through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-stored-json");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(
        path.join(tmpdir(), "ledgr-migration-stored-json-pg-"),
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
    function migrate(): string {
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
      return r.stdout;
    }

    /** An empty database migrated to just before the tag, holding the
     *  cases' rows; the journal is then the shipped one. */
    async function installBefore(
      cases: readonly SalaryCase[] = PROFILES,
      contributions: readonly ActiveFieldsCase[] = CONTRIBUTION_PROFILES,
    ) {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(
        path.join(REPO, "drizzle", "meta", "_journal.json"),
        "utf8",
      );
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(
        journal.entries.findIndex((e) => e.tag === STORED_JSON_TAG),
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      await client.query(
        "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES ($1, $2, '1980-01-01', true)",
        [SNAPSHOT_PERSON.id, SNAPSHOT_PERSON.name],
      );
      for (const job of JOBS)
        await client.query(
          "INSERT INTO jobs (id, person_id, employer_name, start_date, is_speculative) VALUES ($1, $2, $3, $4, false)",
          [job.id, job.person_id, job.employer_name, job.start_date],
        );
      for (const c of cases)
        await client.query(
          "INSERT INTO salary_profiles (id, name, salaries) VALUES ($1, $2, $3::jsonb)",
          [c.id, `Invented ${c.id}`, JSON.stringify(c.before)],
        );
      for (const a of ACCOUNTS) {
        const cols = Object.keys(a);
        const params = cols.map((_, i) => "$" + String(i + 1));
        await client.query(
          `INSERT INTO contribution_accounts (${cols.join(", ")}) VALUES (${params.join(", ")})`,
          Object.values(a),
        );
      }
      for (const [table, row] of [
        ...PERFORMANCE_ACCOUNTS.map(
          (a) => ["performance_accounts", a] as const,
        ),
        ...yearRows().map((y) => ["account_performance", y] as const),
      ]) {
        const cols = Object.keys(row);
        const params = cols.map((_, i) => "$" + String(i + 1));
        await client.query(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${params.join(", ")})`,
          Object.values(row),
        );
      }
      for (const c of contributions)
        await client.query(
          "INSERT INTO contribution_profiles (id, name, contribution_active_fields) VALUES ($1, $2, $3::jsonb)",
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

    const activeRoots = async () =>
      (
        await client.query<{ f: unknown }>(
          "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE name LIKE 'Invented %' ORDER BY id",
        )
      ).rows.map((r) => r.f);

    const categories = async () =>
      (
        await client.query<{ c: string }>(
          "SELECT parent_category AS c FROM account_performance WHERE institution = 'Invented Bank' ORDER BY id",
        )
      ).rows.map((r) => r.c);

    const readable = PROFILES.flatMap((c, i) =>
      typeof c.before === "string" ? [] : [i],
    );

    it("converts as a pending migration, reads as before, and a later start writes nothing", async () => {
      await installBefore();
      expect(migrate()).toMatch(
        new RegExp(
          `"event":"migration_conversion".*"tag":"${STORED_JSON_TAG}"`,
        ),
      );
      const first = await roots();
      expect(first).toEqual(PROFILES.map((c) => c.after));
      expect(readable.map((i) => profileReads(first[i]))).toEqual(
        readable.map((i) => profileReadsBeforeTag(PROFILES[i]!.before)),
      );
      migrate();
      expect(await roots()).toEqual(first);
    });

    it("converts the contribution active fields as a pending migration, and a later start writes nothing", async () => {
      await installBefore();
      migrate();
      const first = await activeRoots();
      expect(first).toEqual(CONTRIBUTION_PROFILES.map((c) => c.after));
      migrate();
      expect(await activeRoots()).toEqual(first);
    });

    it("gives each account-year its account's category as a pending migration, and a later start writes nothing", async () => {
      await installBefore();
      migrate();
      expect(await categories()).toEqual(YEARS.map((y) => y.after));
      migrate();
      expect(await categories()).toEqual(YEARS.map((y) => y.after));
    });

    it("a refused active-fields row refuses the start, and nothing changes", async () => {
      await installBefore(PROFILES, [
        ...CONTRIBUTION_PROFILES,
        ...REFUSED_FIELDS,
      ]);
      const before = [await roots(), await activeRoots()];
      expect(() => migrate()).toThrow(
        /contribution_profiles 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512/,
      );
      expect([await roots(), await activeRoots()]).toEqual(before);
    });

    it.each([
      [
        "a recorded hash that no longer matches",
        "UPDATE drizzle.__drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)",
      ],
      ["a cleared journal", "DELETE FROM drizzle.__drizzle_migrations"],
    ])(
      "a squash replay (%s), twice over, writes nothing again",
      async (_, damage) => {
        await installBefore();
        migrate();
        const converted = await roots();
        expect(converted).toEqual(PROFILES.map((c) => c.after));
        for (let run = 0; run < 2; run++) {
          await client.query(damage);
          migrate();
          expect(await roots()).toEqual(converted);
          expect(await activeRoots()).toEqual(
            CONTRIBUTION_PROFILES.map((c) => c.after),
          );
        }
      },
    );

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrate();
      await expectPgReplaySafe(client, tagConverters(STORED_JSON_TAG));
    });

    it("an entry the schema refuses refuses the start, and the whole tag rolls back", async () => {
      await installBefore([...PROFILES, ...REFUSED]);
      const before = await roots();
      expect(() => migrate()).toThrow(
        /salary_profiles 301, 302, 303, 304, 305, 306, 307/,
      );
      expect(await roots()).toEqual(before);
    });
  },
);
