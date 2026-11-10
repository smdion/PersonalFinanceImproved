/** The credentials tag's first step, live and on restore: every stored
 *  integration credential (api_connections.config, and its copies in stored
 *  versions) is held encrypted. Rules: CREDENTIALS_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import { encryptStringWithKey } from "../../crypto-envelope";
import type { ConverterContext } from "./converter-rows";
import { isRow, type Row, type Update } from "./converter-rows";

/** The tag the credentials, mapping, joint and cached-month converters run under. */
export const CREDENTIALS_TAG = "0019_v0106_credentials";

const CONNECTIONS = "api_connections";
const VERSION_TABLES = "state_version_tables";

/** Already encrypted, in any envelope format: every format keeps a numeric
 *  `v` and a string `ct` (crypto-envelope.ts), so a replay under a later
 *  format leaves its envelopes alone. */
function isEnvelope(value: unknown): value is Row {
  if (!isRow(value)) return false;
  return typeof value["v"] === "number" && typeof value["ct"] === "string";
}

const NOT_JSON = Symbol("not JSON");
function parsed(text: string): unknown {
  let value: unknown = NOT_JSON;
  try {
    value = JSON.parse(text);
  } catch {
    // Not JSON: the text is the value.
  }
  return value;
}

/** Text layers a stored value can carry: one for SQLite's JSON text, more
 *  where a JSON string holds the JSON (a double-encoded column). */
const MOST_LAYERS = 4;

/** The value under every text layer that is JSON. */
function unwrapped(value: unknown): unknown {
  let inner = value;
  for (let n = 0; n < MOST_LAYERS && typeof inner === "string"; n++) {
    const next = parsed(inner);
    if (next === NOT_JSON) break;
    inner = next;
  }
  return inner;
}

/** A column value as stored: SQLite (and a SQLite backup) gives JSON as
 *  text, PostgreSQL as a value (a string scalar as its JSON text). */
const stored = (column: unknown) => {
  if (typeof column !== "string") return column;
  const value = parsed(column);
  return value === NOT_JSON ? column : value;
};

/** What a stored config needs: nothing (an envelope), the envelope out of
 *  the text that holds it (never encrypted twice), or encrypting what it
 *  holds (any JSON value: it reads back exactly as stored). */
type Plan =
  | { kind: "kept" }
  | { kind: "unwrapped"; envelope: Row }
  | { kind: "plaintext"; value: unknown };

function plan(column: unknown): Plan {
  const value = stored(column);
  if (isEnvelope(value)) return { kind: "kept" };
  const inner = unwrapped(value);
  if (isEnvelope(inner)) return { kind: "unwrapped", envelope: inner };
  return { kind: "plaintext", value: inner };
}

/** A stored version's copy of the api_connections rows, as an array. */
function versionRows(data: unknown): readonly unknown[] | null {
  const value = stored(data);
  return Array.isArray(value) ? value : null;
}

type Encrypt = (value: unknown) => Row;

/** Each connection's new config: the envelope it holds, or its value
 *  encrypted. Never a config value in a note: ids only. */
function connectionUpdates(rows: readonly Row[], encrypt: Encrypt) {
  const updates: Update[] = [];
  let unwrappedCount = 0;
  for (const row of rows) {
    if (row["config"] === undefined) continue;
    const p = plan(row["config"]);
    if (p.kind === "kept") continue;
    if (p.kind === "unwrapped") unwrappedCount++;
    const config = p.kind === "unwrapped" ? p.envelope : encrypt(p.value);
    updates.push({
      table: CONNECTIONS,
      id: Number(row["id"]),
      set: { config },
    });
  }
  return { updates, unwrapped: unwrappedCount };
}

/** A version copy keeps its stored form (text stays text, as the rotation
 *  tool keeps it); only a plaintext config inside is encrypted. */
function versionUpdates(rows: readonly Row[], encrypt: Encrypt) {
  const updates: Update[] = [];
  let encrypted = 0;
  for (const version of rows) {
    if (version["table_name"] !== CONNECTIONS) continue;
    const copies = versionRows(version["data"]);
    if (!copies) continue;
    let changed = 0;
    const data = copies.map((copy) => {
      if (!isRow(copy) || copy["config"] === undefined) return copy;
      const p = plan(copy["config"]);
      if (p.kind !== "plaintext") return copy;
      changed++;
      const envelope = encrypt(p.value);
      const text = typeof copy["config"] === "string";
      return { ...copy, config: text ? JSON.stringify(envelope) : envelope };
    });
    if (changed === 0) continue;
    encrypted += changed;
    updates.push({
      table: VERSION_TABLES,
      id: Number(version["id"]),
      set: { data },
    });
  }
  return { updates, encrypted };
}

/** Idempotent by structure: an envelope is left as it is (every writer
 *  stores one). The key is read only when plaintext exists; missing, the
 *  start is refused (the context's key refusal) and the tag rolls back. */
export const CREDENTIALS_CONVERTER = {
  tables: [CONNECTIONS, VERSION_TABLES],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
    context: ConverterContext,
  ) => {
    const connections = (tables[CONNECTIONS] ?? []).filter(isRow);
    const versions = (tables[VERSION_TABLES] ?? []).filter(isRow);
    let key: Buffer | null = null;
    const encrypt: Encrypt = (value) => {
      key ??= context.encryptionKey();
      return { ...encryptStringWithKey(key, JSON.stringify(value)) };
    };
    const c = connectionUpdates(connections, encrypt);
    const v = versionUpdates(versions, encrypt);
    const encrypted = c.updates.length - c.unwrapped;
    return {
      updates: [...c.updates, ...v.updates],
      notes: [
        `${encrypted} connection configs encrypted, ${c.unwrapped} unwrapped from text; ${v.encrypted} stored-version copies encrypted`,
      ],
    };
  },
} as const;
