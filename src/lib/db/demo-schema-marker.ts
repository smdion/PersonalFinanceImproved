/**
 * Demo schemas are copies of the public tables, built when a demo profile
 * is chosen. Each is stamped (a schema comment) with how many migrations
 * the database had when it was built; one built before a later migration
 * is stale. The migrator drops stale ones on every start, and requests
 * refuse to use one (see demoSchemaMiddleware). db-migrate.ts keeps its
 * own copy of the prefix (it's built standalone) — a test keeps them equal.
 */
export const DEMO_SCHEMA_MARKER_PREFIX = "ledgr-migrations:";

/** Applied-migration count, as recorded by the database itself (a scalar subquery). */
export const MIGRATION_COUNT_SUBQUERY =
  "(SELECT count(*)::int FROM drizzle.__drizzle_migrations)";

/** The same count as a query returning one row `{ n }`. */
export const MIGRATION_COUNT_SQL = `SELECT ${MIGRATION_COUNT_SUBQUERY} AS n`;
