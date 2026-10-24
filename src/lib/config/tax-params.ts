/**
 * Tax-parameter resolver.
 *
 * ONE function every tax consumer calls the same way — the retirement
 * projection payload builder, the paycheck router, `savings.ts`, the annual
 * tax-liability path. Previously each of those had its own `WHERE tax_year =
 * X` / `MAX(tax_year)` logic (three-plus independent copies), and the
 * `irmaa_brackets` / FPL data was not consulted at all.
 *
 * Design: this is a THIN resolver. It does not hold figure
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
 * `tax_year` values, i.e. exactly the behaviour before this resolver existed.
 */

import type { HsaCoverageType, W4FilingStatus } from "./enum-values";

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
  /**
   * How to handle a `requestedYear` that has no data. Default "nearest".
   *  - "nearest" (retirement): newest year <= requestedYear, else oldest.
   *  - "throw"   : reject.
   *  - "null"    (paycheck): return `null` so the caller can degrade
   *               gracefully — the paycheck year selector lets a user pick
   *               a year with no seeded tables, and the contract there is
   *               "show empty, never another year's figures".
   */
  onMissing?: "throw" | "nearest" | "null";
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

/** Every distinct `tax_year` that has `contribution_limits` rows.
 *  Deliberately NOT the union across all five tables: `contribution_limits`
 *  is the only slice `requireLimit()` callers read (standard deduction,
 *  §63(f) senior deduction, IRS contribution limits, FICA/paycheck
 *  constants) — those throw when their key is missing for the resolved
 *  year. If a year could be selected from, say, `tax_brackets` alone, an
 *  admin seeding next year's withholding brackets early (before
 *  contribution limits are published) would make that year "newest" and
 *  take down every household's projections and the paycheck router with a
 *  throw, even though the previous year has complete data. The other four
 *  slices (`withholdingBrackets`/`ltcgByStatus`/`irmaaByStatus`/
 *  `fplByHousehold`) are `| undefined` by design and degrade gracefully —
 *  they don't need to gate year selection. */
function candidateYears(rows: TaxParamsRowSets): number[] {
  return [...new Set(rows.contributionLimits.map((r) => r.taxYear))].sort(
    (a, b) => a - b,
  );
}

function pickYear(
  years: number[],
  requestedYear: number | undefined,
  onMissing: "throw" | "nearest" | "null",
): number | null {
  if (years.length === 0) {
    throw new Error(
      "resolveTaxParams: no tax reference data present (contribution_limits is empty)",
    );
  }
  if (requestedYear == null) return years[years.length - 1]!;
  if (years.includes(requestedYear)) return requestedYear;
  if (onMissing === "throw") {
    throw new Error(
      `resolveTaxParams: no tax data for year ${requestedYear} (have ${years.join(", ")})`,
    );
  }
  if (onMissing === "null") return null;
  const earlier = years.filter((y) => y <= requestedYear);
  return earlier.length > 0 ? earlier[earlier.length - 1]! : years[0]!;
}

// Overloads: only `onMissing: "null"` can return null.
export function resolveTaxParams(
  rows: TaxParamsRowSets,
  requestedYear: number | undefined,
  opts: { onMissing: "null" },
): ResolvedTaxParams | null;
export function resolveTaxParams(
  rows: TaxParamsRowSets,
  requestedYear?: number,
  opts?: { onMissing?: "throw" | "nearest" },
): ResolvedTaxParams;
export function resolveTaxParams(
  rows: TaxParamsRowSets,
  requestedYear?: number,
  opts: ResolveTaxParamsOptions = {},
): ResolvedTaxParams | null {
  const onMissing = opts.onMissing ?? "nearest";
  const resolvedYear = pickYear(candidateYears(rows), requestedYear, onMissing);
  if (resolvedYear == null) return null;

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

/** Pub 590-A Worksheet 2-2: a reduced Roth IRA limit rounds UP to the next
 *  multiple of this, and any amount above $0 but below the floor becomes
 *  the floor (statutory, IRC 408A(c)(3) — not indexed). */
export const ROTH_IRA_REDUCED_LIMIT_ROUNDING = 10;
export const ROTH_IRA_REDUCED_LIMIT_FLOOR = 200;

/** The yearly limit rows for a filing status (lower-cased in the key,
 *  matching `standard_deduction_<status>`). */
export function rothIraPhaseoutKeys(filingStatus: string): {
  start: string;
  end: string;
} {
  const s = filingStatus.toLowerCase();
  return {
    start: `roth_ira_phaseout_start_${s}`,
    end: `roth_ira_phaseout_end_${s}`,
  };
}

/** The Additional Medicare LIABILITY threshold row for a filing status. */
export function medicareLiabilityKey(filingStatus: string): string {
  return `fica_medicare_surtax_liability_${filingStatus.toLowerCase()}`;
}

/** A pre-tax IRA balance below this share of the person's IRA limit isn't
 *  worth a pro-rata warning: converting a full year's contribution, under
 *  ~1% of it would be taxable (leftover cents, a dividend after a
 *  conversion). */
export const PRO_RATA_MATERIAL_SHARE_OF_IRA_LIMIT = 0.01;

/** Married filing separately (and lived together): the Roth IRA phase-out
 *  is statutory and not indexed (IRC 408A(c)(3)(B)). The app has no MFS
 *  status, so this is only used to say so. */
export const ROTH_IRA_MFS_PHASEOUT = { start: 0, end: 10_000 } as const;

/** The yearly HDHP minimum-deductible row for each HSA coverage type —
 *  the default cash buffer to keep uninvested in an HSA. */
export const HDHP_MIN_DEDUCTIBLE_KEY: Record<HsaCoverageType, string> = {
  self_only: "hdhp_min_deductible_self",
  family: "hdhp_min_deductible_family",
};

/** Filing statuses where a spouse's IRA can be funded from the couple's
 *  combined compensation (spousal IRA, IRC 219(c)). */
export const SPOUSAL_IRA_FILING_STATUSES: readonly W4FilingStatus[] = ["MFJ"];

/** Filing statuses of a married couple: if either spouse has family HSA
 *  coverage, both are treated as having it and share one family limit, each
 *  spouse's catch-up on top (IRS Pub 969). The app has no MFS status. */
export const MARRIED_FILING_STATUSES: readonly W4FilingStatus[] = ["MFJ"];

/** All filing statuses the engine expects a bracket set for. */
export const REQUIRED_FILING_STATUSES: W4FilingStatus[] = [
  "MFJ",
  "Single",
  "HOH",
];
