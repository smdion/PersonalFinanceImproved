import type { AccountCategory } from "@/lib/config/account-types";
import type { LumpSum } from "./year-overrides";
import type { RoutingMode, RoutingTaxType, TaxSplitConfig } from "./routing";

/**
 * Page-level defaults for accumulation — the "Projection Assumptions" baseline.
 * These are the values used when no year-specific override is active.
 * Every field here has a corresponding optional field in AccumulationOverride.
 */
export type AccumulationDefaults = {
  /**
   * Target contribution rate as decimal (e.g. 0.25 = 25% of gross salary).
   * This is the total percentage of salary you want to save/invest each year.
   */
  contributionRate: number;

  /**
   * How to route contributions across accounts.
   * 'waterfall' = fill in priority order; 'percentage' = split by %.
   */
  routingMode: RoutingMode;

  /**
   * Waterfall-mode priority: the first account fills first. Brokerage, the unlimited overflow
   * catch-all, usually goes last.
   */
  accountOrder: AccountCategory[];

  /**
   * Percentage-mode fractions of total contribution per account, summing to 1.0. Excess over an
   * account's IRS limit redistributes proportionally to the rest.
   */
  accountSplits: Record<AccountCategory, number>;

  /**
   * Default Roth/Traditional split for 401k and IRA.
   * See TaxSplitConfig for how the fraction works.
   *
   * Example: { '401k': 1.0, ira: 1.0 } → all Roth by default
   */
  taxSplits: TaxSplitConfig;
};

/**
 * One year's accumulation override: every field optional and sticky-forward (unset fields keep
 * their prior value), applied in year order; `reset: true` reverts all fields to defaults. The
 * "by lever" and "by year" UI views edit the same array.
 */
export type AccumulationOverride = {
  year: number;

  /** Target contribution rate as decimal. See AccumulationDefaults.contributionRate. */
  contributionRate?: number;

  /** Routing mode. See AccumulationDefaults.routingMode. */
  routingMode?: RoutingMode;

  /**
   * Account priority order for waterfall mode.
   * Only meaningful when routingMode is 'waterfall'.
   */
  accountOrder?: AccountCategory[];

  /**
   * Percentage splits for percentage mode. Values should sum to 1.0.
   * Only meaningful when routingMode is 'percentage'.
   */
  accountSplits?: Partial<Record<AccountCategory, number>>;

  /**
   * Roth fraction overrides for 401k and/or IRA.
   * Partial — only set the accounts whose split you want to change.
   */
  taxSplits?: Partial<TaxSplitConfig>;

  /**
   * Dollar cap per account type below the IRS limit (the stricter wins); omitted accounts are
   * uncapped.
   */
  accountCaps?: Partial<Record<AccountCategory, number>>;

  /**
   * Cap on total Roth or Traditional contributions across all accounts; the stricter of account
   * and tax-type cap wins.
   */
  taxTypeCaps?: Partial<Record<RoutingTaxType, number>>;

  /**
   * One-time dollar injections for this year. NOT sticky-forward.
   * Bypasses IRS contribution limits (models rollovers, inheritances, windfalls).
   */
  lumpSums?: LumpSum[];

  /**
   * When true, ALL fields revert to AccumulationDefaults from this year onward.
   * Any other fields set in the same override are ignored when reset is true.
   */
  reset?: boolean;

  /** Optional note explaining why this override exists (shown in UI tooltip). */
  notes?: string;
};

/**
 * The fully resolved accumulation config for a single year.
 * Computed by the engine after applying all sticky-forward overrides.
 * Every field is non-optional — all values are known.
 */
export type ResolvedAccumulationConfig = {
  contributionRate: number;
  routingMode: RoutingMode;
  accountOrder: AccountCategory[];
  accountSplits: Record<AccountCategory, number>;
  taxSplits: TaxSplitConfig;
  /** null = no artificial cap (IRS limit only). */
  accountCaps: Record<AccountCategory, number | null>;
  /** null = no cross-account tax-type cap. */
  taxTypeCaps: Record<RoutingTaxType, number | null>;
  /** Lump sums for this year only (NOT sticky-forward). Empty if none. */
  lumpSums: LumpSum[];
};
