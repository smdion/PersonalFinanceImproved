/**
 * The router suite on PostgreSQL (LEDGR_ROUTER_DIALECT=postgres, with
 * TEST_DATABASE_URL naming a throwaway `_test` database): createTestCaller
 * gives each caller its own database, copied from a template the real
 * migrator builds once, and the procedures run on the app's PostgreSQL
 * schema. The test's own `db` and `sqlite` keep their SQLite shape (the
 * seed helpers write synchronously), answered by that same database
 * through a worker thread (pg-sync-worker.mjs).
 *
 * A test whose own SQL is SQLite's (a pragma, a SQLite function) fails here
 * by name; that is the point of the shard.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import {
  MessageChannel,
  receiveMessageOnPort,
  Worker,
  type MessagePort,
} from "node:worker_threads";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as pgSchema from "@/lib/db/schema-pg";
import { TEST_DATABASE_LOCK } from "./test-database-lock";

/** True when this run puts the router suite on PostgreSQL. */
export const ROUTERS_ON_POSTGRES =
  process.env.LEDGR_ROUTER_DIALECT === "postgres";

// ── The synchronous bridge ──

type Reply = {
  /** The request's id, echoed by the worker. */
  id: number;
  result?: {
    rows: unknown[];
    rowCount: number;
    fields: string[];
    json: boolean[];
  };
  error?: { message: string; code: string | null };
};

let bridge: { worker: Worker; wake: Int32Array; port: MessagePort } | null =
  null;
let sent = 0;

/**
 * One request, answered synchronously. The worker posts its reply, sets the
 * flag, then notifies; a wait that already saw the flag set returns before
 * that notify lands, so a notify can wake the next request's wait before
 * its reply exists (CI run 43361513884). A wake is only a hint: the call
 * returns when the port holds the reply carrying its own id, and drops a
 * reply to a request that gave up waiting.
 */
function call(msg: Record<string, unknown>): NonNullable<Reply["result"]> {
  if (!bridge) {
    const flag = new SharedArrayBuffer(4);
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(
      new URL("./pg-sync-worker.mjs", import.meta.url),
      { workerData: { flag, port: port2 }, transferList: [port2] },
    );
    worker.unref();
    bridge = { worker, wake: new Int32Array(flag), port: port1 };
  }
  const id = ++sent;
  bridge.worker.postMessage({ ...msg, id });
  const deadline = performance.now() + 120_000;
  let reply: Reply | undefined;
  while (reply?.id !== id) {
    // Cleared before the port is read: the reply is posted before the flag
    // is set, so a reply this misses sets it again and the wait returns.
    Atomics.store(bridge.wake, 0, 0);
    reply = receiveMessageOnPort(bridge.port)?.message as Reply | undefined;
    if (reply) continue;
    const left = deadline - performance.now();
    if (left <= 0) throw new Error("PostgreSQL bridge: no answer in 120 s");
    Atomics.wait(bridge.wake, 0, 0, left);
  }
  if (reply.error)
    throw Object.assign(
      new Error(
        `${reply.error.message} (PostgreSQL bridge: ${String(msg.sql)})`,
      ),
      { code: reply.error.code },
    );
  return reply.result!;
}

type TableColumns = { timestamps: Set<string>; unique: string[] };

let tableColumns: Map<string, TableColumns> | null = null;

/** Each table's timestamp columns (SQLite's schema writes them as epoch
 *  seconds, PostgreSQL's takes a timestamp) and its unique columns. */
function columnsOf(table: string): TableColumns {
  const exported: unknown[] = Object.values(pgSchema);
  tableColumns ??= new Map(
    exported
      .filter((t): t is PgTable => is(t, PgTable))
      .map((t) => {
        const { name, columns } = getTableConfig(t);
        return [
          name,
          {
            timestamps: new Set(
              columns
                .filter((c) => c.columnType === "PgTimestamp")
                .map((c) => c.name),
            ),
            unique: [
              ...columns.filter((c) => c.isUnique).map((c) => c.name),
              ...columns.filter((c) => c.primary).map((c) => c.name),
            ],
          },
        ] as const;
      }),
  );
  return tableColumns.get(table) ?? { timestamps: new Set(), unique: [] };
}

