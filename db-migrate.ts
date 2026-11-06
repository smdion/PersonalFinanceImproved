import * as fs from "fs";
import * as nodeCrypto from "crypto";
import * as path from "path";
// esbuild bundles these into db-migrate.js (build:migrator), so the image's
// migrator runs the app's own code without src/ or the Next build.
import {
  DEMO_SCHEMA_MARKER_PREFIX,
  MIGRATION_STAMP_SUBQUERY,
} from "./src/lib/db/demo-schema-marker";
import {
  parseSimulationPresets,
  pickApprovedCommunityFile,
  readTaxDataDir,
  reconcileReferenceRows,
  reconcileReferenceRowsSync,
  seedSimulationPresets,
  seedSimulationPresetsSync,
  SIMULATION_PRESETS_FILE,
  TAX_DATA_DIR,
  type RefQuery,
  type SimulationPresetsFile,
  type TaxDataFile,
} from "./src/lib/db/reference-reconcile-core";
import { VERSION_TABLE_NAMES } from "./src/lib/db/version-tables";
import {
  MIGRATION_CONVERTERS,
  runConverterPg,
  runConverterSqlite,
} from "./src/lib/db/migration-converters";

function log(
  level: "info" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>,
) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...data };
  if (level === "error") console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

function getDialect(): "postgresql" | "sqlite" {
  const url = process.env.DATABASE_URL;
  if (
    url &&
    (url.startsWith("postgres://") || url.startsWith("postgresql://"))
  ) {
    return "postgresql";
  }
  return "sqlite";
}

/**
 * Reference-data reconcile: the tax data (tax-data/us-federal/, one file a
 * year, assembled by assembleTaxData) is
 * applied on every migrate, in public and in each live demo schema, so a new
 * tax year or a corrected figure reaches existing installs — without ever
 * touching a figure the household changed (see reconcileReferenceRows).
 * The Simulation presets (reference-data/) are seeded only where every
 * preset table is empty (see presetSeedSteps). Both come from
 * src/lib/db/reference-reconcile-core.ts, the code the app runs.
 */
function readTaxDataFile(): TaxDataFile {
  return readTaxDataDir(fs, path.resolve(TAX_DATA_DIR));
}

function readSimulationPresetsFile(): SimulationPresetsFile {
  return parseSimulationPresets(
    fs.readFileSync(path.resolve(SIMULATION_PRESETS_FILE), "utf-8"),
  );
}

// ---------------------------------------------------------------------------
// Squash upgrade detection + backup (PostgreSQL)
// ---------------------------------------------------------------------------

type SquashResult = {
  backupPath: string | null;
  schemaVersion: string | null;
  wasSquash: boolean;
};

// sha256 of each per-release squashed-baseline migration file, as it existed
// while that release line was current. On any post-squash install, the
// EARLIEST row in __drizzle_migrations is exactly this baseline — an exact,
// unambiguous era signal. A pure schema-shape probe CANNOT distinguish, e.g.,
// a v0.7.0 install from a v0.6.8 one: the v7 squashed baseline *is* the v0.6.8
// schema tip, so no table or column exists in one and not the other.
const BASELINE_HASHES: Record<string, string> = {
  "952dea4c31cf5524148c004239222928a754785719f49651e2b83784d474a22b":
    "v0.7_final",
  "08f641ca8ae0681a1e836dab77b0421bbb6949d68ac04d115b1f58539e32a3d0":
    "v0.6_final",
};

// sha256 of every PostgreSQL migration file of the v0.8 line, including the
// pre-release 0004–0011 that v0.8.5 squashed into one. Those files are in no
// journal since the v0.9.0 squash, so their hashes are frozen here. A squash
// freezes the outgoing line's hashes here first (its journal goes).
const PRE_V09_MIGRATION_HASHES: Record<string, string> = {
  a626ffc04645cdc4d3a28b0793d380796c27be18d954ba22b62514018d595d5f:
    "0000_v8_initial_schema",
  fcdc386e4feec343e36bf406408b945085d25e3ab894400c35380eae6f089db1:
    "0001_nappy_blade",
  "1e41b0bc9dffb0f161e934366d6bca24f7eb760c2a36dfa1089570c8c5a264f7":
    "0002_talented_monster_badoon",
  "3885f68b63400bafa5255385298f696ac03762bde8d62f63d10eafdfd87ab59d":
    "0003_past_rhodey",
  "604efb62e506b15c0e4fb1badcd39e8322e6029754caeb07aa655d9883d40995":
    "0004_simple_rogue",
  "0fdbea5668319cde21964cdc4731467be705ca30948d1277d751f0b2600213c2":
    "0005_light_prima",
  bf1ae798460566c4643eaa7513f73346fa19db826e20c822fbb748b2f44caad0:
    "0006_empty_zarda",
  a67207de4f5756238733969d786dd6b3e50425e0cdb7806c709af5c8d723ea6a:
    "0007_bizarre_zarek",
  "20aa1a547298db796e508d3f2a3b89e8e288e8926ea5c44d662831f03efbddb8":
    "0008_worthless_talisman",
  "714af5cf53b1209c1ce826835d770efa3f119848479cd8bb0c0d8d050644af2b":
    "0009_icy_black_cat",
  "540178c73bb2f46266a77e5b57eafab7f90913c3641fe03ab0fb2d1bfecccca0":
    "0010_red_ink",
  "5d38e8c357c954874148fe4052d3dff8a10ca116b2f873fb09a432526c3bb178":
    "0011_lumpy_maximus",
  // v0.8.5 as released (0004–0011 squashed). Keep in step with the file.
  da6dbae6f960a0e17c5d3810ad13a8971de5de1782b171d8249107e3d75ff3a7:
    "0004_v085_investments",
  // v0.8.6: savings_goals parent key + index, old roth_basis names, pending_rollovers dropped.
  b9e85651c61ef84f14d47c010ce6eebd53291b32401381f8445d340924a7886d:
    "0005_v086_schema_cleanup",
  // v0.8.8: holding history tables; legacy account_holdings dropped.
  "410f5133c53ca099b8a7e996a5f490795aeadf37fb76e8a896af234a60387964":
    "0006_v088_holding_periods",
  "18d3b73b7b2f4b5b517acf2bace36352da2177adda54e886e13b407cce3e23e7":
    "0007_v088_drop_account_holdings",
  "557d5cbc5313ee2ca388e2c5d9fbf5c03d3f0794968b4f313778389a987b5a61":
    "0008_v088_paycheck_earnings",
  // v0.8.10: Plans are sets of profiles; per-account fromBonus; unique Plan names.
  "79acc58519aec1a6bbb497fca3bd5691f987ae6f4351b3eca06174db040571e8":
    "0009_v0810_profile_sets",
  // v0.8.10: holding history per part (holding_periods.sub_key).
  "63fc76f959fa22a150d4f8227fe4cdd898f2cc8eee5ecf11a049659dd67ad92d":
    "0010_v0810_holding_period_parts",
  // v0.8.11: where reinvested RMD money goes (per Retirement Profile).
  "0366e7ae1b9763c3f54b88688d82045f70e204c8817fbad10ce68c9d9e4e975c":
    "0011_v0811_rmd_excess_target",
  // v0.8.14: Performance notes, estimated fields, accepted checks.
  "887f50d59ffe2a1e15e321d1116a106d652e8ac4ad96ec0c3d7a5db112690651":
    "0012_v0814_perf_annotations",
};

/**
 * Every known PostgreSQL migration's tag by its file's sha256: the frozen v0.8
 * line, then the journal's, hashed as drizzle records them. It names the
 * schema an older install was at, in the refusal message
 * (assertSupportedUpgradePathPg) and in the backup label when the migration
 * table is missing. A journal it can't read throws; an entry with no file
 * gets no hash.
 */
export function migrationTagsByHash(
  migrationsFolder: string,
): Record<string, string> {
  const hashes = { ...PRE_V09_MIGRATION_HASHES };
  for (const entry of readJournal(migrationsFolder).entries) {
    const hash = fileHash(nodeCrypto, `${migrationsFolder}/${entry.tag}.sql`);
    if (hash) hashes[hash] = entry.tag;
  }
  return hashes;
}

