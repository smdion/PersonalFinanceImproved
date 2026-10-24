import type { db as appDb } from "@/lib/db";
import { settingValueSchema } from "@/lib/db/json-schemas";
import { zDecimal } from "@/lib/config/enum-values";

/** Accepts both the main db instance and transaction handles. */
export type DbType =
  typeof appDb | Parameters<Parameters<typeof appDb.transaction>[0]>[0];

/** Re-export the centralized decimal-string validator for backward compatibility. */
export { zDecimal };

/** Re-export the centralized settingValue schema for backward compatibility. */
export const settingValue = settingValueSchema;