// ── JSON read through the bridge ──
// The bridge hands JSON over as its text, as better-sqlite3 does, so the
// SQLite schema's JSON columns parse it once. The app's jsonb columns keep
// what node-postgres parsed, so for a cell the bridge read they parse its
// text here, once, as node-postgres would have.

/** A JSON cell's text, marked as read through the bridge (JSON.parse reads
 *  a String object as its text; only the bridge makes one). */
const bridged = (text: string) => new String(text);

if (ROUTERS_ON_POSTGRES) {
  const exported: unknown[] = Object.values(pgSchema);
  for (const table of exported.filter((t): t is PgTable => is(t, PgTable)))
    for (const column of getTableConfig(table).columns)
      if (column.getSQLType() === "jsonb") {
        const read = column.mapFromDriverValue.bind(column);
        column.mapFromDriverValue = (value: unknown) =>
          value instanceof String ? JSON.parse(value.valueOf()) : read(value);
      }
}

const unquote = (id: string) => id.trim().replace(/^"|"$/g, "");

/** Top-level comma-separated items of a parenthesised list's inside. */
function splitItems(inside: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of inside) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      items.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  items.push(cur);
  return items;
}

/** One value of an insert row: an omitted column (`null`,
 *  `(unixepoch())`) takes its default, and epoch seconds go to a timestamp
 *  column as one. */
function insertValue(value: string, timestamp: boolean): string {
  const v = value.trim();
  if (/^null$/i.test(v) || /^\(unixepoch\(\)\)$/i.test(v)) return "DEFAULT";
  return timestamp && /^\$\d+$/.test(v) ? `to_timestamp(${v})` : v;
}

/** An insert's rows, each value through insertValue. */
function insertValues(out: string): string {
  const head = /^\s*insert\s+into\s+"([^"]+)"\s*\(([^)]*)\)\s+values\s/is.exec(
    out,
  );
  if (!head) return out;
  const { timestamps } = columnsOf(head[1]!);
  const columns = head[2]!.split(",").map(unquote);
  const start = head[0].length;
  const end = out.search(/\s(on conflict|returning)\s/i);
  const rows = out.slice(start, end < 0 ? undefined : end);
  let fixed = "";
  let depth = 0;
  let row = "";
  for (const ch of rows) {
    if (ch === "(" && depth++ === 0) {
      row = "";
      continue;
    }
    if (ch === ")" && --depth === 0) {
      const values = splitItems(row).map((item, i) =>
        insertValue(item, timestamps.has(columns[i]!)),
      );
      fixed += `(${values.join(", ")})`;
      continue;
    }
    if (depth > 0) row += ch;
    else fixed += ch;
  }
  return out.slice(0, start) + fixed + (end < 0 ? "" : out.slice(end));
}

/** An update's epoch seconds go to a timestamp column as one. */
function updateSet(out: string): string {
  const head = /^\s*update\s+"([^"]+)"\s+set\s/is.exec(out);
  const timestamps = head ? columnsOf(head[1]!).timestamps : undefined;
  if (!timestamps?.size) return out;
  return out.replace(
    /"([a-z0-9_]+)" = (\$\d+)/g,
    (m: string, col: string, param: string) =>
      timestamps.has(col) ? `"${col}" = to_timestamp(${param})` : m,
  );
}

/** `INSERT OR REPLACE` as an upsert on the first unique column it writes. */
function orReplace(out: string): string {
  const head =
    /^\s*insert\s+or\s+replace\s+into\s+"?([a-z0-9_]+)"?\s*\(([^)]*)\)/i.exec(
      out,
    );
  if (!head) return out;
  const columns = head[2]!.split(",").map(unquote);
  const target = columnsOf(head[1]!).unique.find((c) => columns.includes(c));
  if (!target) return out;
  const set = columns
    .filter((c) => c !== target)
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(", ");
  return `${out.replace(/^\s*insert\s+or\s+replace\s/i, "insert ")} on conflict ("${target}") do update set ${set}`;
}

