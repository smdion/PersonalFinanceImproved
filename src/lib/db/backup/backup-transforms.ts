/**
 * Cross-version backup transformers: pure functions reshaping an older backup's JSON to the
 * current schema. Supporting another old version means adding its tag to
 * KNOWN_SCHEMA_VERSIONS and, if its shape differs, a transform.
 */

import { log } from "@/lib/logger";
import { convertV0810ProfileSets } from "../migrate/v0810-profile-sets";
import { renameDisplayNameActive } from "../migrate/v0102-display-name-custom";
import { dropDeadHoldingLinkAndSettings } from "../migrate/v0102-dead-data";
import { convertRestoredBackup } from "./restore-conversions";
import pgJournal from "../../../../drizzle/meta/_journal.json";
import { writeStamp } from "@/lib/utils/clock";

/** The tags since the v0.9.0 squash, in journal order (both dialects share them). */
const CURRENT_LINE_TAGS = pgJournal.entries.map((e) => e.tag);

// ---------------------------------------------------------------------------
// Known schema versions
// ---------------------------------------------------------------------------

/**
 * Every v0.8-line journal tag in both dialects, shared by `KNOWN_SCHEMA_VERSIONS` and
 * `schemaEra()`. Additive entries need nothing (the v0.7 → current transform covers them); one
 * that drops a column needs a strip in transformV07xToCurrent, or validateColumns fails.
 */
const V08_SCHEMA_TAGS = [
  "0001_nappy_blade", // PG: retirement_settings.withdrawal_routing_mode
  "0001_cool_frank_castle", // SQLite counterpart of 0001
  "0002_talented_monster_badoon", // PG: retirement_settings.withdrawal_order + withdrawal_splits
  "0002_complete_jackpot", // SQLite counterpart of 0002
  "0003_past_rhodey", // PG: retirement_profile_people.social_security_pia
  "0003_shallow_patch", // SQLite counterpart of 0003
  // 0004–0011 are pre-release v0.8.5 builds' tags (squashed into 0004_v085_investments);
  // only those builds' backups carry them.
  "0004_simple_rogue", // PG: v0.8.5 investments foundation (securities, holding_observations, investment_transactions, investment_transaction_rules, simplefin_account_balances, sync_request_log)
  "0004_glorious_tigra", // SQLite counterpart of 0004
  "0005_light_prima", // PG: simplefin_accounts.last_balance_date
  "0005_neat_namorita", // SQLite counterpart of 0005
  "0006_empty_zarda", // PG: v0.8.5 SEC fund facts (security_facts, sec_filing_cache, securities SEC identity, asset_class_params.composition_bucket)
  "0006_opposite_onslaught", // SQLite counterpart of 0006
  "0007_bizarre_zarek", // PG: simplefin_accounts.linked_sub_key (link to a sub-account)
  "0007_closed_bastion", // SQLite counterpart of 0007
  "0008_worthless_talisman", // PG: investment_transactions.source_split
  "0008_absent_tenebrous", // SQLite counterpart of 0008
  "0009_icy_black_cat", // PG: drop investment_transactions.source_split (per-deposit split removed before release)
  "0009_vengeful_mister_sinister", // SQLite counterpart of 0009
  "0010_red_ink", // PG: securities.standin_preview (a suggested stand-in's SEC facts, for judging it)
  "0010_mysterious_black_panther", // SQLite counterpart of 0010
  "0011_lumpy_maximus", // PG: asset_class_buckets (several buckets per asset class), copied from asset_class_params.composition_bucket
  "0011_peaceful_rictor", // SQLite counterpart of 0011
  "0004_v085_investments", // PG + SQLite: v0.8.5 as released — investments, SEC fund facts, asset_class_buckets
  "0005_v086_schema_cleanup", // PG + SQLite: savings_goals parent key (PG) + index, old roth_basis names, filing_status type — no data shape change
  "0006_v088_holding_periods", // PG + SQLite: holding_periods + holding_period_weights (new tables — older backups restore them empty)
  "0008_v088_paycheck_earnings", // PG + SQLite: paycheck_earnings (other pay / taxable benefits; amounts in salary-profile entries' optional otherEarnings — older backups restore the table empty)
  "0007_v088_drop_account_holdings", // PG + SQLite: drop legacy account_holdings (replaced by holding_periods) — not in VERSION_TABLES, so an older backup's rows are skipped on restore
  "0009_v0810_profile_sets", // PG + SQLite: Plan salaries → Salary Profiles, bonus destinations → entries, bonus switches → per-account fromBonus, unique Plan names; scenarios.overrides/is_baseline and budget column profile ids dropped (transformV0810ProfileSets)
  "0010_v0810_holding_period_parts", // PG + SQLite: holding_periods.sub_key (the part of an account whose feeds are linked per part; null = whole account) — nullable, older backups restore as whole-account periods
  "0011_v0811_rmd_excess_target", // PG + SQLite: retirement_settings.rmd_excess_target_performance_account_id (nullable FK, SET NULL) — older backups restore as "spread across Retirement brokerages"
  "0012_v0814_perf_annotations", // PG + SQLite: account_performance.note (nullable), estimated_fields ([]), accepted_checks ({}) — older backups restore with no notes, estimates or accepted gaps
  // The v0.9 line continues this one ordered list (indexOf checks compare positions). 0013–0016
  // are v0.9.0's four migrations as dev builds numbered them; only dev backups carry them.
  "0013_v090_tax_data_origin",
  "0014_v090_tax_data_updates",
  "0015_v090_utility_feed",
  "0016_v090_debts",
  // The current line, from the journal: a new migration needs no edit here.
  ...CURRENT_LINE_TAGS,
] as const;

