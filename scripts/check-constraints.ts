/**
 * The primary keys, foreign keys and indexes a database migrated from
 * empty has, compared with the committed list for its dialect
 * (scripts/constraints/<dialect>.txt). Migrations can lose a constraint
 * without failing — a squash that drops a foreign key still applies and
 * every query still runs — so a lost or added constraint has to show up as
 * a line in a diff, and a deliberate change rewrites the list in the same
 * commit (`--write`).
 *
 * Usage:
 *   pnpm check:constraints                        SQLite: a temporary database
 *                                                 the real migrator builds from empty
 *   pnpm check:constraints --sqlite-path=<file>   SQLite: an existing database
 *   DATABASE_URL=postgresql://… pnpm check:constraints
 *                                                 PostgreSQL: that database's
 *                                                 public schema, read only (CI
 *                                                 migrates its empty service
 *                                                 database first)
 *   … --write                                     rewrite the list from what was read
 *
 * Pointed at an upgraded install instead of one built from empty, the diff
 * is how that install differs from a fresh one.
 *
 * One line per constraint, the same shape on both dialects:
 *   <table>: primary key (<columns>)
 *   <table>: foreign key (<columns>) references <table>(<columns>) on delete <action> on update <action>
 *   <table>: [unique ]index <name> (<columns>)[ partial][ using <method>]
 * A partial index's predicate isn't compared: the two dialects print it
 * differently. Foreign keys carry no name: SQLite keeps none.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type Dialect = "postgresql" | "sqlite";

const SNAPSHOT_DIR = path.join(process.cwd(), "scripts", "constraints");

export function snapshotPath(dialect: Dialect): string {
  return path.join(SNAPSHOT_DIR, `${dialect}.txt`);
}

// --- Lines --------------------------------------------------------------

/** PostgreSQL's `confdeltype`/`confupdtype` codes. */
const PG_ACTIONS: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

export function primaryKeyLine(table: string, columns: string[]): string {
  return `${table}: primary key (${columns.join(", ")})`;
}

export function foreignKeyLine(foreignKey: {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: string;
  onUpdate: string;
}): string {
  return (
    `${foreignKey.table}: foreign key (${foreignKey.columns.join(", ")})` +
    ` references ${foreignKey.refTable}(${foreignKey.refColumns.join(", ")})` +
    ` on delete ${foreignKey.onDelete.toLowerCase()}` +
    ` on update ${foreignKey.onUpdate.toLowerCase()}`
  );
}

export function indexLine(index: {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
  partial: boolean;
  method?: string;
}): string {
  const method =
    index.method && index.method !== "btree" ? ` using ${index.method}` : "";
  return (
    `${index.table}: ${index.unique ? "unique " : ""}index ${index.name}` +
    ` (${index.columns.join(", ")})${index.partial ? " partial" : ""}${method}`
  );
}

/** PostgreSQL's one-letter referential action, spelled out. */
export function pgAction(code: string): string {
  const action = PG_ACTIONS[code];
  if (!action) throw new Error(`Unknown referential action code: ${code}`);
  return action;
}

/** SQLite `PRAGMA foreign_key_list` rows, one per column: grouped into one
 *  line per foreign key (`id`), columns in `seq` order. A key that names no
 *  parent columns references the parent's primary key (`parentKey`). */
export function sqliteForeignKeyLines(
  table: string,
  rows: {
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string | null;
    on_update: string;
    on_delete: string;
  }[],
  parentKey: (parent: string) => string[],
): string[] {
  const byId = new Map<number, typeof rows>();
  for (const row of rows) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  return [...byId.values()].map((keyRows) => {
    const sorted = [...keyRows].sort((a, b) => a.seq - b.seq);
    const first = sorted[0]!;
    const refColumns = sorted.every((row) => row.to)
      ? sorted.map((row) => row.to!)
      : parentKey(first.table);
    return foreignKeyLine({
      table,
      columns: sorted.map((row) => row.from),
      refTable: first.table,
      refColumns,
      onDelete: first.on_delete,
      onUpdate: first.on_update,
    });
  });
}

