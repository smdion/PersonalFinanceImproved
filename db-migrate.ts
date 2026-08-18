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
  "salary_profiles",
  "contribution_profiles",
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

/** Detect the pre-squash schema era by probing for tables/columns. */
async function detectSchemaEra(
  client: import("pg").PoolClient,
): Promise<string> {
  // v0.6.x has account_holdings (added in 0001_melodic_thaddeus_ross, the
  // earliest post-v6-baseline migration, so present in every deployed v0.6.x install)
  const { rows: probeV06 } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'account_holdings'
    ) AS exists`,
  );
  if (probeV06[0]?.exists) return "v0.6_final";

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
      "23505", // unique_violation
      "42703", // undefined_column — already renamed/dropped by a later migration
      "42P01", // undefined_table — already renamed/dropped by a later migration
    ]);

    for (const entry of journal.entries) {
      const sqlPath = path.resolve(`${migrationsFolder}/${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) continue;
      const sql = fs.readFileSync(sqlPath, "utf-8");
      const hash = crypto.createHash("sha256").update(sql).digest("hex");

      // See the matching comment in runPostgres's idempotent pre-apply loop
      // — must run after the schema is caught up through 0015 but before
      // 0016 drops the source tables, wherever that lands in this replay.
      if (entry.tag === "0016_drop_salary_ledger_tables") {
        await backfillHistoricalSalaries(pool);
      }

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

/**
 * Freeze `salary_changes` + `job_bonus_overrides` into `historical_salaries`
 * (past years only — the current year stays live/auto-fill, same rule
 * historical.ts's computeSummary uses) and convert every Salary Profile's
 * entries to complete-only for each person's currently-active job (dropping
 * entries for ended/speculative jobs), BEFORE migration
 * 0016_drop_salary_ledger_tables removes the source tables for good.
 *
 * Gated entirely on `salary_changes` still existing — a fresh install (no
 * legacy data) or an already-migrated DB (dev, migrated by hand on
 * 2026-08-18 via the identical logic in
 * .scratch/migrate-to-historical-salaries.mjs) both skip this as a no-op.
 *
 * Callers must invoke this from WITHIN the migration-apply loop, immediately
 * before applying the 0016 entry specifically — NOT once up front. A deploy
 * can be arbitrarily far behind (missing 0013's `jobs.is_speculative`, not
 * just 0015/0016), and this function queries that column; calling it before
 * the schema has caught up crashes on "column is_speculative does not
 * exist" (caught on the demo canary on 2026-08-18, never reached prod).
 */
