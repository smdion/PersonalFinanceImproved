// Engine configuration types — routing modes, strategy params, contribution specs.
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
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type { LumpSum } from "./shared";

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

// --- Accumulation (saving / contributing) ---

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

// --- Decumulation (withdrawing / distributing) ---

/**
 * Page-level defaults for decumulation — the baseline withdrawal strategy.
 *
 * Decumulation is the reverse of accumulation: instead of routing contributions
 * INTO accounts, you're routing withdrawals OUT OF accounts.
 *
 * The same override system applies: any setting can change at any year,
 * with sticky-forward persistence.
 */
export type DecumulationDefaults = {
  /**
   * Withdrawal rate as decimal (e.g. 0.04 = 4% rule).
   * Applied to total portfolio to determine annual withdrawal target.
   */
  withdrawalRate: number;

  /**
   * How to route withdrawals across accounts.
   * - 'bracket_filling': fill traditional withdrawals up to a target tax bracket,
   *   then Roth for remainder, brokerage as overflow, HSA last. Tax-optimal default.
   *   Requires taxBrackets in distributionTaxRates; falls back to waterfall if missing.
   * - 'waterfall': drain accounts in priority order (withdrawalOrder).
   * - 'percentage': split withdrawals by fixed % (withdrawalSplits).
   *   If a split requests more than available, excess redistributes proportionally.
   */
  withdrawalRoutingMode: RoutingMode;

  /**
   * Account withdrawal priority — which accounts to draw from first.
   * Only used when withdrawalRoutingMode = 'waterfall'.
   * Typically: brokerage first (taxable), then traditional (tax-deferred),
   * then Roth last (let tax-free growth compound longest).
   *
   * Example: ['brokerage', '401k', 'ira', 'hsa']
   *   → Draw from brokerage first, then 401k, then IRA, then HSA last.
   */
  withdrawalOrder: AccountCategory[];

  /**
   * Fixed percentage split for withdrawals across accounts.
   * Only used when withdrawalRoutingMode = 'percentage'.
   * Values should sum to 1.0 (100%). If an account has insufficient
   * funds, its shortfall redistributes proportionally to others.
   *
   * Example: { brokerage: 0.5, '401k': 0.3, ira: 0.15, hsa: 0.05 }
   */
  withdrawalSplits: Record<AccountCategory, number>;

  /**
   * Per-account: which tax type to draw from first WITHIN that account.
   * For 401k and IRA, you may have both Traditional and Roth balances.
   * This controls which bucket depletes first within each account.
   *
   * Example: { '401k': 'traditional', ira: 'traditional' }
   *   → Draw Traditional 401k before Roth 401k; Traditional IRA before Roth IRA.
   *   → This lets Roth balances grow tax-free longer.
   *
   * HSA and Brokerage only have one tax type, so they're ignored here.
   */
  withdrawalTaxPreference: Partial<Record<AccountCategory, RoutingTaxType>>;

  /**
   * Distribution tax configuration.
   *
   * When `taxBrackets` are provided, the engine estimates the effective federal
   * income tax rate on traditional withdrawals per year using actual bracket data
   * from the DB (based on the person's filing status). The `taxMultiplier` scales
   * the result for future rate uncertainty (1.0 = current law).
   *
   * If brackets are not provided, `traditionalFallbackRate` is used as a flat haircut.
   *
   * - roth: 0% — applies to QUALIFIED Roth dollars only (contribution basis,
   *   conversion basis, and growth once the owner is 59½+). Growth withdrawn
   *   from a NON-qualified distribution is taxed as ordinary income instead —
   *   see `computeTaxFromSlots`'s `rothTaxableGrowth` parameter and
   *   `roth-distribution-tax.ts` (v0.7.8 Roth-tax-basis follow-up,
   *   DESIGN-DECISION-v0.7.8-roth-tax-basis.md). This rate is NOT a lever
   *   for non-qualified growth — that portion is always ordinary income by
   *   law, computed automatically, never configurable here.
   * - hsa: 0% — qualified HSA withdrawals are tax-free
   * - brokerage: long-term capital gains rate (default 0.15)
   *
   * The 10%/20% early-withdrawal penalty is NOT modeled through these
   * rates — it's a separate cost entirely (see `avoidPenalizedWithdrawals`
   * below and `penaltyCost` on the year output), priced by
   * `early-withdrawal-penalty.ts` and never folded into `taxCost`.
   */
  distributionTaxRates: {
    traditionalFallbackRate: number;
    roth: number;
    hsa: number;
    brokerage: number;
    /** W-4 withholding brackets (from DB, person's filing status), sorted by threshold ascending. */
    taxBrackets?: {
      threshold: number;
      baseWithholding: number;
      rate: number;
    }[];
    /** Multiplier on computed tax (1.0 = current law, 0.8 = 20% lower). Default 1.0. */
    taxMultiplier?: number;
    /**
     * When true (default), the engine increases withdrawals to cover taxes so
     * after-tax proceeds meet expenses. When false, withdrawals equal the raw
     * expense need — tax cost is still calculated and reported but not grossed up.
     */
    grossUpForTaxes?: boolean;
    /**
     * Target marginal tax rate for Roth optimization (e.g. 0.12 = 12% bracket).
     * When set, the engine caps traditional withdrawals at the bracket threshold
     * for this rate, filling remaining need from Roth to minimize the tax bill.
     * Undefined = disabled (no Roth optimization).
     */
    rothBracketTarget?: number;
    /** Enable automatic Roth conversions (Traditional → Roth) to fill target bracket. */
    enableRothConversions?: boolean;
    /** Target marginal rate for Roth conversions (null/undefined = use rothBracketTarget). */
    rothConversionTarget?: number;
    /** DB-loaded LTCG brackets by filing status, from the `ltcg_brackets`
     *  table (v0.7.9 R40 follow-up). Overrides `LTCG_BRACKETS`' hardcoded
     *  defaults in `tax-tables.ts` when present — mirrors how `taxBrackets`
     *  above overrides the ordinary W-4 defaults. Threshold `null` = the top
     *  (Infinity) bracket. Undefined = fall back to the hardcoded table. */
    ltcgBrackets?: Record<string, { threshold: number | null; rate: number }[]>;
    /** Household's annual standard deduction (from `contribution_limits`,
     *  filing-status-keyed), for converting GROSS ordinary income into the
     *  TAXABLE income LTCG brackets are actually denominated in (found
     *  2026-08-30 — `LTCG_BRACKETS`/`ltcgBrackets` use real IRS
     *  taxable-income thresholds, but every LTCG-stacking call site fed
     *  them a gross figure with nothing subtracted, systematically
     *  overstating how much of the 0%/15% room ordinary income had
     *  already consumed and overcharging real LTCG tax as a result).
     *  This same value ALSO feeds `taxBrackets`/`incomeCapForMarginalRate`
     *  above (R56) — but via `toOrdinaryBracketIncome` in
     *  `tax-estimation.ts`, which subtracts only the smaller residual
     *  between this figure and the Pub 15-T table's own embedded offset,
     *  not this full figure directly (that WOULD double-count). Undefined
     *  ⇒ 0 for the LTCG path / gross-unchanged for the ordinary path,
     *  reproducing pre-fix behavior exactly — this is what makes both
     *  fixes additive rather than a forced behavior change for every
     *  caller. */
    standardDeduction?: number;
    /** IRC §63(f)(1) additional standard deduction for taxpayers age 65+,
     *  per qualifying senior, already resolved to the household's filing
     *  status (married-per-spouse vs. unmarried single/HoH) from
     *  `contribution_limits` (`additional_std_deduction_65_{married,unmarried}`).
     *  The decumulation-year handler multiplies this by the number of
     *  household members who are 65+ in that projection year and folds the
     *  result into `standardDeduction` BEFORE the per-year inflation growth,
     *  so it grows on the same `taxDataYear` vintage as the base deduction
     *  (both are CPI-indexed). Undefined ⇒ 0 additional deduction,
     *  reproducing pre-R59 behavior (which understated 0%-LTCG room for the
     *  ~always-65+ decumulation population). The temporary OBBBA senior
     *  deduction (2025–2028, MAGI-phased) is a SEPARATE lever — see the four
     *  `obbbaSenior*` fields below — folded in alongside this one but
     *  resolved differently (needs a MAGI phaseout basis this field doesn't). */
    additionalStdDeduction65PerSenior?: number;
    /** OBBBA temporary senior deduction (One Big Beautiful Bill Act, 2025) —
     *  $6,000/person 65+, tax years 2025–2028 only, from `contribution_limits`
     *  (`obbba_senior_deduction_per_person`). Undefined ⇒ not seeded for this
     *  tax year ⇒ $0, same convention as every other deduction figure here.
     *  See `obbba-senior-deduction.ts`'s docblock for the full mechanism
     *  (folded into `standardDeduction` pre-routing using LAST YEAR's MAGI
     *  as the phaseout basis — same circularity-breaking lag IRMAA's 2-year
     *  lookback already uses). */
    obbbaSeniorDeductionPerPerson?: number;
    /** Filing-status-resolved MAGI phaseout start ($150k MFJ / $75k
     *  Single/HoH/MFS) — from `contribution_limits`
     *  (`obbba_senior_deduction_phaseout_start_{mfj,unmarried}`). */
    obbbaSeniorPhaseoutStart?: number;
    /** OBBBA phaseout rate — 6% of MAGI over the threshold, per the statute.
     *  From `contribution_limits` (`obbba_senior_deduction_phaseout_rate`). */
    obbbaSeniorPhaseoutRate?: number;
    /** Last tax year the OBBBA senior deduction is authorized (2028) — from
     *  `contribution_limits` (`obbba_senior_deduction_sunset_year`), NOT a
     *  hardcoded literal in engine code, so the sunset tracks the seed data
     *  rather than a second, independently-maintained boundary. Undefined ⇒
     *  not seeded ⇒ the deduction computes as $0 for every year (treated as
     *  "doesn't exist," not "no sunset"). */
    obbbaSeniorSunsetYear?: number;
    /** The calendar year `taxBrackets`/`standardDeduction`/`ltcgBrackets`
     *  actually represent (the DB row's own `taxYear`, e.g. the seeded
     *  `tax_brackets.taxYear` — see `build-engine-payload.ts`'s
     *  `latestTaxYear`). NOT the same concept as the projection's own
     *  `yearIndex`/start year — those happen to coincide only because the
     *  plan starts in the same calendar year this tax data was seeded for.
     *  Used to grow these otherwise-flat figures forward for years beyond
     *  this one (found live, 2026-08-31 — every one of these values was
     *  held flat in NOMINAL dollars for the entire projection despite
     *  being legally inflation-indexed in reality, silently overstating
     *  tax burden decades out). Undefined ⇒ no growth applied (treat as
     *  already-current), matching pre-fix behavior for any caller that
     *  doesn't thread this through.
     *
     *  Advisor-caught nuance (2026-08-31): this is sourced from
     *  `tax_brackets`' own `MAX(taxYear)` — `standardDeduction`'s actual
     *  source (`contribution_limits`, queried by `asOfDate`'s calendar
     *  year, `build-engine-payload.ts` ~line 139) is a SEPARATE query with
     *  no enforced alignment to it. They currently share the same vintage
     *  in practice (both 2026-seeded), which is what makes treating them
     *  as one shared anchor safe today — but nothing prevents that from
     *  drifting (e.g. next year's brackets seeded in Oct/Nov before the
     *  matching `contribution_limits` row lands). A drift here doesn't
     *  desync `toOrdinaryBracketIncome`'s residual math (both are still
     *  grown by the identical factor off whichever anchor is used) — it
     *  just makes the growth itself off by however many years the two
     *  vintages have drifted apart. If that ever becomes a real gap,
     *  thread a second, `standardDeduction`-specific vintage year instead
     *  of assuming they match. */
    taxDataYear?: number;
  };

  /** Withdrawal/spending strategy. Defaults to 'fixed'. */
  withdrawalStrategy?: WithdrawalStrategyType;

  /** R55 follow-up (2026-08-30): within `bracket_filling` mode's cost-
   *  ranked tier beyond the Traditional bracket-fill target, which of Roth
   *  basis / brokerage's 0%-LTCG room drains first — see
   *  `RankWithdrawalTiersInput.discretionaryWithdrawalOrder`
   *  (withdrawal-cost-ranking.ts) for the full tradeoff explanation.
   *  Defaults to `"roth_first"`, matching all pre-existing behavior. An
   *  explicit household opt-in, not an automatic optimization — a
   *  brokerage gain still counts toward MAGI for ACA/IRMAA even when taxed
   *  at 0% federally. */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";

  /**
   * Strategy-specific parameters. Keyed by strategy type.
   * Only the active strategy's params are read at runtime.
   * Each value is a record of param name → number | boolean (matching the
   * strategy registry's `paramFields`).
   */
  strategyParams?: Partial<
    Record<WithdrawalStrategyType, Record<string, number | boolean>>
  >;

  /**
   * Whether the engine may EVER draw a dollar that would incur the 10%
   * early-withdrawal penalty — v0.7.8 penalty-hard-exclusion follow-up
   * (DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md § Q4). Default `true`
   * (explicit user decision, 2026-08-26): "default to not taking it if a
   * penalty exists." When on and a household's penalty-free money runs
   * out, the shortfall is left unfunded and surfaced as
   * `penaltyAvoidedShortfall` rather than silently drawing penalized money
   * — see `RouteResult`'s docblock (`withdrawal-routing.ts`). Penalty
   * COST itself (the 10% charged on any penalized dollar actually drawn,
   * e.g. when this is `false`) is NOT gated by this flag — it applies
   * unconditionally, a correctness floor rather than a preference.
   *
   * An earlier `preferPenaltyFreeSources` flag existed alongside this one
   * (intended to control ORDERING among penalty-free money, independent
   * of whether penalty-exposed money was reachable at all) but was never
   * actually wired into routing — deleted 2026-08-27 (advisor review)
   * rather than left as documented-but-dead config. If ordering
   * preferences among penalty-free sources need their own lever in the
   * future, design it fresh rather than resurrecting this name.
   */
  avoidPenalizedWithdrawals?: boolean;

  /**
   * R46: what to do with RMD-forced withdrawal beyond stated spending need,
   * after any QCD (`qcdMaximize`) already reduced the taxable RMD.
   * - "reinvest" (default): excess reinvested into brokerage — matches
   *   every pre-R46 projection (this field defaults to `"reinvest"` when
   *   unset, so an old saved plan is byte-identical).
   * - "spend": excess is NOT reinvested anywhere — recorded as consumed.
   *   A real behavior change: net worth ends up lower than "reinvest",
   *   by design, for any household that picks this.
   */
  rmdExcessHandling?: "reinvest" | "spend";

  /**
   * R46: when true, every year with an active RMD automatically applies
   * the largest Qualified Charitable Distribution the approximation in
   * `qcd.ts` allows (capped by `QCD_ANNUAL_CAP_PER_PERSON` and each
   * person's own IRA-only Traditional balance — NOT full IRS per-account-
   * type RMD accuracy, see `PLAN-rmd-excess-handling.md`). The QCD'd
   * amount satisfies that much of the RMD directly and is excluded from
   * taxable income; it does not fund spending need. Only takes effect
   * when individual accounts are tracked (`hasIndividualAccounts`) — same
   * limitation per-person RMD tracking itself already has, since QCD is
   * inherently a per-person, per-IRA-account concept. Default `false`
   * (no behavior change for a household that never opts in).
   */
  qcdMaximize?: boolean;

  /**
   * R47: proactively size Roth conversions to shrink a FUTURE RMD toward
   * projected spending need, not just fill this year's bracket room
   * opportunistically. Per-person forward projection nets out both
   * growth and estimated future Traditional withdrawal (see
   * `rmd-smoothing.ts` and `PLAN-r47-rmd-aware-roth-smoothing.md`) —
   * never pushes a conversion above the household's own
   * `rothBracketTarget` ceiling. Only takes effect when individual
   * accounts are tracked (`hasIndividualAccounts`) — RMD smoothing is
   * inherently per-person. Default `false` (no behavior change for a
   * household that never opts in).
   */
  rmdSmoothingEnabled?: boolean;

  /**
   * R47: how far smoothing may raise the EFFECTIVE conversion target rate
   * above `rothBracketTarget`/`rothConversionTarget` when it needs more
   * room than those provide — can only RAISE the effective ceiling, never
   * lower a value the household already configured through those other
   * fields. `undefined`/unset resolves to a moderate default (see
   * `override-resolution.ts`) only for households that have opted into
   * `rmdSmoothingEnabled` without setting this — the UI should seed a new
   * household's default from their current `rothBracketTarget` at the
   * point they turn smoothing on, not rely on this fallback silently.
   */
  rmdSmoothingMaxBracketTarget?: number;
};

