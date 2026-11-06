import type { AccountCategory } from "@/lib/config/account-types";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type { LumpSum } from "./year-overrides";
import type { z } from "zod/v4";
import type { decumulationOverrideArraySchema } from "@/lib/pure/engine/types/overrides.schema";
import type { LtcgBracketTable } from "../../../config/tax-tables";
import type { IrmaaBracketTable } from "../../../config/irmaa-tables";
import type { RoutingMode, RoutingTaxType } from "./routing";

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
   *   `roth-distribution-tax.ts`. This rate is NOT a lever
   *   for non-qualified growth — that portion is always ordinary income by
   *   law, computed automatically, never configurable here.
   * - hsa: 0% — an extra rate on top, not the HSA's tax: routing books HSA
   *   draws as Traditional, so they're ordinary income (HSA_DRAW_TREATMENT,
   *   lib/pure/accounts/early-access.ts — projected as non-medical)
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
    /** The year's LTCG brackets by filing status (`ltcg_brackets`).
     *  Threshold `null` = the open top bracket. Required: nothing stands in
     *  for a missing table (the payload throws). */
    ltcgBrackets: LtcgBracketTable;
    /** The year's IRMAA brackets by filing status (`irmaa_brackets`). */
    irmaaBrackets: IrmaaBracketTable;
    /** The coverage year's poverty levels by household size
     *  (`fpl_by_household`). */
    fplByHousehold: Record<number, number>;
    /** The most an IRA owner can give as qualified charitable
     *  distributions in a year, per person (`qcd_annual_limit`, the limits
     *  year's; CPI-indexed, grown from `taxDataYear`). */
    qcdAnnualLimit: number;
    /** Household's annual standard deduction (from `contribution_limits`,
     *  filing-status-keyed), for converting GROSS ordinary income into the
     *  TAXABLE income LTCG brackets are actually denominated in
     *  (`ltcgBrackets` use real IRS
     *  taxable-income thresholds, but every LTCG-stacking call site fed
     *  them a gross figure with nothing subtracted, systematically
     *  overstating how much of the 0%/15% room ordinary income had
     *  already consumed and overcharging real LTCG tax as a result).
     *  This same value ALSO feeds `taxBrackets`/`incomeCapForMarginalRate`
     *  above — but via `toOrdinaryBracketIncome` in
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
     *  reproducing the prior behavior (which understated 0%-LTCG room for the
     *  ~always-65+ decumulation population). The temporary OBBBA senior
     *  deduction (2025–2028, MAGI-phased) is a SEPARATE lever — see the four
     *  `obbbaSenior*` fields below — folded in alongside this one but
     *  resolved differently (needs a MAGI phaseout basis this field doesn't). */
    additionalStdDeduction65PerSenior?: number;
    /** OBBBA temporary senior deduction (One Big Beautiful Bill Act, 2025) —
     *  $6,000/person 65+, tax years 2025–2028 only, from `contribution_limits`
     *  (`obbba_senior_deduction_per_person`). Undefined ⇒ not seeded for this
     *  tax year ⇒ $0, same convention as every other deduction figure here.
     *  See `return-deductions.ts`'s docblock for the full mechanism
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
     *  this one (every one of these values was
     *  held flat in NOMINAL dollars for the entire projection despite
     *  being legally inflation-indexed in reality, silently overstating
     *  tax burden decades out). Undefined ⇒ no growth applied (treat as
     *  already-current), matching pre-fix behavior for any caller that
     *  doesn't thread this through.
     *
     *  This is the standard deduction's (contribution limits') year. Each
     *  other yearly table grows from its own year — `taxBracketsYear`,
     *  `ltcgBracketsYear`, `irmaaBracketsYear`, `fplYear` below — since
     *  the tables can come from different years (a new year's limits
     *  before its withholding tables). Standard deduction and brackets
     *  grown from their own years each estimate year y's real figures, so
     *  `toOrdinaryBracketIncome`'s residual stays correct. */
    taxDataYear?: number;
    /** Year `taxBrackets` came from (database rows); undefined ⇒ `taxDataYear`. */
    taxBracketsYear?: number;
    /** Year `ltcgBrackets` came from; undefined ⇒ `taxDataYear`. */
    ltcgBracketsYear?: number;
    /** Year `irmaaBrackets` came from; undefined ⇒ `taxDataYear`. */
    irmaaBracketsYear?: number;
    /** Coverage year `fplByHousehold` came from; undefined ⇒ `taxDataYear`. */
    fplYear?: number;
    /** `tax_params.version` for `taxDataYear` (the limits year) — a human-legible
     *  "Tax data: 2026, rev N" revision counter. Informational; cache
     *  coherence comes from the resolved values themselves. Undefined for
     *  callers that don't thread it (calculator-level fixtures). */
    taxParamsVersion?: number;
  };

  /** Withdrawal/spending strategy. Defaults to 'fixed'. */
  withdrawalStrategy?: WithdrawalStrategyType;

  /** Within `bracket_filling` mode's cost-
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
   * early-withdrawal penalty. Default `true`
   * ("default to not taking it if a penalty exists"). When on and a
   * household's penalty-free money runs
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
   * actually wired into routing — deleted
   * rather than left as documented-but-dead config. If ordering
   * preferences among penalty-free sources need their own lever in the
   * future, design it fresh rather than resurrecting this name.
   */
  avoidPenalizedWithdrawals?: boolean;

  /**
   * What to do with RMD-forced withdrawal beyond stated spending need,
   * after any QCD (`qcdMaximize`) already reduced the taxable RMD.
   * - "reinvest" (default): excess reinvested into brokerage — matches
   *   prior projections (this field defaults to `"reinvest"` when
   *   unset, so an old saved plan is byte-identical).
   * - "spend": excess is NOT reinvested anywhere — recorded as consumed.
   *   A real behavior change: net worth ends up lower than "reinvest",
   *   by design, for any household that picks this.
   */
  rmdExcessHandling?: "reinvest" | "spend";

  /**
   * When true, every year with an active RMD automatically applies
   * the largest Qualified Charitable Distribution the approximation in
   * `qcd.ts` allows (capped by `distributionTaxRates.qcdAnnualLimit` and each
   * person's own IRA-only Traditional balance — NOT full IRS per-account-
   * type RMD accuracy). The QCD'd
   * amount satisfies that much of the RMD directly and is excluded from
   * taxable income; it does not fund spending need. Only takes effect
   * when individual accounts are tracked (`hasIndividualAccounts`) — same
   * limitation per-person RMD tracking itself already has, since QCD is
   * inherently a per-person, per-IRA-account concept. Default `false`
   * (no behavior change for a household that never opts in).
   */
  qcdMaximize?: boolean;

  /**
   * Proactively size Roth conversions to shrink a FUTURE RMD toward
   * projected spending need, not just fill this year's bracket room
   * opportunistically. Per-person forward projection nets out both
   * growth and estimated future Traditional withdrawal (see
   * `rmd-smoothing.ts`) —
   * never pushes a conversion above the household's own
   * `rothBracketTarget` ceiling. Only takes effect when individual
   * accounts are tracked (`hasIndividualAccounts`) — RMD smoothing is
   * inherently per-person. Default `false` (no behavior change for a
   * household that never opts in).
   */
  rmdSmoothingEnabled?: boolean;

  /**
   * How far smoothing may raise the EFFECTIVE conversion target rate
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

type DecumulationOverrideRow = z.infer<
  typeof decumulationOverrideArraySchema
>[number];
/** The schema's `z.record` over categories demands every key; the engine
 *  fills a missing one, so its type takes a partial record. */
type PerCategoryField =
  "withdrawalSplits" | "withdrawalTaxPreference" | "withdrawalAccountCaps";

/** One year's decumulation override, sticky-forward like
 *  AccumulationOverride; fields in `decumulationOverrideArraySchema`. */
export type DecumulationOverride = Omit<
  DecumulationOverrideRow,
  PerCategoryField
> & {
  [K in PerCategoryField]?: Partial<NonNullable<DecumulationOverrideRow[K]>>;
} & {
  /** Engine-only, so not API-settable. See DecumulationDefaults. */
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
   *  See `rothBracketTarget` on `DecumulationOverride`. */
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
