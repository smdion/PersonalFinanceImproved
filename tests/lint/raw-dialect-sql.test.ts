/**
 * Raw SQL runs through `lib/db/compat.ts`, so it works on both dialects
 * (RULES: SQLite and PostgreSQL are equally supported).
 *
 *   A. Outside the database layer, nothing runs raw SQL itself:
 *      `.execute(` exists only on PostgreSQL and `.all(sql…)` /
 *      `.run(sql…)` / `.get(sql…)` only on SQLite; `queryRaw` and
 *      `execRaw` pick the dialect at call time.
 *   B. SQL only one dialect understands (`PRAGMA`, `pg_…`, a `::type`
 *      cast, `jsonb`, `ILIKE`, `strftime`, `json_extract`) sits only in a
 *      file that branches on the dialect (`isPostgres()`).
 *
 * The database layer itself is exempt: `compat.ts`, the per-dialect schema
 * folders (`lib/db/pg/`, `lib/db/sqlite/`) and the migrator
 * (`lib/db/migrate/`), which is dialect-aware by design. The other
 * exceptions are listed with their reasons and may only shrink.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

const DATABASE_LAYER = [
  "lib/db/compat.ts",
  "lib/db/pg/",
  "lib/db/sqlite/",
  "lib/db/migrate/",
];

/** Files that run raw SQL themselves, each with its reason. */
const RUNS_RAW_SQL: Record<string, string> = {
  "server/services/demo/demo-schema.ts":
    "demo schemas exist only on PostgreSQL (DEMO_ONLY installs)",
};

const RUNS_RAW = /\.execute\(|\.(?:all|run|get)\(\s*sql[`.]/;
const ONE_DIALECT =
  /\bPRAGMA\b|\bpg_[a-z_]+|::[a-z][a-z0-9_]*\b|\bjsonb\b|\bILIKE\b|\bstrftime\(|\bjson_extract\(/;
/** An `sql` template or `sql.raw(…)` string, up to its closing backtick. */
const SQL_TEXT = /\bsql(?:\.raw\()?`([^`]*)`/g;

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(e.name)) yield full;
  }
}

function files(): { rel: string; text: string }[] {
  return [...sources(SRC)]
    .map((f) => ({
      rel: path.relative(SRC, f).split(path.sep).join("/"),
      text: fs.readFileSync(f, "utf8"),
    }))
    .filter(({ rel }) => !DATABASE_LAYER.some((d) => rel.startsWith(d)));
}

/** The file's text without line comments and block comments. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("raw SQL goes through lib/db/compat.ts", () => {
  it("A. nothing outside the database layer runs raw SQL itself", () => {
    const running = files()
      .filter(({ text }) => RUNS_RAW.test(code(text)))
      .map(({ rel }) => rel);
    expect(
      running.filter((r) => !(r in RUNS_RAW_SQL)),
      "run raw SQL with queryRaw/execRaw from lib/db/compat.ts",
    ).toEqual([]);
    expect(
      Object.keys(RUNS_RAW_SQL).filter((r) => !running.includes(r)),
      "no longer runs raw SQL: remove it from RUNS_RAW_SQL",
    ).toEqual([]);
  });

  it("B. one dialect's SQL sits only in a file that branches on the dialect", () => {
    const unbranched = files()
      .filter(({ rel, text }) => {
        const body = code(text);
        const oneDialect = [...body.matchAll(SQL_TEXT)].some((m) =>
          ONE_DIALECT.test(m[1]!),
        );
        return (
          oneDialect && !/\bisPostgres\(/.test(body) && !(rel in RUNS_RAW_SQL)
        );
      })
      .map(({ rel }) => rel);
    expect(unbranched).toEqual([]);
  });
});
