import * as fs from "fs";
import * as path from "path";

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
 * Reference-data reconcile (R43).
 *
 * `seed-reference-data.sql` is `INSERT … ON CONFLICT DO NOTHING` only — no
 * DDL, no UPDATE/DELETE. It is safe to re-run on every migrate, and doing so
 * is the only way a new tax year added to the seed reaches an existing
 * install. Previously the seed ran only when `contribution_limits` was empty,
 * so annual figure updates never propagated to a populated DB (R43 audit,
 * systemic problem #3).
 *
 * Additive only: `ON CONFLICT DO NOTHING` never overwrites an admin's
 * Settings edit and never corrects an already-seeded wrong value — a
 * seed-value *correction* still has to go through the UI or a manual
 * statement (documented in TAX-PARAMETER-RUNBOOK.md).
 *
 * Every table the seed writes MUST be a year-keyed reference table with a
 * `tax_year`-scoped unique constraint. Without one, `ON CONFLICT DO NOTHING`
 * has nothing to conflict on and every reconcile re-inserts duplicate rows.
 * Two guards enforce this before the seed runs, both failing the migrate
 * loudly:
 *   1. Every `INSERT INTO` target must be in `REFERENCE_SEED_TABLES` — an
 *      explicit allowlist, so adding a non-year-keyed `INSERT` to the seed
 *      file surfaces as a clear "this reconcile only handles year-keyed
 *      reference tables" error rather than a cryptic constraint failure or
 *      silent row duplication.
 *   2. Each of those tables is checked for a `tax_year`-scoped unique index
 *      in the live schema (belt-and-braces against the allowlist drifting
 *      from reality).
 * If you need to seed non-year-keyed reference data, do it through a
 * separate mechanism — not this file.
 */
const REFERENCE_SEED_TABLES = new Set([
  "contribution_limits",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
]);

function parseSeedTableNames(seedSql: string): string[] {
  const names = new Set<string>();
  const re = /INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seedSql)) !== null) names.add(m[1]!);
  const unexpected = [...names].filter((n) => !REFERENCE_SEED_TABLES.has(n));
  if (unexpected.length > 0) {
    throw new Error(
      `seed-reference-data.sql inserts into non-reference table(s) [${unexpected.join(
        ", ",
      )}]. The migrate reconcile only handles year-keyed reference tables ` +
        `(${[...REFERENCE_SEED_TABLES].join(", ")}) — add the table to ` +
        `REFERENCE_SEED_TABLES in db-migrate.ts only if it has a tax_year-scoped ` +
        `unique index, otherwise seed it through a separate mechanism.`,
    );
  }
  return [...names];
}

// Table names that are included in versioned backups (must match version-tables.ts).
// This is a local copy because db-migrate.ts runs in Docker where src/ isn't available.
// R43 follow-up (schema-reviewer suggestion): "retirement_profiles" and
// "retirement_profile_people" were missing from this mirror entirely — a
// pre-existing gap, not introduced by R43, found while reviewing the table
// R43's own tax_params_year column lives on. Order within this array is not
// load-bearing (both use sites just dump each table's rows into a JSON
// snapshot independently, read-only, no FK-insert-order constraint) —
// unlike version-tables.ts's VERSION_TABLES, which does encode tier order
// for restore.
const VERSION_TABLE_NAMES = [
  "people",
  "budget_profiles",
  "savings_goals",
  "mortgage_loans",
  "contribution_limits",
  "retirement_scenarios",
  "return_rate_table",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "fpl_by_household",
  "tax_params",
  "api_connections",
  "app_settings",
  "local_admins",
  "salary_profiles",
  "contribution_profiles",
  "retirement_profiles",
  "scenarios",
  "asset_class_params",
  "mc_presets",
  "portfolio_snapshots",
  "brokerage_goals",
  "net_worth_annual",
  "home_improvement_items",
  "other_asset_items",
  "historical_notes",
  "relocation_scenarios",
  "jobs",
  "historical_salaries",
  "budget_items",
  "savings_monthly",
  "savings_planned_transactions",
  "savings_planned_tx_settlements",
  "savings_allocation_overrides",
  "savings_goal_profile_allocations",
  "self_loans",
  "performance_accounts",
  "mortgage_what_if_scenarios",
  "mortgage_extra_payments",
  "retirement_settings",
  "retirement_profile_people",
  "retirement_salary_overrides",
  "retirement_budget_overrides",
  "asset_class_correlations",
  "glide_path_allocations",
  "brokerage_planned_transactions",
  "annual_performance",
  "property_taxes",
  "paycheck_deductions",
  "contribution_accounts",
  "portfolio_accounts",
  "account_performance",
  "mc_preset_glide_paths",
  "mc_preset_return_overrides",
  "projection_overrides",
  "mc_user_presets",
  "account_holdings",
  "budget_income_adjustments",
  "account_basis",
  "budget_item_category_links",
  "savings_goal_category_links",
  "pending_rollovers",
  "simplefin_balance_snapshots",
  "simplefin_accounts",
  "utility_service",
  "utility_reading",
];

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

