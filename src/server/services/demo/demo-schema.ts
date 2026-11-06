/** A demo profile's Postgres schema: built from public's table structure,
 *  stamped with the migrations it was built for, then given reference data
 *  and the profile's seed. */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import {
  DEMO_SCHEMA_MARKER_PREFIX,
  DEMO_SHARED_TABLES,
  MIGRATION_STAMP_SQL,
} from "@/lib/db/demo-schema-marker";
import { applyReferenceData } from "@/lib/db/reference-data";
import * as schema from "@/lib/db/schema";
import { pool, type db as appDb } from "@/lib/db";
import { serializeQueries } from "@/lib/db/serial-client";
import type { DemoProfile } from "@/lib/demo";
import { seedProfile } from "@/server/services/demo/demo-seed";

/**
 * Escape a SQL identifier (schema/table/sequence name) to prevent injection.
 * Double-quotes the name and escapes any embedded double-quotes.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Maximum number of demo schemas allowed (DoS prevention). */
const MAX_DEMO_SCHEMAS = 10;

/** Builds (or rebuilds) the demo schema for `slug`, seeds `profile` into it
 *  and returns the schema's name. */
export async function buildDemoSchema(
  slug: string,
  profile: DemoProfile,
): Promise<string> {
  const schemaName = `demo_${slug.replace(/-/g, "_")}`;
  const quotedSchema = quoteIdent(schemaName);

  // Enforce max demo schema count to prevent DoS
  const client = await pool.connect();
  const serial = serializeQueries(client);
  try {
    const schemaCount = await client.query(
      `SELECT count(*)::int AS cnt FROM information_schema.schemata WHERE schema_name LIKE 'demo\\_%'`,
    );
    if ((schemaCount.rows[0]?.cnt ?? 0) >= MAX_DEMO_SCHEMAS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Maximum demo schemas (${MAX_DEMO_SCHEMAS}) reached. Deactivate an existing profile first.`,
      });
    }

    const { drizzle } = await import("drizzle-orm/node-postgres");
    const conn = serial.client;
    // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
    const cdb = drizzle(conn, { schema }) as unknown as typeof appDb;

    // Create schema if not exists
    await cdb.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`));

    // Copy table structure from public schema into demo schema
    const tables = await cdb.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );

    for (const { tablename } of tables.rows) {
      // Install-wide tables are read from public (search_path).
      if (DEMO_SHARED_TABLES.includes(tablename)) continue;
      const quotedTable = quoteIdent(tablename);
      await cdb.execute(
        sql.raw(`DROP TABLE IF EXISTS ${quotedSchema}.${quotedTable} CASCADE`),
      );
      await cdb.execute(
        sql.raw(
          `CREATE TABLE ${quotedSchema}.${quotedTable} (LIKE public.${quotedTable} INCLUDING ALL)`,
        ),
      );
    }

    // Copy sequences/serial defaults — reset all serial sequences
    const sequences = await cdb.execute<{ sequence_name: string }>(
      sql`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`,
    );
    for (const { sequence_name } of sequences.rows) {
      const quotedSeq = quoteIdent(sequence_name);
      await cdb.execute(
        sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${quotedSchema}.${quotedSeq}`),
      );
      await cdb.execute(
        sql.raw(`ALTER SEQUENCE ${quotedSchema}.${quotedSeq} RESTART WITH 1`),
      );
    }

    // Stamp the schema with the migrations it was built for, so a
    // later upgrade can tell it's stale (see demo-schema-marker.ts).
    const migrations = (await client.query(MIGRATION_STAMP_SQL)) as {
      rows: { stamp: string }[];
    };
    const stamp = migrations.rows[0]?.stamp ?? "";
    // "<count>:<hex hash>" — interpolated, so check its shape.
    if (!/^\d+:[0-9a-f]*$/.test(stamp))
      throw new Error(`Unexpected migration stamp: ${stamp}`);
    await client.query(
      `COMMENT ON SCHEMA ${quotedSchema} IS '${DEMO_SCHEMA_MARKER_PREFIX}${stamp}'`,
    );

    // Switch search_path and seed demo data + reference tables
    await client.query(`SET search_path TO ${quotedSchema}, public`);

    // Reference data (limits, brackets, LTCG / IRMAA, poverty lines,
    // tax-data revisions) from the shipped tax-data file and any newer
    // approved update — never the household's own rows.
    await applyReferenceData(cdb);

    await seedProfile(cdb, profile);
  } finally {
    // Queries still queued run on the demo schema before the reset.
    await serial.close();
    await client.query("SET search_path TO public");
    client.release();
  }

  return schemaName;
}
