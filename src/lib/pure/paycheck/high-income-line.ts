/**
 * The household's default high-income line (config HIGH_INCOME_LINE) by filing status: MFJ gets
 * the household figure, Single and Head of household the single one. Without a status, by the
 * number of people (two or more read as a couple), and the basis says so.
 */
import { HIGH_INCOME_LINE } from "@/lib/config/milestones";
import {
  filingRules,
  type ReturnFilingStatus,
} from "@/lib/config/filing-status";

export type HighIncomeLineBasis = ReturnFilingStatus | "people";

/** The saved line when one is set (a positive number), else the default. */
export function effectiveHighIncomeLine(
  saved: unknown,
  defaultThreshold: number,
): number;
export function effectiveHighIncomeLine(
  saved: unknown,
  defaultThreshold: number | undefined,
): number | undefined;
export function effectiveHighIncomeLine(
  saved: unknown,
  defaultThreshold: number | undefined,
): number | undefined {
  return typeof saved === "number" && saved > 0 ? saved : defaultThreshold;
}

export function defaultHighIncomeLine(
  filingStatus: ReturnFilingStatus | null,
  peopleCount: number,
): { threshold: number; basis: HighIncomeLineBasis } {
  if (filingStatus)
    return {
      threshold:
        filingRules(filingStatus).peopleOnReturn === 2
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
