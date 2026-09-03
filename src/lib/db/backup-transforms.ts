/**
 * Cross-version backup transformers.
 *
 * When a backup file was exported from an older schema version, the
 * transformer reshapes the JSON data so it matches the current schema.
 * Transformers are pure functions — no DB, no side effects.
 *
 * To add support for a new old version: add its tag to KNOWN_SCHEMA_VERSIONS
 * and, if needed, write a new transformer or extend the existing one.
 */

import { log } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Known schema versions
// ---------------------------------------------------------------------------

/**
 * Every v0.7-line journal tag, in both dialects.
 *
 * Declared ONCE and consumed by both `KNOWN_SCHEMA_VERSIONS` (which decides
 * whether a backup is importable at all) and `schemaEra()` (which decides
 * which transform runs). Those two lists were previously maintained by hand
 * and drifted: tags `0002`–`0031` shipped without being added to either, so
 * `transformBackupToCurrentSchema` threw `Unknown schema version` for any
 * backup taken between v0.7.0 and v0.7.10 — restore was simply broken across
 * most of the v0.7 line. Sharing one list means adding a
 * migration can't silently break restore again.
 *
 * Tags 0007–0024 are hand-named and identical in both journals, so they
 * appear once. 0002–0006 and 0025–0031 are drizzle-generated and differ per
 * dialect, so both spellings are listed.
 */
const V07_SCHEMA_TAGS = [
  "0000_v7_initial_schema", // PG + SQLite (identical tag in both journals)
  // --- PG + SQLite diverge (drizzle-generated names) ---
  "0001_parched_karma", // PG
  "0001_fresh_masque", // SQLite
  "0002_oval_thunderbolt", // PG
  "0002_public_marvel_apes", // SQLite
  "0003_graceful_satana", // PG
  "0003_loose_wonder_man", // SQLite
  "0004_clumsy_cargill", // PG
  "0004_wooden_starfox", // SQLite
  "0005_slim_daimon_hellstrom", // PG
  "0005_free_patch", // SQLite
  "0006_thin_molecule_man", // PG
  "0006_silent_gorgon", // SQLite
  // --- hand-named, identical in both journals ---
  "0007_salary_profiles",
  "0008_kill_live_sentinel",
  "0009_salary_profile_bonus_terms",
  "0010_contribution_active_fields",
  "0011_contribution_accounts_no_base_value",
  "0012_salary_profile_job_keyed",
  "0013_speculative_jobs",
  "0014_salary_no_base_value",
  "0015_historical_salaries",
  "0016_drop_salary_ledger_tables",
  "0017_salary_entry_bonus_override",
  "0018_fk_index_cleanup",
  "0019_mortgage_refinanced_from_fk",
  "0020_employer_match_grouping_unq",
  "0021_retirement_filing_status_backfill",
  "0022_salary_profile_full_shape",
  "0023_extra_paycheck_routing_to_salary_profile",
  "0024_projection_cache",
  // --- diverge again ---
  "0025_nosy_korg", // PG
  "0025_empty_xorn", // SQLite
  "0026_illegal_raider", // PG
  "0026_wet_sumo", // SQLite
  "0027_tough_fenris", // PG
  "0027_previous_mojo", // SQLite
  "0028_classy_speedball", // PG
  "0028_daily_maximus", // SQLite
  "0029_magical_the_spike", // PG
  "0029_stale_richard_fisk", // SQLite
  "0030_acoustic_blue_shield", // PG
  "0030_hesitant_micromacro", // SQLite
  "0031_wide_winter_soldier", // PG
  "0031_mighty_energizer", // SQLite
  "0032_curved_silhouette", // PG: retirement profiles, step A (expand)
  "0032_demonic_firelord", // SQLite counterpart of 0032
  "0033_stormy_shiver_man", // PG: retirement_settings unique(person_id) -> unique(profile_id, person_id)
  "0033_far_hellfire_club", // SQLite counterpart of 0033
  "0034_nice_omega_red", // PG: retirement_settings.discretionary_withdrawal_order
  "0034_even_cassandra_nova", // SQLite counterpart of 0034
  "0035_harsh_gabe_jones", // PG: budget_item_category_links + savings_goal_category_links tables
  "0035_salty_warbird", // SQLite counterpart of 0035
  "0036_category_links_backfill", // PG + SQLite (identical tag) — backfill only, no schema shape change
  "0037_sad_thanos", // PG: budget_income_adjustments table (Budget-mode extra paycheck)
  "0037_majestic_caretaker", // SQLite counterpart of 0037
  "0038_pink_crusher_hogan", // PG: fpl_by_household + tax_params tables + retirement_profiles.tax_params_year
  "0038_broken_guardian", // SQLite counterpart of 0038
  "0039_rich_prodigy", // PG only: tax_params.version CHECK(version > 0) — no SQLite counterpart (check() constraints are PG-only by design, stripped from schema-sqlite.ts's generation; drizzle-kit generate against the SQLite schema produced "No schema changes, nothing to migrate")
] as const;

