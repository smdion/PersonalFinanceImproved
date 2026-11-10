/**
 * The v0.10.6 money tag through the real migrator on PostgreSQL
 * (db-migrate.ts's runPostgres, run as the image runs it): an install at
 * the tag before it gets the per-person retirement rows of
 * retirement-people-cases.ts, as a pending migration and in a squash
 * replay, twice over; every reader reads each person as before; run twice
 * more over its own output, the converters write nothing; every budget
 * item's amounts get one number per column (budget-amounts-cases.ts). Only when
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
  MONEY_TAG,
  RETIREMENT_PEOPLE_CONVERTER,
} from "@/lib/db/migrate/v0106-retirement-people";
import { BUDGET_AMOUNTS_CONVERTER } from "@/lib/db/migrate/v0106-budget-amounts";
import { expectPgReplaySafe } from "./converter-replay";
import {
  ITEMS,
  PROFILES as BUDGETS,
  asReadBeforeTag,
  reads as budgetReads,
} from "./budget-amounts-cases";
import {
  ADDED,
  HELD,
  PEOPLE,
  PROFILES,
  SETTINGS,
  reads,
  settingsBeforeTag,
  type PersonRow,
  type Settings,
} from "./retirement-people-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const PERSON_COLUMNS =
  "id, profile_id, person_id, retirement_age, end_age, social_security_monthly, social_security_pia, ss_start_age, rule_of_55_override, salary_annual_increase";
/** PostgreSQL's decimal text ("2010.00") as the cases' plain text. */
const text = (v: string | null) => (v == null ? null : String(Number(v)));

describe.skipIf(skipWithoutPostgres)(
  "the money tag through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-money");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-migration-money-pg-"));
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

    /** An empty database migrated to just before the money tag, holding
     *  the cases' rows; the journal is then the shipped one. */
    async function installBefore() {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(
        path.join(REPO, "drizzle", "meta", "_journal.json"),
        "utf8",
      );
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(
        journal.entries.findIndex((e) => e.tag === MONEY_TAG),
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      for (const p of PEOPLE)
        await client.query(
          "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES ($1, $2, '1980-01-01', $3)",
          [p.id, p.name, p.is_primary_user],
        );
      for (const p of PROFILES)
        await client.query(
          "INSERT INTO retirement_profiles (id, name) VALUES ($1, $2)",
          [p.id, p.name],
        );
      for (const s of SETTINGS)
        await client.query(
          `INSERT INTO retirement_settings (id, person_id, profile_id, retirement_age, end_age, return_after_retirement, annual_inflation, salary_annual_increase, social_security_monthly, ss_start_age, rule_of_55_override)
           VALUES ($1, $2, $3, $4, $5, '0.05', '0.03', $6, $7, $8, $9)`,
          [
            s.id,
            s.person_id,
            s.profile_id,
            s.retirement_age,
            s.end_age,
            s.salary_annual_increase,
            s.social_security_monthly,
            s.ss_start_age,
            s.rule_of_55_override,
          ],
        );
      for (const r of HELD)
        await client.query(
          `INSERT INTO retirement_profile_people (${PERSON_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            r.id,
            r.profile_id,
            r.person_id,
            r.retirement_age,
            r.end_age,
            r.social_security_monthly,
            r.social_security_pia,
            r.ss_start_age,
            r.rule_of_55_override,
            r.salary_annual_increase,
          ],
        );
      for (const b of BUDGETS)
        await client.query(
          "INSERT INTO budget_profiles (id, name, column_labels) VALUES ($1, $2, $3::jsonb)",
          [b.id, b.name, JSON.stringify(b.column_labels)],
        );
      for (const c of ITEMS)
        await client.query(
          "INSERT INTO budget_items (id, profile_id, category, subcategory, amounts) VALUES ($1, $2, 'Invented', $3, $4::jsonb)",
          [c.id, c.profile_id, `Item ${c.id}`, JSON.stringify(c.before)],
        );
      // Explicit ids leave the sequence behind; the app's own restore resets it.
      await client.query(
        "SELECT setval(pg_get_serial_sequence('retirement_profile_people', 'id'), (SELECT max(id) FROM retirement_profile_people))",
      );
      fs.writeFileSync(journalPath(), shipped);
    }

    /** The per-person rows, and what every reader reads from them. */
    const state = async (
      read = reads,
      budgetView: typeof asReadBeforeTag = (i) => [...i],
    ) => {
      const rows = (
        await client.query<PersonRow>(
          `SELECT ${PERSON_COLUMNS} FROM retirement_profile_people ORDER BY id`,
        )
      ).rows.map((r) => ({
        ...r,
        social_security_monthly: text(r.social_security_monthly),
        social_security_pia: text(r.social_security_pia),
      }));
      const tables = {
        people: (
          await client.query<(typeof PEOPLE)[number]>(
            "SELECT * FROM people ORDER BY id",
          )
        ).rows,
        retirement_settings: (
          await client.query<Settings>(
            "SELECT * FROM retirement_settings ORDER BY id",
          )
        ).rows,
        retirement_profile_people: rows,
      };
      const items = (
        await client.query<{ profile_id: number; amounts: unknown[] }>(
          "SELECT profile_id, amounts FROM budget_items ORDER BY id",
        )
      ).rows;
      return {
        rows,
        reads: read(tables),
        amounts: items.map((i) => i.amounts),
        budget: budgetReads(budgetView(items)),
      };
    };

    const expected = [
      ...HELD,
      ...ADDED.map((r, i) => ({ ...r, id: HELD.length + 1 + i })),
    ];

    it("adds the rows as a pending migration, reads as before, and a later start adds none", async () => {
      await installBefore();
      const before = await state(
        (t) => reads(t, settingsBeforeTag),
        asReadBeforeTag,
      );
      expect(migrate()).toMatch(
        new RegExp(`"event":"migration_conversion".*"tag":"${MONEY_TAG}"`),
      );
      const first = await state();
      expect(first.rows).toEqual(expected);
      expect(first.reads).toEqual(before.reads);
      expect(first.amounts).toEqual(ITEMS.map((c) => c.after));
      expect(first.budget).toEqual(before.budget);
      migrate();
      expect(await state()).toEqual(first);
    });

    it.each([
      [
        "a recorded hash that no longer matches",
        "UPDATE drizzle.__drizzle_migrations SET hash = 'not-a-hash' WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)",
      ],
      ["a cleared journal", "DELETE FROM drizzle.__drizzle_migrations"],
    ])(
      "a squash replay (%s), twice over, adds nothing again",
      async (_, damage) => {
        await installBefore();
        migrate();
        const added = await state();
        expect(added.rows).toEqual(expected);
        expect(added.amounts).toEqual(ITEMS.map((c) => c.after));
        for (let run = 0; run < 2; run++) {
          await client.query(damage);
          migrate();
          expect(await state()).toEqual(added);
        }
      },
    );

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrate();
      await expectPgReplaySafe(client, [
        RETIREMENT_PEOPLE_CONVERTER,
        BUDGET_AMOUNTS_CONVERTER,
      ]);
    });
  },
);
