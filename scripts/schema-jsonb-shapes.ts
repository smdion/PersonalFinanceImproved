/**
 * What each jsonb column is read and written through, for docs/SCHEMA.md
 * (scripts/gen-schema-docs.ts). A migration that converts a column or
 * retires its reader edits that column's line here, and nowhere else in
 * the generator.
 *
 * The generator checks every line: the column is a jsonb column, each
 * `file#name` is still exported from `src/<file>`, and a `fallbacks` site
 * is still a row of docs/FALLBACKS.md § Old stored shapes. A line that
 * names something gone fails the run. A jsonb column with no line prints
 * as "unchecked".
 */

export interface JsonbShape {
  /** The zod schema that describes the column: `file#export` under src/. */
  shape?: string;
  /** Where code parses through `shape`: on a write, on a read, both, or
   *  nowhere (the schema documents the column only). */
  parsed?: "write" | "read" | "read and write" | "nowhere";
  /** The stored reader that server reads go through: `file#export`. */
  reader?: string;
  /** The site of the FALLBACKS § Old stored shapes row that still reads
   *  this column's old shapes, as the row writes it. */
  fallbacks?: string;
  /** A short note, e.g. a column loose by design. */
  note?: string;
}

const SCHEMAS = "lib/db/shapes/json-schemas.ts";

/** By `table.column`. */
export const JSONB_SHAPES: Record<string, JsonbShape> = {
  "account_performance.accepted_checks": {
    reader:
      "lib/pure/investments/performance-annotations.ts#parseAcceptedChecks",
  },
  "account_performance.estimated_fields": {
    reader:
      "lib/pure/investments/performance-annotations.ts#parseEstimatedFields",
  },
  "api_connections.account_mappings": {
    shape: `${SCHEMAS}#accountMappingsSchema`,
    parsed: "nowhere",
    fallbacks: "services/sync/apply-pull-mapping.ts",
  },
  "api_connections.config": {
    shape: `${SCHEMAS}#apiConfigSchema`,
    parsed: "nowhere",
    reader: "lib/crypto.ts#readMaybeEncrypted",
    fallbacks: "lib/crypto.ts",
  },
  "api_connections.skipped_category_ids": {
    shape: `${SCHEMAS}#skippedCategoryIdsSchema`,
    parsed: "nowhere",
  },
  "app_settings.value": {
    shape: `${SCHEMAS}#settingValueSchema`,
    parsed: "write",
    reader: "lib/db/stored-setting.ts#readStoredSetting",
    note: "the reader checks a key against that key's own shape",
  },
  "budget_api_cache.data": {
    shape: `${SCHEMAS}#budgetApiCacheDataSchema`,
    parsed: "nowhere",
    reader: "lib/budget-api/cached-month.ts#readCachedMonthBalances",
    fallbacks: "lib/budget-api/cached-month.ts",
    note: "cache, loose by design",
  },
  "budget_items.amounts": {
    shape: `${SCHEMAS}#budgetAmountsSchema`,
    parsed: "read and write",
    fallbacks: "lib/pure/budget/budget.ts",
  },
  "budget_profiles.column_labels": {
    shape: `${SCHEMAS}#columnLabelsSchema`,
    parsed: "write",
  },
  "budget_profiles.column_months": {
    shape: `${SCHEMAS}#columnMonthsSchema`,
    parsed: "write",
  },
  "change_log.new_value": {
    shape: `${SCHEMAS}#changeLogValueSchema`,
    parsed: "nowhere",
    note: "audit, loose by design",
  },
  "change_log.old_value": {
    shape: `${SCHEMAS}#changeLogValueSchema`,
    parsed: "nowhere",
    note: "audit, loose by design",
  },
  "contribution_profiles.contribution_active_fields": {
    shape: `${SCHEMAS}#contributionActiveFieldsSchema`,
    parsed: "read and write",
    reader: "lib/db/stored-active-fields.ts#readContributionActiveFields",
    fallbacks: "lib/db/stored-active-fields.ts",
  },
  "fpl_by_household.amounts": {
    shape: `${SCHEMAS}#fplByHouseholdAmountsSchema`,
    parsed: "write",
  },
  "irmaa_brackets.brackets": {
    shape: `${SCHEMAS}#irmaaBracketsSchema`,
    parsed: "write",
  },
  "ltcg_brackets.brackets": {
    shape: `${SCHEMAS}#ltcgBracketsSchema`,
    parsed: "write",
  },
  "projection_cache.result": { note: "cache, loose by design" },
  "projection_overrides.overrides": {
    reader:
      "server/services/projection/projection-run.ts#resolveProjectionOverrides",
    note: "parsed by override_type; a row that fails reads as none",
  },
  "relocation_scenarios.params": {
    shape: `${SCHEMAS}#relocationScenarioParamsSchema`,
    parsed: "write",
  },
  "retirement_settings.withdrawal_order": {
    shape:
      "lib/pure/engine/types/overrides.schema.ts#storedWithdrawalOrderSchema",
    parsed: "read",
  },
  "retirement_settings.withdrawal_splits": {
    shape:
      "lib/pure/engine/types/overrides.schema.ts#storedWithdrawalSplitsSchema",
    parsed: "read",
  },
  "salary_profiles.salaries": {
    shape: `${SCHEMAS}#salaryEntriesSchema`,
    parsed: "read and write",
    reader: "lib/db/stored-salary-entries.ts#checkSalaryEntries",
    fallbacks: "lib/db/stored-salary-entries.ts",
  },
  "state_version_tables.data": {
    shape: `${SCHEMAS}#stateVersionDataSchema`,
    parsed: "nowhere",
    note: "backup blob, loose by design",
  },
  "tax_brackets.brackets": {
    shape: `${SCHEMAS}#taxBracketsSchema`,
    parsed: "write",
  },
};
