// Centralized dialect detection — used by schema, connection, and migration layers.
// DATABASE_URL present and starts with postgres:// or postgresql:// → PostgreSQL.
// Absent or anything else → SQLite (default).

export type Dialect = "postgresql" | "sqlite";

export function getDialect(): Dialect {
  const url = process.env.DATABASE_URL;
  if (
    url &&
    (url.startsWith("postgres://") || url.startsWith("postgresql://"))
  ) {
    return "postgresql";
  }
  return "sqlite";
}

export function isPostgres(): boolean {
  return getDialect() === "postgresql";
}

export function isSQLite(): boolean {
  return getDialect() === "sqlite";
}