/** All schema version tags that we know how to import from. */
export const KNOWN_SCHEMA_VERSIONS = [
  // v0.1.x series — PostgreSQL journal tags
  "0000_initial_schema",
  "0001_drop_pg_enums",
  "0002_rename_retirement_category",
  "0003_add_rollovers_column",
  "0004_ambiguous_wraith",
  "0005_cold_random",
  "0006_goofy_rawhide_kid",
  "0007_melted_swordsman",
  "0008_prior_year_contrib",
  // v0.1.x series — SQLite journal tags (different numbering, no PG-specific migrations)
  "0001_rename_retirement_category", // SQLite 0001 = PG 0002
  "0002_add_rollovers_column", // SQLite 0002 = PG 0003
  "0003_reflective_stardust", // SQLite 0003 = PG 0004-0007 combined
  "0004_prior_year_contrib", // SQLite 0004 = PG 0008
  // v0.2.x series — squashed schema (single migration) + incremental
  "0000_v2_initial_schema",
  "0001_add_parent_goal_fk",
  "0002_add_parent_goal_id_index",
  "0003_flaky_betty_brant",
  "0004_tired_magik",
  "0005_bizarre_sprite",
  "0006_light_lady_deathstrike",
  // v0.2.x SQLite tags
  "0001_add_mc_user_presets",
  "0002_watery_dazzler",
  "0003_cynical_taskmaster",
  "0004_rapid_juggernaut",
  "0005_chemical_sage",
  // Synthetic tags used by pre-upgrade backup (db-migrate.ts schema probing)
  "v0.2_final",
  "v0.3_final",
  "v0.5_final",
  "v0.6_final",
  "v0.7_final",
  // v0.6.x series — squashed v6 baseline + incremental migrations
  "0000_v6_initial_schema",
  "0001_melodic_thaddeus_ross", // PG: account_holdings/pending_rollovers + extra_paycheck_routing reshape
  "0002_blue_moon_knight", // PG: utilities tracker tables
  "0003_chubby_katie_power", // PG
  "0004_dear_zemo", // PG
  "0005_lethal_rogue", // PG
  "0006_blue_gunslinger", // PG
  "0001_moaning_abomination", // SQLite counterpart of 0001
  "0002_nervous_major_mapleleaf", // SQLite counterpart of 0002
  "0003_common_crusher_hogan", // SQLite counterpart of 0003
  "0004_calm_dazzler", // SQLite counterpart of 0004
  "0005_zippy_warlock", // SQLite counterpart of 0005
  "0006_concerned_psylocke", // SQLite counterpart of 0006
  // v0.7.x series — squashed v7 baseline + every incremental migration,
  // from the single V07_SCHEMA_TAGS list above (shared with schemaEra()).
  ...V07_SCHEMA_TAGS,
  // v0.8.0 — pure migration squash, zero schema change vs the v0.7.11 tip.
  // A backup exported at any v0.8.x patch carries this single baseline tag;
  // it is already current-shape, so schemaEra() routes it through the same
  // (idempotent) v0.7 → current transform until the v0.8 line accrues its
  // own migrations and the next squash gives it a dedicated era.
  "0000_v8_initial_schema",
] as const;

export type KnownSchemaVersion = (typeof KNOWN_SCHEMA_VERSIONS)[number];

/**
 * Maps SQLite journal tags to their PG equivalents so the cumulative
 * transform logic (which uses PG tag positions) works for both dialects.
 */
