// How the engine routes money across accounts: modes, tax splits, slots.
// Categories are 401k, HSA, IRA and brokerage (the uncapped catch-all); caps
// are IRS limits plus tighter user caps, and the more restrictive one wins.

import type { AccountCategory } from "@/lib/config/account-types";

/**
 * How contributions are distributed. Waterfall (default) fills accounts in priority
 * order up to their cap; percentage splits by fixed %, and any share over an
 * account's cap redistributes proportionally to the rest.
 */
export type RoutingMode = "waterfall" | "percentage" | "bracket_filling";

/**
 * Tax treatment for routing. Only 401k and IRA offer the choice; HSA is always
 * pre-tax and brokerage always after-tax.
 */
export type RoutingTaxType = "traditional" | "roth";

/**
 * Per-account Roth fraction, 0 (all Traditional) to 1 (all Roth); 0.7 = 70% Roth.
 * Only 401k and IRA have configurable splits.
 */
export type TaxSplitConfig = Partial<Record<AccountCategory, number>>;

/**
 * How contributions were routed to one account for one year (tax split, caps).
 */
export type AccumulationSlot = {
  category: AccountCategory;
  /** IRS limit for this account this year (0 for brokerage). */
  irsLimit: number;
  /**
   * The actual limit used after applying artificial caps.
   * effectiveLimit = min(irsLimit, accountCap ?? Infinity).
   * For brokerage: always Infinity (no limit).
   */
  effectiveLimit: number;
  /** Employer match flowing into this account (doesn't count toward limits). */
  employerMatch: number;
  /** Total employee contribution routed to this account. */
  employeeContrib: number;
  /** Roth portion of employee contribution (only for 401k/IRA). */
  rothContrib: number;
  /** Traditional portion of employee contribution (only for 401k/IRA). */
  traditionalContrib: number;
  /** How much effective limit space remains after employee contribution. */
  remainingSpace: number;
  /** True if the artificial account cap was the binding constraint (not IRS limit). */
  cappedByAccount: boolean;
  /** True if a cross-account tax-type cap reduced contributions to this account. */
  cappedByTaxType: boolean;
  /** Amount that couldn't fit here and was sent to the next account. */
  overflowAmount: number;
  /** Part of `employeeContrib` from Portfolio-parented specs — savings
   *  outside retirement accounts, so the retirement contribution-rate
   *  ceiling never scales it. Spec routing only. */
  portfolioContrib?: number;
};

/**
 * Per-account slot showing how withdrawals were drawn for one year.
 */
export type DecumulationSlot = {
  category: AccountCategory;
  /** Total amount withdrawn from this account. */
  withdrawal: number;
  /** Roth portion of withdrawal (only for 401k/IRA). */
  rothWithdrawal: number;
  /** Traditional portion of withdrawal (only for 401k/IRA). */
  traditionalWithdrawal: number;
  /** True if the artificial account cap was the binding constraint. */
  cappedByAccount: boolean;
  /** True if a cross-account tax-type cap limited withdrawals from this account. */
  cappedByTaxType: boolean;
  /** Amount that couldn't be drawn here and shifts to the next account. */
  remainingNeed: number;
  /** For brokerage: portion of withdrawal that is return of basis (tax-free). */
  basisPortion?: number;
  /** For brokerage: portion of withdrawal that is taxable gain. */
  gainsPortion?: number;
};
