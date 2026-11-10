/**
 * Applies the tax-data file (`tax-data/us-federal/`), then a newer admin-approved community
 * update, on start (db-migrate.ts) and after a restore, import or reset; the rules are in
 * reference-reconcile-core.ts. Simulation presets are seeded only into empty preset tables.
 */
import * as fs from "fs";
import * as path from "path";
import { sql, type SQL } from "drizzle-orm";
import { execRaw, queryRaw } from "../compat";
import { isPostgres } from "../dialect";
import { log } from "@/lib/logger";
import {
  reconcileReferenceRows,
  reconcileReferenceRowsSync,
  type RefChange,
  type RefMode,
  type RefQuery,
  type RefQuerySync,
  pickApprovedCommunityFile,
  type TaxDataFile,
  TAX_DATA_DIR,
  readTaxDataDir,
  parseSimulationPresets,
  seedSimulationPresets,
  seedSimulationPresetsSync,
  SIMULATION_PRESETS_FILE,
  type SimulationPresetsFile,
} from "./reference-reconcile-core";

/** The tables the reference data writes (a test checks the shipped rows
 *  name only these). */
export const REFERENCE_TABLES = [
  "contribution_limits",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
] as const;
export type ReferenceTable = (typeof REFERENCE_TABLES)[number];

/** The shipped tax data, read from disk once and assembled into one file
 *  (the Docker image copies `tax-data/`; never bundled, so the app and the
 *  migrator read the same files). Shared — don't mutate it. */
let shippedFile: TaxDataFile | undefined;
export function readTaxDataFile(): TaxDataFile {
  shippedFile ??= readTaxDataDir(fs, path.resolve(TAX_DATA_DIR));
  return shippedFile;
}

/** The shipped Simulation presets, read from disk once (the Docker image
 *  copies `reference-data/`). Shared — don't mutate it. */
let shippedPresets: SimulationPresetsFile | undefined;
export function readSimulationPresetsFile(): SimulationPresetsFile {
  shippedPresets ??= parseSimulationPresets(
    fs.readFileSync(path.resolve(SIMULATION_PRESETS_FILE), "utf-8"),
  );
  return shippedPresets;
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

type RawDb = Parameters<typeof execRaw>[0];

/** Run the reconcile's statements on `db`. */
function runOn(db: RawDb) {
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
function sqliteClient(db: RawDb): SqliteClient | null {
  const client = (db as { $client?: unknown }).$client as
    SqliteClient | undefined;
  return client && typeof client.prepare === "function" ? client : null;
}

/** Run `sync` (better-sqlite3's own transaction) or `async` (Postgres, in
 *  one transaction when `db` can open one) against `db`. */
async function inReferenceTransaction<T>(
  db: RawDb,
  sync: (run: RefQuerySync) => T,
  async: (run: RefQuery, dialect: "pg" | "sqlite") => Promise<T>,
): Promise<T> {
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
      return client.transaction(() => sync(run))();
    }
  }
  if (!isPostgres() || !("transaction" in db))
    return async(runOn(db), isPostgres() ? "pg" : "sqlite");
  const pg = db as RawDb & {
    transaction: <U>(fn: (tx: RawDb) => Promise<U>) => Promise<U>;
  };
  return pg.transaction((tx) => async(runOn(tx), "pg"));
}

/** Run `files` in order (each with its mode) in one transaction; step 5
 *  (carry-forward) runs with the last. Exported for tests. */
export async function reconcileTaxDataFiles(
  db: RawDb,
  files: { file: TaxDataFile; mode: RefMode }[],
): Promise<RefChange[]> {
  const last = files.length - 1;
  return inReferenceTransaction(
    db,
    (run) =>
      files.flatMap(
        ({ file, mode }, i) =>
          reconcileReferenceRowsSync(run, file, mode, i === last).changes,
      ),
    async (run, dialect) => {
      const changes: RefChange[] = [];
      for (const [i, { file, mode }] of files.entries())
        changes.push(
          ...(
            await reconcileReferenceRows(run, dialect, file, mode, i === last)
          ).changes,
        );
      return changes;
    },
  );
}

/** Seed the shipped presets into `db` when its preset tables are all
 *  empty, in its own transaction; returns the rows inserted. */
export async function seedShippedPresets(db: RawDb): Promise<number> {
  const presets = readSimulationPresetsFile();
  return inReferenceTransaction(
    db,
    (run) => seedSimulationPresetsSync(run, presets),
    (run, dialect) => seedSimulationPresets(run, dialect, presets),
  );
}

/** The newest community update an admin approved that this version can
 *  read, when it's newer than the shipped file (null otherwise). */
export async function approvedCommunityFile(
  db: RawDb,
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

/** Apply the tax data in one transaction (shipped file, then a newer approved community
 *  update), then the presets in their own when empty. Throws on failure. */
export async function applyReferenceData(db: RawDb): Promise<void> {
  const file = readTaxDataFile();
  const community = await approvedCommunityFile(db, file.dataVersion);
  await reconcileTaxDataFiles(db, [
    { file, mode: "seed" },
    ...(community ? [{ file: community, mode: "community" as const }] : []),
  ]);
  await seedShippedPresets(db);
}

/** Apply an approved community update (one transaction); returns the
 *  figures it changed. */
export async function applyCommunityTaxData(
  db: RawDb,
  file: TaxDataFile,
): Promise<RefChange[]> {
  return reconcileTaxDataFiles(db, [{ file, mode: "community" }]);
}

/** What applying a community update would change, without writing. */
export async function previewCommunityTaxData(
  db: RawDb,
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

/** Re-apply the tax data after anything replaces or empties the reference tables; returns
 *  whether it applied. Never throws: that change already committed, so a failure is logged. */
export async function reconcileReferenceData(db: RawDb): Promise<boolean> {
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
