/** Demo router for creating, listing, activating, and destroying isolated demo schemas seeded with predefined financial profiles. */
import {
  DEMO_SCHEMA_MARKER_PREFIX,
  DEMO_SHARED_TABLES,
  MIGRATION_STAMP_SQL,
} from "@/lib/db/demo-schema-marker";
import { applyReferenceData } from "@/lib/db/reference-data";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { DEMO_PROFILES, getDemoProfileList } from "@/lib/demo";
import * as schema from "@/lib/db/schema";
import { db as appDb, pool } from "@/lib/db";
import { serializeQueries } from "@/lib/db/serial-client";
import { isPostgres } from "@/lib/db/dialect";
import { seedProfile } from "@/server/services/demo/demo-seed";

/** Safe slug pattern — lowercase alphanumeric + hyphens, 1-40 chars. */
const DEMO_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const MAX_SLUG_LENGTH = 40;

const demoSlugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(
    DEMO_SLUG_REGEX,
    "Slug must be lowercase alphanumeric with hyphens only",
  );

/**
 * Escape a SQL identifier (schema/table/sequence name) to prevent injection.
 * Double-quotes the name and escapes any embedded double-quotes.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Maximum number of demo schemas allowed (DoS prevention). */
const MAX_DEMO_SCHEMAS = 10;

export const demoRouter = createTRPCRouter({
  /** List available demo profiles. */
  listProfiles: protectedProcedure.query(() => {
    return {
      profiles: getDemoProfileList(),
      isDemoOnly: process.env.DEMO_ONLY === "true",
    };
  }),

  /** Activate a demo profile — creates schema, seeds data, returns success.
   *  Uses protectedProcedure (not a domain procedure) intentionally: writes
   *  go to an isolated per-user demo schema, never to shared application
   *  data, and must remain callable in DEMO_ONLY mode. See RULES.md
   *  § Permission & Security Gates rule 3 exception. */
  activateProfile: protectedProcedure
    .input(z.object({ slug: demoSlugSchema }))
    .mutation(async ({ input }) => {
      if (!isPostgres()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Demo mode requires PostgreSQL (uses PG schemas for isolation)",
        });
      }

      const profile = DEMO_PROFILES[input.slug];
      if (!profile) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown demo profile: ${input.slug}`,
        });
      }

      const schemaName = `demo_${input.slug.replace(/-/g, "_")}`;
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
        await cdb.execute(
          sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`),
        );

        // Copy table structure from public schema into demo schema
        const tables = await cdb.execute<{ tablename: string }>(
          sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
        );

        for (const { tablename } of tables.rows) {
          // Install-wide tables are read from public (search_path).
          if (DEMO_SHARED_TABLES.includes(tablename)) continue;
          const quotedTable = quoteIdent(tablename);
          await cdb.execute(
            sql.raw(
              `DROP TABLE IF EXISTS ${quotedSchema}.${quotedTable} CASCADE`,
            ),
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
            sql.raw(
              `CREATE SEQUENCE IF NOT EXISTS ${quotedSchema}.${quotedSeq}`,
            ),
          );
          await cdb.execute(
            sql.raw(
              `ALTER SEQUENCE ${quotedSchema}.${quotedSeq} RESTART WITH 1`,
            ),
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

      // Set HttpOnly cookie server-side so it's not accessible to JavaScript
      const cookieStore = await cookies();
      cookieStore.set("demo_active_profile", input.slug, {
        path: "/",
        maxAge: 86400,
        sameSite: "strict",
        httpOnly: true,
      });

      return { ok: true, slug: input.slug, schemaName };
    }),

  /** Deactivate demo mode — clear the HttpOnly cookie server-side.
   *  Uses protectedProcedure (not a domain procedure) intentionally: this
   *  mutates session/cookie state, not application data, and must remain
   *  callable in DEMO_ONLY mode where the demoOnlyGuard exempts demo.*
   *  paths. See RULES.md § Permission & Security Gates rule 3 exception. */
  deactivateDemo: protectedProcedure.mutation(async () => {
    const cookieStore = await cookies();
    cookieStore.set("demo_active_profile", "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
    });
    return { ok: true };
  }),
});