const SQLITE_TO_PG_TAG: Record<string, string> = {
  "0001_rename_retirement_category": "0002_rename_retirement_category",
  "0002_add_rollovers_column": "0003_add_rollovers_column",
  "0003_reflective_stardust": "0007_melted_swordsman", // Combined PG 0004-0007
  "0004_prior_year_contrib": "0008_prior_year_contrib",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TableData = Record<string, unknown[]>;

/** Rename a key in every row of a table (if the table and old key exist). */
function renameColumn(
  tables: TableData,
  tableName: string,
  oldKey: string,
  newKey: string,
): void {
  const rows = tables[tableName];
  if (!rows) return;
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    if (oldKey in record) {
      record[newKey] = record[oldKey];
      delete record[oldKey];
    }
  }
}

/** Add a column with a default value to every row if it's missing. */
function addColumnDefault(
  tables: TableData,
  tableName: string,
  column: string,
  defaultValue: unknown,
): void {
  const rows = tables[tableName];
  if (!rows) return;
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    if (!(column in record)) {
      record[column] = defaultValue;
    }
  }
}

/** Rename a value in a specific column across all rows of a table. */
function renameValue(
  tables: TableData,
  tableName: string,
  column: string,
  oldValue: unknown,
  newValue: unknown,
): void {
  const rows = tables[tableName];
  if (!rows) return;
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    if (record[column] === oldValue) {
      record[column] = newValue;
    }
  }
}

// ---------------------------------------------------------------------------
// Schema version ordering (for "at least version X" checks)
// ---------------------------------------------------------------------------

/** PG tags in canonical order — used for cumulative "at least version X" checks. */
const PG_TAGS = KNOWN_SCHEMA_VERSIONS.slice(0, 9); // First 9 entries are v0.1.x PG
const VERSION_ORDER: Map<string, number> = new Map(
  PG_TAGS.map((tag, index) => [tag, index]),
);

/** Resolve a schema tag to its position in the PG ordering (SQLite tags normalized). */
function versionIndex(tag: string): number {
  const normalized = SQLITE_TO_PG_TAG[tag] ?? tag;
  return VERSION_ORDER.get(normalized) ?? -1;
}

// ---------------------------------------------------------------------------
// Schema era classification
// ---------------------------------------------------------------------------

/** Returns the broad era for a schema version tag. */
function schemaEra(
  tag: string,
): "v0.1" | "v0.2" | "v0.3" | "v0.5" | "v0.6" | "v0.7" {
  if (tag === "v0.6_final") return "v0.6";
  if (tag === "v0.5_final") return "v0.5";
  if (tag === "v0.3_final") return "v0.3";
  if (tag === "v0.2_final") return "v0.2";

  // v0.7_final (pre-upgrade backup tag) and the v0.8.0 squash baseline are
  // both already current-shape (the v0.8.0 squash changed no schema), so
  // they route through the same v0.7 → current transform, which is
  // idempotent for a backup that is already current.
  if (tag === "v0.7_final") return "v0.7";
  if (tag === "0000_v8_initial_schema") return "v0.7";

  // v0.7.x tags (squashed v7 baseline + every incremental migration).
  // Same single source as KNOWN_SCHEMA_VERSIONS — see V07_SCHEMA_TAGS.
  if ((V07_SCHEMA_TAGS as readonly string[]).includes(tag)) return "v0.7";

  // v0.6.x tags (squashed v6 baseline + incremental). Routed to a minimal
  // transform that only backfills tables added within the v0.6 line.
  const v06Tags = new Set([
    "0000_v6_initial_schema",
    "0001_melodic_thaddeus_ross", // PG
    "0002_blue_moon_knight", // PG
    "0003_chubby_katie_power", // PG
    "0004_dear_zemo", // PG
    "0005_lethal_rogue", // PG
    "0006_blue_gunslinger", // PG
    "0001_moaning_abomination", // SQLite
    "0002_nervous_major_mapleleaf", // SQLite
    "0003_common_crusher_hogan", // SQLite
    "0004_calm_dazzler", // SQLite
    "0005_zippy_warlock", // SQLite
    "0006_concerned_psylocke", // SQLite
  ]);
  if (v06Tags.has(tag)) return "v0.6";

  // v0.2.x PG tags
  const v02PgTags = new Set([
    "0000_v2_initial_schema",
    "0001_add_parent_goal_fk",
    "0002_add_parent_goal_id_index",
    "0003_flaky_betty_brant",
  ]);
  if (v02PgTags.has(tag)) return "v0.2";

  // v0.3.x PG tags (added retirement_behavior, contribution_scaling, cost_basis)
  const v03PgTags = new Set([
    "0004_tired_magik",
    "0005_bizarre_sprite",
    "0006_light_lady_deathstrike",
  ]);
  if (v03PgTags.has(tag)) return "v0.3";

  // v0.2.x SQLite tags
  const v02SqliteTags = new Set([
    "0001_add_mc_user_presets",
    "0002_watery_dazzler",
  ]);
  if (v02SqliteTags.has(tag)) return "v0.2";

  // v0.3.x SQLite tags
  const v03SqliteTags = new Set([
    "0003_cynical_taskmaster",
    "0004_rapid_juggernaut",
    "0005_chemical_sage",
  ]);
  if (v03SqliteTags.has(tag)) return "v0.3";

  // Everything else is v0.1.x
  return "v0.1";
}

