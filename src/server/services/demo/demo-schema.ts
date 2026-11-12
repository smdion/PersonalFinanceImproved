/** A demo profile's Postgres schema: built from public's table structure,
 *  stamped with the migrations it was built for, then given reference data
 *  and the profile's seed. */
import { sql } from "drizzle-orm";
import {
  DEMO_SCHEMA_STATE_SQL,
  DEMO_SHARED_TABLES,
  MIGRATION_STAMP_SQL,
  demoSchemaMarker,
  demoSchemaStateParams,
} from "@/lib/db/migrate/demo-schema-marker";
import { applyReferenceData } from "@/lib/db/migrate/reference-data";
import * as schema from "@/lib/db/schema";
import { pool, type db as appDb } from "@/lib/db";
import { serializeQueries } from "@/lib/db/serial-client";
import {
  demoSchemaName,
  getDemoProfile,
  type DemoProfileSlug,
} from "@/lib/demo";
import { seedProfile } from "@/server/services/demo/demo-seed";
import { lockForTransaction } from "@/server/data/lock-row";
import { calendarDateOf } from "@/lib/utils/calendar-date";

/** DEMO_SCHEMA_STATE_SQL's row. */
type DemoSchemaState = { complete: boolean | null; seeded_on: string };

/**
 * Escape a SQL identifier (schema/table/sequence name) to prevent injection.
 * Double-quotes the name and escapes any embedded double-quotes.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Builds (or rebuilds) the demo schema for profile `slug`, seeds the
 *  profile into it and returns the schema's name. Refuses a slug that isn't
 *  a profile's before any SQL runs, whatever its caller checked. */
export async function buildDemoSchema(
  slug: DemoProfileSlug,
  seededOn: Date,
): Promise<string> {
  const profile = getDemoProfile(slug);
  const schemaName = demoSchemaName(slug);
  if (!profile || !schemaName)
    throw new Error(`Not a demo profile: ${JSON.stringify(slug)}`);
  const quotedSchema = quoteIdent(schemaName);

  const client = await pool.connect();
  const serial = serializeQueries(client);
  try {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    // eslint-disable-next-line no-restricted-syntax -- Drizzle ORM type limitation
    const cdb = drizzle(serial.client, { schema }) as unknown as typeof appDb;
    // One transaction under the schema's lock: a reader sees the old schema
    // or the whole new one, and two builds of one profile run in turn.
    await cdb.transaction(async (tx) => {
      const run = (text: string) => tx.execute(sql.raw(text));
      await lockForTransaction(tx, `demo-schema-build:${schemaName}`);
      // A demo-only server's visitors share each profile: one complete and
      // seeded today is kept. A household install's activate resets it.
      if (process.env.DEMO_ONLY === "true") {
        const { rows }: { rows: DemoSchemaState[] } = await serial.client.query(
          DEMO_SCHEMA_STATE_SQL,
          demoSchemaStateParams(schemaName),
        );
        const [state] = rows;
        if (state?.complete && state.seeded_on === calendarDateOf(seededOn))
          return;
      }
      await run(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);

      // Copy table structure from public schema into demo schema
      const tables = await tx.execute<{ tablename: string }>(
        sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      for (const { tablename } of tables.rows) {
        // Install-wide tables are read from public (search_path).
        if (DEMO_SHARED_TABLES.includes(tablename)) continue;
        const quotedTable = quoteIdent(tablename);
        await run(
          `DROP TABLE IF EXISTS ${quotedSchema}.${quotedTable} CASCADE`,
        );
        await run(
          `CREATE TABLE ${quotedSchema}.${quotedTable} (LIKE public.${quotedTable} INCLUDING ALL)`,
        );
      }

      // Copy sequences/serial defaults — reset all serial sequences
      const sequences = await tx.execute<{ sequence_name: string }>(
        sql`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`,
      );
      for (const { sequence_name } of sequences.rows) {
        const quotedSeq = quoteIdent(sequence_name);
        await run(`CREATE SEQUENCE IF NOT EXISTS ${quotedSchema}.${quotedSeq}`);
        await run(`ALTER SEQUENCE ${quotedSchema}.${quotedSeq} RESTART WITH 1`);
      }

      // Switch search_path and seed demo data + reference tables
      await run(`SET search_path TO ${quotedSchema}, public`);

      // Reference data (limits, brackets, LTCG / IRMAA, poverty lines,
      // tax-data revisions) from the shipped tax-data file and any newer
      // approved update — never the household's own rows.
      await applyReferenceData(tx);
      await seedProfile(tx, profile, seededOn);

      // Stamped last, with the migrations it was built for: a schema the
      // demo middleware calls complete is fully seeded (demo-schema-marker.ts).
      const migrations = await tx.execute<{ stamp: string }>(
        sql.raw(MIGRATION_STAMP_SQL),
      );
      const stamp = migrations.rows[0]?.stamp ?? "";
      // "<count>:<hex hash>" — interpolated, so check its shape.
      if (!/^\d+:[0-9a-f]*$/.test(stamp))
        throw new Error(`Unexpected migration stamp: ${stamp}`);
      const marker = demoSchemaMarker(stamp, calendarDateOf(seededOn));
      await run(`COMMENT ON SCHEMA ${quotedSchema} IS '${marker}'`);
    });
  } finally {
    // Queries still queued run on the demo schema before the reset.
    await serial.close();
    await client.query("SET search_path TO public");
    client.release();
  }

  return schemaName;
}
