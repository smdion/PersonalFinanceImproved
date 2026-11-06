/**
 * Migration 0016 through the real migrator on PostgreSQL (db-migrate.ts's
 * runPostgres, run as the image runs it): a 0015 install's percent matches
 * get employer_match_rate and employerMatchRate as the restore step gives
 * them (match-rate-cases.ts), as a pending migration and in a squash
 * replay; a replay never divides again, and a double-encoded column stays
 * as it was. Only when TEST_DATABASE_URL names a throwaway database (CI's
 * PostgreSQL job): it drops the database's schemas.
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
import { MATCH_RATE_TAG } from "@/lib/db/v0102-match-rate";
import { ACCOUNT_CASES, PROFILE_CASES } from "./match-rate-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const CASES = ACCOUNT_CASES.filter((c) => !c.sqliteOnly);
/** A column stored as a jsonb string by an old restore (jsonb-import.ts):
 *  the app reads no entries from it, so the converter leaves it. */
const DOUBLE_ENCODED = JSON.stringify(
  JSON.stringify({
    contributionAccounts: { "1": { employerMatchValue: "50" } },
  }),
);

describe.skipIf(skipWithoutPostgres)(
  "migration 0016 through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-0016");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-0016-pg-"));
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

    /** An empty database migrated to 0015, holding every case. */
    async function installAt0015(): Promise<void> {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(
        path.join(REPO, "drizzle", "meta", "_journal.json"),
        "utf8",
      );
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(
        journal.entries.findIndex((e) => e.tag === MATCH_RATE_TAG),
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      for (const c of CASES)
        await client.query(
          `INSERT INTO contribution_accounts (id, account_type, sub_type, tax_treatment, employer_match_type, employer_match_value)
           VALUES ($1, '401k', $2, 'pre_tax', $3, $4)`,
          [c.id, c.subType ?? null, c.type, c.value],
        );
      for (const [i, c] of PROFILE_CASES.entries())
        await client.query(
          "INSERT INTO contribution_profiles (name, contribution_active_fields) VALUES ($1, $2::jsonb)",
          [`Invented ${i}`, JSON.stringify(c.before)],
        );
      await client.query(
        "INSERT INTO contribution_profiles (name, contribution_active_fields) VALUES ('Double encoded', $1::jsonb)",
        [DOUBLE_ENCODED],
      );
      fs.writeFileSync(journalPath(), shipped);
    }

    const state = async () => ({
      accounts: (
        await client.query<{
          id: number;
          value: string | null;
          rate: string | null;
        }>(
          "SELECT id, employer_match_value AS value, employer_match_rate AS rate FROM contribution_accounts ORDER BY id",
        )
      ).rows,
      fields: (
        await client.query<{ f: unknown }>(
          "SELECT contribution_active_fields AS f FROM contribution_profiles WHERE name LIKE 'Invented %' ORDER BY id",
        )
      ).rows.map((r) => r.f),
      doubleEncoded: (
        await client.query<{ f: string }>(
          "SELECT contribution_active_fields::text AS f FROM contribution_profiles WHERE name = 'Double encoded'",
        )
      ).rows[0]?.f,
      recorded: Number(
        (
          await client.query<{ n: string }>(
            "SELECT count(*) AS n FROM drizzle.__drizzle_migrations",
          )
        ).rows[0]?.n,
      ),
    });

    const num = (v: string | null | undefined) =>
      v == null ? null : Number(v);

    async function expectConverted() {
      const s = await state();
      expect(s.accounts.map((a) => [a.id, num(a.value), num(a.rate)])).toEqual(
        CASES.map((c) => [
          c.id,
          num(c.value),
          // 0016 adds the column, so a rate stored before it can't exist.
          num(c.rate === undefined ? c.after : "0.5"),
        ]),
      );
      expect(s.fields).toEqual(PROFILE_CASES.map((c) => c.after));
      expect(s.doubleEncoded).toBe(DOUBLE_ENCODED);
      return s;
    }

    it("converts every case as a pending migration; a later start changes nothing", async () => {
      await installAt0015();
      expect(migrate()).toMatch(
        /"event":"migration_conversion".*"tag":"0016_v0102_match_rate"/,
      );
      const converted = await expectConverted();
      expect(converted.recorded).toBe(
        (
          JSON.parse(fs.readFileSync(journalPath(), "utf8")) as {
            entries: unknown[];
          }
        ).entries.length,
      );
      migrate();
      expect(await state()).toEqual(converted);
    });

    it.each([
      [
        "a recorded hash that no longer matches",
        "UPDATE drizzle.__drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)",
      ],
      ["a cleared journal", "DELETE FROM drizzle.__drizzle_migrations"],
    ])(
      "a squash replay (%s), twice over converted data, never divides again",
      async (_, damage) => {
        await installAt0015();
        migrate();
        const converted = await expectConverted();
        for (let run = 0; run < 2; run++) {
          await client.query(damage);
          migrate();
          expect(await state()).toEqual(converted);
        }
      },
    );

    it("a cleared journal at 0015 replays and converts", async () => {
      await installAt0015();
      await client.query("DELETE FROM drizzle.__drizzle_migrations");
      migrate();
      await expectConverted();
    });
  },
);