/** First tags whose backups carry asset_class_buckets (PG, SQLite). */
const ASSET_CLASS_BUCKETS_TAGS = [
  "0011_lumpy_maximus",
  "0011_peaceful_rictor",
] as const;

/**
 * Tables a restore rebuilds from other tables when the backup predates
 * them — so a backup without one doesn't lose its data (see
 * tablesLostOnRestore). Value: the table it's rebuilt from.
 */
export const REBUILT_ON_RESTORE: Readonly<Record<string, string>> = {
  asset_class_buckets: "asset_class_params",
};

/**
 * Whether a backup at `schemaVersion` was taken before asset_class_buckets
 * existed. Decided by the version, not by the table being empty: a newer
 * backup with nothing linked must stay unlinked.
 */
function predatesAssetClassBuckets(schemaVersion: string): boolean {
  const v08 = V08_SCHEMA_TAGS as readonly string[];
  const at = v08.indexOf(schemaVersion);
  if (at === -1) return true; // every older era
  return ASSET_CLASS_BUCKETS_TAGS.every((t) => at < v08.indexOf(t));
}

/**
 * Pre-0011 backups: each asset class's single composition_bucket becomes
 * its asset_class_buckets row (the squashed v0.8.5 migration drops the
 * column from a live database that still has it).
 */
function rebuildAssetClassBuckets(
  tables: TableData,
  schemaVersion: string,
): void {
  if (!predatesAssetClassBuckets(schemaVersion)) return;
  const rows: Record<string, unknown>[] = [];
  for (const c of (tables["asset_class_params"] ?? []) as Record<
    string,
    unknown
  >[]) {
    const bucket = c["composition_bucket"];
    if (typeof bucket === "string" && bucket !== "")
      rows.push({ bucket, asset_class_id: c["id"] });
  }
  // Nothing to link: leave the table out, as a backup with it empty would.
  if (rows.length > 0) tables["asset_class_buckets"] = rows;
}

/**
 * Drops fields only pre-release v0.8.5 builds had, as the squashed migration does: a hand-set
 * transaction kind reverts to the rules; the split, override source and bucket link go. Runs
 * after rebuildAssetClassBuckets, which reads composition_bucket.
 */
function dropPreReleaseV085Fields(tables: TableData): void {
  for (const row of (tables["investment_transactions"] ?? []) as Record<
    string,
    unknown
  >[]) {
    if (row["kind_override_source"] === "user") row["kind_override"] = null;
    delete row["kind_override_source"];
    delete row["source_split"];
  }
  for (const row of (tables["asset_class_params"] ?? []) as Record<
    string,
    unknown
  >[])
    delete row["composition_bucket"];
}