async function backfillHistoricalSalaries(
  pool: import("pg").Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: tableCheck } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'salary_changes'
      ) AS exists`,
    );
    if (!tableCheck[0]?.exists) return;

    const currentYear = new Date().getFullYear();

    await client.query("BEGIN");
    try {
      // This runs before the migration-apply loop, so 0015 (which creates
      // this table) may not have run yet on a prod deploy that's starting
      // further behind than dev was — create it here too so the backfill
      // below always has somewhere to write. Matches 0015's DDL exactly
      // (same constraint/index names) so 0015 itself becomes a clean no-op
      // (duplicate_table/duplicate_object, already-ignorable) when it runs
      // afterward, instead of silently creating a second redundant FK.
      await client.query(`
        CREATE TABLE IF NOT EXISTS historical_salaries (
          id serial PRIMARY KEY NOT NULL,
          person_id integer NOT NULL,
          year integer NOT NULL,
          salary numeric(14, 2) NOT NULL,
          bonus numeric(14, 2) DEFAULT '0' NOT NULL
        )
      `);
      await client.query(`
        DO $$ BEGIN
          ALTER TABLE historical_salaries
            ADD CONSTRAINT historical_salaries_person_id_people_id_fk
            FOREIGN KEY (person_id) REFERENCES public.people(id)
            ON DELETE cascade ON UPDATE no action;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS historical_salaries_person_year_idx
          ON historical_salaries USING btree (person_id, year)
      `);

      const { rows: jobs } = await client.query<{
        id: number;
        person_id: number;
        end_date: string | null;
        is_speculative: boolean;
      }>("SELECT id, person_id, end_date, is_speculative FROM jobs");
      const jobById = new Map(jobs.map((j) => [j.id, j]));

      const { rows: pastChanges } = await client.query<{
        job_id: number;
        effective_date: string;
        new_salary: string;
      }>(
        `SELECT job_id, effective_date, new_salary FROM salary_changes
         WHERE EXTRACT(YEAR FROM effective_date) < $1
         ORDER BY job_id, effective_date`,
        [currentYear],
      );
      const { rows: pastOverrides } = await client.query<{
        job_id: number;
        year: number;
        override_amount: string;
      }>(
        `SELECT job_id, year, override_amount FROM job_bonus_overrides WHERE year < $1`,
        [currentYear],
      );
      const overrideMap = new Map(
        pastOverrides.map((o) => [`${o.job_id}:${o.year}`, o.override_amount]),
      );

      let backfilled = 0;
      for (const c of pastChanges) {
        const job = jobById.get(c.job_id);
        if (!job || job.is_speculative) continue;
        const year = new Date(c.effective_date).getUTCFullYear();
        const bonus = overrideMap.get(`${c.job_id}:${year}`) ?? "0.00";
        await client.query(
          `INSERT INTO historical_salaries (person_id, year, salary, bonus)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (person_id, year) DO UPDATE SET salary = excluded.salary, bonus = excluded.bonus`,
          [job.person_id, year, c.new_salary, bonus],
        );
        backfilled++;
      }

      // "Live" salary per job = its most recent salary_changes row (any
      // year, including the current one — what the job resolves to TODAY).
      const { rows: allChanges } = await client.query<{
        job_id: number;
        new_salary: string;
      }>(
        "SELECT job_id, new_salary FROM salary_changes ORDER BY job_id, effective_date",
      );
      const liveSalaryByJob = new Map<number, string>();
      for (const c of allChanges) liveSalaryByJob.set(c.job_id, c.new_salary);

      const activeJobIds = new Set(
        jobs
          .filter((j) => !j.is_speculative && j.end_date === null)
          .map((j) => j.id),
      );

      const { rows: profiles } = await client.query<{
        id: number;
        salaries: Record<
          string,
          {
            salary?: number;
            bonusPercent?: number;
            bonusMultiplier?: number;
            monthsInBonusYear?: number;
          }
        >;
      }>("SELECT id, salaries FROM salary_profiles");

      let convertedProfiles = 0;
      for (const p of profiles) {
        const next: Record<
          string,
          {
            salary: number;
            bonusPercent: number;
            bonusMultiplier: number;
            monthsInBonusYear: number;
          }
        > = {};
        for (const [jobIdStr, entry] of Object.entries(p.salaries ?? {})) {
          const jobId = Number(jobIdStr);
          if (!activeJobIds.has(jobId)) continue;
          next[jobIdStr] = {
            salary: entry.salary ?? Number(liveSalaryByJob.get(jobId) ?? 0),
            bonusPercent: entry.bonusPercent ?? 0,
            bonusMultiplier: entry.bonusMultiplier ?? 1,
            monthsInBonusYear: entry.monthsInBonusYear ?? 12,
          };
        }
        await client.query(
          "UPDATE salary_profiles SET salaries = $1 WHERE id = $2",
          [JSON.stringify(next), p.id],
        );
        convertedProfiles++;
      }

      await client.query("COMMIT");
      log("info", "historical_salaries_backfill_complete", {
        historicalSalaryRowsWritten: backfilled,
        salaryProfilesConverted: convertedProfiles,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
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
        // Must run AFTER the schema is caught up through 0015 (jobs.
        // is_speculative from 0013, historical_salaries from 0015) but
        // BEFORE 0016 drops salary_changes/job_bonus_overrides — a deploy
        // can be arbitrarily far behind, not just missing 0015/0016, so
        // this can't run once up front (see backfillHistoricalSalaries's
        // docblock; this ordering bug shipped once already — surfaced on
        // the demo canary, never reached prod).
        if (entry.tag === "0016_drop_salary_ledger_tables") {
          await backfillHistoricalSalaries(pool);
        }
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
      if (v06Check.n > 0 || v05Check.n > 0 || v03Check.n > 0) {
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
  // Detect schema era. Check newest first to correctly classify older installs.
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
    probeV06Sqlite.n > 0
      ? "v0.6_final"
      : probeV05Sqlite.n > 0
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

    // See the matching comment in runPostgres's idempotent pre-apply loop
    // — must run after the schema is caught up through 0015 but before
    // 0016 drops the source tables, wherever that lands in this replay.
    if (entry.tag === "0016_drop_salary_ledger_tables") {
      backfillHistoricalSalariesSQLite(sqlite);
    }

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
            msg.includes("no such table")
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

/**
 * SQLite twin of backfillHistoricalSalaries (see its docblock above) — same
 * gate (skip if `salary_changes` doesn't exist), same logic, same
 * call-it-immediately-before-0016-within-the-loop timing requirement.
 */
function backfillHistoricalSalariesSQLite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
): void {
  const tableCheck = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='salary_changes'",
    )
    .get();
  if (!tableCheck) return;

  const currentYear = new Date().getFullYear();

  const tx = sqlite.transaction(() => {
    // See the matching comment in backfillHistoricalSalaries (pg) — 0015
    // may not have run yet on a deploy starting further behind than dev.
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS historical_salaries (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        person_id integer NOT NULL REFERENCES people(id) ON DELETE cascade,
        year integer NOT NULL,
        salary text NOT NULL,
        bonus text DEFAULT '0' NOT NULL
      )
    `);
    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS historical_salaries_person_year_idx
        ON historical_salaries (person_id, year)
    `);

    type JobRow = {
      id: number;
      person_id: number;
      end_date: string | null;
      is_speculative: number;
    };
    const jobs = sqlite
      .prepare("SELECT id, person_id, end_date, is_speculative FROM jobs")
      .all() as JobRow[];
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    type ChangeRow = {
      job_id: number;
      effective_date: string;
      new_salary: string;
    };
    const pastChanges = sqlite
      .prepare(
        "SELECT job_id, effective_date, new_salary FROM salary_changes WHERE CAST(strftime('%Y', effective_date) AS INTEGER) < ? ORDER BY job_id, effective_date",
      )
      .all(currentYear) as ChangeRow[];
    type OverrideRow = {
      job_id: number;
      year: number;
      override_amount: string;
    };
    const pastOverrides = sqlite
      .prepare(
        "SELECT job_id, year, override_amount FROM job_bonus_overrides WHERE year < ?",
      )
      .all(currentYear) as OverrideRow[];
    const overrideMap = new Map(
      pastOverrides.map((o) => [`${o.job_id}:${o.year}`, o.override_amount]),
    );

    const upsertHist = sqlite.prepare(`
      INSERT INTO historical_salaries (person_id, year, salary, bonus)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (person_id, year) DO UPDATE SET salary = excluded.salary, bonus = excluded.bonus
    `);
    let backfilled = 0;
    for (const c of pastChanges) {
      const job = jobById.get(c.job_id);
      if (!job || job.is_speculative) continue;
      const year = new Date(c.effective_date).getUTCFullYear();
      const bonus = overrideMap.get(`${c.job_id}:${year}`) ?? "0.00";
      upsertHist.run(job.person_id, year, c.new_salary, bonus);
      backfilled++;
    }

    const allChanges = sqlite
      .prepare(
        "SELECT job_id, new_salary FROM salary_changes ORDER BY job_id, effective_date",
      )
      .all() as { job_id: number; new_salary: string }[];
    const liveSalaryByJob = new Map<number, string>();
    for (const c of allChanges) liveSalaryByJob.set(c.job_id, c.new_salary);

    const activeJobIds = new Set(
      jobs
        .filter((j) => !j.is_speculative && j.end_date === null)
        .map((j) => j.id),
    );

    type ProfileRow = { id: number; salaries: string };
    const profiles = sqlite
      .prepare("SELECT id, salaries FROM salary_profiles")
      .all() as ProfileRow[];
    const updateProfile = sqlite.prepare(
      "UPDATE salary_profiles SET salaries = ? WHERE id = ?",
    );
    let convertedProfiles = 0;
    for (const p of profiles) {
      const salaries = JSON.parse(p.salaries || "{}") as Record<
        string,
        {
          salary?: number;
          bonusPercent?: number;
          bonusMultiplier?: number;
          monthsInBonusYear?: number;
        }
      >;
      const next: Record<
        string,
        {
          salary: number;
          bonusPercent: number;
          bonusMultiplier: number;
          monthsInBonusYear: number;
        }
      > = {};
      for (const [jobIdStr, entry] of Object.entries(salaries)) {
        const jobId = Number(jobIdStr);
        if (!activeJobIds.has(jobId)) continue;
        next[jobIdStr] = {
          salary: entry.salary ?? Number(liveSalaryByJob.get(jobId) ?? 0),
          bonusPercent: entry.bonusPercent ?? 0,
          bonusMultiplier: entry.bonusMultiplier ?? 1,
          monthsInBonusYear: entry.monthsInBonusYear ?? 12,
        };
      }
      updateProfile.run(JSON.stringify(next), p.id);
      convertedProfiles++;
    }

    log("info", "historical_salaries_backfill_complete", {
      dialect: "sqlite",
      historicalSalaryRowsWritten: backfilled,
      salaryProfilesConverted: convertedProfiles,
    });
  });
  tx();
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
      // See the matching comment in runPostgres's idempotent pre-apply loop
      // — must run after the schema is caught up through 0015 but before
      // 0016 drops the source tables, wherever that lands in this replay.
      if (entry.tag === "0016_drop_salary_ledger_tables") {
        backfillHistoricalSalariesSQLite(sqlite);
      }
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
              msg.includes("no such table")
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
