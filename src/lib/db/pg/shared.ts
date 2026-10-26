// Part of the Drizzle schema (PostgreSQL) — types shared by the tables; see schema-pg.ts.

import type { PayPeriod } from "@/lib/config/enum-values";

/** One date-ranged rule directing an extra paycheck to one or more savings goals. */
export type ExtraPaycheckRule = {
  /** "YYYY-MM" — first month this rule applies (inclusive). */
  from: string;
  /** "YYYY-MM" — last month this rule applies (inclusive), or null for open-ended. */
  to: string | null;
  /** How to split the check across goals; pct values must sum to 100. */
  splits: { goalId: number; pct: number }[];
  /**
   * @deprecated Use ExtraPaycheckRoutingData.baseNetPayPerCheck + yearlyGrowth instead.
   * Kept for backward-compat fallback when routing-level base is absent.
   */
  netPaySnapshot?: number;
};

/** A one-time per-month override that takes precedence over the matching rule. */
export type ExtraPaycheckOverride = {
  /** "YYYY-MM" — the specific extra-paycheck month this override applies to. */
  month: string;
  /** Override splits; pct values must sum to 100. */
  splits: { goalId: number; pct: number }[];
};

/** Per-year growth entry for projecting future extra-paycheck net pay. */
export type YearlyGrowthEntry = { type: "pct" | "dollar"; value: number };

/** Top-level shape stored in a Salary Profile entry's `extraPaycheckRouting`
 *  field (see salaryEntrySchema in json-schemas.ts) — moved off
 *  `jobs.extra_paycheck_routing` because it's a comp-layer decision about
 *  this job's pay, not a job identity fact. */
export type ExtraPaycheckRoutingData = {
  rules: ExtraPaycheckRule[];
  overrides?: ExtraPaycheckOverride[];
  /**
   * Net pay per check from the paycheck calculator, snapshotted when rules/growth are saved.
   * Used as the base for projecting future extra-paycheck amounts via yearlyGrowth.
   */
  baseNetPayPerCheck?: number;
  /**
   * The calendar year when baseNetPayPerCheck was recorded. Anchors compounding so that
   * rules applied in future years accumulate the correct number of growth steps.
   */
  baseYear?: number;
  /**
   * Per-year growth rates keyed by year string (e.g. "2027").
   * pct: percentage increase (3 = 3%); dollar: flat dollar increase carried forward.
   * Missing years default to 0% growth. Dollar entries are one-time bumps that
   * compound into the base for subsequent years.
   */
  yearlyGrowth?: Record<string, YearlyGrowthEntry>;
  /**
   * Pay schedule snapshotted alongside baseNetPayPerCheck/baseYear, from the
   * same resolved job entry computeJobNetPayPerCheck already reads. Optional
   * — the materializer prefers this snapshot but falls back to the job's
   * LIVE entry in the globally-active Salary Profile when absent (e.g.
   * routing saved before this field existed). Freezes the schedule at save
   * time so a later job/Salary-Profile correction doesn't retroactively move
   * already-materialized planned-transaction dates — see RULES.md's
   * extraPaycheckRouting section.
   */
  payPeriod?: PayPeriod;
  /** Snapshotted alongside payPeriod above. `null` is a real, complete
   *  value ("no anchor, use start date") — distinct from the field being
   *  entirely absent (pre-snapshot routing, or a schedule that couldn't be
   *  resolved at save time). */
  anchorPayDate?: string | null;
  /**
   * Whether `rules` currently materialize into savings_planned_transactions
   * at all. Absent/true = today's behavior (route to savings goals, per
   * rules/overrides below). false = "Budget" mode — the extra paycheck
   * isn't diverted anywhere; it stays as regular income, same as a job with
   * no routing configured. Distinct from clearing `rules` so a user can
   * pause routing without losing a configured schedule (see
   * extra-paycheck-rules-editor.tsx's Savings/Budget toggle).
   */
  enabled?: boolean;
};
