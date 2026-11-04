// The filing-status schemas, apart from filing-status.ts: client
// components read its values and labels, and Zod stays out of their bundle.
import { z } from "zod/v4";
import {
  RETURN_FILING_STATUS_VALUES,
  W4_FILING_STATUS_VALUES,
} from "@/lib/config/filing-status";

export const returnFilingStatusSchema = z.enum(RETURN_FILING_STATUS_VALUES);
export const w4FilingStatusSchema = z.enum(W4_FILING_STATUS_VALUES);
