/**
 * Tax-parameter resolver (R43).
 *
 * ONE function every tax consumer calls the same way — the retirement
 * projection payload builder, the paycheck router, `savings.ts`, the annual
 * tax-liability path. Before R43 each of those had its own `WHERE tax_year =
 * X` / `MAX(tax_year)` logic (three-plus independent copies), and the
 * `irmaa_brackets` / FPL data was not consulted at all.
 *
 * Design (see `.scratch/docs/reviews/R43-REVIEW.md` §5-Rec-1 and the
 * follow-up advisor pass): this is a THIN resolver. It does not hold figure
 * values. The existing `contribution_limits` / `tax_brackets` /
 * `ltcg_brackets` / `irmaa_brackets` / `fpl_by_household` tables remain the
 * one and only value store, keyed by `tax_year` exactly as today. The
 * `tax_params` table is an optional per-year vintage marker that supplies
 * `version` (a human-legible "Tax data: 2026, rev N") — cache coherence
 * comes from the resolved values themselves, which already land in the
 * engine-input hash.
 *
 * Resolution rule (identical for every caller):
 *   1. `requestedYear` omitted        -> newest year with data.
 *   2. `requestedYear` present, exact  -> that year.
 *   3. `requestedYear` present, missing:
 *        onMissing "nearest" (retirement — a base year then grown forward)
 *          -> newest year <= requestedYear, else the oldest year with data.
 *        onMissing "throw" (paycheck / savings — a user picked a year;
 *          showing a different year's figures is a wrong answer)
 *          -> throw.
 *   4. No reference rows at all       -> throw (genuine misconfiguration).
 *
 * The `tax_params` rows are NOT required for resolution — a DB with none
 * (e.g. an old-backup restore) resolves purely off the value tables' own
 * `tax_year` values, i.e. exactly the pre-R43 behaviour.
 */

import type { W4FilingStatus } from "./enum-values";

/**
 * The three per-slice entry shapes, kept local so `src/lib/config/` has no
 * dependency on the DB layer. Structurally identical to the same-named
 * types in `db/schema-pg.ts` and the Zod schemas in `db/json-schemas.ts`.
 */
export type TaxBracketEntry = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};
export type LtcgBracketEntry = { threshold: number | null; rate: number };
export type IrmaaBracketEntry = {
  magiThreshold: number;
  annualSurcharge: number;
};

// ── Input row shapes (already fetched from the DB by the caller) ───────

export interface TaxParamsVintageRow {
  taxYear: number;
  version: number;
}
export interface ContributionLimitRow {
  taxYear: number;
  limitType: string;
  value: number | string;
}
export interface WithholdingBracketRow {
  taxYear: number;
  filingStatus: string;
  w4Checkbox: boolean;
  brackets: TaxBracketEntry[];
}
export interface LtcgBracketRow {
  taxYear: number;
  filingStatus: string;
  brackets: LtcgBracketEntry[];
}
export interface IrmaaBracketRow {
  taxYear: number;
  filingStatus: string;
  brackets: IrmaaBracketEntry[];
}
export interface FplRow {
  taxYear: number;
  amounts: Record<string, number>;
}

export interface TaxParamsRowSets {
  vintage: TaxParamsVintageRow[];
  contributionLimits: ContributionLimitRow[];
  withholdingBrackets: WithholdingBracketRow[];
  ltcgBrackets: LtcgBracketRow[];
  irmaaBrackets: IrmaaBracketRow[];
  fpl: FplRow[];
}

export interface ResolveTaxParamsOptions {
  /** How to handle a `requestedYear` that has no data. Default "nearest". */
  onMissing?: "throw" | "nearest";
}

// ── Output shape ─────────────────────────────────────────────────────

export interface ResolvedTaxParams {
  /** The year whose value rows were actually used. */
  resolvedYear: number;
  /** `tax_params.version` for `resolvedYear`, or 0 when no vintage row exists. */
  version: number;
  /** `contribution_limits` for `resolvedYear` as a `limitType -> value` map. */
  limits: Record<string, number>;
  /**
   * `tax_brackets` for `resolvedYear`, keyed
   * `[filingStatus][w4Checkbox]` -> ordered bracket list.
   * `undefined` when the resolved year has no rows (caller falls back to
   * its hardcoded default, same as today).
   */
  withholdingBrackets:
    Record<string, Record<"true" | "false", TaxBracketEntry[]>> | undefined;
  /** `ltcg_brackets` for `resolvedYear`, keyed by filing status. `undefined` when none. */
  ltcgByStatus: Record<string, LtcgBracketEntry[]> | undefined;
  /** `irmaa_brackets` for `resolvedYear`, keyed by filing status. `undefined` when none. */
  irmaaByStatus: Record<string, IrmaaBracketEntry[]> | undefined;
  /** `fpl_by_household` for `resolvedYear` as a `size -> dollars` map. `undefined` when none. */
  fplByHousehold: Record<number, number> | undefined;
}

