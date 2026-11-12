// Shared types for spreadsheet view components, read from what
// trpc.netWorth.computeDetailedHistory returns.
import type { RouterOutputs } from "@/lib/trpc";

export type DetailedHistoryRow =
  RouterOutputs["netWorth"]["computeDetailedHistory"]["years"][number];

/** Tax-type distribution within a parent category. */
export type TaxLocationBreakdown = NonNullable<
  DetailedHistoryRow["portfolioByTaxLocation"]
>;