// ---------------------------------------------------------------------------
// The v0.1.x → v0.2.0 transformer
// ---------------------------------------------------------------------------

/**
 * Transform a v0.1.x backup to match the v0.2.0 schema.
 *
 * Changes applied (cumulative, based on which version the backup came from):
 *
 * 1. 0002+ rename: "Retirement" → "401k/IRA" in annual_performance.category
 * 2. 0003+ add: `rollovers` column on account_performance and annual_performance
 * 3. 0005+ add: `contribution_profile_id` on retirement_salary_overrides
 * 4. 0006+ add: `created_by`/`updated_by` on retirement override tables
 * 5. 0007+ add: `filing_status` on retirement_settings
 * 6. 0008+ add: `prior_year_contrib_amount`/`prior_year_contrib_year` on contribution_accounts
 * 7. Always: rename `api_sync_enabled` → `is_api_sync_enabled` (savings_goals)
 * 8. Always: rename `lt_brokerage_enabled` → `is_lt_brokerage_enabled` (retirement_scenarios)
 */
function transformV01xToV020(
  tables: TableData,
  sourceVersion: string,
): TableData {
  const idx = versionIndex(sourceVersion);

  // --- Cumulative transforms (only apply if backup is older than the change) ---

  // 0002: Rename "Retirement" → "401k/IRA" in annual_performance
  if (idx < versionIndex("0002_rename_retirement_category")) {
    renameValue(
      tables,
      "annual_performance",
      "category",
      "Retirement",
      "401k/IRA",
    );
  }

  // 0003: Add rollovers column
  if (idx < versionIndex("0003_add_rollovers_column")) {
    addColumnDefault(tables, "account_performance", "rollovers", "0");
    addColumnDefault(tables, "annual_performance", "rollovers", "0");
  }

  // 0005: Add contribution_profile_id FK
  if (idx < versionIndex("0005_cold_random")) {
    addColumnDefault(
      tables,
      "retirement_salary_overrides",
      "contribution_profile_id",
      null,
    );
  }

  // 0006: Add audit columns to override tables
  if (idx < versionIndex("0006_goofy_rawhide_kid")) {
    addColumnDefault(tables, "retirement_budget_overrides", "created_by", null);
    addColumnDefault(tables, "retirement_budget_overrides", "updated_by", null);
    addColumnDefault(tables, "retirement_salary_overrides", "created_by", null);
    addColumnDefault(tables, "retirement_salary_overrides", "updated_by", null);
  }

  // 0007: Add filing_status to retirement_settings
  if (idx < versionIndex("0007_melted_swordsman")) {
    addColumnDefault(tables, "retirement_settings", "filing_status", null);
  }

  // 0008: Add prior-year contribution columns
  if (idx < versionIndex("0008_prior_year_contrib")) {
    addColumnDefault(
      tables,
      "contribution_accounts",
      "prior_year_contrib_amount",
      "0",
    );
    addColumnDefault(
      tables,
      "contribution_accounts",
      "prior_year_contrib_year",
      null,
    );
  }

  // --- Always apply: v0.2.0 boolean column renames ---
  renameColumn(
    tables,
    "savings_goals",
    "api_sync_enabled",
    "is_api_sync_enabled",
  );
  renameColumn(
    tables,
    "retirement_scenarios",
    "lt_brokerage_enabled",
    "is_lt_brokerage_enabled",
  );

  return tables;
}

