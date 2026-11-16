/**
 * The spouse-link tag through the real migrator on PostgreSQL (db-migrate.ts's
 * runPostgres, run as the image runs it): an install at the tag before it
 * gets the column with no link on any saved row, as a pending migration and
 * in a squash replay, twice over; a pair saved since survives every replay;
 * deleting a spouse unlinks the other. Only when TEST_DATABASE_URL names a
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

const REPO = process.cwd();
const TSX = path.join(REPO, "node_modules", ".bin", "tsx");
const TAG = "0024_v0111_spouse_link";
/** Three invented adults. */
const IDS = [81, 82, 83];

describe.skipIf(skipWithoutPostgres)(
  "the spouse-link tag through the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-spouse-link");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(
        path.join(tmpdir(), "ledgr-migration-spouse-link-pg-"),
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

    /** An empty database migrated to just before the tag, holding three
     *  people; the journal is then the shipped one. */
    async function installBefore() {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(
        path.join(REPO, "drizzle", "meta", "_journal.json"),
        "utf8",
      );
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(journal.entries.findIndex((e) => e.tag === TAG));
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      migrate();
      for (const id of IDS)
        await client.query(
          "INSERT INTO people (id, name, date_of_birth, is_primary_user) VALUES ($1, $2, '1970-01-01', $3)",
          [id, `Invented ${id}`, id === IDS[0]],
        );
      fs.writeFileSync(journalPath(), shipped);
    }

    /** The first two people linked, as the people writer saves a pair. */
    async function linkPair() {
      await client.query(
        "UPDATE people SET spouse_person_id = $1 WHERE id = $2",
        [IDS[1], IDS[0]],
      );
      await client.query(
        "UPDATE people SET spouse_person_id = $1 WHERE id = $2",
        [IDS[0], IDS[1]],
      );
    }

    const links = async () =>
      (
        await client.query<{ s: number | null }>(
          "SELECT spouse_person_id AS s FROM people ORDER BY id",
        )
      ).rows.map((r) => r.s);

    it("adds the column with no link on any saved row, and a later start writes nothing", async () => {
      await installBefore();
      migrate();
      expect(await links()).toEqual([null, null, null]);
      migrate();
      expect(await links()).toEqual([null, null, null]);
    });

    it("a squash replay (a cleared journal) twice over keeps a saved pair", async () => {
      await installBefore();
      migrate();
      await linkPair();
      for (let run = 0; run < 2; run++) {
        await client.query("DELETE FROM drizzle.__drizzle_migrations");
        migrate();
        expect(await links()).toEqual([IDS[1], IDS[0], null]);
      }
    });

    it("deleting a spouse unlinks the other", async () => {
      await installBefore();
      migrate();
      await linkPair();
      await client.query("DELETE FROM people WHERE id = $1", [IDS[1]]);
      expect(await links()).toEqual([null, null]);
    });
  },
);
