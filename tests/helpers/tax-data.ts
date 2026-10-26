/**
 * The shipped tax-data file (tax-data/us-federal.json) as the row shapes
 * tests use — the one source the database is reconciled from.
 */
import * as fs from "fs";
import * as path from "path";
import type {
  TaxDataFile,
  TaxDataYear,
} from "@/lib/db/reference-reconcile-core";

export const TAX_DATA_PATH = path.resolve(
  __dirname,
  "../../tax-data/us-federal.json",
);

export function readTaxData(): TaxDataFile {
  return JSON.parse(fs.readFileSync(TAX_DATA_PATH, "utf8")) as TaxDataFile;
}

const years = (): [number, TaxDataYear][] =>
  Object.entries(readTaxData().years).map(([y, d]) => [Number(y), d]);

/** `contribution_limits` rows. */
export function taxDataLimits(): {
  taxYear: number;
  limitType: string;
  value: number;
}[] {
  return years().flatMap(([taxYear, d]) =>
    Object.entries(d.limits).map(([limitType, l]) => ({
      taxYear,
      limitType,
      value: l.value,
    })),
  );
}

/** `contribution_limits` as `"year:limit_type" → value`. */
export function taxDataLimitMap(): Map<string, number> {
  return new Map(
    taxDataLimits().map((r) => [`${r.taxYear}:${r.limitType}`, r.value]),
  );
}

/** `tax_brackets` rows. */
export function taxDataWithholding(): {
  taxYear: number;
  filingStatus: string;
  w4Checkbox: boolean;
  brackets: { threshold: number; baseWithholding: number; rate: number }[];
}[] {
  return years().flatMap(([taxYear, d]) =>
    Object.entries(d.withholding.tables).flatMap(([filingStatus, t]) =>
      (["standard", "checkbox"] as const).map((kind) => ({
        taxYear,
        filingStatus,
        w4Checkbox: kind === "checkbox",
        brackets: t[kind] as {
          threshold: number;
          baseWithholding: number;
          rate: number;
        }[],
      })),
    ),
  );
}

/** `ltcg_brackets` / `irmaa_brackets` rows. */
export function taxDataBrackets(section: "ltcg" | "irmaa"): {
  taxYear: number;
  filingStatus: string;
  brackets: unknown[];
}[] {
  return years().flatMap(([taxYear, d]) =>
    Object.entries(d[section]?.brackets ?? {}).map(
      ([filingStatus, brackets]) => ({ taxYear, filingStatus, brackets }),
    ),
  );
}

/** `fpl_by_household` rows. */
export function taxDataFpl(): {
  taxYear: number;
  amounts: Record<string, number>;
}[] {
  return years().flatMap(([taxYear, d]) =>
    d.fpl ? [{ taxYear, amounts: d.fpl.amounts }] : [],
  );
}

/** The engine's yearly tax tables (and the QCD limit) for one year of the
 *  shipped file, in the shapes `distributionTaxRates` takes — pinned to a year (default 2026)
 *  so a new data release doesn't move every engine test. */
export function shippedTaxTables(year = 2026): {
  ltcgBrackets: Record<string, { threshold: number | null; rate: number }[]>;
  irmaaBrackets: Record<
    string,
    { magiThreshold: number; annualSurcharge: number }[]
  >;
  fplByHousehold: Record<number, number>;
  qcdAnnualLimit: number;
} {
  const d = readTaxData().years[String(year)];
  if (!d?.ltcg || !d.irmaa || !d.fpl)
    throw new Error(`The tax-data file has no complete ${year}`);
  return {
    ltcgBrackets: d.ltcg.brackets as Record<
      string,
      { threshold: number | null; rate: number }[]
    >,
    irmaaBrackets: d.irmaa.brackets as Record<
      string,
      { magiThreshold: number; annualSurcharge: number }[]
    >,
    fplByHousehold: Object.fromEntries(
      Object.entries(d.fpl.amounts).map(([k, v]) => [Number(k), v]),
    ),
    qcdAnnualLimit: d.limits.qcd_annual_limit!.value,
  };
}