/**
 * A single year-override entry for the decumulation phase.
 * Same sticky-forward semantics as AccumulationOverride.
 *
 * EXAMPLES:
 *
 * Reduce withdrawal rate at age 75 (year 2062):
 *   { year: 2062, withdrawalRate: 0.035 }
 *   → Drop to 3.5% withdrawal from 2062 onward.
 *
 * Switch to drawing Roth first from 401k at age 80:
 *   { year: 2067, withdrawalTaxPreference: { '401k': 'roth' } }
 *   → Start drawing Roth 401k before Traditional 401k.
 *
 * Cap annual brokerage withdrawals at $50k:
 *   { year: 2060, withdrawalAccountCaps: { brokerage: 50000 } }
 *   → No more than $50k/year from brokerage; excess need from other accounts.
 */
export type DecumulationOverride = {
  year: number;

  /** Withdrawal rate as decimal. See DecumulationDefaults.withdrawalRate. */
  withdrawalRate?: number;

  /** Withdrawal routing mode. See DecumulationDefaults.withdrawalRoutingMode. */
  withdrawalRoutingMode?: RoutingMode;

  /** Account withdrawal priority (waterfall mode). See DecumulationDefaults.withdrawalOrder. */
  withdrawalOrder?: AccountCategory[];

  /** Fixed percentage split (percentage mode). See DecumulationDefaults.withdrawalSplits. */
  withdrawalSplits?: Partial<Record<AccountCategory, number>>;

  /**
   * Per-account tax preference for withdrawals.
   * See DecumulationDefaults.withdrawalTaxPreference.
   */
  withdrawalTaxPreference?: Partial<Record<AccountCategory, RoutingTaxType>>;

  /**
   * Dollar cap on withdrawals per account per year.
   * Limits how much can be drawn from a single account type.
   * Excess withdrawal need shifts to the next account in withdrawalOrder.
   */
  withdrawalAccountCaps?: Partial<Record<AccountCategory, number>>;

  /**
   * Cross-account dollar cap per tax type for withdrawals.
   * Limits total Traditional or Roth withdrawals across all accounts.
   *
   * Example: { traditional: 80000 } → draw no more than $80k/year from
   * Traditional balances (across 401k + IRA), to stay in a lower tax bracket.
   */
  withdrawalTaxTypeCaps?: Partial<Record<RoutingTaxType, number>>;

  /**
   * Override the Roth conversion target bracket for this year onward.
   * Set to 0 to disable Roth conversions from this year.
   * Omit to keep the current target.
   */
  rothConversionTarget?: number;

  /**
   * Override the bracket_filling target marginal rate (see
   * `DistributionTaxRates.rothBracketTarget`) for this year onward.
   * Omit to keep the plan's configured target. Added 2026-08-29 so a
   * multi-year withdrawal-policy search can express "try this bracket
   * target for this candidate" the same way `accumulationOverrides`
   * already lets Coast FIRE express a candidate contribution rate — see
   * `.scratch/docs/plans/PLAN-v0.7.10-multi-year-withdrawal-optimizer.md`.
   */
  rothBracketTarget?: number;

  /**
   * Override R47's RMD-smoothing ceiling (see
   * `DecumulationDefaults.rmdSmoothingMaxBracketTarget`) for this year
   * onward. Omit to keep the plan's configured ceiling. Added 2026-08-29
   * alongside `rothBracketTarget` so a search that varies the bracket
   * target can keep this ceiling consistent with whatever target it's
   * evaluating, instead of scoring a candidate against a stale ceiling
   * seeded from a different value.
   */
  rmdSmoothingMaxBracketTarget?: number;

  /**
   * One-time dollar withdrawals for this year. NOT sticky-forward.
   * Models windfall spending, one-time distributions, etc.
   */
  lumpSums?: LumpSum[];

  /**
   * When true, ALL decumulation fields revert to DecumulationDefaults.
   */
  reset?: boolean;

  /** Optional note explaining why this override exists (shown in UI tooltip). */
  notes?: string;

  /** Override for this year onward. See DecumulationDefaults.avoidPenalizedWithdrawals. */
  avoidPenalizedWithdrawals?: boolean;
};

