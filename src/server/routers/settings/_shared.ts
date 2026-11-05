import { settingValueSchema } from "@/lib/db/json-schemas";
import { zDecimal } from "@/lib/utils/zod-fields";

/** Re-export the centralized decimal-string validator for backward compatibility. */
export { zDecimal };

/** Re-export the centralized settingValue schema for backward compatibility. */
export const settingValue = settingValueSchema;