/**
 * A backup from before 0006: Constant Percentage, Endowment, Vanguard Dynamic and RMD Spending
 * keep Social Security inside the strategy's amount, as 0006 sets live. A backup with the
 * columns keeps its values (null included); VPW's stays null.
 */
function transformV095SsInAmount(tables: TableData): void {
  for (const column of [
    "cp_ss_in_amount",
    "en_ss_in_amount",
    "vd_ss_in_amount",
    "rmd_ss_in_amount",
  ])
    addColumnDefault(tables, "retirement_settings", column, true);
}

/**
 * A backup from before v0.8.10: convertV0810ProfileSets (as migration 0009 runs live), then the
 * columns 0009 drops are removed. A backup already in the new shape passes through unchanged.
 */
function transformV0810ProfileSets(tables: TableData): void {
  const rows = tables as Record<string, Record<string, unknown>[]>;
  const r = convertV0810ProfileSets(rows);
  if (r.newSalaryProfiles.length > 0)
    rows["salary_profiles"] = [
      ...(rows["salary_profiles"] ?? []),
      ...r.newSalaryProfiles,
    ];
  if (rows["app_settings"])
    rows["app_settings"] = rows["app_settings"].filter(
      (s) => !r.deletedSettings.includes(String(s["key"])),
    );
  for (const plan of rows["scenarios"] ?? []) {
    delete plan["overrides"];
    delete plan["is_baseline"];
  }
  for (const profile of rows["budget_profiles"] ?? []) {
    delete profile["column_contribution_profile_ids"];
    delete profile["column_salary_profile_ids"];
  }
  for (const note of r.notes) log("info", "backup_v0810_conversion", { note });
}

/**
 * Every v0.7-line journal tag, shared by `KNOWN_SCHEMA_VERSIONS` (importable?) and `schemaEra()`
 * (which transform). 0007–0024 are identical in both journals; 0002–0006 and 0025–0031 are
 * drizzle-generated per dialect, so both spellings are listed.
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
  // v0.8.0 squash baseline: no schema change from the v0.7.11 tip, so schemaEra() routes it
  // through the same idempotent v0.7 → current transform.
  "0000_v8_initial_schema",
  // v0.8.x incremental migrations, post-squash — same single-list rule as
  // V07_SCHEMA_TAGS above (shared with schemaEra()).
  ...V08_SCHEMA_TAGS,
] as const;

type KnownSchemaVersion = (typeof KNOWN_SCHEMA_VERSIONS)[number];

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

/** v0.1.x PG tags in order, for "at least version X" checks; listed explicitly so appending
 *  to KNOWN_SCHEMA_VERSIONS never shifts them. */
const PG_TAGS = [
  "0000_initial_schema",
  "0001_drop_pg_enums",
  "0002_rename_retirement_category",
  "0003_add_rollovers_column",
  "0004_ambiguous_wraith",
  "0005_cold_random",
  "0006_goofy_rawhide_kid",
  "0007_melted_swordsman",
  "0008_prior_year_contrib",
] as const;
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

/** The broad era of a schema version tag. Exported for backup-transforms.test.ts, which checks
 *  no journal tag falls to the "v0.1" default (that would run the whole rename ladder). */
