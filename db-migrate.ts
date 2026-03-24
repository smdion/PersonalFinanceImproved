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

// Table names that are included in versioned backups (must match version-tables.ts)
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
];

async function createPreMigrationBackup(
  pool: import("pg").Pool,
): Promise<string | null> {
  const client = await pool.connect();
  try {
    // Check if __drizzle_migrations table exists (indicates an existing DB)
    const { rows: tableCheck } = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = '__drizzle_migrations'
      ) AS exists`,
    );
    if (!tableCheck[0]?.exists) return null; // Fresh DB — no backup needed

    // Check current migration count in DB
    const { rows: migrationRows } = await client.query(
      "SELECT count(*)::int AS count FROM __drizzle_migrations",
    );
    const appliedCount = migrationRows[0]?.count ?? 0;

    // Read the new journal to see how many migrations we expect
    const journal = JSON.parse(
      fs.readFileSync(path.resolve("./drizzle/meta/_journal.json"), "utf-8"),
    );
    const journalCount = journal.entries?.length ?? 0;

    // If DB has more migrations than journal (squash scenario), create backup
    if (appliedCount <= journalCount) return null; // Normal upgrade or fresh — no backup needed

    log("info", "pre_migration_backup_start", {
      appliedMigrations: appliedCount,
      journalMigrations: journalCount,
      reason:
        "Migration squash detected — applied count exceeds journal entries",
    });

    // Export all versioned tables
    const tables: Record<string, unknown[]> = {};
    let schemaVersion = "unknown";

    // Try to read the old schema version from the journal that was in the DB
    try {
      const { rows: hashRows } = await client.query(
        "SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
      );
      if (hashRows[0]) {
        // We can't reverse the hash to a tag name, so just record the count
        schemaVersion = `pre-squash-${appliedCount}-migrations`;
      }
    } catch {
      // Ignore — schemaVersion stays "unknown"
    }

    for (const tableName of VERSION_TABLE_NAMES) {
      try {
        const { rows } = await client.query(`SELECT * FROM "${tableName}"`);
        tables[tableName] = rows;
      } catch {
        // Table may not exist in older schemas — skip
        tables[tableName] = [];
      }
    }

    const backup = {
      schemaVersion,
      exportedAt: new Date().toISOString(),
      preUpgradeBackup: true,
      tables,
    };

    // Write to /app/data/ (Docker volume) or current directory
    const backupDir = fs.existsSync("/app/data") ? "/app/data" : ".";
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
  } catch (err) {
    // Non-fatal: log and continue with migration
    log("warn", "pre_migration_backup_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
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
    // Pre-migration auto-backup: if the DB has existing tables but the
    // migration journal differs (e.g., v0.1.x → v0.2.0 squash), export
    // all versioned table data to a JSON file before applying migrations.
    const preUpgradeBackupPath = await createPreMigrationBackup(pool);

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
        "SELECT hash FROM __drizzle_migrations",
      );
      const recordedHashes = new Set(
        recorded.map((r: { hash: string }) => r.hash),
      );
      const crypto = await import("crypto");
      // PG error codes for idempotent DDL (locale-independent)
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
        // Try to apply each statement inside a transaction (may already exist from a prior push)
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s: string) => s.trim())
          .filter(Boolean);
        await client.query("BEGIN");
        try {
          for (const stmt of statements) {
            // Use savepoints so a failed DDL doesn't abort the entire transaction
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
          // Record in journal (within same transaction)
          await client.query(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)",
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

    // Post-migration column renames: v0.2.0 renamed two boolean columns.
    // The squashed schema has the new names, but existing DBs still have old names.
    // These ALTERs are idempotent — they no-op if the column already has the new name.
    const renameClient = await pool.connect();
    try {
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
          // Check if the old column still exists
          const { rows } = await renameClient.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2`,
            [table, from],
          );
          if (rows.length > 0) {
            await renameClient.query(
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
    } finally {
      renameClient.release();
    }

    log("info", "migrations_applied", { dialect: "postgresql" });

    // Write upgrade banner flag if a pre-migration backup was created
    if (preUpgradeBackupPath) {
      const flagClient = await pool.connect();
      try {
        await flagClient.query(
          `INSERT INTO app_settings (key, value)
           VALUES ('pre_upgrade_backup', $1::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [
            JSON.stringify({
              path: preUpgradeBackupPath,
              createdAt: new Date().toISOString(),
            }),
          ],
        );
        log("info", "upgrade_banner_flag_set", {
          path: preUpgradeBackupPath,
        });
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
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: "./drizzle-sqlite" });
  log("info", "migrations_applied", { dialect: "sqlite", path: dbPath });

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
