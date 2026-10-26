/**
 * Reference data (contribution limits, tax brackets, LTCG / IRMAA brackets,
 * poverty lines, tax-data revisions) comes from the tax-data file,
 * `tax-data/us-federal.json` — one source, reviewed in the public repo. The
 * migrator applies it on every start (db-migrate.ts); the rules for what it
 * may change are in reference-reconcile-core.ts.
 *
 * Paths that rewrite those tables in a running app — a version restore, a
 * backup import, "Reset all data" — re-apply it here, so the tables never
 * sit older (or empty) until the next restart. A community update an admin
 * approved (tax_data_updates) is applied after the shipped file whenever
 * it's newer, so it stands in for the shipped data from then on. Demo
 * schemas are built from the files too, never from the household's rows.
 */
import * as fs from "fs";
import * as path from "path";
import { sql, type SQL } from "drizzle-orm";
import { execRaw, queryRaw } from "./compat";
import { isPostgres } from "./dialect";
import { log } from "@/lib/logger";
import {
  reconcileReferenceRows,
  reconcileReferenceRowsSync,
  type RefChange,
  type RefMode,
  pickApprovedCommunityFile,
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

/** The shipped tax-data file, read from disk once (the Docker image copies
 *  `tax-data/`; never bundled, so the app and the migrator read one file).
 *  Shared — don't mutate it. */
let shippedFile: TaxDataFile | undefined;
export function readTaxDataFile(): TaxDataFile {
  shippedFile ??= JSON.parse(
    fs.readFileSync(path.resolve("./tax-data/us-federal.json"), "utf-8"),
  ) as TaxDataFile;
  return shippedFile;
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

/** The better-sqlite3 client behind a SQLite Drizzle instance (its own
 *  transactions are synchronous; Drizzle's async one doesn't hold). */
type SqliteClient = {
  prepare: (sql: string) => {
    reader: boolean;
    all: (...p: unknown[]) => unknown[];
    run: (...p: unknown[]) => unknown;
  };
  transaction: <T>(fn: () => T) => () => T;
};
function sqliteClient(db: Db): SqliteClient | null {
  const client = (db as { $client?: unknown }).$client as
    SqliteClient | undefined;
  return client && typeof client.prepare === "function" ? client : null;
}

/** Run `files` in order (each with its mode) in one transaction; step 5
 *  (carry-forward) runs with the last. Exported for tests. */
export async function reconcileTaxDataFiles(
  db: Db,
  files: { file: TaxDataFile; mode: RefMode }[],
): Promise<RefChange[]> {
  const changes: RefChange[] = [];
  const last = files.length - 1;
  if (!isPostgres()) {
    const client = sqliteClient(db);
    if (client) {
      const run = (text: string, params: unknown[]) => {
        const stmt = client.prepare(text);
        if (stmt.reader)
          return stmt.all(...params) as Record<string, unknown>[];
        stmt.run(...params);
        return [];
      };
      client.transaction(() => {
        files.forEach(({ file, mode }, i) =>
          changes.push(
            ...reconcileReferenceRowsSync(run, file, mode, i === last).changes,
          ),
        );
      })();
      return changes;
    }
  }
  const go = async (target: Db, dialect: "pg" | "sqlite") => {
    for (const [i, { file, mode }] of files.entries())
      changes.push(
        ...(
          await reconcileReferenceRows(
            runOn(target),
            dialect,
            file,
            mode,
            i === last,
          )
        ).changes,
      );
  };
  if (!isPostgres() || !("transaction" in db)) {
    await go(db, isPostgres() ? "pg" : "sqlite");
    return changes;
  }
  const pg = db as Db & {
    transaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>;
  };
  await pg.transaction((tx) => go(tx, "pg"));
  return changes;
}

/** The newest community update an admin approved that this version can
 *  read, when it's newer than the shipped file (null otherwise). */
export async function approvedCommunityFile(
  db: Db,
  shippedVersion = readTaxDataFile().dataVersion,
): Promise<TaxDataFile | null> {
  const rows = (await queryRaw(
    db,
    toSql(
      "SELECT file_text FROM tax_data_updates WHERE status = 'applied'",
      [],
    ),
  )) as { file_text: string }[];
  return pickApprovedCommunityFile(rows, shippedVersion);
}

/** Apply the tax data to `db` (throws on failure), in one transaction:
 *  the shipped file, then a newer approved community update. A demo
 *  schema finds the install's updates through its search_path. */
export async function applyReferenceData(db: Db): Promise<void> {
  const file = readTaxDataFile();
  const community = await approvedCommunityFile(db, file.dataVersion);
  await reconcileTaxDataFiles(db, [
    { file, mode: "seed" },
    ...(community ? [{ file: community, mode: "community" as const }] : []),
  ]);
}

/** Apply an approved community update (one transaction); returns the
 *  figures it changed. */
export async function applyCommunityTaxData(
  db: Db,
  file: TaxDataFile,
): Promise<RefChange[]> {
  return reconcileTaxDataFiles(db, [{ file, mode: "community" }]);
}

/** What applying a community update would change, without writing. */
export async function previewCommunityTaxData(
  db: Db,
  file: TaxDataFile,
): Promise<RefChange[]> {
  const run = async (text: string, params: unknown[]) =>
    /^\s*SELECT/i.test(text)
      ? ((await queryRaw(db, toSql(text, params))) as Record<string, unknown>[])
      : [];
  return (
    await reconcileReferenceRows(
      run,
      isPostgres() ? "pg" : "sqlite",
      file,
      "community",
    )
  ).changes;
}

/** Re-apply the tax data — run after anything that replaced or emptied
 *  the reference tables. Never throws: it runs after that change has
 *  committed, so a failure here is logged (the next start's migrate
 *  reconciles anyway) rather than reported as the restore failing. Returns
 *  whether it applied. */
export async function reconcileReferenceData(db: Db): Promise<boolean> {
  try {
    await applyReferenceData(db);
    return true;
  } catch (err) {
    log("warn", "reference_data_reconcile_failed", {
      error: err instanceof Error ? err.message : String(err),
      dataVersion: readTaxDataFile().dataVersion,
      communityDataVersion: await approvedCommunityFile(db)
        .then((f) => f?.dataVersion ?? null)
        .catch(() => null),
    });
    return false;
  }
}
