// The filing-status schemas, apart from filing-status.ts (values and types) so Zod stays out of
// client bundles. The chain: lib/pure/tax/filing-status.ts; this year's resolver:
// server/services/tax/filing-status.ts.
import { z } from "zod/v4";
import {
  RETURN_FILING_STATUS_VALUES,
  TAX_TABLE_ROWS,
  W4_FILING_STATUS_VALUES,
} from "@/lib/config/filing-status";

export const returnFilingStatusSchema = z.enum(RETURN_FILING_STATUS_VALUES);
export const w4FilingStatusSchema = z.enum(W4_FILING_STATUS_VALUES);
/** A per-status tax table's row (`FilingStatusKey`). */
export const taxTableRowSchema = z.enum(TAX_TABLE_ROWS);
