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

// Table names that are included in versioned backups (must match version-tables.ts).
// This is a local copy because db-migrate.ts runs in Docker where src/ isn't available.
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
  "api_connections",
  "app_settings",
  "local_admins",
  "scenarios",
  "asset_class_params",
  "mc_presets",
  "portfolio_snapshots",
  "brokerage_goals",
  "contribution_profiles",
  "net_worth_annual",
  "home_improvement_items",
  "other_asset_items",
  "historical_notes",
  "relocation_scenarios",
  "jobs",
  "budget_items",
  "savings_monthly",
  "savings_planned_transactions",
  "savings_allocation_overrides",
  "self_loans",
  "performance_accounts",
  "mortgage_what_if_scenarios",
  "mortgage_extra_payments",
  "retirement_settings",
  "retirement_salary_overrides",
  "retirement_budget_overrides",
  "asset_class_correlations",
  "glide_path_allocations",
  "brokerage_planned_transactions",
  "annual_performance",
  "property_taxes",
  "salary_changes",
  "paycheck_deductions",
  "contribution_accounts",
  "portfolio_accounts",
  "account_performance",
  "mc_preset_glide_paths",
  "mc_preset_return_overrides",
  "projection_overrides",
  "mc_user_presets",
  "account_holdings",
  "pending_rollovers",
];

// ---------------------------------------------------------------------------
// Squash upgrade detection + backup (PostgreSQL)
// ---------------------------------------------------------------------------

type SquashResult = {
  backupPath: string | null;
  schemaVersion: string | null;
  wasSquash: boolean;
};

