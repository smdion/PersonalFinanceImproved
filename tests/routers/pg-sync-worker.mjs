/**
 * The worker behind postgres-router-db.ts: runs one query at a time on a
 * PostgreSQL connection and wakes the waiting test thread. Values come back
 * as better-sqlite3 gives them for the SQLite schema: booleans 1/0,
 * timestamps as epoch seconds, dates and JSON as text, bigints as numbers.
 */
import { parentPort, workerData } from "node:worker_threads";
import pg from "pg";

const { flag, port } = workerData;
const wake = new Int32Array(flag);

const epochSeconds = (iso) => Math.floor(Date.parse(iso) / 1000);

const types = {
  getTypeParser(oid, format) {
    switch (oid) {
      case 16: // bool
        return (v) => (v === "t" ? 1 : 0);
      case 1114: // timestamp, stored as UTC
        return (v) => epochSeconds(`${v.replace(" ", "T")}Z`);
      case 1184: // timestamptz: "+00" → "+00:00"
        return (v) =>
          epochSeconds(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
      case 20: // int8
        return (v) => Number(v);
      case 1082: // date
      case 114: // json
      case 3802: // jsonb
      case 1700: // numeric
        return (v) => v;
      default:
        return pg.types.getTypeParser(oid, format);
    }
  },
};

/** One connection per database, by URL. */
const clients = new Map();

async function client(url) {
  let c = clients.get(url);
  if (!c) {
    c = new pg.Client({
      connectionString: url,
      types,
      options: "-c TimeZone=UTC",
    });
    await c.connect();
    clients.set(url, c);
  }
  return c;
}

async function handle(msg) {
  if (msg.op === "end") {
    const c = clients.get(msg.url);
    clients.delete(msg.url);
    await c?.end();
    return null;
  }
  const c = await client(msg.url);
  const res = await c.query({
    text: msg.sql,
    values: msg.params,
    rowMode: msg.raw ? "array" : undefined,
  });
  const last = Array.isArray(res) ? res.at(-1) : res;
  return {
    rows: last?.rows ?? [],
    rowCount: last?.rowCount ?? 0,
    fields: (last?.fields ?? []).map((f) => f.name),
  };
}

parentPort.on("message", async (msg) => {
  try {
    port.postMessage({ result: await handle(msg) });
  } catch (e) {
    port.postMessage({
      error: { message: e?.message ?? String(e), code: e?.code ?? null },
    });
  }
  Atomics.store(wake, 0, 1);
  Atomics.notify(wake, 0);
});