// ── Implementation ──────────────────────────────────────────────────

function toNum(v: number | string): number {
  return typeof v === "number" ? v : parseFloat(v);
}

/** Every distinct `tax_year` that has at least one value row. */
function candidateYears(rows: TaxParamsRowSets): number[] {
  const years = new Set<number>();
  for (const r of rows.contributionLimits) years.add(r.taxYear);
  for (const r of rows.withholdingBrackets) years.add(r.taxYear);
  for (const r of rows.ltcgBrackets) years.add(r.taxYear);
  for (const r of rows.irmaaBrackets) years.add(r.taxYear);
  for (const r of rows.fpl) years.add(r.taxYear);
  return [...years].sort((a, b) => a - b);
}

function pickYear(
  years: number[],
  requestedYear: number | undefined,
  onMissing: "throw" | "nearest",
): number {
  if (years.length === 0) {
    throw new Error(
      "resolveTaxParams: no tax reference data present (contribution_limits / tax_brackets / … are all empty)",
    );
  }
  if (requestedYear == null) return years[years.length - 1]!;
  if (years.includes(requestedYear)) return requestedYear;
  if (onMissing === "throw") {
    throw new Error(
      `resolveTaxParams: no tax data for year ${requestedYear} (have ${years.join(", ")})`,
    );
  }
  const earlier = years.filter((y) => y <= requestedYear);
  return earlier.length > 0 ? earlier[earlier.length - 1]! : years[0]!;
}

export function resolveTaxParams(
  rows: TaxParamsRowSets,
  requestedYear?: number,
  opts: ResolveTaxParamsOptions = {},
): ResolvedTaxParams {
  const onMissing = opts.onMissing ?? "nearest";
  const resolvedYear = pickYear(candidateYears(rows), requestedYear, onMissing);

  const version =
    rows.vintage.find((v) => v.taxYear === resolvedYear)?.version ?? 0;

  const limits: Record<string, number> = {};
  for (const r of rows.contributionLimits) {
    if (r.taxYear === resolvedYear) limits[r.limitType] = toNum(r.value);
  }

  const whRows = rows.withholdingBrackets.filter(
    (r) => r.taxYear === resolvedYear,
  );
  let withholdingBrackets:
    Record<string, Record<"true" | "false", TaxBracketEntry[]>> | undefined;
  if (whRows.length > 0) {
    withholdingBrackets = {};
    for (const r of whRows) {
      (withholdingBrackets[r.filingStatus] ??= {} as Record<
        "true" | "false",
        TaxBracketEntry[]
      >)[r.w4Checkbox ? "true" : "false"] = r.brackets;
    }
  }

  const ltcgRows = rows.ltcgBrackets.filter((r) => r.taxYear === resolvedYear);
  const ltcgByStatus =
    ltcgRows.length > 0
      ? Object.fromEntries(ltcgRows.map((r) => [r.filingStatus, r.brackets]))
      : undefined;

  const irmaaRows = rows.irmaaBrackets.filter(
    (r) => r.taxYear === resolvedYear,
  );
  const irmaaByStatus =
    irmaaRows.length > 0
      ? Object.fromEntries(irmaaRows.map((r) => [r.filingStatus, r.brackets]))
      : undefined;

  const fplRow = rows.fpl.find((r) => r.taxYear === resolvedYear);
  const fplByHousehold = fplRow
    ? Object.fromEntries(
        Object.entries(fplRow.amounts).map(([k, v]) => [Number(k), v]),
      )
    : undefined;

  return {
    resolvedYear,
    version,
    limits,
    withholdingBrackets,
    ltcgByStatus,
    irmaaByStatus,
    fplByHousehold,
  };
}

/** All filing statuses the engine expects a bracket set for. */
export const REQUIRED_FILING_STATUSES: W4FilingStatus[] = [
  "MFJ",
  "Single",
  "HOH",
];