/**
 * SQLite's SQL as drizzle's SQLite dialect (or a test) writes it, for
 * PostgreSQL: `?` placeholders become `$n`; an insert's omitted columns
 * take their defaults; epoch seconds written to a timestamp column become
 * one; a conflict target loses its table name; `INSERT OR IGNORE` is
 * `ON CONFLICT DO NOTHING` and `INSERT OR REPLACE` an upsert; `unixepoch()` is now().
 */
export function toPostgresSql(sqliteSql: string): string {
  let n = 0;
  let out = "";
  let quote: string | null = null;
  for (const ch of sqliteSql) {
    if (quote) {
      if (ch === quote) quote = null;
      out += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else out += ch === "?" ? `$${++n}` : ch;
  }
  out = orReplace(out);
  const ignore = /^\s*insert\s+or\s+ignore\s/i;
  if (ignore.test(out)) {
    out = out.replace(ignore, "insert ");
    const r = out.search(/\sreturning\s/i);
    out =
      r < 0
        ? `${out} on conflict do nothing`
        : `${out.slice(0, r)} on conflict do nothing${out.slice(r)}`;
  }
  out = updateSet(insertValues(out)).replace(
    /on conflict \(([^)]*)\)/i,
    (_m: string, target: string) =>
      `on conflict (${target.replace(/"[^"]+"\./g, "")})`,
  );
  return out.replace(/unixepoch\(\)/gi, "now()");
}

const objects = (r: NonNullable<Reply["result"]>) =>
  r.rows as Record<string, unknown>[];

/** A statement with better-sqlite3's methods. */
class Statement {
  private rawMode = false;
  constructor(
    private readonly url: string,
    private readonly sql: string,
  ) {}
  get reader(): boolean {
    return /^\s*(select|with|pragma)\b|\breturning\b/i.test(this.sql);
  }
  raw(on = true): this {
    this.rawMode = on;
    return this;
  }
  private query(params: unknown[], sql = this.sql) {
    return call({
      op: "query",
      url: this.url,
      sql: toPostgresSql(sql),
      params,
      raw: this.rawMode,
    });
  }
  /** The rows; in raw mode (drizzle mapping its columns) a JSON cell is
   *  marked as text read from PostgreSQL (see jsonFromBridge). */
  private rows(params: unknown[]): unknown[] {
    const r = this.query(params);
    if (!this.rawMode || !r.json.includes(true)) return r.rows;
    return (r.rows as unknown[][]).map((row) =>
      row.map((v, i) => (r.json[i] && typeof v === "string" ? bridged(v) : v)),
    );
  }
  all(...params: unknown[]): unknown[] {
    return this.rows(params);
  }
  get(...params: unknown[]): unknown {
    return this.rows(params)[0];
  }
  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    // better-sqlite3 reports the inserted row's id.
    const insert =
      /^\s*insert\s/i.test(this.sql) && !/\breturning\b/i.test(this.sql);
    const raw = this.rawMode;
    this.rawMode = false;
    const r = this.query(params, insert ? `${this.sql} returning *` : this.sql);
    this.rawMode = raw;
    const last = objects(r).at(-1);
    return {
      changes: r.rowCount,
      lastInsertRowid: Number(last?.["id"] ?? 0),
    };
  }
}

/** The better-sqlite3 surface the router tests and drizzle use. */
export class PostgresAsSqlite {
  open = true;
  constructor(readonly url: string) {}
  prepare(sql: string): Statement {
    return new Statement(this.url, sql);
  }
  exec(sql: string): this {
    call({ op: "query", url: this.url, sql: toPostgresSql(sql), params: [] });
    return this;
  }
  /** SQLite-only settings mean nothing here. */
  pragma(): unknown[] {
    return [];
  }
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const run = (...args: A): R => {
      this.exec("BEGIN");
      try {
        const result = fn(...args);
        this.exec("COMMIT");
        return result;
      } catch (e) {
        this.exec("ROLLBACK");
        throw e;
      }
    };
    return Object.assign(run, {
      deferred: run,
      immediate: run,
      exclusive: run,
    });
  }
  close(): void {
    if (!this.open) return;
    this.open = false;
    call({ op: "end", url: this.url });
  }
}

// ── One database per caller, copied from a migrated template ──