/**
 * Detect the pre-squash schema era. Hash of the earliest applied migration
 * first (exact for v0.6.x / v0.7.x), then schema-shape probes for older
 * eras that predate the squashed-baseline scheme.
 */
async function detectSchemaEra(
  client: import("pg").PoolClient,
  migrationsFolder: string,
): Promise<string> {
  // Exact, v0.8 line on: the latest migration applied. Outside the try: a
  // journal or file error throws rather than falling through to the probes.
  const tags = migrationTagsByHash(migrationsFolder);
  try {
    const { rows: lastRow } = await client.query(
      "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1",
    );
    const lastHash = lastRow[0]?.hash as string | undefined;
    const tag = lastHash ? tags[lastHash] : undefined;
    if (tag) {
      return tag;
    }
  } catch {
    // __drizzle_migrations absent or unreadable — fall through.
  }

  // Exact: the first migration a post-squash install ever applied is its
  // release-line baseline.
  try {
    const { rows: firstRow } = await client.query(
      "SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id ASC LIMIT 1",
    );
    const firstHash = firstRow[0]?.hash as string | undefined;
    if (firstHash && BASELINE_HASHES[firstHash]) {
      return BASELINE_HASHES[firstHash];
    }
  } catch {
    // __drizzle_migrations absent or unreadable — fall through to probes.
  }

  // Heuristic fallback for older eras (these installs are years old and rare;
  // their probes have never been exact but the cumulative backup-transform
  // ladder tolerates an over-conservative guess).

  // A v0.8.5+ install (has `securities`) whose migration rows can't be
  // matched: label it v0.8.5 rather than letting it fall through — since
  // 0007 dropped account_holdings, it would otherwise read as v0.5.
  const { rows: probeV085 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'securities'
    ) AS exists`,
  );
  if (probeV085[0]?.exists) return "0004_v085_investments";

  // v0.6.x install whose __drizzle_migrations lacks the baseline row:
  // account_holdings is in the v6 baseline itself.
  const { rows: probeV06 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'account_holdings'
    ) AS exists`,
  );
  if (probeV06[0]?.exists) return "v0.6_final";

  // v0.5.x has is_immutable on annual_performance (added in 0001_v5_schema_changes)
  const { rows: probeV05 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'annual_performance' AND column_name = 'is_immutable'
    ) AS exists`,
  );
  if (probeV05[0]?.exists) return "v0.5_final";

  // v0.3.x has projection_overrides table (added in v0.3.23)
  const { rows: probeV03 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'projection_overrides'
    ) AS exists`,
  );
  if (probeV03[0]?.exists) return "v0.3_final";

  // v0.2.x has is_api_sync_enabled on savings_goals (renamed in v0.2.0)
  const { rows: probeV02 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'savings_goals' AND column_name = 'is_api_sync_enabled'
    ) AS exists`,
  );
  if (probeV02[0]?.exists) return "v0.2_final";

  // v0.1.x — use the last v0.1.x tag
  return "0008_prior_year_contrib";
}

/**
 * First directory that actually accepts a write, from an ordered candidate
 * list. The pre-upgrade backup is the safety net before a destructive
 * squash / DROP, so "the directory exists" (the old `fs.existsSync`
 * heuristic) is not enough — on the hardened homelab stack the container
 * rootfs is read-only and `/app/data` is present but not a writable mount,
 * so `writeFileSync` there throws EROFS and the backup silently never
 * happened (R18).
 *
 *  1. `LEDGR_BACKUP_DIR` — point this at a writable volume mount in the
 *     deployment (the fix for a read-only-rootfs container).
 *  2. `/app/data` — the historical location; works when it IS a writable
 *     mount.
 *  3. `/tmp` — last resort that still beats no backup: it survives the
 *     migration run (long enough for an operator to copy the file out),
 *     just not a container restart. Usually a tmpfs even on a read-only
 *     rootfs.
 *  4. `.` — local/dev.
 *
 * Returns `null` only when every candidate rejects a probe write — a
 * genuinely unwritable environment, which the callers log at error level.
 */
function resolveWritableBackupDir(): string | null {
  const candidates = [
    process.env.LEDGR_BACKUP_DIR,
    "/app/data",
    "/tmp",
    ".",
  ].filter((d): d is string => !!d && d.trim().length > 0);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.pre-upgrade-backup-probe-${process.pid}`);
      fs.writeFileSync(probe, "");
      fs.unlinkSync(probe);
      return dir;
    } catch {
      // not writable — try the next candidate
    }
  }
  return null;
}

/** How many pre-upgrade backups to keep in the backup directory (newest first). */
const PRE_UPGRADE_BACKUPS_KEPT = 5;

/** Keep only the newest pre-upgrade backups — restart loops would otherwise pile them up. */
export function prunePreUpgradeBackups(backupDir: string): void {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => /^pre-upgrade-backup-.*\.(json|db)$/.test(f))
      .sort()
      .reverse();
    for (const f of files.slice(PRE_UPGRADE_BACKUPS_KEPT)) {
      fs.unlinkSync(path.join(backupDir, f));
      log("info", "pre_upgrade_backup_pruned", { file: f });
    }
  } catch (err) {
    log("warn", "pre_upgrade_backup_prune_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Warn when a backup landed somewhere a container rebuild would erase. */
function warnIfEphemeral(backupPath: string): void {
  if (process.env.LEDGR_BACKUP_DIR || backupPath.startsWith("/app/data/"))
    return;
  log("error", "pre_upgrade_backup_not_persistent", {
    path: backupPath,
    message:
      "The pre-upgrade backup was written outside a persistent volume and will be lost when the container is recreated. Copy it out now, and set LEDGR_BACKUP_DIR to a mounted directory.",
  });
}

/**
 * Export a JSON snapshot of every VERSION_TABLE_NAMES table and write it to
 * disk — the safety net before any schema change (squash or normal
 * upgrade). Same "pre-upgrade-backup-*.json" format from every call site.
 *
 * Read in one REPEATABLE READ, READ ONLY transaction so all tables come
 * from the same moment. Only a table that doesn't exist yet (added by the
 * migration about to run) is exported empty; any other read error fails
 * the backup rather than writing one with silently missing data.
 */
async function writePreMigrationBackupPg(
  client: import("pg").PoolClient,
  schemaVersion: string,
): Promise<string | null> {
  const tables: Record<string, unknown[]> = {};
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: existing } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const present = new Set(existing.map((r) => r.tablename));
    for (const tableName of VERSION_TABLE_NAMES) {
      if (!present.has(tableName)) {
        tables[tableName] = [];
        continue;
      }
      const { rows } = await client.query(`SELECT * FROM "${tableName}"`);
      tables[tableName] = rows;
    }
    await client.query("COMMIT");
  } catch (readErr) {
    await client.query("ROLLBACK").catch(() => {});
    log("error", "pre_migration_backup_read_failed", {
      error: readErr instanceof Error ? readErr.message : String(readErr),
    });
    return null;
  }

  const backup = {
    schemaVersion,
    exportedAt: new Date().toISOString(),
    preUpgradeBackup: true,
    tables,
  };

  const backupDir = resolveWritableBackupDir();
  if (!backupDir) {
    log("error", "pre_migration_backup_no_writable_dir", {
      message:
        "No writable directory for the pre-upgrade backup (tried LEDGR_BACKUP_DIR, /app/data, /tmp, .). Set LEDGR_BACKUP_DIR to a writable volume mount.",
    });
    return null;
  }
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
      backupDir,
      `pre-upgrade-backup-${timestamp}.json`,
    );
    fs.writeFileSync(backupPath, JSON.stringify(backup));
    log("info", "pre_migration_backup_complete", {
      path: backupPath,
      tableCount: Object.keys(tables).length,
      totalRows: Object.values(tables).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    });
    warnIfEphemeral(backupPath);
    prunePreUpgradeBackups(backupDir);
    return backupPath;
  } catch (backupErr) {
    log("error", "pre_migration_backup_write_failed", {
      dir: backupDir,
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Supported upgrade path + schema checks (both dialects)
// ---------------------------------------------------------------------------

/**
 * The tag a backup of a database at the baseline's schema carries: the last
 * migration of the release line squashed into `0000_v9_initial_schema`
 * (v0.8.15 shipped no migration of its own, so v0.8.14's).
 */
export const SQUASHED_LINE_TIP = "0012_v0814_perf_annotations";

/** The database is from a release this one can't upgrade directly. Never
 *  swallowed — the migration stops with the database untouched. */
export class UpgradePathError extends Error {
  override name = "UpgradePathError";
}

type Journal = { entries: { idx: number; tag: string }[] };

function readJournal(migrationsFolder: string): Journal {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(`${migrationsFolder}/meta/_journal.json`),
      "utf-8",
    ),
  );
}

function fileHash(
  crypto: typeof import("crypto"),
  filePath: string,
): string | null {
  const p = path.resolve(filePath);
  if (!fs.existsSync(p)) return null;
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(p, "utf-8"))
    .digest("hex");
}

