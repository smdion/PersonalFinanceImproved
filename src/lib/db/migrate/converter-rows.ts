/** Rows as data converters read them (no import from migration-converters
 *  .ts): snake_case; JSON an object (PostgreSQL) or text (SQLite); a timestamp
 *  ISO text or epoch seconds, so its first writer adds a helper for both. */

export type Row = Record<string, unknown>;
export type Update = { table: string; id: number; set: Row };

export const isRow = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isEmpty = (v: unknown) => v === null || v === undefined;

/** A JSON column in either dialect's form, parsed; undefined for text
 *  that isn't JSON. */
function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** A JSON column as an object; null for anything else. */
export function jsonObject(value: unknown): Row | null {
  const v = parsedJson(value);
  return isRow(v) ? v : null;
}

/** A JSON column as an array; null for anything else. */
export function jsonArray(value: unknown): readonly unknown[] | null {
  const v = parsedJson(value);
  return Array.isArray(v) ? v : null;
}

/** A boolean column: true/false on PostgreSQL, 1/0 on SQLite, "1"/"true"
 *  text in some older backups. Null for anything else. A decimal reads
 *  "50.00" on PostgreSQL but "50" on SQLite: compare Number(), never text. */
export function asBool(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1" || value === "true")
    return true;
  if (value === false || value === 0 || value === "0" || value === "false")
    return false;
  return null;
}

/** What a converter gets besides its tables: the encryption key, read only
 *  when it asks, so an install with nothing to encrypt starts without one. */
export type ConverterContext = {
  readonly encryptionKey: () => Buffer;
};
