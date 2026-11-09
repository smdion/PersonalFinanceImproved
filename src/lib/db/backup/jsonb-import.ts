/**
 * Encodes an exported jsonb value for a PG `::jsonb` insert: a SQLite export's value is already
 * JSON text (sent as-is); a PG export's is parsed, even a bare string scalar, so it's stringified.
 * An unknown source dialect counts as "postgres". No DB imports, so it unit-tests without a DB.
 */
export function encodeJsonbForPgImport(
  val: unknown,
  sourceDialect: "postgres" | "sqlite" | undefined,
): string {
  if (sourceDialect === "sqlite") {
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  return JSON.stringify(val);
}