// ---------------------------------------------------------------------------
// The v0.2.x / v0.3.x → v0.4.0 transformer
// ---------------------------------------------------------------------------

/**
 * Transform a v0.2.x or v0.3.x backup to match the v0.4.0 (current) schema.
 *
 * v0.3.x added these on top of v0.2.0:
 *  - `retirement_behavior` on performance_accounts (default "stops_at_owner_retirement")
 *  - `contribution_scaling` on performance_accounts (default "scales_with_salary")
 *  - `cost_basis` on performance_accounts (default "0")
 *  - `projection_overrides` table (new)
 *  - `mc_user_presets` table (new)
 *
 * A v0.2.x backup is missing all five. A v0.3.x backup may have some or all
 * depending on which patch it came from. We use addColumnDefault which is
 * idempotent (only adds if the column is missing).
 */
function transformV02xV03xToV040(tables: TableData): TableData {
  // performance_accounts columns added in v0.3.x
  addColumnDefault(
    tables,
    "performance_accounts",
    "retirement_behavior",
    "stops_at_owner_retirement",
  );
  addColumnDefault(
    tables,
    "performance_accounts",
    "contribution_scaling",
    "scales_with_salary",
  );
  addColumnDefault(tables, "performance_accounts", "cost_basis", "0");

  // New tables — ensure they exist as empty arrays if missing
  if (!tables["projection_overrides"]) {
    tables["projection_overrides"] = [];
  }
  if (!tables["mc_user_presets"]) {
    tables["mc_user_presets"] = [];
  }

  // v0.4.14+: portfolio_by_tax_location JSONB on net_worth_annual
  // Nullable — buildYearEndHistory falls back to legacy columns when null
  addColumnDefault(
    tables,
    "net_worth_annual",
    "portfolio_by_tax_location",
    null,
  );

  // v0.6.x: utilities tracker tables — absent from all older backups
  if (!tables["utility_service"]) {
    tables["utility_service"] = [];
  }
  if (!tables["utility_reading"]) {
    tables["utility_reading"] = [];
  }

  // v0.6.x: tables and columns added after v0.4 — absent from all older backups
  if (!tables["account_holdings"]) {
    tables["account_holdings"] = [];
  }
  if (!tables["pending_rollovers"]) {
    tables["pending_rollovers"] = [];
  }
  addColumnDefault(tables, "savings_allocation_overrides", "source", "manual");
  addColumnDefault(tables, "savings_planned_transactions", "source", "manual");

  return tables;
}

// ---------------------------------------------------------------------------
// The v0.5.x → v0.6.0 transformer
// ---------------------------------------------------------------------------

/**
 * Transform a v0.5.x backup to match the v0.6.0 schema.
 *
 * The data shape is unchanged between v0.5 and v0.6 — this squash release
 * only consolidates migrations and adds `pending_rollovers` to the versioned
 * backup set. v0.5 backups did not include `pending_rollovers` (it was
 * accidentally omitted from VERSION_TABLE_NAMES), so restoring a v0.5 backup
 * simply starts that table empty, which is safe.
 */
function transformV05xToV060(tables: TableData): TableData {
  if (!tables["pending_rollovers"]) {
    tables["pending_rollovers"] = [];
  }
  // v0.6.x: utilities tracker tables — absent from v0.5 backups
  if (!tables["utility_service"]) {
    tables["utility_service"] = [];
  }
  if (!tables["utility_reading"]) {
    tables["utility_reading"] = [];
  }
  return tables;
}

// ---------------------------------------------------------------------------
// The v0.6.x → current transformer
// ---------------------------------------------------------------------------

/**
 * Transform a v0.6.x backup to match the current schema.
 *
 * Backfills everything added across the v0.6 line so older v0.6 backups (down
 * to the v0.6.0 baseline) import cleanly:
 *  - v0.6.2 (0001_melodic_thaddeus_ross): `account_holdings` + `pending_rollovers`
 *    tables, `source` column on the two savings tables.
 *  - v0.6.5 (0002_blue_moon_knight): `utility_service` + `utility_reading` tables.
 *
 * All helpers are idempotent (only add what's missing), so this also handles
 * `v0.6_final` (a fully-current v0.6.8 backup tagged during the v0.7.0 squash)
 * as a pure pass-through — every table it needs is already present.
 */