/** Table → column names of a journal entry's drizzle snapshot. */
export function snapshotColumns(
  migrationsFolder: string,
  idx: number,
): Map<string, string[]> {
  const snap = JSON.parse(
    fs.readFileSync(
      path.resolve(
        `${migrationsFolder}/meta/${String(idx).padStart(4, "0")}_snapshot.json`,
      ),
      "utf-8",
    ),
  ) as {
    tables: Record<
      string,
      { name: string; columns: Record<string, { name: string }> }
    >;
  };
  return new Map(
    Object.values(snap.tables).map((t) => [
      t.name,
      Object.values(t.columns).map((c) => c.name),
    ]),
  );
}

/** What a snapshot has that the database doesn't ("table" or "table.column"). */
export function missingFromSnapshot(
  expected: Map<string, string[]>,
  actual: Map<string, Set<string>>,
): string[] {
  const missing: string[] = [];
  for (const [table, cols] of expected) {
    const have = actual.get(table);
    if (!have) {
      missing.push(table);
      continue;
    }
    for (const c of cols) if (!have.has(c)) missing.push(`${table}.${c}`);
  }
  return missing;
}

function columnMap(
  rows: { table_name: string; column_name: string }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!m.has(r.table_name)) m.set(r.table_name, new Set());
    m.get(r.table_name)!.add(r.column_name);
  }
  return m;
}

/**
 * Where an existing database's schema is, by the journal: the last entry
 * whose file hash is recorded, else the last entry whose snapshot's tables
 * and columns are all present and none of the columns it drops is (a
 * journal cleared by a failed run), else — the baseline's schema — the
 * squashed line's tip. The label restore transforms key on: a database not
 * yet past a drop must never be labelled at or after it, or its backup
 * would skip the restore step that removes the dropped column.
 */
export function schemaLabel(
  journal: Journal,
  migrationsFolder: string,
  recordedHashes: Set<string>,
  actual: Map<string, Set<string>>,
  crypto: typeof import("crypto"),
): string {
  const { lastAppliedTag } = pendingJournalEntries(
    journal,
    migrationsFolder,
    recordedHashes,
    crypto,
  );
  if (lastAppliedTag) return lastAppliedTag;
  for (const entry of [...journal.entries].reverse()) {
    if (entry.idx === 0) break;
    const at = snapshotColumns(migrationsFolder, entry.idx);
    if (missingFromSnapshot(at, actual).length > 0) continue;
    const before = snapshotColumns(migrationsFolder, entry.idx - 1);
    const dropped = [...before].some(([table, cols]) => {
      const kept = at.get(table);
      return cols.some((c) => !kept?.includes(c) && actual.get(table)?.has(c));
    });
    if (!dropped) return entry.tag;
  }
  return SQUASHED_LINE_TIP;
}

/** Baseline tables and columns ("table" or "table.column") that a later
 *  journal entry drops: a database past that entry lacks them without being
 *  older than the baseline. */
function droppedAfterBaseline(
  journal: Journal,
  migrationsFolder: string,
): Set<string> {
  const [baseline, ...later] = journal.entries;
  const dropped = new Set<string>();
  if (!baseline) return dropped;
  const base = snapshotColumns(migrationsFolder, baseline.idx);
  for (const entry of later) {
    const at = snapshotColumns(migrationsFolder, entry.idx);
    for (const [table, cols] of base) {
      const kept = at.get(table);
      if (!kept) dropped.add(table);
      else
        for (const c of cols)
          if (!kept.includes(c)) dropped.add(`${table}.${c}`);
    }
  }
  return dropped;
}

/** Refuse a database a newer Ledgr upgraded: it records every entry of
 *  this journal plus a migration this journal doesn't have. A replay would
 *  rewrite its journal and the newer image would then fail on every start. */
function assertNotFromNewerRelease(
  journal: Journal,
  migrationsFolder: string,
  recordedHashes: Set<string>,
  crypto: typeof import("crypto"),
): void {
  const own = new Set<string>();
  for (const entry of journal.entries) {
    const h = fileHash(crypto, `${migrationsFolder}/${entry.tag}.sql`);
    if (h === null) continue;
    if (!recordedHashes.has(h)) return;
    own.add(h);
  }
  const unknown = [...recordedHashes].filter((h) => !own.has(h)).length;
  if (unknown === 0) return;
  throw new UpgradePathError(
    `This database was upgraded by a newer Ledgr: it records ${unknown} migration(s) this release doesn't have. Restore the pre-upgrade backup, or run the newer image. Nothing has been changed.`,
  );
}

/**
 * Refuse a database older than the baseline. Squashing replays the
 * baseline's CREATE TABLEs, which an existing table silently skips — so an
 * install that predates the baseline would never get the columns its
 * release line added later. Allowed: a fresh install (no `people`), one
 * that has recorded the baseline, and one with every table and column of
 * the baseline's snapshot that no later entry drops (v0.8.14/v0.8.15, a
 * dev database on any v0.9 migration, a journal cleared by a failed run at
 * any entry). Anything else stops here, before any backup or change, and
 * so does a database from a newer release (assertNotFromNewerRelease).
 */
export function assertSupportedUpgradePath(
  journal: Journal,
  migrationsFolder: string,
  recordedHashes: Set<string>,
  actual: Map<string, Set<string>>,
  crypto: typeof import("crypto"),
  era: () => string,
): void {
  if (!actual.has("people")) return;
  assertNotFromNewerRelease(journal, migrationsFolder, recordedHashes, crypto);
  const baseline = journal.entries[0];
  if (!baseline) return;
  const baselineHash = fileHash(
    crypto,
    `${migrationsFolder}/${baseline.tag}.sql`,
  );
  if (baselineHash && recordedHashes.has(baselineHash)) return;
  const dropped = droppedAfterBaseline(journal, migrationsFolder);
  const missing = missingFromSnapshot(
    snapshotColumns(migrationsFolder, baseline.idx),
    actual,
  ).filter((m) => !dropped.has(m));
  if (missing.length === 0) return;
  throw new UpgradePathError(
    `This database is from an older Ledgr (schema ${era()}). This release upgrades from v0.8.14 or later: update to v0.8.15 first, start it once so it migrates, then update to this release. Nothing has been changed. Missing: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` and ${missing.length - 8} more` : ""}.`,
  );
}

/** Index names of a journal entry's drizzle snapshot. */
function snapshotIndexes(migrationsFolder: string, idx: number): string[] {
  const snap = JSON.parse(
    fs.readFileSync(
      path.resolve(
        `${migrationsFolder}/meta/${String(idx).padStart(4, "0")}_snapshot.json`,
      ),
      "utf-8",
    ),
  ) as {
    tables: Record<string, { indexes?: Record<string, { name: string }> }>;
  };
  return Object.values(snap.tables).flatMap((t) =>
    Object.values(t.indexes ?? {}).map((i) => i.name),
  );
}