// --- Snapshot file and comparison --------------------------------------

const HEADER = [
  "# Primary keys, foreign keys and indexes after migrating an empty database.",
  "# Checked by scripts/check-constraints.ts; rewrite with its --write flag",
  "# when a migration changes a constraint on purpose.",
];

export function formatSnapshot(lines: string[]): string {
  return [...HEADER, ...[...lines].sort()].join("\n") + "\n";
}

export function parseSnapshot(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Lines the list has that the database lacks, and the reverse. */
export function compareSnapshot(
  expected: string[],
  actual: string[],
): { missing: string[]; unexpected: string[] } {
  const have = new Set(actual);
  const want = new Set(expected);
  return {
    missing: [...want].filter((line) => !have.has(line)).sort(),
    unexpected: [...have].filter((line) => !want.has(line)).sort(),
  };
}

// --- Reading a database -------------------------------------------------

export function readSqlite(dbPath: string): string[] {
  /* eslint-disable @typescript-eslint/no-require-imports -- better-sqlite3 is loaded only on the SQLite path, as in the other scripts */
  const Database = require("better-sqlite3");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const tables = (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name <> '__drizzle_migrations'",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    const primaryKey = (table: string): string[] =>
      (
        sqlite.pragma(`table_info("${table}")`) as {
          name: string;
          pk: number;
        }[]
      )
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name);

    const lines: string[] = [];
    for (const table of tables) {
      const key = primaryKey(table);
      if (key.length > 0) lines.push(primaryKeyLine(table, key));
      lines.push(
        ...sqliteForeignKeyLines(
          table,
          sqlite.pragma(`foreign_key_list("${table}")`),
          primaryKey,
        ),
      );
      const indexes = sqlite.pragma(`index_list("${table}")`) as {
        name: string;
        unique: number;
        origin: string;
        partial: number;
      }[];
      for (const index of indexes) {
        // The primary key is its own line (an INTEGER PRIMARY KEY has no
        // index at all; PostgreSQL's is `<table>_pkey`).
        if (index.origin === "pk") continue;
        const columns = (
          sqlite.pragma(`index_xinfo("${index.name}")`) as {
            name: string | null;
            desc: number;
            key: number;
            seqno: number;
          }[]
        )
          .filter((column) => column.key === 1)
          .sort((a, b) => a.seqno - b.seqno)
          .map(
            (column) =>
              `${column.name ?? "<expression>"}${column.desc ? " desc" : ""}`,
          );
        lines.push(
          indexLine({
            table,
            name: index.name,
            columns,
            unique: index.unique === 1,
            partial: index.partial === 1,
          }),
        );
      }
    }
    return lines;
  } finally {
    sqlite.close();
  }
}

export async function readPostgres(databaseUrl: string): Promise<string[]> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
    options: "-c default_transaction_read_only=on",
  });
  await client.connect();
  try {
    const foreignKeys = await client.query<{
      table: string;
      ref_table: string;
      columns: string[];
      ref_columns: string[];
      on_delete: string;
      on_update: string;
    }>(`
      SELECT t.relname::text AS table, r.relname::text AS ref_table,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
              ORDER BY k.ord) AS columns,
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
              ORDER BY k.ord) AS ref_columns,
        c.confdeltype::text AS on_delete, c.confupdtype::text AS on_update
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class r ON r.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'`);
    const indexes = await client.query<{
      table: string;
      name: string;
      unique: boolean;
      primary: boolean;
      partial: boolean;
      method: string;
      columns: string[];
    }>(`
      SELECT t.relname::text AS table, i.relname::text AS name,
        x.indisunique AS unique, x.indisprimary AS primary,
        x.indpred IS NOT NULL AS partial, am.amname::text AS method,
        ARRAY(SELECT CASE WHEN x.indkey[k] = 0
                       THEN pg_get_indexdef(x.indexrelid, k + 1, true)
                       ELSE (SELECT a.attname::text FROM pg_attribute a
                             WHERE a.attrelid = x.indrelid AND a.attnum = x.indkey[k])
                     END
                     || CASE WHEN (x.indoption[k]::int & 1) = 1 THEN ' desc' ELSE '' END
              FROM generate_subscripts(x.indkey, 1) AS k
              WHERE k < x.indnkeyatts
              ORDER BY k) AS columns
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_am am ON am.oid = i.relam
      WHERE n.nspname = 'public'`);
    return [
      ...foreignKeys.rows.map((row) =>
        foreignKeyLine({
          table: row.table,
          columns: row.columns,
          refTable: row.ref_table,
          refColumns: row.ref_columns,
          onDelete: pgAction(row.on_delete),
          onUpdate: pgAction(row.on_update),
        }),
      ),
      ...indexes.rows.map((row) =>
        row.primary ? primaryKeyLine(row.table, row.columns) : indexLine(row),
      ),
    ];
  } finally {
    await client.end();
  }
}