function transformV06xToCurrent(tables: TableData): TableData {
  // Tables added in v0.6.2
  if (!tables["account_holdings"]) {
    tables["account_holdings"] = [];
  }
  if (!tables["pending_rollovers"]) {
    tables["pending_rollovers"] = [];
  }
  // Columns added in v0.6.2 (NOT NULL default 'manual')
  addColumnDefault(tables, "savings_allocation_overrides", "source", "manual");
  addColumnDefault(tables, "savings_planned_transactions", "source", "manual");

  // Utilities tracker tables (this change)
  if (!tables["utility_service"]) {
    tables["utility_service"] = [];
  }
  if (!tables["utility_reading"]) {
    tables["utility_reading"] = [];
  }
  // v0.7.1: settlement side table — a v0.6.x backup predates it entirely
  if (!tables["savings_planned_tx_settlements"]) {
    tables["savings_planned_tx_settlements"] = [];
  }
  return tables;
}

// ---------------------------------------------------------------------------
// The v0.7.x → current transformer
// ---------------------------------------------------------------------------

/**
 * Transform a v0.7.x backup to match the current schema.
 *
 * The v0.7.0 baseline (`0000_v7_initial_schema`) predates
 * `savings_planned_tx_settlements` (added in v0.7.1, `0001_parched_karma` /
 * `0001_fresh_masque`) — restoring one simply starts that table empty, which
 * is safe (it only ever holds settlement records, never a source of truth
 * for money already accounted for elsewhere).
 *
 * It also predates `0008_kill_live_sentinel`, which dropped
 * `contribution_profiles.is_default` and replaced
 * `salary_profiles.salary_overrides` (sparse personId → number) with
 * `salary_profiles.salaries` (personId → {mode:"job"} | {mode:"fixed",
 * salary}). Both are reshaped here with the SAME rule the migration uses, so
 * an old snapshot restores with identical semantics rather than being
 * rejected: a person who had a number was explicitly pinned (fixed),
 * everyone else follows their job.
 *
 * Every step is idempotent, so a backup already at the current shape is a
 * pure pass-through.
 */
