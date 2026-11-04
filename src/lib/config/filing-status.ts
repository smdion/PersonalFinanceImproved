// Filing status: the status the tax return files as, and the box ticked on
// a W-4 (Form W-4 Step 1(c), a withholding choice). Two concepts that
// share their three spellings today.
import { z } from "zod/v4";

export const RETURN_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type ReturnFilingStatus = (typeof RETURN_FILING_STATUS_VALUES)[number];

export const W4_FILING_STATUS_VALUES = ["MFJ", "Single", "HOH"] as const;
export type W4FilingStatus = (typeof W4_FILING_STATUS_VALUES)[number];
export const w4FilingStatusSchema = z.enum(W4_FILING_STATUS_VALUES);
