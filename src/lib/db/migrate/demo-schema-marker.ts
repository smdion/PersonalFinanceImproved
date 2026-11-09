/**
 * Demo schemas (copies of public tables) are stamped "<count>:<last hash>" of the migrations
 * applied when built; a mismatch is stale (the hash catches a squash resetting the count). The
 * migrator drops stale ones on start and demoSchemaMiddleware refuses them.
 */
export const DEMO_SCHEMA_MARKER_PREFIX = "ledgr-migrations:";

/** The database's migration stamp, "<count>:<last hash>", as recorded by
 *  the database itself (a scalar text subquery). */
export const MIGRATION_STAMP_SUBQUERY =
  "(SELECT count(*)::text || ':' || coalesce((SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1), '') FROM drizzle.__drizzle_migrations)";

/** The same stamp as a query returning one row `{ stamp }`. */
export const MIGRATION_STAMP_SQL = `SELECT ${MIGRATION_STAMP_SUBQUERY} AS stamp`;

/** Install-wide tables a demo schema reads from public (search_path "demo_x, public")
 *  instead of copying; the demo builder and demoSchemaMiddleware share this list. */
export const DEMO_SHARED_TABLES: readonly string[] = ["tax_data_updates"];