/** A SQLite database the real migrator (`tsx db-migrate.ts`, as a child
 *  process) builds from empty in `dir`. */
function migrateEmptySqlite(dir: string): string {
  const dbPath = path.join(dir, "ledgr.db");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SQLITE_PATH: dbPath,
    LEDGR_BACKUP_DIR: path.join(dir, "backups"),
  };
  delete env.DATABASE_URL;
  // db-migrate.ts does nothing when VITEST is set.
  for (const key of Object.keys(env))
    if (key.startsWith("VITEST")) delete env[key];
  const result = spawnSync(
    path.join(process.cwd(), "node_modules", ".bin", "tsx"),
    ["db-migrate.ts"],
    { cwd: process.cwd(), env, encoding: "utf8", timeout: 180_000 },
  );
  if (result.status !== 0)
    throw new Error(
      `db-migrate.ts exited ${result.status}:\n${result.stderr}\n${result.stdout}`,
    );
  return dbPath;
}

// --- CLI ----------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const sqlitePath = args
    .find((arg) => arg.startsWith("--sqlite-path="))
    ?.slice("--sqlite-path=".length);
  const url = process.env.DATABASE_URL;
  const dialect: Dialect =
    !sqlitePath && url && /^postgres(ql)?:\/\//.test(url)
      ? "postgresql"
      : "sqlite";

  let actual: string[];
  let source: string;
  if (dialect === "postgresql") {
    actual = await readPostgres(url!);
    source = "the PostgreSQL database at DATABASE_URL";
  } else if (sqlitePath) {
    actual = readSqlite(sqlitePath);
    source = sqlitePath;
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgr-constraints-"));
    try {
      actual = readSqlite(migrateEmptySqlite(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    source = "a SQLite database migrated from empty";
  }

  const file = snapshotPath(dialect);
  const relative = path.relative(process.cwd(), file);
  if (write) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatSnapshot(actual));
    console.log(`Wrote ${actual.length} constraints to ${relative}.`);
    return;
  }

  const expected = fs.existsSync(file)
    ? parseSnapshot(fs.readFileSync(file, "utf8"))
    : [];
  const { missing, unexpected } = compareSnapshot(expected, actual);
  if (missing.length === 0 && unexpected.length === 0) {
    console.log(
      `Constraints match ${relative}: ${actual.length} primary keys, foreign keys and indexes (${dialect}).`,
    );
    return;
  }
  console.error(`Constraints differ from ${relative} (${source}):`);
  for (const line of missing) console.error(`  missing:    ${line}`);
  for (const line of unexpected) console.error(`  unexpected: ${line}`);
  console.error(
    `\n"missing" is in the list but not in the database (a migration lost it); "unexpected" is the reverse.\nIf a migration changed these on purpose, run the same command with --write and commit ${relative}.`,
  );
  process.exit(1);
}

// Importable by tests without running the check.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
