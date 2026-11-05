import type { AccountCategory } from "@/lib/config/account-types";
import type { LumpSum } from "../../accounts/account-balances.types";
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
   * Account priority order for waterfall mode.
   * The first account in the list fills first, then the next, etc.
   * Brokerage should usually be last (it's the unlimited overflow catch-all).
   *
   * Example: ['401k', 'hsa', 'ira', 'brokerage']
   *   → Max out 401k first, then HSA, then IRA, remainder to brokerage.
   */
  accountOrder: AccountCategory[];

  /**
   * Percentage splits for percentage mode. Values must sum to 1.0.
   * Each value is the fraction of the total contribution going to that account.
   *
   * Example: { '401k': 0.60, hsa: 0.15, ira: 0.15, brokerage: 0.10 }
   *   → 60% of contributions to 401k, 15% to HSA, 15% to IRA, 10% to brokerage.
   *
   * If a percentage allocation exceeds an account's IRS limit, the excess
   * redistributes proportionally to the remaining accounts.
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
 * A single year-override entry for the accumulation phase.
 *
 * HOW OVERRIDES WORK:
 * - Each field is optional — only set the fields you want to change.
 * - Fields you don't set keep their previous value (sticky-forward).
 * - Multiple overrides can exist for different years.
 * - The engine processes overrides in year order, carrying forward each field.
 * - Two UI views read and write the same AccumulationOverride[]: "by lever"
 *   (one setting across time) and "by year" (each year's resolved config).
 *
 * EXAMPLES:
 *
 * Change just the contribution rate in 2028:
 *   { year: 2028, contributionRate: 0.30 }
 *   → Rate becomes 30% from 2028 onward. All other settings unchanged.
 *
 * Switch to percentage mode and change tax splits in 2030:
 *   { year: 2030, routingMode: 'percentage',
 *     accountSplits: { '401k': 0.5, hsa: 0.2, ira: 0.2, brokerage: 0.1 },
 *     taxSplits: { '401k': 0.5, ira: 1.0 } }
 *   → From 2030: percentage mode, 50/50 Roth/Trad in 401k, all Roth IRA.
 *
 * Cap 401k contributions at $15k in 2029:
 *   { year: 2029, accountCaps: { '401k': 15000 } }
 *   → 401k limited to $15k (below IRS limit). Excess overflows per routing mode.
 *
 * Reset everything back to defaults in 2035:
 *   { year: 2035, reset: true }
 *   → All fields revert to AccumulationDefaults values from 2035 onward.
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
   * Artificial dollar cap per account type for this year.
   * Caps are BELOW IRS limits — the more restrictive cap wins.
   * Set a value to cap; omit an account to leave it uncapped.
   *
   * Example: { '401k': 15000 } → cap 401k at $15k, others use IRS limits.
   */
  accountCaps?: Partial<Record<AccountCategory, number>>;

  /**
   * Cross-account dollar cap per tax type.
   * Limits total Roth or Traditional contributions across ALL accounts.
   * The more restrictive of (account cap, tax-type cap) wins.
   *
   * Example: { roth: 20000 } → total Roth across 401k+IRA capped at $20k.
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