export function schemaEra(
  tag: string,
): "v0.1" | "v0.2" | "v0.3" | "v0.5" | "v0.6" | "v0.7" {
  if (tag === "v0.6_final") return "v0.6";
  if (tag === "v0.5_final") return "v0.5";
  if (tag === "v0.3_final") return "v0.3";
  if (tag === "v0.2_final") return "v0.2";

  // v0.7_final and the v0.8.0 squash baseline are already current-shape, so they take the
  // idempotent v0.7 → current transform.
  if (tag === "v0.7_final") return "v0.7";
  if (tag === "0000_v8_initial_schema") return "v0.7";
  // v0.8.x incremental tags are additive, so already current-shape: same route as the v8
  // baseline, from the list KNOWN_SCHEMA_VERSIONS also uses.
  if ((V08_SCHEMA_TAGS as readonly string[]).includes(tag)) return "v0.7";

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
 * v0.1.x → v0.2.0, cumulative by source tag: 0002+ renames "Retirement" → "401k/IRA", 0003–0008
 * add their columns where missing, and api_sync_enabled / lt_brokerage_enabled get `is_` names.
 */
function transformV01xToV020(
  tables: TableData,
  sourceVersion: string,
): TableData {
  const index = versionIndex(sourceVersion);

  // --- Cumulative transforms (only apply if backup is older than the change) ---

  // 0002: Rename "Retirement" → "401k/IRA" in annual_performance
  if (index < versionIndex("0002_rename_retirement_category")) {
    renameValue(
      tables,
      "annual_performance",
      "category",
      "Retirement",
      "401k/IRA",
    );
  }

  // 0003: Add rollovers column
  if (index < versionIndex("0003_add_rollovers_column")) {
    addColumnDefault(tables, "account_performance", "rollovers", "0");
    addColumnDefault(tables, "annual_performance", "rollovers", "0");
  }

  // 0005: Add contribution_profile_id FK
  if (index < versionIndex("0005_cold_random")) {
    addColumnDefault(
      tables,
      "retirement_salary_overrides",
      "contribution_profile_id",
      null,
    );
  }

  // 0006: Add audit columns to override tables
  if (index < versionIndex("0006_goofy_rawhide_kid")) {
    addColumnDefault(tables, "retirement_budget_overrides", "created_by", null);
    addColumnDefault(tables, "retirement_budget_overrides", "updated_by", null);
    addColumnDefault(tables, "retirement_salary_overrides", "created_by", null);
    addColumnDefault(tables, "retirement_salary_overrides", "updated_by", null);
  }

  // 0007: Add filing_status to retirement_settings
  if (index < versionIndex("0007_melted_swordsman")) {
    addColumnDefault(tables, "retirement_settings", "filing_status", null);
  }

  // 0008: Add prior-year contribution columns
  if (index < versionIndex("0008_prior_year_contrib")) {
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
 * v0.2.x / v0.3.x → v0.4.0: adds what v0.3.x added (three performance_accounts columns with
 * defaults, projection_overrides, mc_user_presets) where missing; a v0.3.x backup may have some.
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

/** v0.5.x → v0.6.0: same data shape; a v0.5 backup has no `pending_rollovers`, which
 *  restores empty. */
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
 * v0.6.x → current: adds v0.6.2's `account_holdings`, `pending_rollovers` and savings `source`
 * columns and v0.6.5's utility tables where missing. Idempotent, so `v0.6_final` (a current
 * v0.6.8 backup) passes through.
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
 * v0.7.x → current, idempotent. A pre-v0.7.1 backup gets an empty savings_planned_tx_settlements;
 * a pre-0008 one loses `is_default` and gets `salaries` from `salary_overrides` by the
 * migration's rule (a stored number → fixed, otherwise follow the job).
 */
function transformV07xToCurrent(tables: TableData): TableData {
  if (!tables["savings_planned_tx_settlements"]) {
    tables["savings_planned_tx_settlements"] = [];
  }

  // 0032: Retirement Profiles, expand plus the migration's 5-step backfill in JS, so a restored
  // pre-0032 backup gets a first profile (the app only creates one by duplicating another).
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
    // Step 1+2: one "Current Retirement" profile, only when settings exist and
    // no profile does yet (idempotent — a backup already at the current
    // shape, or one with no retirement data at all, is a pure pass-through).
    if (settingsRows.length > 0 && profileRows.length === 0) {
      const profileId = 1;
      profileRows.push({
        id: profileId,
        name: "Current Retirement",
        description:
          "Your existing retirement assumptions, carried over when Retirement Profiles were introduced.",
        created_at: writeStamp().toISOString(),
      });
      for (const row of settingsRows) {
        if (row["profile_id"] == null) row["profile_id"] = profileId;
      }

      // Step 3: a retirement_profile_people row per person. "prim" = the settings row whose
      // person ranks highest by is_primary_user then id (getPrimaryPerson's rule), among those
      // with one.
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

      // Step 5: the global active-profile pointer; without it a household with no active
      // Plan resolves no profile (blank Retirement page).
      const appSettingsRows = (tables["app_settings"] ?? []) as Record<
        string,
        unknown
      >[];
      if (
        !appSettingsRows.some(
          (r) => r["key"] === "active_retirement_profile_id",
        )
      ) {
        // A synthetic max+1 id: restore NULL-fills missing keys and app_settings.id is a
        // NOT NULL PK; sequences are reset after restore, so it's safe.
        const maxId = appSettingsRows.reduce(
          (m, r) => Math.max(m, Number(r["id"]) || 0),
          0,
        );
        appSettingsRows.push({
          id: maxId + 1,
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

  // 0008: drop contribution_profiles.is_default (its row stays an ordinary profile).
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

  // 0038: fpl_by_household and tax_params restore empty (the resolver then uses the value
  // tables' MAX(tax_year)); retirement_profiles.tax_params_year is NULL (track latest).
  if (!tables["fpl_by_household"]) tables["fpl_by_household"] = [];
  if (!tables["tax_params"]) tables["tax_params"] = [];
  addColumnDefault(tables, "retirement_profiles", "tax_params_year", null);

  // v0.8.x 0003: retirement_profile_people.social_security_pia, nullable (NULL = not opted
  // into PIA-based optimization). A no-op for pre-0003 backups, kept to match 0038 above.
  addColumnDefault(
    tables,
    "retirement_profile_people",
    "social_security_pia",
    null,
  );

  return tables;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type TransformResult = {
  tables: TableData;
  transformed: boolean;
  sourceVersion: string;
};

/** Transform a backup's tables to the current schema: as-is when current, transformed when
 *  from a known older version, an error when unknown. */
export function transformBackupToCurrentSchema(
  tables: TableData,
  schemaVersion: string,
  currentVersion: string,
): TransformResult {
  if (schemaVersion === currentVersion) {
    return { tables, transformed: false, sourceVersion: schemaVersion };
  }

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

  // Rows copied one level deep, so the input is never changed
  const cloned: TableData = {};
  for (const [key, rows] of Object.entries(tables)) {
    cloned[key] = rows.map((row) => ({ ...(row as Record<string, unknown>) }));
  }

  const era = schemaEra(schemaVersion);

  // Cumulative: a backup N eras behind runs every transform from its era on, oldest first.
  // Each is idempotent, so a too-early era guess only adds no-op passes.
  const ERA_ORDER = ["v0.1", "v0.2", "v0.3", "v0.5", "v0.6", "v0.7"] as const;
  const rank = (e: string) =>
    ERA_ORDER.indexOf(e as (typeof ERA_ORDER)[number]);
  const eraRank = rank(era);

  if (eraRank <= rank("v0.1")) {
    transformV01xToV020(cloned, schemaVersion);
  }
  if (eraRank <= rank("v0.3")) {
    // v0.1.x / v0.2.x / v0.3.x → v0.4 (idempotent; fills any missing columns)
    transformV02xV03xToV040(cloned);
  }
  if (eraRank <= rank("v0.5")) {
    // → v0.6.0: adds an empty pending_rollovers table when absent
    transformV05xToV060(cloned);
  }
  if (eraRank <= rank("v0.6")) {
    // v0.6-line tables/columns + utilities tables
    transformV06xToCurrent(cloned);
  }
  // v0.7-line tables (retirement_profiles, fpl_by_household, tax_params, …)
  // + the salary_overrides → salaries reshape + is_default drop. Runs for
  // every era, including a fully-current v0.7.x export (a no-op then).
  transformV07xToCurrent(cloned);
  rebuildAssetClassBuckets(cloned, schemaVersion);
  dropPreReleaseV085Fields(cloned);
  transformV0810ProfileSets(cloned);
  transformV095SsInAmount(cloned);
  renameDisplayNameActive(cloned);
  dropDeadHoldingLinkAndSettings(cloned);
  convertRestoredBackup(cloned);

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
