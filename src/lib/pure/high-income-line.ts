/**
 * The household's default high-income line (config HIGH_INCOME_LINE): by
 * this year's filing status — married filing jointly gets the household
 * figure, Single and Head of household the single one. Without a status,
 * by the number of people (two or more read as a couple), and the basis
 * says so.
 */
import { HIGH_INCOME_LINE } from "@/lib/config/milestones";
import type { W4FilingStatus } from "@/lib/config/enum-values";

export type HighIncomeLineBasis = W4FilingStatus | "people";

export function defaultHighIncomeLine(
  filingStatus: W4FilingStatus | null,
  peopleCount: number,
): { threshold: number; basis: HighIncomeLineBasis } {
  if (filingStatus)
    return {
      threshold:
        filingStatus === "MFJ"
          ? HIGH_INCOME_LINE.married
          : HIGH_INCOME_LINE.single,
      basis: filingStatus,
    };
  return {
    threshold:
      peopleCount >= 2 ? HIGH_INCOME_LINE.married : HIGH_INCOME_LINE.single,
    basis: "people",
  };
}
