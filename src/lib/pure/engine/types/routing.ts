// How the engine routes money across accounts: modes, tax splits, slots.
//
// The engine manages how money flows into accounts (accumulation) and out of
// accounts (decumulation) across the full projection timeline.
//
// CORE CONCEPTS:
//
// 1. ACCOUNT CATEGORIES — The 4 account types money can flow into/out of:
//    • 401k  — employer-sponsored retirement (IRS limit applies)
//    • HSA   — health savings account (IRS limit applies, always pre-tax)
//    • IRA   — individual retirement account (IRS limit applies)
//    • Brokerage — taxable investment account (no IRS limit, catch-all)
//
// 2. TAX TREATMENT — How contributions are taxed:
//    • Traditional — pre-tax now, taxed on withdrawal
//    • Roth        — after-tax now, tax-free withdrawal
//    • HSA is always pre-tax; Brokerage is always after-tax.
//    • 401k and IRA can be split between Traditional and Roth.
//
// 3. ROUTING MODES — Two ways to distribute contributions across accounts:
//    • Waterfall  — fill accounts in priority order up to their limits
//    • Percentage — split contributions by percentage across accounts
//
// 4. STICKY-FORWARD OVERRIDES — Any setting can be changed at any year.
//    The change persists until the next override for that same field.
//    Example: Set contribution rate to 30% in 2028. It stays 30% for 2029,
//    2030, etc. until you set a different rate in another year.
//    Set `reset: true` to revert ALL fields to page-level defaults.
//
// 5. CAPS — Two layers of caps limit contributions:
//    • IRS limits    — hard legal limits per account type (grow ~2%/year)
//    • Artificial caps — user-defined limits below IRS limits
//      - Per-account: "cap my 401k at $15k this year"
//      - Per-tax-type: "cap all Roth contributions at $20k"
//      The more restrictive cap always wins. When a cap is hit, excess
//      flows to the next account (waterfall) or redistributes (percentage).
//
// 6. OVERFLOW — When an account can't absorb more money:
//    • Waterfall mode: excess flows to the next account in priority order
//    • Percentage mode: excess redistributes proportionally to remaining
//      accounts, then to brokerage as the final catch-all
//    The UI highlights every year where overflow/redistribution occurs.
//
// 7. UI VIEWS — The same override data supports two views:
//    • "By lever" — see all rate changes, all priority changes, etc.
//      Good for tweaking one setting across time.
//    • "By year"  — see the full resolved config for each year.
//      Good for understanding "what's happening in 2035?"
//    Both views read/write the same AccumulationOverride[] array.

import type { AccountCategory } from "@/lib/config/account-types";

/**
 * How contributions are distributed across account categories.
 *
 * **Waterfall mode** (default): Contributions fill the highest-priority account
 * first, up to its limit (IRS or artificial cap), then overflow to the next.
 * Best when you want to maximize tax-advantaged space before using brokerage.
 *
 * **Percentage mode**: Contributions are split across accounts by a fixed %.
 * If a percentage allocation exceeds an account's limit, the excess
 * redistributes proportionally to the remaining accounts.
 * Best when you want explicit control over how much goes where.
 */
export type RoutingMode = "waterfall" | "percentage" | "bracket_filling";

/**
 * Tax treatment types for contribution/distribution routing.
 *
 * Only applies to 401k and IRA — the two account types that offer a choice.
 * HSA is always pre-tax (similar to traditional but with unique tax benefits).
 * Brokerage is always after-tax (no special tax treatment on contributions).
 */
export type RoutingTaxType = "traditional" | "roth";

/**
 * Per-account Roth fraction (0–1) for accounts that support tax treatment choice.
 *
 * - Value of 0 = 100% Traditional (all contributions are pre-tax)
 * - Value of 1 = 100% Roth (all contributions are after-tax, grow tax-free)
 * - Value of 0.7 = 70% Roth / 30% Traditional
 *
 * Only 401k and IRA have configurable splits:
 * - HSA is always pre-tax (not configurable here)
 * - Brokerage is always after-tax (not configurable here)
 *
 * Example: { '401k': 0.7, ira: 1.0 }
 *   → 401k gets 70% Roth / 30% Traditional
 *   → IRA gets 100% Roth
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
   *  outside the retirement plan, so the retirement contribution-rate
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