/**
 * The fully resolved decumulation config for a single year.
 * Computed by the engine after applying all sticky-forward overrides.
 */
export type ResolvedDecumulationConfig = {
  withdrawalRate: number;
  withdrawalRoutingMode: RoutingMode;
  withdrawalOrder: AccountCategory[];
  withdrawalSplits: Record<AccountCategory, number>;
  withdrawalTaxPreference: Record<AccountCategory, RoutingTaxType | null>;
  /** null = no artificial cap on withdrawals from this account. */
  withdrawalAccountCaps: Record<AccountCategory, number | null>;
  /** null = no cross-account tax-type cap on withdrawals. */
  withdrawalTaxTypeCaps: Record<RoutingTaxType, number | null>;
  /** Resolved Roth conversion target marginal rate (sticky-forward from overrides). undefined = use defaults. */
  rothConversionTarget?: number;
  /** Resolved bracket_filling target marginal rate (sticky-forward from
   *  overrides). undefined = use `decumulationDefaults.distributionTaxRates.rothBracketTarget`.
   *  Added 2026-08-29 — see `rothBracketTarget` on `DecumulationOverride`. */
  rothBracketTarget?: number;
  /** Lump sums for this year only (NOT sticky-forward). Empty if none. */
  lumpSums: LumpSum[];
  /** See DecumulationDefaults.avoidPenalizedWithdrawals. Always resolved
   *  (never undefined) — `resolveDecumulationConfig` defaults it to `true`. */
  avoidPenalizedWithdrawals: boolean;
  /** See DecumulationDefaults.rmdExcessHandling. Always resolved (never
   *  undefined) — defaults to `"reinvest"`. */
  rmdExcessHandling: "reinvest" | "spend";
  /** See DecumulationDefaults.qcdMaximize. Always resolved (never
   *  undefined) — defaults to `false`. */
  qcdMaximize: boolean;
  /** See DecumulationDefaults.rmdSmoothingEnabled. Always resolved (never
   *  undefined) — defaults to `false`. */
  rmdSmoothingEnabled: boolean;
  /** See DecumulationDefaults.rmdSmoothingMaxBracketTarget. Always
   *  resolved (never undefined) — defaults to
   *  `RMD_SMOOTHING_MAX_BRACKET_TARGET_FALLBACK`. */
  rmdSmoothingMaxBracketTarget: number;
  /** See DecumulationDefaults.discretionaryWithdrawalOrder. Always
   *  resolved (never undefined) — defaults to `"roth_first"`. */
  discretionaryWithdrawalOrder: "roth_first" | "brokerage_first";
};

