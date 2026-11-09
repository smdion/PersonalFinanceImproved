/** Rows as the data converters read them (migration-converters.ts): snake_
 *  case, a JSON column as an object (PostgreSQL) or text (SQLite). One copy
 *  for every converter; no import from migration-converters.ts. */

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

/** What a converter gets besides its tables: the encryption key, read only
 *  when it asks, so an install with nothing to encrypt starts without one. */
export type ConverterContext = {
  readonly encryptionKey: (purpose: string) => Buffer;
};
