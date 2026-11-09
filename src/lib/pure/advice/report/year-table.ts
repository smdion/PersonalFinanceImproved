/** Condensed, print-friendly year table for the advisor report (not the interactive
 *  ProjectionTable), with a flags column for notable years. */
import type { EngineDecumulationYear } from "@/lib/pure/engine/types/index";
import { formatCurrency } from "@/lib/utils/format";

export interface YearTableRow {
  year: number;
  age: number;
  withdrawal: string;
  taxCost: string;
  flags: string[];
}

/**
 * The notable-year flags, most consequential first; shared by the advisor report's year
 * table and the Tax Optimization page's table.
 */
export function taxYearFlags(
  y: Pick<
    EngineDecumulationYear,
    | "rmdOverrodeRouting"
    | "rmdShortfallAmount"
    | "irmaaCost"
    | "acaSubsidyPreserved"
    | "rothConversionAmount"
    | "rothConversionIrmaaCapped"
  >,
): string[] {
  const flags: string[] = [];
  if (y.rmdOverrodeRouting) flags.push("RMD");
  if (y.rmdShortfallAmount > 0) flags.push("RMD shortfall");
  if (y.irmaaCost > 0) flags.push("IRMAA");
  if (y.acaSubsidyPreserved === false) flags.push("ACA lost");
  if (y.rothConversionAmount > 0) flags.push("Roth conversion");
  if (y.rothConversionIrmaaCapped) flags.push("Roth capped (IRMAA)");
  return flags;
}

export function buildYearTableRows(
  decumulationYears: EngineDecumulationYear[],
  deflate: (v: number, year: number) => number,
): YearTableRow[] {
  return decumulationYears.map((y) => ({
    year: y.year,
    age: y.age,
    withdrawal: formatCurrency(deflate(y.totalWithdrawal, y.year)),
    taxCost: formatCurrency(deflate(y.taxCost, y.year)),
    flags: taxYearFlags(y),
  }));
}