/**
 * After a squash replay: every table, column and index of the latest
 * snapshot. Indexes too because the replay skips a unique violation — a
 * CREATE UNIQUE INDEX over duplicate rows would otherwise be skipped
 * silently.
 */
function assertSchemaComplete(
  journal: Journal,
  migrationsFolder: string,
  actual: Map<string, Set<string>>,
  actualIndexes: Set<string>,
  step: "Squash replay" | "Migration",
): void {
  const last = journal.entries[journal.entries.length - 1];
  if (!last) return;
  const missing = [
    ...missingFromSnapshot(snapshotColumns(migrationsFolder, last.idx), actual),
    ...snapshotIndexes(migrationsFolder, last.idx)
      .filter((name) => !actualIndexes.has(name))
      .map((name) => `index ${name}`),
  ];
  if (missing.length > 0)
    throw new Error(
      `${step} left the schema incomplete (missing ${missing.slice(0, 8).join(", ")}) — rolled back, nothing changed.`,
    );
}

/** assertSchemaComplete for a start with nothing pending: an install that
 *  is short of the snapshot (a migration recorded without its change, or a
 *  hand edit) is logged as an error for the admin, never thrown — refusing
 *  to start over drift would take the app down with no migration to blame. */
function warnIfSchemaIncomplete(
  journal: Journal,
  migrationsFolder: string,
  actual: Map<string, Set<string>>,
  actualIndexes: Set<string>,
): void {
  try {
    assertSchemaComplete(
      journal,
      migrationsFolder,
      actual,
      actualIndexes,
      "Migration",
    );
  } catch (err) {
    log("error", "schema_incomplete", {
      error: err instanceof Error ? err.message : String(err),
      note: "The database is missing parts of the current schema though no migration is pending. Restore a backup or ask for a repair migration.",
    });
  }
}

async function pgIndexes(
  client: import("pg").PoolClient,
): Promise<Set<string>> {
  const { rows } = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  return new Set(rows.map((r) => r.indexname));
}

async function pgColumns(
  client: import("pg").PoolClient,
): Promise<Map<string, Set<string>>> {
  const { rows } = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  return columnMap(rows);
}

async function pgRecordedHashes(
  client: import("pg").PoolClient,
): Promise<Set<string>> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations') AS exists`,
  );
  if (!rows[0]?.exists) return new Set();
  const { rows: hashes } = await client.query<{ hash: string }>(
    "SELECT hash FROM drizzle.__drizzle_migrations",
  );
  return new Set(hashes.map((r) => r.hash));
}

async function assertSupportedUpgradePathPg(
  pool: import("pg").Pool,
  migrationsFolder: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    const crypto = await import("crypto");
    const actual = await pgColumns(client);
    if (!actual.has("people")) return;
    const era = await detectSchemaEra(client, migrationsFolder);
    assertSupportedUpgradePath(
      readJournal(migrationsFolder),
      migrationsFolder,
      await pgRecordedHashes(client),
      actual,
      crypto,
      () => era,
    );
  } finally {
    client.release();
  }
}

// "Already done" AND "already moved past" are both benign when replaying a
// migration whose hash isn't recorded against a database that may already be
// past it — which happens only in a squash replay. Anywhere else the same
// errors mean the migration didn't do its job, and skipping them recorded it
// as applied anyway. A migration that creates something that already exists
// (duplicate_*) is as expected as one that references a column/table a later
// migration already renamed or dropped (undefined_column/undefined_table).
const IGNORABLE_PG_CODES = new Set([
  "42701", // duplicate_column
  "42P07", // duplicate_table
  "42710", // duplicate_object (index, constraint, etc.)
  "42704", // undefined_object (DROP CONSTRAINT/INDEX on missing object)
  "23505", // unique_violation
  "42703", // undefined_column — already renamed/dropped by a later migration
  "42P01", // undefined_table — already renamed/dropped by a later migration
]);

/** Squash replay only: run one migration file's statements inside the
 *  caller's transaction, each under a savepoint so an ignorable error skips
 *  only that statement. The replay checks the whole schema afterwards. */
async function replayStatementsPg(
  client: import("pg").PoolClient,
  sql: string,
): Promise<void> {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s: string) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await client.query("SAVEPOINT apply_stmt");
    try {
      await client.query(stmt);
      await client.query("RELEASE SAVEPOINT apply_stmt");
    } catch (stmtErr) {
      const code = (stmtErr as { code?: string }).code;
      if (code && IGNORABLE_PG_CODES.has(code)) {
        await client.query("ROLLBACK TO SAVEPOINT apply_stmt");
      } else {
        throw stmtErr;
      }
    }
  }
}

/** Run one pending migration file's statements inside the caller's
 *  transaction. Every error stops the migration: nothing is skipped. */
async function applyStatementsPg(
  client: import("pg").PoolClient,
  sql: string,
): Promise<void> {
  for (const stmt of sql
    .split("--> statement-breakpoint")
    .map((s: string) => s.trim())
    .filter(Boolean))
    await client.query(stmt);
}

/** A tag's data converter (migration-converters.ts) on PostgreSQL, inside
 *  the caller's transaction: pending loop and squash replay alike. */
async function convertPg(
  client: import("pg").PoolClient,
  tag: string,
  phase: "beforeSql" | "afterSql",
): Promise<void> {
  for (const note of await runConverterPg(
    client,
    MIGRATION_CONVERTERS,
    tag,
    phase,
  ))
    log("info", "migration_conversion", { tag, note });
}

/**
 * Handle a migration squash: when the database has more applied migrations
 * than the journal has entries (or none recorded but tables present, or
 * recorded hashes that don't match the journal's), the migrations were
 * squashed since it last ran. assertSupportedUpgradePathPg has already
 * established the database is at the baseline's schema or past it. This:
 * 1. writes a pre-upgrade backup (always — none means stop),
 * 2. in ONE transaction: clears __drizzle_migrations, replays every journal
 *    entry idempotently (savepoints, ignorable errors skipped), records each
 *    hash, and checks every table and column of the latest snapshot exists.
 * Any failure rolls the whole thing back and stops the migration — nothing
 * is half done, and the previous image still runs against the database.
 * After this, the pre-apply loop and Drizzle's migrate() are no-ops.
 */
