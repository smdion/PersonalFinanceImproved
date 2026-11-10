/** Rows as the data converters read them (migration-converters.ts): snake_
 *  case, JSON as an object (PostgreSQL) or text (SQLite), the rest through
 *  the helpers below. No import from migration-converters.ts. */

export type Row = Record<string, unknown>;
export type Update = { table: string; id: number; set: Row };

export const isRow = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const isEmpty = (v: unknown) => v === null || v === undefined;

/** A JSON column in either dialect's form as an object; null for anything
 *  else, text that isn't JSON too. */
export function jsonObject(value: unknown): Row | null {
  let v: unknown = value;
  if (typeof v === "string")
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  return isRow(v) ? v : null;
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
