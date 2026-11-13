/**
 * The Roth-overlay tag through the real migrator on PostgreSQL (db-migrate.ts's
 * runPostgres, run as the image runs it): an install at the tag before it
 * keeps the Roth bracket overlay on for every saved row (an empty target at
 * the 12% it read), as a pending migration and in a squash replay, twice
 * over; a row saved since with the overlay off stays off; run twice more over
 * its own output, the converter writes nothing. Only when TEST_DATABASE_URL
 * names a throwaway database (CI's PostgreSQL job): it drops the database's
 * schemas.
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
  ROTH_OVERLAY_CONVERTER,
  ROTH_OVERLAY_TAG,
} from "@/lib/db/migrate/v0111-roth-overlay";
import { expectPgReplaySafe } from "./converter-replay";
import { PERSON, ROWS } from "./roth-overlay-cases";

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const BEFORE = ROWS.filter((c) => c.overlay === undefined);
const SINCE = ROWS.filter((c) => c.overlay !== undefined);

describe.skipIf(skipWithoutPostgres)(
  "the Roth-overlay tag through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-roth-overlay");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(
        path.join(tmpdir(), "ledgr-migration-roth-overlay-pg-"),
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

    const insertRow = (id: number, target: string | null) =>
      client.query(
        "INSERT INTO retirement_settings (id, person_id, retirement_age, end_age, return_after_retirement, annual_inflation, salary_annual_increase, roth_bracket_target) VALUES ($1, $2, 60, 95, '0.05', '0.03', '0.03', $3)",
        [id, PERSON.id, target],
      );

    /** An empty database migrated to just before the tag, holding the rows
     *  saved then; the journal is then the shipped one. */
    async function installBefore() {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(
        path.join(REPO, "drizzle", "meta", "_journal.json"),
        "utf8",
      );
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(
        journal.entries.findIndex((e) => e.tag === ROTH_OVERLAY_TAG),
      );
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      await client.query(
        "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES ($1, $2, '1980-01-01', true)",
        [PERSON.id, PERSON.name],
      );
      for (const c of BEFORE) await insertRow(c.id, c.target);
      fs.writeFileSync(journalPath(), shipped);
    }

    /** Rows saved after the tag, each with its switch, as writers save them. */
    async function saveSince() {
      for (const c of SINCE) {
        await insertRow(c.id, c.target);
        await client.query(
          "UPDATE retirement_settings SET roth_bracket_overlay = $1 WHERE id = $2",
          [c.overlay, c.id],
        );
      }
    }

    const rows = async () =>
      (
        await client.query<{ target: string; overlay: boolean | null }>(
          "SELECT roth_bracket_target AS target, roth_bracket_overlay AS overlay FROM retirement_settings WHERE person_id = $1 ORDER BY id",
          [PERSON.id],
        )
      ).rows.map((r) => ({ target: Number(r.target), overlay: r.overlay }));

    it("converts as a pending migration, and a later start writes nothing", async () => {
      await installBefore();
      migrate();
      expect(await rows()).toEqual(BEFORE.map((c) => c.after));
      migrate();
      expect(await rows()).toEqual(BEFORE.map((c) => c.after));
    });

    it("a squash replay (a cleared journal) twice over keeps every switch, an off one included", async () => {
      await installBefore();
      migrate();
      await saveSince();
      for (let run = 0; run < 2; run++) {
        await client.query("DELETE FROM drizzle.__drizzle_migrations");
        migrate();
        expect(await rows()).toEqual(ROWS.map((c) => c.after));
      }
    });

    it("run twice more over its own output, it writes nothing", async () => {
      await installBefore();
      migrate();
      await saveSince();
      await expectPgReplaySafe(client, ROTH_OVERLAY_CONVERTER);
      expect(await rows()).toEqual(ROWS.map((c) => c.after));
    });
  },
);
