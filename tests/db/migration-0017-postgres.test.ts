/**
 * Migration 0017 through the real migrator on PostgreSQL (db-migrate.ts's
 * runPostgres, run as the image runs it): an install at 0016 keeps each
 * percent match's rate alone, as the restore step gives it
 * (match-value-cases.ts), as a pending migration and in a squash replay,
 * twice over; M12: from 0015, 0016 then 0017 end where the restore ladder
 * ends. Only when TEST_DATABASE_URL names a throwaway database (CI's
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
import { MATCH_VALUE_TAG } from "@/lib/db/v0102-match-value";
import { transformBackupToCurrentSchema } from "@/lib/db/backup-transforms";
import { VALUE_ACCOUNTS, VALUE_PROFILES } from "./match-value-cases";
import { ACCOUNT_CASES, PROFILE_CASES } from "./match-rate-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const ACCOUNTS = VALUE_ACCOUNTS.filter((c) => !c.sqliteOnly);
const RATE_ACCOUNTS = ACCOUNT_CASES.filter((c) => !c.sqliteOnly);
const num = (v: unknown) => (v == null ? null : Number(v));
/** Numeric text as a number at any depth: PostgreSQL's "50.00" is "50". */
function numbers(v: unknown): unknown {
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Number(v);
  if (Array.isArray(v)) return v.map(numbers);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, numbers(x)]),
    );
  return v;
}

describe.skipIf(skipWithoutPostgres)(
  "migration 0017 through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-0017");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-0017-pg-"));
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

    /** An empty database migrated to just before `tag`, seeded; the journal
     *  is then the shipped one, so `tag` on is pending. */
    async function installBefore(tag: string, seed: () => Promise<void>) {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(
        path.join(REPO, "drizzle", "meta", "_journal.json"),
        "utf8",
      );
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(journal.entries.findIndex((e) => e.tag === tag));
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      await seed();
      fs.writeFileSync(journalPath(), shipped);
    }

    const profilesFrom = async (cases: readonly { before: unknown }[]) => {
      for (const [i, c] of cases.entries())
        await client.query(
          "INSERT INTO contribution_profiles (name, contribution_active_fields) VALUES ($1, $2::jsonb)",
          [`Invented ${i}`, JSON.stringify(c.before)],
        );
    };

    const installAt0016 = () =>
      installBefore(MATCH_VALUE_TAG, async () => {
        for (const c of ACCOUNTS)
          await client.query(
            `INSERT INTO contribution_accounts (id, account_type, tax_treatment, employer_match_type, employer_match_value, employer_match_rate)
             VALUES ($1, '401k', 'pre_tax', $2, $3, $4)`,
            [c.id, c.type, c.value, c.rate],
          );
        await profilesFrom(VALUE_PROFILES);
      });

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
    });

    async function expectCleared() {
      const s = await state();
      expect(s.accounts.map((a) => [a.id, num(a.value), num(a.rate)])).toEqual(
        ACCOUNTS.map((c) => [c.id, num(c.after), num(c.rate)]),
      );
      expect(s.fields).toEqual(VALUE_PROFILES.map((c) => c.after));
      return s;
    }

    it("clears every case as a pending migration; a later start changes nothing", async () => {
      await installAt0016();
      expect(migrate()).toMatch(
        /"event":"migration_conversion".*"tag":"0017_v0102_match_value"/,
      );
      const cleared = await expectCleared();
      migrate();
      expect(await state()).toEqual(cleared);
    });

    it.each([
      [
        "a recorded hash that no longer matches",
        "UPDATE drizzle.__drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)",
      ],
      ["a cleared journal", "DELETE FROM drizzle.__drizzle_migrations"],
    ])(
      "a squash replay (%s), twice over cleared data, clears nothing again",
      async (_, damage) => {
        await installAt0016();
        migrate();
        const cleared = await expectCleared();
        for (let run = 0; run < 2; run++) {
          await client.query(damage);
          migrate();
          expect(await state()).toEqual(cleared);
        }
      },
    );

    it("M12: from 0015, 0016 then 0017 end where the restore ladder ends", async () => {
      await installBefore(MATCH_RATE_TAG, async () => {
        for (const c of RATE_ACCOUNTS)
          await client.query(
            `INSERT INTO contribution_accounts (id, account_type, sub_type, tax_treatment, employer_match_type, employer_match_value)
             VALUES ($1, '401k', $2, 'pre_tax', $3, $4)`,
            [c.id, c.subType ?? null, c.type, c.value],
          );
        await profilesFrom(PROFILE_CASES);
      });
      migrate();
      const { tables } = transformBackupToCurrentSchema(
        {
          contribution_accounts: RATE_ACCOUNTS.map((c) => ({
            id: c.id,
            employer_match_type: c.type,
            employer_match_value: c.value,
          })),
          contribution_profiles: PROFILE_CASES.map((c, i) => ({
            id: i + 1,
            contribution_active_fields: structuredClone(c.before),
          })),
        },
        "0015_v0102_dead_data",
        MATCH_VALUE_TAG,
      );
      const restored = tables as Record<string, Record<string, unknown>[]>;
      const s = await state();
      expect(s.accounts.map((a) => [a.id, num(a.value), num(a.rate)])).toEqual(
        restored["contribution_accounts"]!.map((a) => [
          a["id"],
          num(a["employer_match_value"]),
          num(a["employer_match_rate"]),
        ]),
      );
      expect(numbers(s.fields)).toEqual(
        numbers(
          restored["contribution_profiles"]!.map(
            (p) => p["contribution_active_fields"],
          ),
        ),
      );
      migrate();
      expect(await state()).toEqual(s);
    });
  },
);