/**
 * Per-account contribution spec derived from paycheck/contributions DB data.
 * The engine uses these to project contributions per-account for years 1+,
 * respecting each account's contribution method and IRS limits.
 */
export type ContributionSpec = {
  /** Waterfall category this account maps to. */
  category: AccountCategory;
  /** Human-readable account name (e.g. "401k", "ESPP", "HSA"). */
  name: string;
  /** How contributions are defined. */
  method: "percent_of_salary" | "fixed_per_period" | "fixed_monthly";
  /** The contribution value: percentage (as decimal, e.g. 0.16 = 16%) for
   *  percent_of_salary, or dollar amount per period/month for fixed methods. */
  value: number;
  /** Fraction of total compensation this spec's job represents (0–1).
   *  For percent_of_salary: engine computes `projectedSalary × salaryFraction × value`
   *  so that multi-job households don't inflate per-account contributions.
   *  Defaults to 1.0 for single-job households. */
  salaryFraction: number;
  /** Periods per year (for fixed_per_period). Ignored for other methods. */
  periodsPerYear?: number;
  /** Current-year annual contribution (computed from value + salary/periods). */
  baseAnnual: number;
  /** Tax treatment of employee contributions. */
  taxTreatment: "pre_tax" | "tax_free" | "after_tax" | "hsa";
  /** Person who owns this contribution (for per-person salary tracking). */
  personId?: number | null;
  /** Owner name for matching to individual accounts. */
  ownerName?: string;
  /** Matched individual account display name (data-driven from DB). */
  accountName?: string;
  /** User's self-imposed annual contribution target (null = no cap). */
  targetAnnual?: number | null;
  /** Overflow allocation priority (lower = higher priority, 0 = default). */
  allocationPriority?: number;
  /** Parent category from contribution account config (e.g. "Retirement", "Portfolio"). */
  parentCategory?: string;
  /** Account ownership type (from contribution_accounts). */
  ownership?: "individual" | "joint";
  /** Post-retirement contribution behavior (from performance_accounts). */
  retirementBehavior?:
    | "stops_at_owner_retirement"
    | "stops_when_last_retires"
    | "continues_after_retirement";
  /** How this contribution scales during accumulation (from performance_accounts). */
  contributionScaling?: "scales_with_salary" | "fixed_amount";
};

// --- Engine Output Slots ---

/**
 * Per-account slot showing how contributions were routed for one year.
 * Per-account slot with tax treatment breakdown and cap info.
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

/** A mid-projection contribution profile switch entry.
 *  Contains the contribution structure to swap in at the target year.
 *  Salary overrides from profiles are handled separately via perPersonSalaryOverrides. */
export type ProfileSwitch = {
  year: number;
  contributionSpecs: ContributionSpec[];
  employerMatchRateByCategory: Record<AccountCategory, number>;
  /** Base-year contributions per category. Used for year-0 real-contrib path
   *  and brokerage intentional-contribution detection in all years. */
  baseYearContributions: Record<AccountCategory, number>;
  baseYearEmployerMatch: Record<AccountCategory, number>;
  employerMatchByParentCat?: Map<AccountCategory, Map<string, number>>;
  /** Contribution rate ceiling derived from this profile's total contributions / compensation. */
  contributionRate: number;
};
