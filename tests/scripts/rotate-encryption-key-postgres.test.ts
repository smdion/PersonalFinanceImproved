/**
 * `scripts/rotate-encryption-key.ts` on PostgreSQL (the cases are in
 * ./rotate-encryption-key-cases, shared with SQLite).
 *
 * Runs only when TEST_DATABASE_URL names a throwaway database (its name
 * must end in `_test`): each case drops and rebuilds its schemas. CI runs
 * it in the PostgreSQL job.
 */
// First: its mocks must be in place before any app module loads.
import {
  dropAllSchemas,
  pointAtTestDatabase,
  skipWithoutPostgres,
} from "../routers/setup-postgres";
import { describe, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrator } from "../routers/fresh-install-cases";
import { rotatePostgres } from "../../scripts/rotate-encryption-key";
import { keyRotationCases } from "./rotate-encryption-key-cases";

describe.skipIf(skipWithoutPostgres)(
  "ENCRYPTION_KEY rotation (PostgreSQL)",
  () => {
    let restoreEnv: () => void = () => {};
    let admin: pg.Client;

    beforeAll(async () => {
      const testDatabase = pointAtTestDatabase("key-rotation-pg");
      restoreEnv = testDatabase.restore;
      admin = new pg.Client({ connectionString: testDatabase.url });
      await admin.connect();
    });

    afterAll(async () => {
      await admin?.end();
      restoreEnv();
    });

    // A PostgreSQL version holds each row as SELECT * returns it: config is jsonb.
    keyRotationCases(
      "PostgreSQL",
      async () => {
        await dropAllSchemas(admin);
        runMigrator();
        return {
          addConnection: async (id, service, config) => {
            await admin.query(
              "INSERT INTO api_connections (id, service, config) VALUES ($1, $2, $3::jsonb)",
              [id, service, JSON.stringify(config)],
            );
          },
          addVersion: async (versionId, rows) => {
            await admin.query(
              "INSERT INTO state_versions (id, name, version_type, schema_version, table_count, total_rows, created_by) VALUES ($1, 'Invented', 'manual', 'test', 1, $2, 'test')",
              [versionId, rows.length],
            );
            await admin.query(
              "INSERT INTO state_version_tables (version_id, table_name, row_count, data) VALUES ($1, 'api_connections', $2, $3::jsonb)",
              [versionId, rows.length, JSON.stringify(rows)],
            );
          },
          configs: async () => {
            const { rows } = await admin.query<{ id: number; config: unknown }>(
              "SELECT id, config FROM api_connections",
            );
            return Object.fromEntries(rows.map((r) => [r.id, r.config]));
          },
          versionRows: async () => {
            const { rows } = await admin.query<{ data: { config: unknown }[] }>(
              "SELECT data FROM state_version_tables WHERE table_name = 'api_connections' ORDER BY id",
            );
            return rows.flatMap((r) => r.data);
          },
          rotate: async (keys, dryRun) => {
            const client = new pg.Client({
              connectionString: process.env.DATABASE_URL,
            });
            await client.connect();
            try {
              return await rotatePostgres(client, keys, dryRun);
            } finally {
              await client.end();
            }
          },
        };
      },
      (envelope) => envelope,
    );
  },
);
