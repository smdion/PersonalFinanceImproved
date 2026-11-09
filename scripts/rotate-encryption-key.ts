/**
 * CLI tool: re-encrypt the stored integration credentials (each
 * `api_connections.config`, and the copies inside stored versions) under a
 * new ENCRYPTION_KEY, in one transaction: none of it lands unless all of it does.
 *
 * Usage, with Ledgr stopped:
 *   ENCRYPTION_KEY_NEW=<new key> pnpm encryption:rotate --dry-run
 *   ENCRYPTION_KEY_NEW=<new key> pnpm encryption:rotate
 * then set ENCRYPTION_KEY to the new key and start Ledgr. ENCRYPTION_KEY (the
 * old key), DATABASE_URL and SQLITE_PATH come from the environment or `.env`.
 */
import type { ClientBase } from "pg";
import type BetterSqlite3 from "better-sqlite3";
import { getDialect } from "../src/lib/db/dialect";
import { loadEnvFile } from "../src/lib/db/env-file";
import {
  decryptStringWithKey,
  encryptStringWithKey,
  isEncryptedEnvelope,
  parseEncryptionKey,
  type EncryptedEnvelope,
} from "../src/lib/crypto-envelope";

export interface RotationKeys {
  oldKey: Buffer;
  newKey: Buffer;
}

export interface RotationCounts {
  /** `api_connections` rows re-encrypted. */
  connections: number;
  /** Credentials re-encrypted inside stored versions. */
  versionCredentials: number;
  /** Plaintext configs (stored before encryption), left for the app's next write. */
  plaintext: number;
  /** Credentials already under the new key (a re-run finishing a mixed state). */
  alreadyNew: number;
}

interface StoredConnection {
  id: number;
  service: string;
  config: unknown;
}

interface StoredVersionTable {
  id: number;
  versionId: number;
  data: unknown;
}

interface RotationPlan {
  connections: StoredConnection[];
  versionTables: StoredVersionTable[];
  counts: RotationCounts;
}

/** Thrown when a credential decrypts with neither key; nothing is written. */
export class RotationRefused extends Error {}

type Rotated =
  | { kind: "rotated"; value: unknown }
  | { kind: "plaintext" }
  | { kind: "alreadyNew" }
  | { kind: "refused" };

