/**
 * Demo schemas (copies of public tables) are stamped "<count>:<last hash>" of the migrations
 * applied when built, then their seeded day; a stamp mismatch is stale (the hash catches a squash
 * resetting the count). The migrator drops stale ones on start and demoSchemaMiddleware refuses them.
 */
export const DEMO_SCHEMA_MARKER_PREFIX = "ledgr-migrations:";
/** Between the migration stamp and the seeded day in a marker. */
const SEEDED_ON = " seeded:";

/** The comment a demo schema is built with: its migration stamp and the
 *  household day it was seeded (YYYY-MM-DD; the migrator imports nothing). */
export function demoSchemaMarker(stamp: string, seededOn: string): string {
  return `${DEMO_SCHEMA_MARKER_PREFIX}${stamp}${SEEDED_ON}${seededOn}`;
}

/** The database's migration stamp, "<count>:<last hash>", as recorded by
 *  the database itself (a scalar text subquery). */
export const MIGRATION_STAMP_SUBQUERY =
  "(SELECT count(*)::text || ':' || coalesce((SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1), '') FROM drizzle.__drizzle_migrations)";

/** The same stamp as a query returning one row `{ stamp }`. */
export const MIGRATION_STAMP_SQL = `SELECT ${MIGRATION_STAMP_SUBQUERY} AS stamp`;

/** SQL: a marker's migration stamp part ("<prefix><count>:<hash>"; all of a
 *  marker with no seeded day), for comparing with the database's stamp. */
export function markerStampSql(marker: string): string {
  return `split_part(${marker}, '${SEEDED_ON}', 1)`;
}

const MARKER = "obj_description(to_regnamespace($1)::oid, 'pg_namespace')";

/** One row `{ complete, seeded_on }` for demo schema $1 (params: demoSchemaStateParams):
 *  complete when it has every public table but the shared ones and its stamp matches
 *  today's migrations; seeded_on is its marker's day ('' when it has none). */
export const DEMO_SCHEMA_STATE_SQL = `SELECT to_regnamespace($1) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_tables p WHERE p.schemaname = 'public'
      AND p.tablename <> ALL($3::text[])
      AND NOT EXISTS (SELECT 1 FROM pg_tables d
        WHERE d.schemaname = $1 AND d.tablename = p.tablename)
  ) AND ${markerStampSql(MARKER)} = $2 || ${MIGRATION_STAMP_SUBQUERY} AS complete,
  coalesce(split_part(${MARKER}, '${SEEDED_ON}', 2), '') AS seeded_on`;

/** Install-wide tables a demo schema reads from public (search_path "demo_x, public")
 *  instead of copying; the demo builder and demoSchemaMiddleware share this list. */
export const DEMO_SHARED_TABLES: readonly string[] = ["tax_data_updates"];

/** DEMO_SCHEMA_STATE_SQL's parameters for one schema. */
export function demoSchemaStateParams(schemaName: string): unknown[] {
  return [schemaName, DEMO_SCHEMA_MARKER_PREFIX, DEMO_SHARED_TABLES];
}
