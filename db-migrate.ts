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
 * Export a JSON snapshot of every VERSION_TABLE_NAMES table and write it to
 * disk. Shared by handleSquashUpgrade (pre-squash safety net) and the normal
 * idempotent pre-apply loop's pre-0016 backup (see the call site right
 * before migration 0016_drop_salary_ledger_tables's DROP TABLE runs) — same
 * format either way, so a single "pre-upgrade-backup-*.json" file on disk
 * always means the same thing to an operator regardless of which path wrote
 * it.
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

  try {
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
  } catch (backupErr) {
    log("warn", "pre_migration_backup_write_failed", {
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
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

      // See the matching comment in runPostgres's idempotent pre-apply loop
      // — must run after the schema is caught up through 0015 but before
      // 0016 drops the source tables, wherever that lands in this replay.
      if (entry.tag === "0016_drop_salary_ledger_tables") {
        await backfillHistoricalSalaries(pool);
      }
      if (entry.tag === "0036_category_links_backfill") {
        await backfillCategoryLinks(pool);
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

    // Guard against re-running this against a DB that's already past 0022
    // (Stage B "full shape" migration) in real history. On a squash-upgrade
    // replay, an earlier idempotent step can recreate `salary_changes` as an
    // EMPTY table (it was for-real dropped long ago, so the replayed CREATE
    // succeeds fresh) — tricking the check above into thinking this is a
    // genuinely old pre-0016 database. Without this guard, the unconditional
    // `UPDATE salary_profiles SET salaries = ...` below rebuilds every
    // profile entry down to its OLD 4-field shape (salary/bonusPercent/
    // bonusMultiplier/monthsInBonusYear), silently discarding the 12+ newer
    // fields (payPeriod, w4FilingStatus, extraPaycheckRouting, etc.) that
    // migration 0022 (or later app-level saves) already put there — real
    // incident, 2026-08-23, root-caused and fixed here. `w4FilingStatus` is
    // 0022-exclusive and NON-NULLABLE on every full-shape entry, so its
    // presence anywhere is conclusive proof this DB is already current.
    const { rows: alreadyModern } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM salary_profiles sp, jsonb_each(sp.salaries) e
        WHERE e.value ? 'w4FilingStatus'
      ) AS exists`,
    );
    if (alreadyModern[0]?.exists) {
      log("info", "historical_salaries_backfill_skipped", {
        reason:
          "salary_profiles already has full-shape (post-0022) entries — this DB is already current, not a genuine pre-0016 upgrade",
      });
      return;
    }

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
        end_year: number | null;
        is_speculative: boolean;
      }>(
        `SELECT id, person_id, end_date, is_speculative,
                EXTRACT(YEAR FROM end_date)::int AS end_year
         FROM jobs`,
      );
      const jobById = new Map(jobs.map((j) => [j.id, j]));

      // Year comes from SQL (EXTRACT), not a JS Date re-derivation — pg's
      // driver parses a DATE column into a JS Date already shifted by the
      // server's local timezone, so re-deriving the year via
      // getUTCFullYear() disagrees with the year this same query's WHERE
      // clause used for positive-UTC-offset zones (e.g. Jan 1 shifting into
      // the prior UTC year). Selecting the year in SQL sidesteps the
      // mismatch entirely instead of working around it in JS.
      const { rows: pastChanges } = await client.query<{
        job_id: number;
        effective_date: string;
        new_salary: string;
        year: number;
      }>(
        `SELECT job_id, effective_date, new_salary,
                EXTRACT(YEAR FROM effective_date)::int AS year
         FROM salary_changes
         WHERE EXTRACT(YEAR FROM effective_date) < $1
         ORDER BY effective_date, job_id`,
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

      // Per job, per year: the LAST (chronologically) change that landed in
      // that year — `pastChanges` is ordered by effective_date, so a later
      // iteration naturally overwrites an earlier same-year one.
      const changesByJob = new Map<
        number,
        Map<number, { salary: string; effectiveDate: string }>
      >();
      for (const c of pastChanges) {
        if (!changesByJob.has(c.job_id)) changesByJob.set(c.job_id, new Map());
        changesByJob.get(c.job_id)!.set(c.year, {
          salary: c.new_salary,
          effectiveDate: c.effective_date,
        });
      }

      // Resolve one winning (job, salary) per person per year, carrying a
      // job's salary forward through years with no raise instead of
      // leaving a gap, then pick the chronologically LATEST source across
      // jobs when two jobs of the same person both cover a year (e.g. a
      // same-year job change) — never "whichever job_id is higher".
      const personYear = new Map<
        number,
        Map<number, { jobId: number; salary: string; effectiveDate: string }>
      >();
      for (const [jobId, yearMap] of changesByJob) {
        const job = jobById.get(jobId);
        if (!job || job.is_speculative) continue;
        const years = [...yearMap.keys()].sort((a, b) => a - b);
        if (years.length === 0) continue; // changesByJob always seeds >=1 entry; guard for TS
        const firstYear = years[0]!;
        // Carry forward through the job's own lifetime: up to its end year
        // if it has ended, otherwise up to the last full (past) year —
        // never past either bound, so an ended job's stale salary can't
        // clobber a later job's real years.
        const upperYear = Math.min(
          job.end_year ?? currentYear - 1,
          currentYear - 1,
        );
        if (upperYear < firstYear) continue;

        if (!personYear.has(job.person_id))
          personYear.set(job.person_id, new Map());
        const yearsForPerson = personYear.get(job.person_id)!;

        let carry = yearMap.get(firstYear)!;
        for (let year = firstYear; year <= upperYear; year++) {
          if (yearMap.has(year)) carry = yearMap.get(year)!;
          const existing = yearsForPerson.get(year);
          if (!existing || carry.effectiveDate > existing.effectiveDate) {
            yearsForPerson.set(year, {
              jobId,
              salary: carry.salary,
              effectiveDate: carry.effectiveDate,
            });
          }
        }
      }

      let backfilled = 0;
      for (const [personId, yearsMap] of personYear) {
        for (const [year, info] of yearsMap) {
          // Bonus attaches to the winning job's year regardless of whether
          // that year also had an actual salary_changes row — a carried-
          // forward (no-raise) year with its own bonus override still gets
          // the bonus, instead of silently dropping it.
          const bonus = overrideMap.get(`${info.jobId}:${year}`) ?? "0.00";
          await client.query(
            `INSERT INTO historical_salaries (person_id, year, salary, bonus)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (person_id, year) DO UPDATE SET salary = excluded.salary, bonus = excluded.bonus`,
            [personId, year, info.salary, bonus],
          );
          backfilled++;
        }
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
          // A profile entry pinning only bonus terms (no `salary`) on a job
          // that also has no live salary_changes row has no real number to
          // write — omit the entry entirely rather than fabricate
          // `salary: 0`, which schema comments say is never a valid entry
          // (a job either has ALL four fields or no key at all).
          const resolvedSalary =
            entry.salary ??
            (liveSalaryByJob.has(jobId)
              ? Number(liveSalaryByJob.get(jobId))
              : undefined);
          if (resolvedSalary === undefined) continue;
          next[jobIdStr] = {
            salary: resolvedSalary,
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

/**
 * One-time, idempotent backfill for migration 0036_category_links_backfill:
 * copies budget_items.api_category_id (and the matching savings_goals
 * columns) into the new budget_item_category_links / savings_goal_
 * category_links tables (see 0035), which — unlike the old single-slot
 * columns — can hold a separate link per connected service.
 *
 * We cannot know which service an existing undisambiguated id actually
 * belongs to, so every row this writes is a best-effort guess keyed to the
 * household's CURRENT app_settings.active_budget_api value. Logs the exact
 * count of guessed rows per table so whoever runs this in prod knows how
 * many links to go verify by hand for any household with more than one
 * connected service.
 */
async function backfillCategoryLinks(pool: import("pg").Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: settingRows } = await client.query<{ value: unknown }>(
      `SELECT value FROM app_settings WHERE key = 'active_budget_api'`,
    );
    const activeService = settingRows[0]?.value;
    if (activeService !== "ynab" && activeService !== "actual") {
      log("info", "category_links_backfill_skipped", {
        reason:
          "no active_budget_api set (or unrecognized value) — nothing to guess",
        activeService: activeService ?? null,
      });
      return;
    }

    await client.query("BEGIN");
    try {
      const { rowCount: budgetItemLinks } = await client.query(
        `INSERT INTO budget_item_category_links
           (budget_item_id, service, category_id, category_name, last_synced_at, sync_direction)
         SELECT id, $1, api_category_id, api_category_name, api_last_synced_at, api_sync_direction
         FROM budget_items
         WHERE api_category_id IS NOT NULL
         ON CONFLICT (budget_item_id, service) DO NOTHING`,
        [activeService],
      );

      const { rowCount: savingsPrimaryLinks } = await client.query(
        `INSERT INTO savings_goal_category_links
           (savings_goal_id, service, role, category_id, category_name)
         SELECT id, $1, 'primary', api_category_id, api_category_name
         FROM savings_goals
         WHERE api_category_id IS NOT NULL
         ON CONFLICT (savings_goal_id, service, role) DO NOTHING`,
        [activeService],
      );

      const { rowCount: savingsReimbursementLinks } = await client.query(
        `INSERT INTO savings_goal_category_links
           (savings_goal_id, service, role, category_id, category_name)
         SELECT id, $1, 'reimbursement', reimbursement_api_category_id, NULL
         FROM savings_goals
         WHERE reimbursement_api_category_id IS NOT NULL
         ON CONFLICT (savings_goal_id, service, role) DO NOTHING`,
        [activeService],
      );

      await client.query("COMMIT");
      log("info", "category_links_backfill_complete", {
        guessedService: activeService,
        budgetItemLinksBackfilled: budgetItemLinks ?? 0,
        savingsGoalPrimaryLinksBackfilled: savingsPrimaryLinks ?? 0,
        savingsGoalReimbursementLinksBackfilled: savingsReimbursementLinks ?? 0,
        note: "every row above is a guess keyed to the current active_budget_api — verify by hand for any household with more than one connected service",
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
          // 0016 permanently DROP TABLEs salary_changes/job_bonus_overrides
          // (CASCADE) and the backfill above it in-place rewrites every
          // salary_profiles row — unlike the squash-recovery path (which
          // already took this same backup at squash-detection time), this
          // normal idempotent-apply path has no backup yet. Take one now,
          // reusing the exact same JSON-snapshot logic handleSquashUpgrade
          // uses, so a normal deploy gets the same safety net before this
          // one genuinely destructive migration.
          await writePreMigrationBackupPg(
            preClient,
            "pre_0016_drop_salary_ledger_tables",
          );
          await backfillHistoricalSalaries(pool);
        }
        if (entry.tag === "0036_category_links_backfill") {
          await backfillCategoryLinks(pool);
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
 * VERSION_TABLE_NAMES snapshot, same JSON shape, same call sites (squash
 * detection, and the normal pre-apply loop's pre-0016 backup).
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

  try {
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
  } catch (backupErr) {
    log("warn", "pre_migration_backup_write_failed", {
      error: backupErr instanceof Error ? backupErr.message : String(backupErr),
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

    // See the matching comment in runPostgres's idempotent pre-apply loop
    // — must run after the schema is caught up through 0015 but before
    // 0016 drops the source tables, wherever that lands in this replay.
    if (entry.tag === "0016_drop_salary_ledger_tables") {
      backfillHistoricalSalariesSQLite(sqlite);
    }
    if (entry.tag === "0036_category_links_backfill") {
      backfillCategoryLinksSQLite(sqlite);
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

/**
 * SQLite twin of backfillHistoricalSalaries (see its docblock above) — same
 * gate (skip if `salary_changes` doesn't exist), same logic, same
 * call-it-immediately-before-0016-within-the-loop timing requirement.
 */
export function backfillHistoricalSalariesSQLite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
): void {
  const tableCheck = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='salary_changes'",
    )
    .get();
  if (!tableCheck) return;

  // See the matching guard + comment in backfillHistoricalSalaries (pg) —
  // same squash-replay hazard applies to the SQLite path.
  const alreadyModern = sqlite
    .prepare(
      `SELECT 1 FROM salary_profiles sp, json_each(sp.salaries) e
       WHERE json_type(e.value, '$.w4FilingStatus') IS NOT NULL
       LIMIT 1`,
    )
    .get();
  if (alreadyModern) {
    log("info", "historical_salaries_backfill_skipped", {
      reason:
        "salary_profiles already has full-shape (post-0022) entries — this DB is already current, not a genuine pre-0016 upgrade",
    });
    return;
  }

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
      end_year: number | null;
      is_speculative: number;
    };
    const jobs = sqlite
      .prepare(
        `SELECT id, person_id, end_date, is_speculative,
                CAST(strftime('%Y', end_date) AS INTEGER) AS end_year
         FROM jobs`,
      )
      .all() as JobRow[];
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    // Year comes from SQL (strftime), matching the pg twin — see its
    // comment for why re-deriving the year from a parsed JS Date is
    // timezone-dependent and must not be done here either, even though
    // SQLite's driver doesn't itself shift the string.
    type ChangeRow = {
      job_id: number;
      effective_date: string;
      new_salary: string;
      year: number;
    };
    const pastChanges = sqlite
      .prepare(
        "SELECT job_id, effective_date, new_salary, CAST(strftime('%Y', effective_date) AS INTEGER) AS year FROM salary_changes WHERE CAST(strftime('%Y', effective_date) AS INTEGER) < ? ORDER BY effective_date, job_id",
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

    // Per job, per year: the LAST (chronologically) change that landed in
    // that year.
    const changesByJob = new Map<
      number,
      Map<number, { salary: string; effectiveDate: string }>
    >();
    for (const c of pastChanges) {
      if (!changesByJob.has(c.job_id)) changesByJob.set(c.job_id, new Map());
      changesByJob
        .get(c.job_id)!
        .set(c.year, { salary: c.new_salary, effectiveDate: c.effective_date });
    }

    // Resolve one winning (job, salary) per person per year — carry a
    // job's salary forward through no-raise years, and when two jobs of
    // the same person cover the same year (e.g. a same-year job change),
    // keep the chronologically LATEST source, never "highest job_id".
    const personYear = new Map<
      number,
      Map<number, { jobId: number; salary: string; effectiveDate: string }>
    >();
    for (const [jobId, yearMap] of changesByJob) {
      const job = jobById.get(jobId);
      if (!job || job.is_speculative) continue;
      const years = [...yearMap.keys()].sort((a, b) => a - b);
      if (years.length === 0) continue;
      const firstYear = years[0]!;
      const upperYear = Math.min(
        job.end_year ?? currentYear - 1,
        currentYear - 1,
      );
      if (upperYear < firstYear) continue;

      if (!personYear.has(job.person_id))
        personYear.set(job.person_id, new Map());
      const yearsForPerson = personYear.get(job.person_id)!;

      let carry = yearMap.get(firstYear)!;
      for (let year = firstYear; year <= upperYear; year++) {
        if (yearMap.has(year)) carry = yearMap.get(year)!;
        const existing = yearsForPerson.get(year);
        if (!existing || carry.effectiveDate > existing.effectiveDate) {
          yearsForPerson.set(year, {
            jobId,
            salary: carry.salary,
            effectiveDate: carry.effectiveDate,
          });
        }
      }
    }

    const upsertHist = sqlite.prepare(`
      INSERT INTO historical_salaries (person_id, year, salary, bonus)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (person_id, year) DO UPDATE SET salary = excluded.salary, bonus = excluded.bonus
    `);
    let backfilled = 0;
    for (const [personId, yearsMap] of personYear) {
      for (const [year, info] of yearsMap) {
        const bonus = overrideMap.get(`${info.jobId}:${year}`) ?? "0.00";
        upsertHist.run(personId, year, info.salary, bonus);
        backfilled++;
      }
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
        // See the matching comment in backfillHistoricalSalaries (pg) —
        // omit rather than fabricate `salary: 0` when neither the pin nor
        // a live salary_changes row has a real number.
        const resolvedSalary =
          entry.salary ??
          (liveSalaryByJob.has(jobId)
            ? Number(liveSalaryByJob.get(jobId))
            : undefined);
        if (resolvedSalary === undefined) continue;
        next[jobIdStr] = {
          salary: resolvedSalary,
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

/**
 * SQLite twin of backfillCategoryLinks (see its docblock above) — same
 * one-time, idempotent, best-effort-guessed backfill of budget_item_
 * category_links / savings_goal_category_links keyed to the household's
 * current active_budget_api, with the same per-table counts logged.
 */
function backfillCategoryLinksSQLite(
  sqlite: InstanceType<typeof import("better-sqlite3")>,
): void {
  const settingRow = sqlite
    .prepare("SELECT value FROM app_settings WHERE key = 'active_budget_api'")
    .get() as { value: string } | undefined;
  let activeService: string | null = null;
  if (settingRow) {
    try {
      const parsed = JSON.parse(settingRow.value);
      if (parsed === "ynab" || parsed === "actual") activeService = parsed;
    } catch {
      // malformed value — treat as unset
    }
  }
  if (activeService === null) {
    log("info", "category_links_backfill_skipped", {
      dialect: "sqlite",
      reason:
        "no active_budget_api set (or unrecognized value) — nothing to guess",
    });
    return;
  }

  const tx = sqlite.transaction(() => {
    const budgetItemLinks = sqlite
      .prepare(
        `INSERT OR IGNORE INTO budget_item_category_links
           (budget_item_id, service, category_id, category_name, last_synced_at, sync_direction)
         SELECT id, ?, api_category_id, api_category_name, api_last_synced_at, api_sync_direction
         FROM budget_items
         WHERE api_category_id IS NOT NULL`,
      )
      .run(activeService).changes;

    const savingsPrimaryLinks = sqlite
      .prepare(
        `INSERT OR IGNORE INTO savings_goal_category_links
           (savings_goal_id, service, role, category_id, category_name)
         SELECT id, ?, 'primary', api_category_id, api_category_name
         FROM savings_goals
         WHERE api_category_id IS NOT NULL`,
      )
      .run(activeService).changes;

    const savingsReimbursementLinks = sqlite
      .prepare(
        `INSERT OR IGNORE INTO savings_goal_category_links
           (savings_goal_id, service, role, category_id, category_name)
         SELECT id, ?, 'reimbursement', reimbursement_api_category_id, NULL
         FROM savings_goals
         WHERE reimbursement_api_category_id IS NOT NULL`,
      )
      .run(activeService).changes;

    log("info", "category_links_backfill_complete", {
      dialect: "sqlite",
      guessedService: activeService,
      budgetItemLinksBackfilled: budgetItemLinks,
      savingsGoalPrimaryLinksBackfilled: savingsPrimaryLinks,
      savingsGoalReimbursementLinksBackfilled: savingsReimbursementLinks,
      note: "every row above is a guess keyed to the current active_budget_api — verify by hand for any household with more than one connected service",
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
        // Same reasoning as the Postgres normal pre-apply loop: this path
        // (unlike squash recovery, which already backed up at squash
        // detection) has no backup yet before 0016's destructive DROP
        // TABLEs. Take one now with the same snapshot logic.
        writePreMigrationBackupSQLite(
          sqlite,
          "pre_0016_drop_salary_ledger_tables",
        );
        backfillHistoricalSalariesSQLite(sqlite);
      }
      if (entry.tag === "0036_category_links_backfill") {
        backfillCategoryLinksSQLite(sqlite);
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

// Guard the top-level side effect so this file can be imported for its
// exported functions (e.g. backfillHistoricalSalariesSQLite, from
// tests/db/historical-salaries-backfill-migration.test.ts) without actually
// running a migration. Vitest sets VITEST=true for every test process; the
// real deploy entry point (`tsx db-migrate.ts`) never sets it, so this is a
// no-op for the actual migration pipeline.
if (!process.env.VITEST) {
  run();
}
