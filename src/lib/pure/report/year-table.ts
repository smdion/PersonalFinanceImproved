/** Simplified, print-scannable year-by-year table for the advisor report —
 *  NOT the full interactive ProjectionTable (many columns, built for
 *  on-screen exploration, print-hostile — see index.tsx's print:hidden on
 *  it in advisor mode). Condensed columns plus a flags column surfacing
 *  only the years where something notable happened. */
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";
import { formatCurrency } from "@/lib/utils/format";

export interface YearTableRow {
  year: number;
  age: number;
  withdrawal: string;
  taxCost: string;
  flags: string[];
}

/**
 * The "something notable happened this year" flag vocabulary — one list,
 * shared by the advisor report's year table and the Tax Optimization page's
 * year-by-year table so the two never drift. Order is deliberate (most
 * consequential first).
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