async function handleSquashUpgrade(
  pool: import("pg").Pool,
  migrationsFolder: string,
): Promise<SquashResult> {
  const client = await pool.connect();
  let backupPathBeforeFailure: string | null = null;
  try {
    const { rows: tableCheck } = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS exists`,
    );
    if (!tableCheck[0]?.exists)
      return { backupPath: null, schemaVersion: null, wasSquash: false };

    const recordedHashes = await pgRecordedHashes(client);
    const { rows: countRows } = await client.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    const appliedCount: number = countRows[0]?.count ?? 0;
    const journal = readJournal(migrationsFolder);
    const journalCount = journal.entries.length;
    const crypto = await import("crypto");
    const actual = await pgColumns(client);

    // Squash detection. Three cases trigger recovery:
    //   1. appliedCount > journalCount — a squash collapsed N migrations
    //      into M < N entries.
    //   2. appliedCount == 0 with existing application tables — a journal
    //      cleared by an earlier failed run.
    //   3. Hash mismatch — as many rows as entries, but the first
    //      `appliedCount` entries' file hashes aren't all recorded (a squash
    //      that kept the entry count). Entries beyond appliedCount are new
    //      and go through the normal pre-apply path.
    const needsRecovery =
      appliedCount > journalCount ||
      (appliedCount === 0 && actual.has("people")) ||
      (appliedCount > 0 &&
        journal.entries.slice(0, appliedCount).some((entry) => {
          const h = fileHash(crypto, `${migrationsFolder}/${entry.tag}.sql`);
          return h !== null && !recordedHashes.has(h);
        }));
    if (!needsRecovery)
      return { backupPath: null, schemaVersion: null, wasSquash: false };

    const schemaVersion = schemaLabel(
      journal,
      migrationsFolder,
      recordedHashes,
      actual,
      crypto,
    );
    log("info", "squash_upgrade_start", {
      appliedMigrations: appliedCount,
      journalMigrations: journalCount,
      schemaVersion,
    });

    // 1. Backup — never clear the journal without one.
    const backupPath = await writePreMigrationBackupPg(client, schemaVersion);
    backupPathBeforeFailure = backupPath;
    requireBackupOrAbort(backupPath);

    // 2. Clear, replay, record, check — all or nothing.
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM drizzle.__drizzle_migrations");
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        await convertPg(client, entry.tag, "beforeSql");
        await replayStatementsPg(client, sql);
        await convertPg(client, entry.tag, "afterSql");
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [
            crypto.createHash("sha256").update(sql).digest("hex"),
            String(Date.now()),
          ],
        );
        log("info", "squash_migration_applied", { tag: entry.tag });
      }
      assertSchemaComplete(
        journal,
        migrationsFolder,
        await pgColumns(client),
        await pgIndexes(client),
        "Squash replay",
      );
      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    }

    log("info", "squash_upgrade_complete", {
      schemaVersion,
      removedEntries: appliedCount,
    });
    return { backupPath, schemaVersion, wasSquash: true };
  } catch (err) {
    log("error", "squash_upgrade_failed", {
      error: err instanceof Error ? err.message : String(err),
      ...(backupPathBeforeFailure
        ? {
            message: `Nothing was changed; a backup was written to ${backupPathBeforeFailure} before the failure.`,
            backupPath: backupPathBeforeFailure,
          }
        : {}),
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Journal entries whose migration file hash isn't recorded yet, and the tag
 * of the last entry that is (the schema the database is at now — the
 * backup's schemaVersion, which restore transforms key on).
 */
export function pendingJournalEntries(
  journal: { entries: { tag: string }[] },
  migrationsFolder: string,
  recordedHashes: Set<string>,
  crypto: typeof import("crypto"),
): { pendingTags: string[]; lastAppliedTag: string | null } {
  const pendingTags: string[] = [];
  let lastAppliedTag: string | null = null;
  for (const entry of journal.entries) {
    const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const hash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(sqlPath, "utf-8"))
      .digest("hex");
    if (recordedHashes.has(hash)) lastAppliedTag = entry.tag;
    else pendingTags.push(entry.tag);
  }
  return { pendingTags, lastAppliedTag };
}

/**
 * Stop before migrating when the pre-migration backup couldn't be written.
 * LEDGR_SKIP_PREMIGRATION_BACKUP=true proceeds anyway (an operator who has
 * their own backup, e.g. a pg_dump or volume snapshot).
 */
/** The pre-migration backup couldn't be written — always stops the migration. */
export class BackupRequiredError extends Error {
  override name = "BackupRequiredError";
}

export function requireBackupOrAbort(backupPath: string | null): void {
  if (backupPath) return;
  if (process.env.LEDGR_SKIP_PREMIGRATION_BACKUP === "true") {
    log("warn", "pre_migration_backup_skipped", {
      message:
        "No pre-migration backup could be written; continuing because LEDGR_SKIP_PREMIGRATION_BACKUP=true.",
    });
    return;
  }
  throw new BackupRequiredError(
    "Refusing to migrate: the pre-migration backup could not be written. The database has not been changed. Set LEDGR_BACKUP_DIR to a writable directory (or LEDGR_SKIP_PREMIGRATION_BACKUP=true if you have your own backup) and restart.",
  );
}

async function runPostgres() {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { Pool } = await import("pg");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    // Refuse a database older than the baseline before anything else —
    // outside the squash, so nothing can swallow it.
    await assertSupportedUpgradePathPg(pool, "./drizzle");

    // Handle squash upgrade: if the DB has more applied migrations than the
    // journal, a schema squash occurred. Backs up, then clears the old
    // journal and replays the new one in one transaction — so the pre-apply
    // loop and Drizzle's migrate() below become no-ops.
    const squash = await handleSquashUpgrade(pool, "./drizzle");
    let backupPath = squash.backupPath;

    // Apply pending migrations here, before Drizzle's migrate(): strictly, in
    // one transaction, with the schema checked before commit (below). Drizzle's
    // migrator commits each file on its own and checks nothing afterwards;
    // running first means migrate() below is always a no-op. Databases that
    // still carry pre-squash history went through the squash replay above.
    const journal = JSON.parse(
      fs.readFileSync(path.resolve("./drizzle/meta/_journal.json"), "utf-8"),
    );
    const preClient = await pool.connect();
    try {
      // Ensure drizzle schema + migrations table exist (migrate() normally does
      // this, but we need it before our pre-apply step).
      await preClient.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await preClient.query(
        `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )`,
      );

      const { rows: recorded } = await preClient.query(
        "SELECT hash FROM drizzle.__drizzle_migrations",
      );
      const recordedHashes = new Set(
        recorded.map((r: { hash: string }) => r.hash),
      );
      const crypto = await import("crypto");

      // Back up before changing an existing install's schema — every
      // upgrade, not only squashes. Fresh installs (no app tables yet)
      // have nothing to lose. Refuse to migrate if no backup could be
      // written: the container then fails to start with the database
      // untouched, and the previous image still runs against it.
      const pending = pendingJournalEntries(
        journal,
        "./drizzle",
        recordedHashes,
        crypto,
      );
      if (pending.pendingTags.length > 0 && !backupPath) {
        const { rows: probe } = await preClient.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'people') AS exists`,
        );
        if (probe[0]?.exists) {
          log("info", "pre_migration_backup_start", {
            pending: pending.pendingTags,
            from: pending.lastAppliedTag,
          });
          backupPath = await writePreMigrationBackupPg(
            preClient,
            // The label restore transforms key on — never "unknown", which
            // the import path rejects.
            pending.lastAppliedTag ??
              (await detectSchemaEra(preClient, "./drizzle")),
          );
          requireBackupOrAbort(backupPath);
        }
      }

      // Every pending migration in one transaction, strictly, then the
      // schema checked against the latest snapshot before commit: a failed
      // statement or a missing table/column rolls all of them back and
      // records nothing (the container then stops with the database as it
      // was).
      if (pending.pendingTags.length > 0) {
        await preClient.query("BEGIN");
        try {
          for (const entry of journal.entries) {
            const sqlPath = path.resolve(`./drizzle/${entry.tag}.sql`);
            if (!fs.existsSync(sqlPath)) continue;
            const sql = fs.readFileSync(sqlPath, "utf-8");
            const hash = crypto.createHash("sha256").update(sql).digest("hex");
            if (recordedHashes.has(hash)) continue;
            await convertPg(preClient, entry.tag, "beforeSql");
            await applyStatementsPg(preClient, sql);
            await convertPg(preClient, entry.tag, "afterSql");
            await preClient.query(
              "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
              [hash, String(Date.now())],
            );
            log("info", "migration_applied", { tag: entry.tag });
          }
          assertSchemaComplete(
            journal,
            "./drizzle",
            await pgColumns(preClient),
            await pgIndexes(preClient),
            "Migration",
          );
          await preClient.query("COMMIT");
        } catch (txErr) {
          await preClient.query("ROLLBACK").catch(() => {});
          throw txErr;
        }
      } else {
        // Nothing pending: still compare with the snapshot, but only report
        // — drift alone never blocks a start (see warnIfSchemaIncomplete).
        warnIfSchemaIncomplete(
          journal,
          "./drizzle",
          await pgColumns(preClient),
          await pgIndexes(preClient),
        );
      }
    } finally {
      preClient.release();
    }

    // Drizzle's own migrate() — always a no-op after the pre-apply
    // above, but retained as a safety net for any edge cases.
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });

    log("info", "migrations_applied", { dialect: "postgresql" });

    // Drop stale demo schemas so they get rebuilt fresh from the public
    // schema's current structure on next activation. Demo schemas are
    // sandboxes the demo router (src/server/routers/demo.ts) builds with
    // CREATE TABLE LIKE public.x and stamps with the applied-migration
    // count and last hash (src/lib/db/demo-schema-marker.ts); any whose
    // stamp doesn't match the current one was built for an older structure. Checked on
    // EVERY start, not just when a migration ran, so a failed drop is
    // retried — and it's fatal: a stale schema can't be left in place
    // (requests refuse to use it, but it must not linger silently).
    {
      const demoClient = await pool.connect();
      try {
        const { rows: stale } = await demoClient.query<{ nspname: string }>(
          `SELECT n.nspname FROM pg_namespace n
            WHERE n.nspname LIKE 'demo\\_%'
              AND obj_description(n.oid, 'pg_namespace') IS DISTINCT FROM
                  $1 || ${MIGRATION_STAMP_SUBQUERY}
            ORDER BY n.nspname`,
          [DEMO_SCHEMA_MARKER_PREFIX],
        );
        for (const { nspname } of stale) {
          // Quote identifier to defend against schema names with special chars
          const quoted = '"' + nspname.replaceAll('"', '""') + '"';
          await demoClient.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
          log("info", "demo_schema_dropped_for_rebuild", {
            schema: nspname,
            reason:
              "Built for an older schema — demo profile will be rebuilt fresh on next activation",
          });
        }
        if (stale.length > 0) {
          log("info", "demo_schemas_cleared", {
            count: stale.length,
            note: "Users with active demo profiles will need to re-activate via the UI",
          });
        }
      } catch (demoErr) {
        log("error", "demo_schema_cleanup_failed", {
          error: demoErr instanceof Error ? demoErr.message : String(demoErr),
        });
        throw new Error(
          `Couldn't drop stale demo schemas: ${demoErr instanceof Error ? demoErr.message : String(demoErr)}`,
        );
      } finally {
        demoClient.release();
      }
    }

    // Write upgrade banner flag if a pre-migration backup was created
    if (backupPath) {
      const flagClient = await pool.connect();
      try {
        await flagClient.query(
          `INSERT INTO app_settings (key, value)
           VALUES ('pre_upgrade_backup', $1::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [
            JSON.stringify({
              path: backupPath,
              createdAt: new Date().toISOString(),
            }),
          ],
        );
        log("info", "upgrade_banner_flag_set", { path: backupPath });
      } catch (flagErr) {
        log("warn", "upgrade_banner_flag_failed", {
          error: flagErr instanceof Error ? flagErr.message : String(flagErr),
        });
      } finally {
        flagClient.release();
      }
    }

    // Reference-data reconcile: the tax-data file, in public and in each
    // live demo schema (demo reference data comes from the file, never from
    // the household's own rows). Fails the migrate loudly — a silently
    // skipped reconcile is how a seed fix never reaches prod.
    const seedClient = await pool.connect();
    try {
      const file = readTaxDataFile();
      const presets = readSimulationPresetsFile();
      const pgQuery: RefQuery = async (text, params) => {
        let i = 0;
        const res = await seedClient.query(
          text.replace(/\?/g, () => `$${++i}`),
          params,
        );
        return res.rows as Record<string, unknown>[];
      };
      // One transaction per schema: a failure part-way leaves nothing half
      // applied (it's idempotent, but a mixed state shouldn't serve traffic).
      const inTransaction = async <T>(fn: () => Promise<T>): Promise<T> => {
        await seedClient.query("BEGIN");
        try {
          const out = await fn();
          await seedClient.query("COMMIT");
          return out;
        } catch (err) {
          await seedClient.query("ROLLBACK");
          throw err;
        }
      };
      // An approved community update newer than this image's file is
      // applied after it (the shipped file can't add what it doesn't have).
      const community = pickApprovedCommunityFile(
        (
          await seedClient.query<{ file_text: string }>(
            "SELECT file_text FROM tax_data_updates WHERE status = 'applied'",
          )
        ).rows,
        file.dataVersion,
      );
      const bothFiles = async () => {
        const seeded = await reconcileReferenceRows(
          pgQuery,
          "pg",
          file,
          "seed",
          !community,
        );
        const updated = community
          ? await reconcileReferenceRows(pgQuery, "pg", community, "community")
          : null;
        return {
          inserted: seeded.inserted + (updated?.inserted ?? 0),
          updated: seeded.updated + (updated?.updated ?? 0),
        };
      };
      const result = await inTransaction(bothFiles);
      // The presets go in after, in a transaction of their own.
      const seedPresets = () =>
        inTransaction(() => seedSimulationPresets(pgQuery, "pg", presets));
      const presetRows = await seedPresets();
      log("info", "reference_data_reconciled", {
        dataVersion: file.dataVersion,
        communityDataVersion: community?.dataVersion ?? null,
        ...result,
        presetRows,
      });
      const { rows: demos } = await seedClient.query<{ nspname: string }>(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'demo\\_%'`,
      );
      for (const { nspname } of demos) {
        const schemaIdent = `"${nspname.replace(/"/g, '""')}"`;
        try {
          await seedClient.query(`SET search_path TO ${schemaIdent}`);
          await inTransaction(bothFiles);
          await seedPresets();
        } finally {
          await seedClient.query("SET search_path TO public");
        }
      }
      if (demos.length > 0)
        log("info", "demo_reference_data_reconciled", {
          schemas: demos.map((d) => d.nspname).join(", "),
        });
    } finally {
      seedClient.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Exact copy of the SQLite database (VACUUM INTO — consistent, includes the
 * migration journal). Restoring = stop Ledgr, put this file in place of the
 * database file, start the previous version.
 */
function writePreMigrationBackupSqlite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
): string | null {
  const backupDir = resolveWritableBackupDir();
  if (!backupDir) {
    log("error", "pre_migration_backup_no_writable_dir", {
      message:
        "No writable directory for the pre-upgrade backup (tried LEDGR_BACKUP_DIR, /app/data, /tmp, .).",
    });
    return null;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `pre-upgrade-backup-${timestamp}.db`);
  try {
    sqlite.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    log("info", "pre_migration_backup_complete", { path: backupPath });
    warnIfEphemeral(backupPath);
    prunePreUpgradeBackups(backupDir);
    return backupPath;
  } catch (err) {
    log("error", "pre_migration_backup_write_failed", {
      dir: backupDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

type SqliteDb = InstanceType<typeof import("better-sqlite3")>;

/**
 * SQLite twin of detectSchemaEra — only words the refusal message now. The
 * first migration a post-squash install applied is its release-line
 * baseline (SQLite spellings of BASELINE_HASHES); older installs fall back
 * to schema-shape probes.
 */
function detectSchemaEraSqlite(sqlite: SqliteDb): string {
  const SQLITE_BASELINE_HASHES: Record<string, string> = {
    dc91abbd28dd17fc654c9712fb27ce8f922708ccaaad7a4d68acbc19d8a7c685:
      "v0.7_final",
    d640cf13da448193bc3cd36084a9495bf8f826d3a3df15f0cfe4acfb6776c2d3:
      "v0.6_final",
  };
  try {
    const firstRow = sqlite
      .prepare(
        "SELECT hash FROM __drizzle_migrations ORDER BY rowid ASC LIMIT 1",
      )
      .get() as { hash?: string } | undefined;
    const era = firstRow?.hash && SQLITE_BASELINE_HASHES[firstRow.hash];
    if (era) return era;
  } catch {
    // no journal — fall through to probes
  }
  const has = (sql: string) =>
    (sqlite.prepare(sql).get() as { n: number }).n > 0;
  const table = (name: string) =>
    has(
      `SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='${name}'`,
    );
  if (table("securities")) return "0004_v085_investments";
  if (table("account_holdings")) return "v0.6_final";
  if (
    has(
      "SELECT count(*) AS n FROM pragma_table_info('annual_performance') WHERE name='is_immutable'",
    )
  )
    return "v0.5_final";
  if (table("projection_overrides")) return "v0.3_final";
  return "v0.2_final";
}

function sqliteColumns(sqlite: SqliteDb): Map<string, Set<string>> {
  return columnMap(
    sqlite
      .prepare(
        "SELECT m.name AS table_name, p.name AS column_name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
      )
      .all() as { table_name: string; column_name: string }[],
  );
}

function sqliteRecordedHashes(sqlite: SqliteDb): Set<string> {
  const exists = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();
  if (!exists) return new Set();
  return new Set(
    (
      sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
        hash: string;
      }[]
    ).map((r) => r.hash),
  );
}

/** Squash replay only: an error meaning the statement is already done (or
 *  already moved past), the SQLite twin of IGNORABLE_PG_CODES. */
const isIgnorableSqliteError = (err: unknown): boolean =>
  [
    "already exists",
    "duplicate column",
    "no such column",
    "no such table",
    "no such index",
  ].some((m) => ((err as Error).message ?? "").includes(m));

const sqliteColumnNames = (sqlite: SqliteDb, table: string): string[] =>
  (
    sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]
  ).map((c) => c.name);

/** Squash replay only: a table recreate runs as a unit under a savepoint
 *  and drops only the columns its own journal entry drops (`ownDrops`). It
 *  is skipped whole when a statement is already done or X has another
 *  column `__new_X` lacks; any other error stops the replay. */
function replayRecreateSqlite(
  sqlite: SqliteDb,
  table: string,
  statements: string[],
  ownDrops: ReadonlySet<string>,
): void {
  sqlite.exec("SAVEPOINT replay_recreate");
  let skipped: string | null = null;
  try {
    sqlite.exec(statements[0]!);
    const kept = new Set(sqliteColumnNames(sqlite, `__new_${table}`));
    const lost = sqliteColumnNames(sqlite, table).filter(
      (c) => !kept.has(c) && !ownDrops.has(c),
    );
    if (lost.length > 0) skipped = `would drop ${lost.join(", ")}`;
    else for (const stmt of statements.slice(1)) sqlite.exec(stmt);
  } catch (err) {
    if (!isIgnorableSqliteError(err)) throw err; // the replay rolls back
    skipped = (err as Error).message;
  }
  if (skipped !== null) {
    sqlite.exec("ROLLBACK TO SAVEPOINT replay_recreate");
    log("info", "squash_recreate_skipped", { table, reason: skipped });
  }
  sqlite.exec("RELEASE SAVEPOINT replay_recreate");
}

/** Squash replay only: run journal entry `idx`'s statements inside the
 *  caller's transaction, skipping what is already done; a table recreate
 *  replays as a unit (replayRecreateSqlite). The replay checks the whole
 *  schema afterwards. */
function replayStatementsSqlite(
  sqlite: SqliteDb,
  sql: string,
  migrationsFolder: string,
  idx: number,
): void {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s: string) => s.replace(/^(\s*--[^\n]*\n)*/, "").trim())
    .filter(Boolean);
  for (let i = 0; i < statements.length; i++) {
    const table = /^CREATE TABLE `__new_([^`]+)`/.exec(statements[i]!)?.[1];
    const end = table
      ? statements.findIndex(
          (s, j) =>
            j > i &&
            s.startsWith(
              `ALTER TABLE \`__new_${table}\` RENAME TO \`${table}\``,
            ),
        )
      : -1;
    if (table && end > i) {
      // What this entry drops from the table: its snapshot's columns
      // against the previous entry's.
      const own = new Set(snapshotColumns(migrationsFolder, idx).get(table));
      const ownDrops = new Set(
        idx > 0
          ? (
              snapshotColumns(migrationsFolder, idx - 1).get(table) ?? []
            ).filter((c) => !own.has(c))
          : [],
      );
      replayRecreateSqlite(
        sqlite,
        table,
        statements.slice(i, end + 1),
        ownDrops,
      );
      i = end;
    } else
      try {
        sqlite.exec(statements[i]!);
      } catch (err) {
        if (!isIgnorableSqliteError(err)) throw err;
      }
  }
}