/**
 * Detect the pre-squash schema era. Hash of the earliest applied migration
 * first (exact for v0.6.x / v0.7.x), then schema-shape probes for older
 * eras that predate the squashed-baseline scheme.
 */
async function detectSchemaEra(
  client: import("pg").PoolClient,
): Promise<string> {
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

/**
 * Export a JSON snapshot of every VERSION_TABLE_NAMES table and write it to
 * disk. Written by the squash-upgrade path (pre-squash safety net). Same
 * "pre-upgrade-backup-*.json" format regardless of which call site wrote it,
 * so it always means the same thing to an operator.
 */
async function writePreMigrationBackupPg(
  client: import("pg").PoolClient,
  schemaVersion: string,
): Promise<string | null> {
  const tables: Record<string, unknown[]> = {};
  for (const tableName of VERSION_TABLE_NAMES) {
    try {
      const { rows } = await client.query(`SELECT * FROM "${tableName}"`);
      tables[tableName] = rows;
    } catch {
      tables[tableName] = [];
    }
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
        "No writable directory for the pre-upgrade backup (tried LEDGR_BACKUP_DIR, /app/data, /tmp, .). Migration is proceeding WITHOUT an on-disk safety net — set LEDGR_BACKUP_DIR to a writable volume mount.",
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
    return backupPath;
  } catch (backupErr) {
    log("error", "pre_migration_backup_write_failed", {
      dir: backupDir,
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
      message:
        "Pre-upgrade backup write failed after its directory passed a probe. Migration is proceeding WITHOUT an on-disk safety net.",
    });
    return null;
  }
}

/**
 * Handle a migration squash: when the DB has more applied migrations than the
 * journal has entries, a schema squash has occurred. This function:
 * 1. Creates a pre-upgrade backup
 * 2. Clears the old __drizzle_migrations entries
 * 3. Applies the new squashed migration idempotently (savepoints + ignore duplicates)
 * 4. Records the new migration hash
 *
 * After this, Drizzle's migrate() sees all migrations as applied and is a no-op.
 */
async function handleSquashUpgrade(
  pool: import("pg").Pool,
  migrationsFolder: string,
  journalPath: string,
): Promise<SquashResult> {
  const client = await pool.connect();
  // Hoisted out of the try block (rather than declared where it's first
  // assigned below) so the catch block can report whether a backup was
  // already written to disk before whatever failed — see the catch block.
  let backupPathBeforeFailure: string | null = null;
  try {
    // Drizzle ORM stores migrations in the "drizzle" schema.
    // Check if drizzle.__drizzle_migrations table exists.
    const { rows: tableCheck } = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) AS exists`,
    );
    if (!tableCheck[0]?.exists)
      return { backupPath: null, schemaVersion: null, wasSquash: false };

    const { rows: migrationRows } = await client.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    const appliedCount = migrationRows[0]?.count ?? 0;

    const journal = JSON.parse(
      fs.readFileSync(path.resolve(journalPath), "utf-8"),
    );
    const journalCount = journal.entries?.length ?? 0;

    // Squash detection. Three cases trigger recovery:
    //   1. appliedCount > journalCount — old logic, catches the common case
    //      where a squash collapses N migrations into M < N entries.
    //   2. appliedCount == 0 with existing application tables — partial
    //      recovery from a previous failed squash that cleared the journal.
    //   3. HASH mismatch — appliedCount equals journalCount but the DB's
    //      applied hashes don't match the journal's expected hashes. Happens
    //      when a v0.5-style squash produces the same number of journal
    //      entries as the previous version, but the file contents (and
    //      therefore hashes) changed. Without this, drizzle.migrate() would
    //      attempt to apply the new migrations from scratch and fail on
    //      duplicate-table errors.
    let isPartialRecovery = false;
    let needsRecovery = appliedCount > journalCount;
    if (!needsRecovery) {
      if (appliedCount === 0) {
        // Check if any application tables exist (partial squash recovery)
        const { rows: tableProbe } = await client.query(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'people'
          ) AS exists`,
        );
        if (tableProbe[0]?.exists) {
          isPartialRecovery = true;
          needsRecovery = true;
          log("info", "partial_squash_recovery_detected", {
            reason:
              "Migration journal empty but application tables exist — recovering from failed squash",
          });
        }
      } else if (journalCount > 0) {
        // Hash-mismatch detection.
        // Only check the first `appliedCount` journal entries — entries beyond
        // appliedCount are legitimately new (not yet applied) and should NOT
        // trigger squash recovery; they go through the normal migrate() path.
        const cryptoMod = await import("crypto");
        const { rows: appliedRows } = await client.query<{ hash: string }>(
          "SELECT hash FROM drizzle.__drizzle_migrations",
        );
        const appliedHashes = new Set(appliedRows.map((r) => r.hash));
        for (const entry of journal.entries.slice(0, appliedCount)) {
          const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
          if (!fs.existsSync(sqlPath)) continue;
          const sql = fs.readFileSync(sqlPath, "utf-8");
          const expected = cryptoMod
            .createHash("sha256")
            .update(sql)
            .digest("hex");
          if (!appliedHashes.has(expected)) {
            needsRecovery = true;
            break;
          }
        }
      }
    }
    if (!needsRecovery) {
      return { backupPath: null, schemaVersion: null, wasSquash: false };
    }

    // --- Squash detected (or partial recovery) ---
    const schemaVersion = await detectSchemaEra(client);
    log("info", "squash_upgrade_start", {
      appliedMigrations: appliedCount,
      journalMigrations: journalCount,
      schemaVersion,
    });

    // 1. Export backup + clear journal (skip for partial recovery — already empty)
    let backupPath: string | null = null;
    if (!isPartialRecovery) {
      backupPath = await writePreMigrationBackupPg(client, schemaVersion);
      backupPathBeforeFailure = backupPath;

      // 2. Clear old migration journal
      await client.query("DELETE FROM drizzle.__drizzle_migrations");
      log("info", "migration_journal_cleared", {
        removedEntries: appliedCount,
      });
    }

    // 3. Apply each new journal migration idempotently and record its hash
    const crypto = await import("crypto");
    // "Already done" AND "already moved past" are both benign here — this
    // loop blindly replays potentially-ancient migrations against a DB that
    // may already be arbitrarily far beyond them. A migration that creates
    // something that already exists (duplicate_*) is exactly as expected as
    // one that references a column/table a LATER migration already
    // renamed or dropped (undefined_column/undefined_table) — e.g. 0005's
    // `INSERT ... SELECT bonus_override FROM jobs` + `DROP COLUMN
    // bonus_override`, replayed after some later migration already dropped
    // that column for real. Without these two codes, a replay that reaches
    // exactly this kind of statement hard-fails mid-loop, after the journal
    // has already been cleared and earlier entries already committed —
    // leaving __drizzle_migrations in a half-recovered state that requires
    // manual repair (see .scratch/recover-migration-tracking.mjs for the
    // one-off recovery this caused on the dev DB on 2026-08-18).
    const IGNORABLE_PG_CODES = new Set([
      "42701", // duplicate_column
      "42P07", // duplicate_table
      "42710", // duplicate_object (index, constraint, etc.)
      "42704", // undefined_object (DROP CONSTRAINT/INDEX on missing object)
      "23505", // unique_violation
      "42703", // undefined_column — already renamed/dropped by a later migration
      "42P01", // undefined_table — already renamed/dropped by a later migration
    ]);

    for (const entry of journal.entries) {
      const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const hash = crypto.createHash("sha256").update(sql).digest("hex");

      // (Per-tag data-backfill hooks for 0016_drop_salary_ledger_tables /
      // 0036_category_links_backfill were removed in the v0.8.0 squash —
      // those tags are no longer in any journal, so this replay loop only
      // ever sees 0000_v8_initial_schema. See git history at 0d30aaf~1 if
      // that backfill logic is ever needed again.)

      const statements = sql
        .split("--> statement-breakpoint")
        .map((s: string) => s.trim())
        .filter(Boolean);

      await client.query("BEGIN");
      try {
        for (const stmt of statements) {
          await client.query("SAVEPOINT squash_stmt");
          try {
            await client.query(stmt);
            await client.query("RELEASE SAVEPOINT squash_stmt");
          } catch (stmtErr) {
            const code = (stmtErr as { code?: string }).code;
            if (code && IGNORABLE_PG_CODES.has(code)) {
              await client.query("ROLLBACK TO SAVEPOINT squash_stmt");
            } else {
              throw stmtErr;
            }
          }
        }
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [hash, String(Date.now())],
        );
        await client.query("COMMIT");
        log("info", "squash_migration_applied", { tag: entry.tag });
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      }
    }

    // 4. v0.1.x → v0.4: rename boolean columns that changed in v0.2.0
    if (schemaVersion === "0008_prior_year_contrib") {
      const renames = [
        {
          table: "savings_goals",
          from: "api_sync_enabled",
          to: "is_api_sync_enabled",
        },
        {
          table: "retirement_scenarios",
          from: "lt_brokerage_enabled",
          to: "is_lt_brokerage_enabled",
        },
      ];
      for (const { table, from, to } of renames) {
        try {
          const { rows } = await client.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
            [table, from],
          );
          if (rows.length > 0) {
            await client.query(
              `ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`,
            );
            log("info", "column_renamed", { table, from, to });
          }
        } catch (renameErr) {
          log("warn", "column_rename_skipped", {
            table,
            from,
            to,
            error:
              renameErr instanceof Error
                ? renameErr.message
                : String(renameErr),
          });
        }
      }
    }

    log("info", "squash_upgrade_complete", { schemaVersion });
    return { backupPath, schemaVersion, wasSquash: true };
  } catch (err) {
    // A backup written before the failure is real, on-disk pre-upgrade
    // state — say so explicitly. Without this, the swallow-and-continue
    // behavior below (unchanged: callers proceed as if no squash happened)
    // gives an operator no signal that a usable backup already exists, even
    // though one may be sitting right there.
    log("warn", "squash_upgrade_failed", {
      error: err instanceof Error ? err.message : String(err),
      ...(backupPathBeforeFailure
        ? {
            message: `backup written to ${backupPathBeforeFailure} before failure — see it for pre-upgrade state`,
            backupPath: backupPathBeforeFailure,
          }
        : {}),
    });
    return { backupPath: null, schemaVersion: null, wasSquash: false };
  } finally {
    client.release();
  }
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
    // Handle squash upgrade: if the DB has more applied migrations than the
    // journal, a schema squash occurred.  This creates a backup, clears old
    // journal entries, applies the new squashed migration idempotently, and
    // records its hash — so Drizzle's migrate() below becomes a no-op.
    const { backupPath } = await handleSquashUpgrade(
      pool,
      "./drizzle",
      "./drizzle/meta/_journal.json",
    );

    // Apply any pending migrations idempotently before handing off to Drizzle's
    // migrate(). This handles upgrade DBs that already have tables/columns from
    // old pre-squash migrations — Drizzle's migrator has no savepoint support
    // and would fail on "table already exists" or "column already exists" errors.
    // Running idempotently first means migrate() below is always a no-op.
    const journal = JSON.parse(
      fs.readFileSync(path.resolve("./drizzle/meta/_journal.json"), "utf-8"),
    );
    const preClient = await pool.connect();
    try {
      // Ensure drizzle schema + migrations table exist (migrate() normally does
      // this, but we need it before our idempotent pre-apply step).
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
      // See the matching comment in handleSquashUpgrade above — this loop
      // has the identical "replay a migration whose hash isn't recorded yet
      // against a DB that may already be past it" shape, so it needs the
      // same undefined_column/undefined_table tolerance.
      const IGNORABLE_PG_CODES = new Set([
        "42701", // duplicate_column
        "42P07", // duplicate_table
        "42710", // duplicate_object (index, constraint, etc.)
        "42704", // undefined_object (DROP CONSTRAINT/INDEX on missing object)
        "23505", // unique_violation
        "42703", // undefined_column — already renamed/dropped by a later migration
        "42P01", // undefined_table — already renamed/dropped by a later migration
      ]);
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`./drizzle/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        const hash = crypto.createHash("sha256").update(sql).digest("hex");
        if (recordedHashes.has(hash)) continue;
        // (Per-tag data-backfill hooks removed — see the note in
        // handleSquashUpgrade's replay loop above. Post-squash this loop
        // only ever sees 0000_v8_initial_schema.)
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s: string) => s.trim())
          .filter(Boolean);
        await preClient.query("BEGIN");
        try {
          for (const stmt of statements) {
            await preClient.query("SAVEPOINT apply_stmt");
            try {
              await preClient.query(stmt);
              await preClient.query("RELEASE SAVEPOINT apply_stmt");
            } catch (stmtErr) {
              const code = (stmtErr as { code?: string }).code;
              if (code && IGNORABLE_PG_CODES.has(code)) {
                await preClient.query("ROLLBACK TO SAVEPOINT apply_stmt");
              } else {
                throw stmtErr;
              }
            }
          }
          await preClient.query(
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
            [hash, String(Date.now())],
          );
          await preClient.query("COMMIT");
          log("info", "migration_applied", { tag: entry.tag });
        } catch (txErr) {
          await preClient.query("ROLLBACK");
          throw txErr;
        }
      }
    } finally {
      preClient.release();
    }

    // Drizzle's own migrate() — always a no-op after the idempotent pre-apply
    // above, but retained as a safety net for any edge cases.
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });

    log("info", "migrations_applied", { dialect: "postgresql" });

    // Drop demo schemas after a schema change so they get rebuilt fresh
    // from the public schema's new structure on next activation. Demo
    // schemas are sandboxes that the demo router (src/server/routers/
    // demo.ts:436) recreates via DROP TABLE + CREATE TABLE LIKE public.x
    // INCLUDING ALL on every activateProfile call. They never carry
    // user-meaningful state, so dropping them on schema upgrade is the
    // simplest way to keep them in sync with the public schema.
    //
    // Without this, demo profiles activated before a schema change
    // would have stale per-tenant tables (missing new columns, old
    // decimal precision, etc.) and any query into the demo schema
    // would fail at runtime.
    if (backupPath) {
      const demoClient = await pool.connect();
      try {
        const { rows: demoSchemas } = await demoClient.query<{
          nspname: string;
        }>(
          "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'demo_%' ORDER BY nspname",
        );
        for (const { nspname } of demoSchemas) {
          // Quote identifier to defend against schema names with special chars
          const quoted = '"' + nspname.replaceAll('"', '""') + '"';
          await demoClient.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
          log("info", "demo_schema_dropped_for_rebuild", {
            schema: nspname,
            reason:
              "Schema upgrade — demo profile will be rebuilt fresh on next activation",
          });
        }
        if (demoSchemas.length > 0) {
          log("info", "demo_schemas_cleared", {
            count: demoSchemas.length,
            note: "Users with active demo profiles will need to re-activate via the UI",
          });
        }
      } catch (demoErr) {
        log("warn", "demo_schema_cleanup_failed", {
          error: demoErr instanceof Error ? demoErr.message : String(demoErr),
        });
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

    // Reference-data reconcile (R43): additive, runs on every migrate so a
    // new tax year in the seed reaches existing installs. Fails the migrate
    // loudly on any error — a silently skipped reconcile is the "seed never
    // reaches prod" bug this replaces.
    const seedClient = await pool.connect();
    try {
      const seedSql = fs.readFileSync(
        path.resolve("./seed-reference-data.sql"),
        "utf-8",
      );
      const seedTables = parseSeedTableNames(seedSql);
      for (const table of seedTables) {
        const { rows } = await seedClient.query(
          `SELECT 1
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_attribute a ON a.attrelid = i.indrelid
                                AND a.attnum = ANY(i.indkey)
            WHERE c.relname = $1 AND i.indisunique AND a.attname = 'tax_year'
            LIMIT 1`,
          [table],
        );
        if (rows.length === 0) {
          throw new Error(
            `Reference table "${table}" has no tax_year-scoped unique constraint — ` +
              `seed reconcile would duplicate rows on every migrate. Add a unique index first.`,
          );
        }
      }
      await seedClient.query(seedSql);
      log("info", "reference_data_reconciled", {
        tables: seedTables.join(", "),
      });
    } finally {
      seedClient.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * SQLite twin of writePreMigrationBackupPg (see its docblock) — same
 * VERSION_TABLE_NAMES snapshot, same JSON shape, written by the
 * squash-upgrade path.
 */
function writePreMigrationBackupSQLite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
  schemaVersion: string,
): string | null {
  const tables: Record<string, unknown[]> = {};
  for (const tableName of VERSION_TABLE_NAMES) {
    try {
      tables[tableName] = sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
    } catch {
      tables[tableName] = [];
    }
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
        "No writable directory for the pre-upgrade backup (tried LEDGR_BACKUP_DIR, /app/data, /tmp, .). Migration is proceeding WITHOUT an on-disk safety net — set LEDGR_BACKUP_DIR to a writable volume mount.",
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
    return backupPath;
  } catch (backupErr) {
    log("error", "pre_migration_backup_write_failed", {
      dir: backupDir,
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
      message:
        "Pre-upgrade backup write failed after its directory passed a probe. Migration is proceeding WITHOUT an on-disk safety net.",
    });
    return null;
  }
}

/**
 * Handle SQLite squash upgrade: same logic as PG but using better-sqlite3 API.
 * Detects squash, creates backup, clears old journal, applies migration
 * idempotently, and records the hash so Drizzle's migrate() is a no-op.
 */
function handleSQLiteSquashUpgrade(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
  migrationsFolder: string,
  journalPath: string,
): string | null {
  // Check if __drizzle_migrations table exists
  const tableExists = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
    )
    .get() as { n: number };
  if (!tableExists || tableExists.n === 0) return null;

  const appliedCount = (
    sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as {
      n: number;
    }
  ).n;

  const journal = JSON.parse(
    fs.readFileSync(path.resolve(journalPath), "utf-8"),
  );
  const journalCount = journal.entries?.length ?? 0;

  // Detect squash. Three cases:
  //   1. Count mismatch (appliedCount > journalCount) — old logic, catches the
  //      common case where a squash collapses N migrations into M < N.
  //   2. appliedCount === 0 with existing application tables — partial recovery
  //      from a previous failed squash that cleared the journal but didn't finish.
  //   3. HASH mismatch — appliedCount equals journalCount but the DB's applied
  //      hashes don't match the journal's expected hashes. Happens when the
  //      v4→v5 squash produces the same number of journal entries as the
  //      previous version had, but the file contents (and therefore hashes)
  //      changed. Without this, drizzle.migrate() would attempt to apply the
  //      "new" migrations from scratch and fail on duplicate-table errors.
  let needsSquashRecovery = appliedCount > journalCount;
  if (!needsSquashRecovery) {
    if (appliedCount === 0) {
      // Check if any application tables exist (partial squash recovery).
      // Use the era probes so we can skip the second probe pass below if positive.
      const v07Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='savings_planned_tx_settlements'",
        )
        .get() as { n: number };
      const v06Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='account_holdings'",
        )
        .get() as { n: number };
      const v05Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM pragma_table_info('annual_performance') WHERE name='is_immutable'",
        )
        .get() as { n: number };
      const v03Check = sqlite
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='projection_overrides'",
        )
        .get() as { n: number };
      if (
        v07Check.n > 0 ||
        v06Check.n > 0 ||
        v05Check.n > 0 ||
        v03Check.n > 0
      ) {
        needsSquashRecovery = true;
        log("info", "partial_squash_recovery_detected", {
          reason:
            "Migration journal empty but application tables exist — recovering from failed squash",
        });
      }
    } else if (journalCount > 0) {
      // Only check the first `appliedCount` journal entries for hash mismatch.
      // Entries beyond appliedCount are legitimately new (not yet applied) and
      // should NOT trigger squash recovery — they go through the normal migrate() path.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cryptoMod = require("crypto") as typeof import("crypto");
      const appliedHashes = new Set(
        (
          sqlite.prepare("SELECT hash FROM __drizzle_migrations").all() as {
            hash: string;
          }[]
        ).map((r) => r.hash),
      );
      for (const entry of journal.entries.slice(0, appliedCount)) {
        const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        const expected = cryptoMod
          .createHash("sha256")
          .update(sql)
          .digest("hex");
        if (!appliedHashes.has(expected)) {
          needsSquashRecovery = true;
          break;
        }
      }
    }
  }
  if (!needsSquashRecovery) return null;

  // --- Squash detected ---
  // Detect schema era. The first migration a post-squash install applied is
  // its release-line baseline — an exact signal (a schema-shape probe can't
  // tell a v0.7.0 install from a v0.6.8 one, since the v7 baseline IS the
  // v0.6.8 tip). SQLite baseline files differ from the PG ones, so these
  // hashes are the SQLite spellings.
  const SQLITE_BASELINE_HASHES: Record<string, string> = {
    dc91abbd28dd17fc654c9712fb27ce8f922708ccaaad7a4d68acbc19d8a7c685:
      "v0.7_final",
    d640cf13da448193bc3cd36084a9495bf8f826d3a3df15f0cfe4acfb6776c2d3:
      "v0.6_final",
  };
  let hashEra: string | null = null;
  try {
    const firstRow = sqlite
      .prepare(
        "SELECT hash FROM __drizzle_migrations ORDER BY rowid ASC LIMIT 1",
      )
      .get() as { hash?: string } | undefined;
    if (firstRow?.hash && SQLITE_BASELINE_HASHES[firstRow.hash]) {
      hashEra = SQLITE_BASELINE_HASHES[firstRow.hash] ?? null;
    }
  } catch {
    // fall through to probes
  }

  // Heuristic fallback for older eras / installs missing the baseline row.
  const probeV06Sqlite = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='account_holdings'",
    )
    .get() as { n: number };
  const probeV05Sqlite = sqlite
    .prepare(
      "SELECT count(*) AS n FROM pragma_table_info('annual_performance') WHERE name='is_immutable'",
    )
    .get() as { n: number };
  const probeV03Sqlite = sqlite
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='projection_overrides'",
    )
    .get() as { n: number };
  const schemaVersion =
    hashEra ??
    (probeV06Sqlite.n > 0
      ? "v0.6_final"
      : probeV05Sqlite.n > 0
        ? "v0.5_final"
        : probeV03Sqlite.n > 0
          ? "v0.3_final"
          : "v0.2_final");

  log("info", "sqlite_squash_upgrade_start", {
    appliedMigrations: appliedCount,
    journalMigrations: journalCount,
    schemaVersion,
  });

  // 1. Export backup
  const backupPath = writePreMigrationBackupSQLite(sqlite, schemaVersion);

  // 2. Clear old journal
  sqlite.prepare("DELETE FROM __drizzle_migrations").run();

  // 3. Apply new migration idempotently and record hash
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic require in SQLite dialect
  const crypto = require("crypto") as typeof import("crypto");
  for (const entry of journal.entries) {
    const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, "utf-8");
    const hash = crypto.createHash("sha256").update(sql).digest("hex");

    // (Per-tag data-backfill hooks removed — see the note in
    // handleSquashUpgrade above. Post-squash this loop only ever sees
    // 0000_v8_initial_schema.)
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s: string) => s.trim())
      .filter(Boolean);

    const applyTx = sqlite.transaction(() => {
      for (const stmt of statements) {
        try {
          sqlite.exec(stmt);
        } catch (stmtErr) {
          const msg = (stmtErr as Error).message ?? "";
          // SQLite: "table X already exists", "duplicate column name", etc.
          // "no such column"/"no such table" is the mirror-image case — a
          // later migration already renamed/dropped what this (older,
          // blindly-replayed) migration is trying to touch. See the
          // matching IGNORABLE_PG_CODES comment in handleSquashUpgrade
          // above for why both directions are benign here.
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate column") ||
            msg.includes("no such column") ||
            msg.includes("no such table") ||
            msg.includes("no such index")
          ) {
            // Idempotent — ignore
          } else {
            throw stmtErr;
          }
        }
      }
      sqlite
        .prepare(
          "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        )
        .run(hash, String(Date.now()));
    });
    applyTx();
    log("info", "squash_migration_applied", { tag: entry.tag });
  }

  log("info", "sqlite_squash_upgrade_complete", { schemaVersion });
  return backupPath;
}

function runSQLite() {
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

  // Handle squash upgrade before running Drizzle's migrate()
  const backupPath = handleSQLiteSquashUpgrade(
    sqlite,
    "./drizzle-sqlite",
    "./drizzle-sqlite/meta/_journal.json",
  );

  // Apply any pending migrations idempotently. Mirrors the PostgreSQL pre-apply
  // step: handles upgrade DBs that already have tables/columns from old pre-squash
  // migrations (or a squash SQL that was generated from a later schema snapshot),
  // causing newer migrations to re-add DDL that already exists.
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
    for (const entry of journal.entries) {
      const sqlPath = path.resolve(`./drizzle-sqlite/${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const hash = crypto.createHash("sha256").update(sql).digest("hex");
      if (appliedHashes.has(hash)) continue;
      // (Per-tag data-backfill hooks removed — see the note in
      // handleSquashUpgrade above. Post-squash this loop only ever sees
      // 0000_v8_initial_schema.)
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const applyTx = sqlite.transaction(() => {
        for (const stmt of statements) {
          try {
            sqlite.exec(stmt);
          } catch (stmtErr) {
            const msg = (stmtErr as Error).message ?? "";
            if (
              msg.includes("already exists") ||
              msg.includes("duplicate column") ||
              msg.includes("no such column") ||
              msg.includes("no such table") ||
              msg.includes("no such index")
            ) {
              // idempotent — skip
            } else {
              throw stmtErr;
            }
          }
        }
        sqlite
          .prepare(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
          )
          .run(hash, String(Date.now()));
      });
      applyTx();
      log("info", "migration_applied", { tag: entry.tag, dialect: "sqlite" });
    }
  }

  // Drizzle's own migrate() — always a no-op after the idempotent pre-apply
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

  // Reference-data reconcile (R43): additive, runs on every migrate. Mirrors
  // the Postgres path above — fails loudly rather than warn-and-continue.
  try {
    const seedSql = fs.readFileSync(
      path.resolve("./seed-reference-data.sql"),
      "utf-8",
    );
    const seedTables = parseSeedTableNames(seedSql);
    for (const table of seedTables) {
      const indexes = sqlite.prepare(`PRAGMA index_list("${table}")`).all() as {
        name: string;
        unique: number;
      }[];
      const hasYearScopedUnique = indexes.some((idx) => {
        if (idx.unique !== 1) return false;
        const cols = sqlite
          .prepare(`PRAGMA index_info("${idx.name}")`)
          .all() as { name: string }[];
        return cols.some((c) => c.name === "tax_year");
      });
      if (!hasYearScopedUnique) {
        throw new Error(
          `Reference table "${table}" has no tax_year-scoped unique constraint — ` +
            `seed reconcile would duplicate rows on every migrate. Add a unique index first.`,
        );
      }
    }
    sqlite.exec(seedSql);
    log("info", "reference_data_reconciled", { tables: seedTables.join(", ") });
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
