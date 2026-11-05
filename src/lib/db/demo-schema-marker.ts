/**
 * Demo schemas are copies of the public tables, built when a demo profile
 * is chosen. Each is stamped (a schema comment) with the migrations the
 * database had when it was built — the applied count and the last hash; one
 * built before a later migration is stale. The hash matters because a
 * migration squash resets the count: a schema stamped "13" before a squash
 * could otherwise match a later release with 13 entries. The migrator drops
 * stale ones on every start, and requests refuse to use one (see
 * demoSchemaMiddleware). db-migrate.ts imports both from here.
 */
export const DEMO_SCHEMA_MARKER_PREFIX = "ledgr-migrations:";

/** The database's migration stamp, "<count>:<last hash>", as recorded by
 *  the database itself (a scalar text subquery). */
export const MIGRATION_STAMP_SUBQUERY =
  "(SELECT count(*)::text || ':' || coalesce((SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1), '') FROM drizzle.__drizzle_migrations)";

/** The same stamp as a query returning one row `{ stamp }`. */
export const MIGRATION_STAMP_SQL = `SELECT ${MIGRATION_STAMP_SUBQUERY} AS stamp`;

/** Install-wide tables a demo schema never gets its own copy of: a demo
 *  reads them from public through its search_path ("demo_x, public").
 *  Community tax-data updates are the install's, not household data. The
 *  demo builder skips these and the request check (demoSchemaMiddleware)
 *  doesn't require them — one list, so the two can't disagree (they did:
 *  the builder skipped tax_data_updates while the check required every
 *  public table, so every demo request was refused). */
export const DEMO_SHARED_TABLES: readonly string[] = ["tax_data_updates"];