/** One SQLite migration transaction (pending or replay) with foreign keys
 *  off: the pragma is a no-op inside a transaction, so a migration file's
 *  own PRAGMA foreign_keys=OFF does nothing, and a table recreate's DROP
 *  TABLE of a parent would fail or cascade-delete its children. Before
 *  commit, foreign_key_check refuses any broken reference the migration
 *  made (ones already there are logged, not blamed on it). */
function sqliteMigrationTransaction(sqlite: SqliteDb, body: () => void): void {
  type Broken = { table: string; rowid: number; parent: string; fkid: number };
  // Named by its key's columns, not fkid (renumbered when a recreate drops a
  // key; the parent alone can't tell two keys to one parent apart). rowid is
  // stable for an INTEGER PRIMARY KEY table.
  const check = () => {
    const columns = new Map<string, Map<number, string>>();
    return (sqlite.pragma("foreign_key_check") as Broken[]).map((b) => {
      let byId = columns.get(b.table);
      if (!byId) {
        byId = new Map();
        for (const f of sqlite
          .prepare(
            'SELECT id, "from" AS col FROM pragma_foreign_key_list(?) ORDER BY id, seq',
          )
          .all(b.table) as { id: number; col: string }[])
          byId.set(f.id, [byId.get(f.id), f.col].filter(Boolean).join(","));
        columns.set(b.table, byId);
      }
      return {
        ...b,
        key: `${b.table}:${b.rowid}:${b.parent}:${byId.get(b.fkid)}`,
      };
    });
  };
  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.transaction(() => {
      const before = new Set(check().map((b) => b.key));
      if (before.size > 0)
        log("warn", "sqlite_foreign_keys_already_broken", {
          count: before.size,
        });
      body();
      const made = check().filter((b) => !before.has(b.key));
      if (made.length > 0)
        throw new Error(
          `Migration would break ${made.length} foreign key reference(s) (first: ${made[0]!.table} row ${made[0]!.rowid} → ${made[0]!.parent}). Nothing was changed.`,
        );
    })();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

/** Run one pending migration file's statements inside the caller's
 *  transaction. Every error stops the migration: nothing is skipped. */
function applyStatementsSqlite(sqlite: SqliteDb, sql: string): void {
  for (const stmt of sql
    .split("--> statement-breakpoint")
    .map((s: string) => s.trim())
    .filter(Boolean))
    sqlite.exec(stmt);
}

/** The SQLite twin of convertPg. */
function convertSqlite(
  sqlite: SqliteDb,
  tag: string,
  phase: "beforeSql" | "afterSql",
): void {
  for (const note of runConverterSqlite(
    sqlite,
    MIGRATION_CONVERTERS,
    tag,
    phase,
  ))
    log("info", "migration_conversion", { tag, note, dialect: "sqlite" });
}

/** The index names a SQLite database has, as assertSchemaComplete reads
 *  them. */
function sqliteIndexes(sqlite: SqliteDb): Set<string> {
  return new Set(
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((r) => r.name),
  );
}

/**
 * SQLite twin of handleSquashUpgrade (see its docblock): same detection,
 * backup first (an exact VACUUM INTO copy), then clear + replay + record +
 * check in one transaction; any failure rolls back and stops.
 */
function handleSQLiteSquashUpgrade(
  sqlite: SqliteDb,
  migrationsFolder: string,
): string | null {
  const tableExists = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get();
  if (!tableExists) return null;

  const recordedHashes = sqliteRecordedHashes(sqlite);
  const appliedCount = (
    sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
      n: number;
    }
  ).n;
  const journal = readJournal(migrationsFolder);
  const journalCount = journal.entries.length;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require in SQLite dialect
  const crypto = require("crypto") as typeof import("crypto");
  const actual = sqliteColumns(sqlite);

  // The same three cases as handleSquashUpgrade.
  const needsRecovery =
    appliedCount > journalCount ||
    (appliedCount === 0 && actual.has("people")) ||
    (appliedCount > 0 &&
      journal.entries.slice(0, appliedCount).some((entry) => {
        const h = fileHash(crypto, `${migrationsFolder}/${entry.tag}.sql`);
        return h !== null && !recordedHashes.has(h);
      }));
  if (!needsRecovery) return null;

  const schemaVersion = schemaLabel(
    journal,
    migrationsFolder,
    recordedHashes,
    actual,
    crypto,
  );
  log("info", "sqlite_squash_upgrade_start", {
    appliedMigrations: appliedCount,
    journalMigrations: journalCount,
    schemaVersion,
  });

  // 1. Backup — never clear the journal without one.
  const backupPath = writePreMigrationBackupSqlite(sqlite);
  requireBackupOrAbort(backupPath);

  // 2. Clear, replay, record, check — all or nothing.
  try {
    sqliteMigrationTransaction(sqlite, () => {
      sqlite.prepare("DELETE FROM __drizzle_migrations").run();
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        convertSqlite(sqlite, entry.tag, "beforeSql");
        replayStatementsSqlite(sqlite, sql, migrationsFolder, entry.idx);
        convertSqlite(sqlite, entry.tag, "afterSql");
        sqlite
          .prepare(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
          )
          .run(
            crypto.createHash("sha256").update(sql).digest("hex"),
            String(Date.now()),
          );
        log("info", "squash_migration_applied", { tag: entry.tag });
      }
      assertSchemaComplete(
        journal,
        migrationsFolder,
        sqliteColumns(sqlite),
        sqliteIndexes(sqlite),
        "Squash replay",
      );
    });
  } catch (err) {
    log("error", "squash_upgrade_failed", {
      error: err instanceof Error ? err.message : String(err),
      message: `Nothing was changed; a backup was written to ${backupPath} before the failure.`,
      backupPath,
    });
    throw err;
  }

  log("info", "sqlite_squash_upgrade_complete", { schemaVersion });
  return backupPath;
}