function transformV07xToCurrent(tables: TableData): TableData {
  if (!tables["savings_planned_tx_settlements"]) {
    tables["savings_planned_tx_settlements"] = [];
  }

  // 0032: Retirement Profiles, step A (expand) + the backfill migration
  // 0032_curved_silhouette.sql itself performs in the same file (advisor-
  // caught 2026-09-01: this function used to stop at step A — empty
  // tables, null profile_id — leaving a restored pre-0032 backup in the
  // migration's INTERMEDIATE state instead of where a live upgrade
  // actually lands. Real households upgrading get a real "Current Plan"
  // profile via the migration's own backfill; restoring an old backup
  // AFTER upgrading truncated that profile back to nothing with no way to
  // recreate one in-app — retirementProfiles.duplicate is the only
  // creation path and needs an existing profile to clone FROM. Mirrors
  // the migration SQL's 5 steps exactly, in JS, against in-memory rows.)
  if (!tables["retirement_profiles"]) tables["retirement_profiles"] = [];
  if (!tables["retirement_profile_people"]) {
    tables["retirement_profile_people"] = [];
  }
  addColumnDefault(tables, "retirement_settings", "profile_id", null);
  for (const col of [
    "distribution_tax_rate_traditional",
    "distribution_tax_rate_roth",
    "distribution_tax_rate_hsa",
    "distribution_tax_rate_brokerage",
  ]) {
    addColumnDefault(tables, "retirement_settings", col, null);
  }

  {
    const settingsRows = (tables["retirement_settings"] ?? []) as Record<
      string,
      unknown
    >[];
    const profileRows = tables["retirement_profiles"] as Record<
      string,
      unknown
    >[];
    // Step 1+2: one "Current Plan" profile, only when settings exist and
    // no profile does yet (idempotent — a backup already at the current
    // shape, or one with no retirement data at all, is a pure pass-through).
    if (settingsRows.length > 0 && profileRows.length === 0) {
      const profileId = 1;
      profileRows.push({
        id: profileId,
        name: "Current Plan",
        description:
          "Your existing retirement assumptions, carried over when Retirement Profiles were introduced.",
        created_at: new Date().toISOString(),
      });
      for (const row of settingsRows) {
        if (row["profile_id"] == null) row["profile_id"] = profileId;
      }

      // Step 3: one retirement_profile_people row per person, completeness
      // invariant. "prim" = the settings row belonging to whichever person
      // has a settings row AND ranks highest by is_primary_user, then id —
      // matching getPrimaryPerson()'s own rule, not necessarily the actual
      // primary person if they have no settings row of their own.
      const peopleRows = (tables["people"] ?? []) as Record<string, unknown>[];
      const settingsByPerson = new Map(
        settingsRows.map((r) => [String(r["person_id"]), r]),
      );
      const orderedPeopleWithSettings = peopleRows
        .filter((p) => settingsByPerson.has(String(p["id"])))
        .sort((a, b) => {
          const aPrimary = a["is_primary_user"] ? 1 : 0;
          const bPrimary = b["is_primary_user"] ? 1 : 0;
          if (aPrimary !== bPrimary) return bPrimary - aPrimary;
          return Number(a["id"]) - Number(b["id"]);
        });
      const primaryRow =
        orderedPeopleWithSettings.length > 0
          ? settingsByPerson.get(String(orderedPeopleWithSettings[0]!["id"]))
          : undefined;

      const peopleRowsTable = tables["retirement_profile_people"] as Record<
        string,
        unknown
      >[];
      if (primaryRow && peopleRowsTable.length === 0) {
        let nextId = 1;
        for (const p of peopleRows) {
          const own = settingsByPerson.get(String(p["id"]));
          const src = own ?? primaryRow;
          peopleRowsTable.push({
            id: nextId++,
            profile_id: profileId,
            person_id: p["id"],
            retirement_age: src["retirement_age"],
            end_age: src["end_age"],
            social_security_monthly: src["social_security_monthly"] ?? null,
            ss_start_age: src["ss_start_age"] ?? null,
            rule_of_55_override: src["rule_of_55_override"] ?? null,
            salary_annual_increase: src["salary_annual_increase"] ?? null,
          });
        }
      }

      // Step 4: distribution tax rates, relocated off retirement_scenarios.
      const selectedScenario = (
        (tables["retirement_scenarios"] ?? []) as Record<string, unknown>[]
      )
        .filter((r) => r["is_selected"] === true)
        .sort((a, b) => Number(a["id"]) - Number(b["id"]))[0];
      if (selectedScenario) {
        for (const row of settingsRows) {
          if (row["distribution_tax_rate_traditional"] == null) {
            row["distribution_tax_rate_traditional"] =
              selectedScenario["distribution_tax_rate_traditional"] ?? null;
            row["distribution_tax_rate_roth"] =
              selectedScenario["distribution_tax_rate_roth"] ?? null;
            row["distribution_tax_rate_hsa"] =
              selectedScenario["distribution_tax_rate_hsa"] ?? null;
            row["distribution_tax_rate_brokerage"] =
              selectedScenario["distribution_tax_rate_brokerage"] ?? null;
          }
        }
      }

      // Step 5: the global active-profile pointer — without it,
      // useEffectiveProfileId has nothing to resolve to for a household
      // with no active Plan, and build-engine-payload returns null
      // (blank Retirement page) even though a real profile now exists.
      const appSettingsRows = (tables["app_settings"] ?? []) as Record<
        string,
        unknown
      >[];
      if (
        !appSettingsRows.some(
          (r) => r["key"] === "active_retirement_profile_id",
        )
      ) {
        appSettingsRows.push({
          key: "active_retirement_profile_id",
          value: profileId,
        });
      }
      tables["app_settings"] = appSettingsRows;
    }
  }

  // null, never a real id — see the scenarios.retirement_profile_id docblock.
  // Backfilling this would turn "this Plan sets nothing for retirement" into
  // "this Plan sets profile 1" for every Plan that ever existed.
  addColumnDefault(tables, "scenarios", "retirement_profile_id", null);

  // 0008: contribution_profiles.is_default no longer exists — the row it
  // flagged survives as an ordinary profile, so the flag is simply dropped.
  for (const row of tables["contribution_profiles"] ?? []) {
    delete (row as Record<string, unknown>).is_default;
  }

  // 0008: salary_profiles.salary_overrides → salaries, sparse → complete.
  const personIds = (tables["people"] ?? [])
    .map((p) => (p as Record<string, unknown>).id)
    .filter((id): id is number | string => id != null)
    .map(String);
  for (const raw of tables["salary_profiles"] ?? []) {
    const row = raw as Record<string, unknown>;
    if (!("salary_overrides" in row)) continue;
    const old = (row.salary_overrides ?? {}) as Record<string, unknown>;
    delete row.salary_overrides;
    const salaries: Record<string, unknown> = {};
    for (const personId of personIds) {
      const pinned = old[personId];
      salaries[personId] =
        typeof pinned === "number"
          ? { mode: "fixed", salary: pinned }
          : { mode: "job" };
    }
    row.salaries = salaries;
  }

  // 0038: fpl_by_household + tax_params tables, and
  // retirement_profiles.tax_params_year. A pre-0038 backup has none of
  // these. The two new tables restore empty — the tax-params resolver
  // falls back to the value tables' own MAX(tax_year) when tax_params is
  // empty, i.e. exactly the earlier behaviour. The new column is nullable
  // (NULL = track latest), so every restored profile keeps its numbers.
  if (!tables["fpl_by_household"]) tables["fpl_by_household"] = [];
  if (!tables["tax_params"]) tables["tax_params"] = [];
  addColumnDefault(tables, "retirement_profiles", "tax_params_year", null);

  return tables;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type TransformResult = {
  tables: TableData;
  transformed: boolean;
  sourceVersion: string;
};

/**
 * Transform a backup's table data to match the current schema version.
 *
 * - If the backup matches the current version, returns as-is.
 * - If the backup is from a known older version, transforms and returns.
 * - If the backup is from an unknown version, throws an error.
 */
export function transformBackupToCurrentSchema(
  tables: TableData,
  schemaVersion: string,
  currentVersion: string,
): TransformResult {
  // Already current — no transform needed
  if (schemaVersion === currentVersion) {
    return { tables, transformed: false, sourceVersion: schemaVersion };
  }

  // Check if it's a known version we can transform from
  if (!KNOWN_SCHEMA_VERSIONS.includes(schemaVersion as KnownSchemaVersion)) {
    throw new Error(
      `Unknown schema version: "${schemaVersion}". ` +
        `This backup may be from a newer version of Ledgr. ` +
        `Current schema: "${currentVersion}". ` +
        `Known importable versions: ${KNOWN_SCHEMA_VERSIONS.join(", ")}`,
    );
  }

  log("info", "backup_transform_start", {
    from: schemaVersion,
    to: currentVersion,
  });

  // Deep-clone tables so we don't mutate the original
  const cloned: TableData = {};
  for (const [key, rows] of Object.entries(tables)) {
    cloned[key] = rows.map((row) => ({ ...(row as Record<string, unknown>) }));
  }

  const era = schemaEra(schemaVersion);

  if (era === "v0.7") {
    // v0.7.x → current: backfill tables added within the v0.7 line
    transformV07xToCurrent(cloned);
  } else if (era === "v0.6") {
    // v0.6.x → current: backfill v0.6-line tables/columns + utilities tables
    transformV06xToCurrent(cloned);
  } else if (era === "v0.5") {
    // v0.5.x → v0.6.0: no column renames, only pending_rollovers table added
    transformV05xToV060(cloned);
  } else {
    // v0.1.x → apply v0.1 → v0.2 transforms first, then v0.2/v0.3 → v0.4
    if (era === "v0.1") {
      transformV01xToV020(cloned, schemaVersion);
    }

    // v0.1.x and v0.2.x both need the v0.2/v0.3 → v0.4 transforms
    // v0.3.x also needs it (idempotent — fills in any missing columns)
    transformV02xV03xToV040(cloned);
  }

  log("info", "backup_transform_complete", {
    from: schemaVersion,
    to: currentVersion,
    tableCount: Object.keys(cloned).length,
  });

  return {
    tables: cloned,
    transformed: true,
    sourceVersion: schemaVersion,
  };
}