/** Detect the pre-squash schema era by probing for tables/columns. */
async function detectSchemaEra(
  client: import("pg").PoolClient,
): Promise<string> {
  // v0.5.x has is_immutable on annual_performance (added in 0001_v5_schema_changes)
  const { rows: probeV05 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'annual_performance' AND column_name = 'is_immutable'
    ) AS exists`,
  );
  if (probeV05[0]?.exists) return "v0.5_final";

  // v0.3.x has projection_overrides table (added in v0.3.23)
  const { rows: probeV03 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'projection_overrides'
    ) AS exists`,
  );
  if (probeV03[0]?.exists) return "v0.3_final";

  // v0.2.x has is_api_sync_enabled on savings_goals (renamed in v0.2.0)
  const { rows: probeV02 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'savings_goals' AND column_name = 'is_api_sync_enabled'
    ) AS exists`,
  );
  if (probeV02[0]?.exists) return "v0.2_final";

  // v0.1.x — use the last v0.1.x tag
  return "0008_prior_year_contrib";
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
            WHERE table_name = 'people'
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

      try {
        const backupDir = fs.existsSync("/app/data") ? "/app/data" : ".";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupPath = path.join(
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
      } catch (backupErr) {
        log("warn", "pre_migration_backup_write_failed", {
          error:
            backupErr instanceof Error ? backupErr.message : String(backupErr),
        });
        backupPath = null;
      }

      // 2. Clear old migration journal
      await client.query("DELETE FROM drizzle.__drizzle_migrations");
      log("info", "migration_journal_cleared", {
        removedEntries: appliedCount,
      });
    }

    // 3. Apply each new journal migration idempotently and record its hash
    const crypto = await import("crypto");
    const IGNORABLE_PG_CODES = new Set([
      "42701", // duplicate_column
      "42P07", // duplicate_table
      "42710", // duplicate_object (index, constraint, etc.)
      "23505", // unique_violation
    ]);

    for (const entry of journal.entries) {
      const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const hash = crypto.createHash("sha256").update(sql).digest("hex");

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
             WHERE table_name = $1 AND column_name = $2`,
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
    log("warn", "squash_upgrade_failed", {
      error: err instanceof Error ? err.message : String(err),
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

    // Normal Drizzle migration — handles fresh installs and incremental upgrades.
    // After a squash upgrade, this is a no-op (all hashes already recorded).
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });

    // Backfill migration journal: if DB was bootstrapped via `drizzle-kit push`,
    // migrations may exist on disk but not in __drizzle_migrations. For each
    // un-recorded migration, apply the SQL (idempotent ALTERs) and record it.
    const journal = JSON.parse(
      fs.readFileSync(path.resolve("./drizzle/meta/_journal.json"), "utf-8"),
    );
    const client = await pool.connect();
    try {
      const { rows: recorded } = await client.query(
        "SELECT hash FROM drizzle.__drizzle_migrations",
      );
      const recordedHashes = new Set(
        recorded.map((r: { hash: string }) => r.hash),
      );
      const crypto = await import("crypto");
      const IGNORABLE_PG_CODES = new Set([
        "42701", // duplicate_column
        "42P07", // duplicate_table
        "42710", // duplicate_object (index, constraint, etc.)
        "23505", // unique_violation
      ]);
      for (const entry of journal.entries) {
        const sqlPath = path.resolve(`./drizzle/${entry.tag}.sql`);
        if (!fs.existsSync(sqlPath)) continue;
        const sql = fs.readFileSync(sqlPath, "utf-8");
        const hash = crypto.createHash("sha256").update(sql).digest("hex");
        if (recordedHashes.has(hash)) continue;
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s: string) => s.trim())
          .filter(Boolean);
        await client.query("BEGIN");
        try {
          for (const stmt of statements) {
            await client.query("SAVEPOINT backfill_stmt");
            try {
              await client.query(stmt);
              await client.query("RELEASE SAVEPOINT backfill_stmt");
            } catch (stmtErr) {
              const code = (stmtErr as { code?: string }).code;
              if (code && IGNORABLE_PG_CODES.has(code)) {
                await client.query("ROLLBACK TO SAVEPOINT backfill_stmt");
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
          log("info", "migration_backfilled", { tag: entry.tag });
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        }
      }
    } finally {
      client.release();
    }

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

    // Seed reference data if empty
    const seedClient = await pool.connect();
    try {
      const { rows } = await seedClient.query(
        "SELECT count(*)::int AS n FROM contribution_limits",
      );
      if (rows[0]?.n === 0) {
        const seedSql = fs.readFileSync(
          path.resolve("./seed-reference-data.sql"),
          "utf-8",
        );
        await seedClient.query(seedSql);
        log("info", "reference_data_seeded", {
          tables: "contribution_limits, tax_brackets",
        });
      }
    } catch (seedErr) {
      log("warn", "reference_data_seed_skipped", {
        error: (seedErr as Error).message,
      });
    } finally {
      seedClient.release();
    }
  } finally {
    await pool.end();
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

  // Detect squash. Two cases:
  //   1. Count mismatch (appliedCount > journalCount) — old logic, catches the
  //      common case where a squash collapses N migrations into M < N.
  //   2. HASH mismatch — appliedCount equals journalCount but the DB's applied
  //      hashes don't match the journal's expected hashes. Happens when the
  //      v4→v5 squash produces the same number of journal entries as the
  //      previous version had, but the file contents (and therefore hashes)
  //      changed. Without this, drizzle.migrate() would attempt to apply the
  //      "new" migrations from scratch and fail on duplicate-table errors.
  let needsSquashRecovery = appliedCount > journalCount;
  if (!needsSquashRecovery && appliedCount > 0 && journalCount > 0) {
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
      const expected = cryptoMod.createHash("sha256").update(sql).digest("hex");
      if (!appliedHashes.has(expected)) {
        needsSquashRecovery = true;
        break;
      }
    }
  }
  if (!needsSquashRecovery) return null;

  // --- Squash detected ---
  // Detect schema era. Check newest first to correctly classify v0.5.x installs.
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
    probeV05Sqlite.n > 0
      ? "v0.5_final"
      : probeV03Sqlite.n > 0
        ? "v0.3_final"
        : "v0.2_final";

  log("info", "sqlite_squash_upgrade_start", {
    appliedMigrations: appliedCount,
    journalMigrations: journalCount,
    schemaVersion,
  });

  // 1. Export backup
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

  let backupPath: string | null = null;
  try {
    const backupDir = fs.existsSync("/app/data") ? "/app/data" : ".";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = path.join(backupDir, `pre-upgrade-backup-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup));
    log("info", "pre_migration_backup_complete", {
      path: backupPath,
      tableCount: Object.keys(tables).length,
      totalRows: Object.values(tables).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    });
  } catch (backupErr) {
    log("warn", "pre_migration_backup_write_failed", {
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
    });
    backupPath = null;
  }

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
          if (
            msg.includes("already exists") ||
            msg.includes("duplicate column")
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

  // Seed reference data if empty
  try {
    const row = sqlite
      .prepare("SELECT count(*) AS n FROM contribution_limits")
      .get() as { n: number };
    if (row.n === 0) {
      const seedSql = fs.readFileSync(
        path.resolve("./seed-reference-data.sql"),
        "utf-8",
      );
      sqlite.exec(seedSql);
      log("info", "reference_data_seeded", {
        tables: "contribution_limits, tax_brackets",
      });
    }
  } catch (seedErr) {
    log("warn", "reference_data_seed_skipped", {
      error: (seedErr as Error).message,
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

run();
