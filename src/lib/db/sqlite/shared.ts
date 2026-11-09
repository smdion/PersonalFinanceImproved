// AUTO-GENERATED from ../pg/ by scripts/gen-sqlite-schema.ts — do not edit.
// Part of the Drizzle schema (SQLite) — types shared by the tables; see schema-pg.ts.

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

/** Top-level shape of a Salary Profile entry's `extraPaycheckRouting` (salaryEntrySchema). */
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
   * Per-year growth keyed by year ("2027"): pct = % increase (3 = 3%); dollar = a one-time
   * bump compounding into later years. Missing years grow 0%.
   */
  yearlyGrowth?: Record<string, YearlyGrowthEntry>;
  /**
   * Pay schedule snapshotted with baseNetPayPerCheck/baseYear, so later job or Salary Profile
   * edits don't move materialized dates. Absent → the job's entry in the active Salary Profile.
   */
  payPeriod?: PayPeriod;
  /** Snapshotted with payPeriod. `null` = "no anchor, use start date"; absent = no snapshot
   *  (or the schedule couldn't be resolved at save time). */
  anchorPayDate?: string | null;
  /**
   * false = "Budget" mode: the extra paycheck stays regular income, but `rules` are kept so
   * routing can resume. Absent/true = route to savings goals per rules/overrides.
   */
  enabled?: boolean;
};
