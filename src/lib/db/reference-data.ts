/**
 * Reference data (contribution limits, tax brackets, LTCG / IRMAA brackets,
 * poverty lines, tax-data revisions) comes from the tax-data file,
 * `tax-data/us-federal.json` — one source, reviewed in the public repo. The
 * migrator applies it on every start (db-migrate.ts); the rules for what it
 * may change are in reference-reconcile-core.ts.
 *
 * Paths that rewrite those tables in a running app — a version restore, a
 * backup import, "Reset all data" — re-apply it here, so the tables never
 * sit older (or empty) until the next restart. Demo schemas are built from
 * the file too, never from the household's own rows.
 */
import * as fs from "fs";
import * as path from "path";
import { sql, type SQL } from "drizzle-orm";
import { execRaw, queryRaw } from "./compat";
import { isPostgres } from "./dialect";
import { log } from "@/lib/logger";
import {
  reconcileReferenceRows,
  type TaxDataFile,
} from "./reference-reconcile-core";

/** The tables the reference data writes (db-migrate.ts keeps the same set;
 *  a test checks). */
export const REFERENCE_TABLES = [
  "contribution_limits",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
] as const;
export type ReferenceTable = (typeof REFERENCE_TABLES)[number];

/** The shipped tax-data file, read from disk (the Docker image copies
 *  `tax-data/`; never bundled, so the app and the migrator read one file). */
export function readTaxDataFile(): TaxDataFile {
  return JSON.parse(
    fs.readFileSync(path.resolve("./tax-data/us-federal.json"), "utf-8"),
  ) as TaxDataFile;
}

/** `?` placeholders → a parameterised Drizzle query (either dialect). */
export function toSql(text: string, params: unknown[]): SQL {
  const parts = text.split("?");
  return sql.join(
    parts.map((part, i) =>
      i < params.length ? sql`${sql.raw(part)}${params[i]}` : sql.raw(part),
    ),
  );
}

type Db = Parameters<typeof execRaw>[0];

/** Run the reconcile's statements on `db`. */
function runOn(db: Db) {
  return async (text: string, params: unknown[]) => {
    const q = toSql(text, params);
    if (/^\s*SELECT/i.test(text)) return queryRaw(db, q);
    await execRaw(db, q);
    return [];
  };
}

/** Apply the tax-data file to `db` (throws on failure). On Postgres it runs
 *  in one transaction, so a failure part-way leaves nothing half applied
 *  (SQLite here is tests and CI, whose driver can't run an async
 *  transaction; it's idempotent either way). */
export async function applyReferenceData(db: Db): Promise<void> {
  const file = readTaxDataFile();
  const dialect = isPostgres() ? "pg" : "sqlite";
  if (dialect === "sqlite" || !("transaction" in db)) {
    await reconcileReferenceRows(runOn(db), dialect, file);
    return;
  }
  const pg = db as Db & {
    transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
  };
  await pg.transaction((tx) => reconcileReferenceRows(runOn(tx), "pg", file));
}

/** Re-apply the tax-data file — run after anything that replaced or
 *  emptied the reference tables. Never throws: it runs after that change
 *  has committed, so a failure here is logged (the next start's migrate
 *  reconciles anyway) rather than reported as the restore failing. Returns
 *  whether it applied. */
export async function reconcileReferenceData(db: Db): Promise<boolean> {
  try {
    await applyReferenceData(db);
    return true;
  } catch (err) {
    log("warn", "reference_data_reconcile_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
