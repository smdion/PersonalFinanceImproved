/**
 * A converter's refusal in the real PostgreSQL migrator (runPostgres, in
 * this process so the registry can hold invented converters): the tag's
 * earlier converter and every pending tag roll back, nothing is recorded,
 * and the message names ids, never a value. Only when TEST_DATABASE_URL
 * names a throwaway database (CI's PostgreSQL job): it drops its schemas.
 */
// First: its mocks must be in place before any app module loads.
import {
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { DataConverter } from "@/lib/db/migrate/migration-converters";
import { MigrationRefusal } from "@/lib/db/migrate/converter-refusal";
import { over, renames } from "./converter-list-cases";

const hook = vi.hoisted(() => ({
  converters: {} as Record<string, DataConverter | DataConverter[]>,
}));
vi.mock("@/lib/db/migrate/migration-converters", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MIGRATION_CONVERTERS: hook.converters,
}));

import { runPostgres } from "../../db-migrate";

const REPO = process.cwd();
const TAG = "0015_v0102_dead_data";
const SECRET = "invented-secret-value";

const refuses = over((rows) => {
  const ids = rows.filter((r) => r.key.startsWith("retired_")).map((r) => r.id);
  if (ids.length > 0)
    throw new MigrationRefusal({
      problem: "Invented rows can't be converted",
      refused: { app_settings: ids },
      fix: "Change them in the previous version, then upgrade again.",
    });
  return { updates: [] };
});

describe.skipIf(skipWithoutPostgres)(
  "a refusal in the real migrator (PostgreSQL)",
  () => {
    let testDb: ReturnType<typeof pointAtTestDatabase>;
    let client: pg.Client;
    let dir: string;

    beforeAll(async () => {
      testDb = pointAtTestDatabase("migration-refusal");
      client = new pg.Client({ connectionString: testDb.url });
      await client.connect();
      dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-refusal-pg-"));
      fs.cpSync(path.join(REPO, "drizzle"), path.join(dir, "drizzle"), {
        recursive: true,
      });
      for (const data of ["tax-data", "reference-data"])
        fs.symlinkSync(path.join(REPO, data), path.join(dir, data));
      process.chdir(dir);
    });
    afterAll(async () => {
      process.chdir(REPO);
      if (client) await dropAllSchemas(client);
      await client?.end();
      testDb?.restore();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    const journalPath = () =>
      path.join(dir, "drizzle", "meta", "_journal.json");

    const state = async () => ({
      settings: (
        await client.query(
          "SELECT key, value FROM app_settings WHERE key <> 'pre_upgrade_backup' ORDER BY key",
        )
      ).rows,
      recorded: (
        await client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
        )
      ).rows[0]!.n,
      cols: (
        await client.query<{ name: string }>(
          "SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'holding_observations'",
        )
      ).rows.map((r) => r.name),
    });

    it("rolls back the tag's earlier converter and every pending tag", async () => {
      await dropAllSchemas(client);
      const shipped = fs.readFileSync(journalPath(), "utf8");
      const journal = JSON.parse(shipped) as { entries: { tag: string }[] };
      journal.entries.splice(journal.entries.findIndex((e) => e.tag === TAG));
      fs.writeFileSync(journalPath(), JSON.stringify(journal, null, 2));
      await runPostgres();
      await client.query(
        "INSERT INTO app_settings (key, value) VALUES ('invented_a', $1::jsonb), ('retired_b', $1::jsonb)",
        [JSON.stringify(SECRET)],
      );
      fs.writeFileSync(journalPath(), shipped);
      const before = await state();

      hook.converters[TAG] = [renames, refuses];
      const run = runPostgres();
      await expect(run).rejects.toThrow(MigrationRefusal);
      await expect(run).rejects.not.toThrow(new RegExp(SECRET));
      const after = await state();
      expect(after).toEqual(before);
      expect(after.recorded).toBe(journal.entries.length);
      expect(after.cols).toContain("performance_account_id"); // 0015 not applied
    });
  },
);