export function runSQLite() {
  /* eslint-disable @typescript-eslint/no-require-imports -- dynamic require for SQLite dialect */
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const dbPath = process.env.SQLITE_PATH ?? "data/ledgr.db";
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  // Refuse a database older than the baseline before anything else.
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("crypto") as typeof import("crypto");
    assertSupportedUpgradePath(
      readJournal("./drizzle-sqlite"),
      "./drizzle-sqlite",
      sqliteRecordedHashes(sqlite),
      sqliteColumns(sqlite),
      crypto,
      () => detectSchemaEraSqlite(sqlite),
    );
  }

  // Handle squash upgrade before running Drizzle's migrate()
  let backupPath = handleSQLiteSquashUpgrade(sqlite, "./drizzle-sqlite");

  // Apply pending migrations strictly, as on PostgreSQL (see the pre-apply
  // there). Databases that still carry pre-squash history went through the
  // squash replay above.
  {
    const journal = JSON.parse(
      fs.readFileSync(
        path.resolve("./drizzle-sqlite/meta/_journal.json"),
        "utf-8",
      ),
    );
    sqlite.exec(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require("crypto") as typeof import("crypto");
    const appliedHashes = new Set(
      (
        sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
          hash: string;
        }[]
      ).map((r) => r.hash),
    );

    // Same rule as PostgreSQL: back up an existing install before changing
    // its schema, and don't migrate without a backup.
    const pending = pendingJournalEntries(
      journal,
      "./drizzle-sqlite",
      appliedHashes,
      crypto,
    );
    const hasAppTables = !!sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'people'",
      )
      .get();
    if (pending.pendingTags.length > 0 && !backupPath && hasAppTables) {
      log("info", "pre_migration_backup_start", {
        pending: pending.pendingTags,
        from: pending.lastAppliedTag,
        dialect: "sqlite",
      });
      backupPath = writePreMigrationBackupSqlite(sqlite);
      requireBackupOrAbort(backupPath);
    }

    // Same rule as PostgreSQL: every pending migration in one transaction,
    // strictly, with the schema checked before commit.
    if (pending.pendingTags.length > 0)
      sqliteMigrationTransaction(sqlite, () => {
        for (const entry of journal.entries) {
          const sqlPath = path.resolve(`./drizzle-sqlite/${entry.tag}.sql`);
          if (!fs.existsSync(sqlPath)) continue;
          const sql = fs.readFileSync(sqlPath, "utf-8");
          const hash = crypto.createHash("sha256").update(sql).digest("hex");
          if (appliedHashes.has(hash)) continue;
          convertSqlite(sqlite, entry.tag, "beforeSql");
          applyStatementsSqlite(sqlite, sql);
          convertSqlite(sqlite, entry.tag, "afterSql");
          sqlite
            .prepare(
              "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
            )
            .run(hash, String(Date.now()));
          log("info", "migration_applied", {
            tag: entry.tag,
            dialect: "sqlite",
          });
        }
        assertSchemaComplete(
          journal,
          "./drizzle-sqlite",
          sqliteColumns(sqlite),
          sqliteIndexes(sqlite),
          "Migration",
        );
      });
    else
      warnIfSchemaIncomplete(
        journal,
        "./drizzle-sqlite",
        sqliteColumns(sqlite),
        sqliteIndexes(sqlite),
      );
  }

  // Drizzle's own migrate() — always a no-op after the pre-apply
  // above, but retained as a safety net.
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "./drizzle-sqlite" });
  log("info", "migrations_applied", { dialect: "sqlite", path: dbPath });

  // Write upgrade banner flag if a backup was created
  if (backupPath) {
    try {
      sqlite
        .prepare(
          `INSERT INTO app_settings (key, value)
           VALUES ('pre_upgrade_backup', json(?))
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        )
        .run(
          JSON.stringify({
            path: backupPath,
            createdAt: new Date().toISOString(),
          }),
        );
      log("info", "upgrade_banner_flag_set", { path: backupPath });
    } catch (flagErr) {
      log("warn", "upgrade_banner_flag_failed", {
        error: flagErr instanceof Error ? flagErr.message : String(flagErr),
      });
    }
  }

  // Reference-data reconcile: the tax-data file. Mirrors the Postgres path
  // above — fails loudly rather than warn-and-continue.
  try {
    const file = readTaxDataFile();
    const presets = readSimulationPresetsFile();
    const run = (text: string, params: unknown[]) => {
      const stmt = sqlite.prepare(text);
      if (stmt.reader) return stmt.all(...params) as Record<string, unknown>[];
      stmt.run(...params);
      return [];
    };
    const community = pickApprovedCommunityFile(
      sqlite
        .prepare(
          "SELECT file_text FROM tax_data_updates WHERE status = 'applied'",
        )
        .all() as { file_text: string }[],
      file.dataVersion,
    );
    const result = sqlite.transaction(() => {
      const seeded = reconcileReferenceRowsSync(run, file, "seed", !community);
      const updated = community
        ? reconcileReferenceRowsSync(run, community, "community")
        : null;
      return {
        inserted: seeded.inserted + (updated?.inserted ?? 0),
        updated: seeded.updated + (updated?.updated ?? 0),
      };
    })();
    // The presets go in after, in a transaction of their own.
    const presetRows = sqlite.transaction(() =>
      seedSimulationPresetsSync(run, presets),
    )();
    log("info", "reference_data_reconciled", {
      dataVersion: file.dataVersion,
      communityDataVersion: community?.dataVersion ?? null,
      ...result,
      presetRows,
    });
  } finally {
    sqlite.close();
  }
}

async function run() {
  const dialect = getDialect();
  log("info", "migration_start", { dialect });

  try {
    if (dialect === "postgresql") {
      await runPostgres();
    } else {
      runSQLite();
    }
  } catch (err) {
    log("error", "migration_failed", {
      dialect,
      error: err instanceof Error ? err.message : String(err),
      code: (err as NodeJS.ErrnoException).code,
    });
    process.exit(1);
  }
}

// Guard the top-level side effect so this file can be imported (e.g. by a
// test) without actually running a migration. Vitest sets VITEST=true for
// every test process; the real deploy entry point (`tsx db-migrate.ts`)
// never sets it, so this is a no-op for the actual migration pipeline.
if (!process.env.VITEST) {
  run();
}
