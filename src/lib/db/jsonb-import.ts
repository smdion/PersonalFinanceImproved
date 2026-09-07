/**
 * Encodes a jsonb column's exported value back into a JSON string for a PG
 * `::jsonb` insert.
 *
 * A backup produced on SQLite carries `text({ mode: "json" })` columns as
 * already-serialized JSON strings — push as-is, or `JSON.stringify` would
 * double-encode them (store `"\"[...]\""`). A backup produced on PG carries
 * jsonb as whatever node-pg parsed it into: an object/array for most
 * columns, but a BARE (unquoted) string for a column whose jsonb value is
 * itself a JSON string scalar (e.g. an ISO timestamp) — that always needs
 * `JSON.stringify` to become valid JSON again, same as an object does.
 * `typeof val === "string"` can't tell those two "already a string" cases
 * apart, so branch on the export's actual source dialect instead (falls
 * back to "postgres" for older backups made before this field existed —
 * matching pre-existing behavior for what was, in practice, always a
 * PG-sourced backup).
 *
 * Zero DB imports so this stays unit-testable without a live connection —
 * kept out of version-logic.ts, which pulls in the full schema barrel.
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