function requireTestUrl(): URL {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "LEDGR_ROUTER_DIALECT=postgres needs TEST_DATABASE_URL (a throwaway database ending in _test)",
    );
  const parsed = new URL(url);
  if (!parsed.pathname.replace(/^\//, "").endsWith("_test"))
    throw new Error(
      `TEST_DATABASE_URL must name a throwaway database ending in _test (got "${parsed.pathname}")`,
    );
  return parsed;
}

const dbUrl = (base: URL, name: string) => {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
};

/** What the template holds: the migrations and the reference data. */
function templateStamp(): string {
  const h = createHash("sha256");
  const files = [
    "drizzle/meta/_journal.json",
    ...fs
      .readdirSync("tax-data")
      .sort()
      .map((f) => path.join("tax-data", f)),
    ...fs
      .readdirSync("reference-data")
      .sort()
      .map((f) => path.join("reference-data", f)),
  ];
  for (const f of files)
    if (fs.statSync(f).isFile()) h.update(f).update(fs.readFileSync(f));
  return h.digest("hex").slice(0, 16);
}

let template: Promise<string> | null = null;

/** The template's name, built under the test database's lock by the
 *  first worker that needs it and reused while its stamp matches. */
function ensureTemplate(admin: pg.Client, base: URL): Promise<string> {
  template ??= (async () => {
    const baseName = base.pathname.replace(/^\//, "");
    const name = `${baseName}_routers_tpl`;
    const stamp = templateStamp();
    await admin.query("SELECT pg_advisory_lock($1, $2)", [
      ...TEST_DATABASE_LOCK,
    ]);
    try {
      const { rows } = await admin.query<{ stamp: string | null }>(
        "SELECT shobj_description(oid, 'pg_database') AS stamp FROM pg_database WHERE datname = $1",
        [name],
      );
      if (rows[0]?.stamp === stamp) return name;
      if (rows.length > 0)
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${name}"`);
      const backupDir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-routers-"));
      try {
        const { runMigrator } = await import("./fresh-install-cases");
        runMigrator({
          DATABASE_URL: dbUrl(base, name),
          LEDGR_BACKUP_DIR: backupDir,
          NEXTAUTH_SECRET: "routers-postgres-test-placeholder-secret-32+",
        });
      } finally {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
      await admin.query(`COMMENT ON DATABASE "${name}" IS '${stamp}'`);
      return name;
    } finally {
      await admin.query("SELECT pg_advisory_unlock($1, $2)", [
        ...TEST_DATABASE_LOCK,
      ]);
    }
  })();
  return template;
}

let admin: Promise<pg.Client> | null = null;
let count = 0;

export type PostgresTestDatabase = {
  /** The app's view: drizzle on node-postgres with the PostgreSQL schema. */
  db: ReturnType<typeof drizzle<typeof pgSchema>>;
  pool: pg.Pool;
  /** The test's view: better-sqlite3's surface on the same database. */
  sqlite: PostgresAsSqlite;
  /** Close both views and drop the database (in the background). */
  drop: () => void;
};

/** A fresh database for one caller, copied from the template. */
export async function openPostgresTestDatabase(): Promise<PostgresTestDatabase> {
  const base = requireTestUrl();
  admin ??= (async () => {
    const c = new pg.Client({ connectionString: base.toString() });
    await c.connect();
    return c;
  })();
  const a = await admin;
  const tpl = await ensureTemplate(a, base);
  const name = `${tpl.replace(/_tpl$/, "")}_${process.pid}_${++count}`;
  await a.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await a.query(`CREATE DATABASE "${name}" TEMPLATE "${tpl}"`);
  const url = dbUrl(base, name);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  // Teardown drops the database WITH (FORCE), which terminates any client the
  // pool still holds; pg emits that on the pool, and unheard it fails the run.
  pool.on("error", () => {});
  const sqlite = new PostgresAsSqlite(url);
  return {
    db: drizzle(pool, { schema: pgSchema }),
    pool,
    sqlite,
    drop: () => {
      sqlite.close();
      void pool
        .end()
        .then(() => a.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`))
        .catch(() => undefined);
    },
  };
}
