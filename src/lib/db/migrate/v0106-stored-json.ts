/** The stored-JSON tag's converters, in the order they run (each over a
 *  fresh read of its tables), for MIGRATION_CONVERTERS. */
// No import from migration-converters.ts, which registers these.
import { ACTIVE_FIELDS_CONVERTER } from "./v0106-active-fields";
import { PERFORMANCE_CATEGORY_CONVERTER } from "./v0106-performance-category";
import { RETIRED_LIMITS_CONVERTER } from "./v0106-retired-limits";
import { SALARY_ENTRIES_CONVERTER } from "./v0106-salary-entries";

/** The stored-JSON tag. */
export const STORED_JSON_TAG = "0020_v0106_stored_json";

export const STORED_JSON_CONVERTERS = {
  [STORED_JSON_TAG]: [
    SALARY_ENTRIES_CONVERTER,
    ACTIVE_FIELDS_CONVERTER,
    PERFORMANCE_CATEGORY_CONVERTER,
    RETIRED_LIMITS_CONVERTER,
  ],
} as const;