function decrypts(key: Buffer, envelope: EncryptedEnvelope): boolean {
  try {
    decryptStringWithKey(key, envelope);
    return true;
  } catch {
    return false;
  }
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A stored config re-encrypted under the new key, kept in its stored shape (an envelope, or JSON text of one). */
function rotateValue(value: unknown, keys: RotationKeys): Rotated {
  if (typeof value === "string") {
    // SQLite snapshots hold the config as JSON text: rotate inside, write back as text.
    const inner = rotateValue(parseJsonText(value), keys);
    return inner.kind === "rotated"
      ? { kind: "rotated", value: JSON.stringify(inner.value) }
      : inner;
  }
  if (!isEncryptedEnvelope(value)) return { kind: "plaintext" };
  let plaintext: string;
  try {
    plaintext = decryptStringWithKey(keys.oldKey, value);
  } catch {
    return decrypts(keys.newKey, value)
      ? { kind: "alreadyNew" }
      : { kind: "refused" };
  }
  return {
    kind: "rotated",
    value: encryptStringWithKey(keys.newKey, plaintext),
  };
}

/** Every stored credential re-encrypted, or RotationRefused naming each one that can't be. */
function planRotation(
  connections: StoredConnection[],
  versionTables: StoredVersionTable[],
  keys: RotationKeys,
): RotationPlan {
  const refusals: string[] = [];
  const counts: RotationCounts = {
    connections: 0,
    versionCredentials: 0,
    plaintext: 0,
    alreadyNew: 0,
  };
  const rotate = (value: unknown, where: string): Rotated => {
    const result = rotateValue(value, keys);
    if (result.kind === "refused") refusals.push(where);
    else if (result.kind === "alreadyNew") counts.alreadyNew++;
    return result;
  };

  const rotatedConnections: StoredConnection[] = [];
  for (const conn of connections) {
    const result = rotate(
      conn.config,
      `api_connections id ${conn.id} (${conn.service})`,
    );
    if (result.kind === "rotated")
      rotatedConnections.push({ ...conn, config: result.value });
    else if (result.kind === "plaintext") counts.plaintext++;
  }
  counts.connections = rotatedConnections.length;

  const rotatedTables: StoredVersionTable[] = [];
  for (const table of versionTables) {
    if (!Array.isArray(table.data)) continue;
    let rotatedRows = 0;
    const data: unknown[] = table.data.map((row: unknown) => {
      if (!row || typeof row !== "object" || !("config" in row)) return row;
      const rowId = "id" in row ? String(row.id) : "?";
      const result = rotate(
        row.config,
        `stored version ${table.versionId}, api_connections row id ${rowId}`,
      );
      if (result.kind !== "rotated") return row;
      rotatedRows++;
      return { ...row, config: result.value };
    });
    if (rotatedRows > 0) rotatedTables.push({ ...table, data });
    counts.versionCredentials += rotatedRows;
  }

  if (refusals.length > 0) {
    throw new RotationRefused(
      `${refusals.length} stored credential(s) decrypt with neither ENCRYPTION_KEY nor ENCRYPTION_KEY_NEW: ${refusals.join("; ")}. Nothing was changed.`,
    );
  }
  return {
    connections: rotatedConnections,
    versionTables: rotatedTables,
    counts,
  };
}

const VERSION_TABLES_SQL =
  "SELECT id, version_id, data FROM state_version_tables WHERE table_name = 'api_connections' ORDER BY id";

/** SQLite: read, re-encrypt and write in one IMMEDIATE transaction (JSON columns are text). */
export function rotateSqlite(
  sqlite: BetterSqlite3.Database,
  keys: RotationKeys,
  dryRun: boolean,
): RotationCounts {
  const rotate = sqlite.transaction((): RotationCounts => {
    const connections = sqlite
      .prepare<[], { id: number; service: string; config: string }>(
        "SELECT id, service, config FROM api_connections ORDER BY id",
      )
      .all()
      .map((r) => ({ ...r, config: parseJsonText(r.config) }));
    const versionTables = sqlite
      .prepare<[], { id: number; version_id: number; data: string }>(
        VERSION_TABLES_SQL,
      )
      .all()
      .map((r) => ({
        id: r.id,
        versionId: r.version_id,
        data: parseJsonText(r.data),
      }));
    const plan = planRotation(connections, versionTables, keys);
    if (dryRun) return plan.counts;
    const setConfig = sqlite.prepare(
      "UPDATE api_connections SET config = ? WHERE id = ?",
    );
    for (const c of plan.connections)
      setConfig.run(JSON.stringify(c.config), c.id);
    const setData = sqlite.prepare(
      "UPDATE state_version_tables SET data = ? WHERE id = ?",
    );
    for (const t of plan.versionTables)
      setData.run(JSON.stringify(t.data), t.id);
    return plan.counts;
  });
  return rotate.immediate();
}

/** PostgreSQL: the same in one transaction, the two tables closed to writes while it runs; a dry run rolls back. */
export async function rotatePostgres(
  client: ClientBase,
  keys: RotationKeys,
  dryRun: boolean,
): Promise<RotationCounts> {
  await client.query("BEGIN");
  try {
    // Reads still run; an insert or update (a saved credential, a new version) waits.
    await client.query(
      "LOCK TABLE api_connections, state_version_tables IN EXCLUSIVE MODE",
    );
    const { rows: connections } = await client.query<StoredConnection>(
      "SELECT id, service, config FROM api_connections ORDER BY id",
    );
    const { rows: versionRows } = await client.query<{
      id: number;
      version_id: number;
      data: unknown;
    }>(VERSION_TABLES_SQL);
    const plan = planRotation(
      connections,
      versionRows.map((r) => ({
        id: r.id,
        versionId: r.version_id,
        data: r.data,
      })),
      keys,
    );
    if (!dryRun) {
      for (const c of plan.connections)
        await client.query(
          "UPDATE api_connections SET config = $1::jsonb WHERE id = $2",
          [JSON.stringify(c.config), c.id],
        );
      for (const t of plan.versionTables)
        await client.query(
          "UPDATE state_version_tables SET data = $1::jsonb WHERE id = $2",
          [JSON.stringify(t.data), t.id],
        );
    }
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
    return plan.counts;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

function readKeys(): RotationKeys {
  const keys = {
    oldKey: parseEncryptionKey(process.env.ENCRYPTION_KEY),
    newKey: parseEncryptionKey(
      process.env.ENCRYPTION_KEY_NEW,
      "ENCRYPTION_KEY_NEW",
    ),
  };
  if (keys.oldKey.equals(keys.newKey))
    throw new Error(
      "ENCRYPTION_KEY_NEW is the same key as ENCRYPTION_KEY: nothing to rotate.",
    );
  return keys;
}

async function run() {
  loadEnvFile();
  const dryRun = process.argv.includes("--dry-run");
  const keys = readKeys();
  const dialect = getDialect();
  console.error(`Rotating ENCRYPTION_KEY (dialect: ${dialect})...`);

  let counts: RotationCounts;
  if (dialect === "postgresql") {
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
    });
    await client.connect();
    try {
      counts = await rotatePostgres(client, keys, dryRun);
    } finally {
      await client.end();
    }
  } else {
    const Database = (await import("better-sqlite3")).default;
    const sqlite = new Database(process.env.SQLITE_PATH ?? "data/ledgr.db", {
      fileMustExist: true,
    });
    sqlite.pragma("busy_timeout = 5000");
    try {
      counts = rotateSqlite(sqlite, keys, dryRun);
    } finally {
      sqlite.close();
    }
  }

  const verb = dryRun ? "Would re-encrypt" : "Re-encrypted";
  console.error(
    `${verb} ${counts.connections} integration credential(s) and ${counts.versionCredentials} in stored versions; ${counts.alreadyNew} already under the new key; ${counts.plaintext} plaintext config(s) left for Ledgr to encrypt on its next save.`,
  );
  if (dryRun) console.error("No changes made (--dry-run).");
  else
    console.error(
      "Now set ENCRYPTION_KEY to the new key, then start Ledgr. Backup files made before now still need the old key.",
    );
}

// Guarded so the tests can import the functions above without a run.
if (!process.env.VITEST) {
  run().catch((err) => {
    console.error(
      "Key rotation failed:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
