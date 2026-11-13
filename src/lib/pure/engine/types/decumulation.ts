import type { AccountCategory } from "@/lib/config/account-types";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type { LumpSum } from "./year-overrides";
import type { z } from "zod/v4";
import type { decumulationOverrideArraySchema } from "@/lib/pure/engine/types/overrides.schema";
import type { LtcgBracketTable } from "../../../config/tax-tables";
import type { IrmaaBracketTable } from "../../../config/irmaa-tables";
import type { RoutingMode, RoutingTaxType } from "./routing";

/**
 * Page-level decumulation defaults: routing withdrawals out of accounts, with the same
 * sticky-forward per-year overrides as accumulation.
 */
export type DecumulationDefaults = {
  /**
   * Withdrawal rate as decimal (e.g. 0.04 = 4% rule).
   * Applied to total portfolio to determine annual withdrawal target.
   */
  withdrawalRate: number;

  /**
   * 'bracket_filling' (default; Traditional to a target bracket, then Roth, brokerage, HSA; needs
   * taxBrackets, else waterfall), 'waterfall' (withdrawalOrder) or 'percentage' (withdrawalSplits).
   */
  withdrawalRoutingMode: RoutingMode;

  /**
   * Waterfall-mode draw order. Typically brokerage, then Traditional, then Roth last.
   */
  withdrawalOrder: AccountCategory[];

  /**
   * Percentage-mode split summing to 1.0; an account's shortfall redistributes proportionally.
   */
  withdrawalSplits: Record<AccountCategory, number>;

  /**
   * Which tax type drains first within a roth_traditional account (e.g. Traditional before Roth
   * so Roth grows longer). Single-tax-type accounts are ignored.
   */
  withdrawalTaxPreference: Partial<Record<AccountCategory, RoutingTaxType>>;

  /**
   * Distribution tax: `taxBrackets` (× `taxMultiplier`) price Traditional draws, else the flat
   * `traditionalFallbackRate`; `roth` applies to qualified dollars only, `hsa` is an extra rate,
   * `brokerage` the LTCG rate. Early-withdrawal penalties are priced separately, never here.
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
    /** Target marginal rate for Roth optimization (bracket filling, conversions, RMD smoothing). */
    rothBracketTarget?: number;
    /** The Roth bracket overlay: waterfall caps Traditional draws at `rothBracketTarget`'s bracket
     *  and Roth fills the rest. null: a stored row without its switch, read as on and warned. */
    rothBracketOverlay: boolean | null;
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
    /** Annual standard deduction (filing-status-keyed): turns gross ordinary income into the
     *  taxable income LTCG brackets use; the ordinary path subtracts only its Pub 15-T residual
     *  (`toOrdinaryBracketIncome`). Undefined ⇒ 0 / gross unchanged. */
    standardDeduction?: number;
    /** IRC §63(f)(1) additional deduction per 65+ person, filing-status-resolved; the year handler
     *  multiplies it by that year's 65+ count and folds it into `standardDeduction` before growth.
     *  Undefined ⇒ 0. The OBBBA senior deduction is separate (`obbbaSenior*`). */
    additionalStdDeduction65PerSenior?: number;
    /** OBBBA senior deduction ($6,000 per 65+ person, tax years 2025–2028; undefined ⇒ $0).
     *  Folded into `standardDeduction` pre-routing with last year's MAGI as the phaseout basis
     *  (return-deductions.ts). */
    obbbaSeniorDeductionPerPerson?: number;
    /** Filing-status-resolved MAGI phaseout start ($150k MFJ / $75k
     *  Single, HOH; none for MFS) — from `contribution_limits`
     *  (`obbba_senior_deduction_phaseout_start_{mfj,unmarried}`). */
    obbbaSeniorPhaseoutStart?: number;
    /** OBBBA phaseout rate — 6% of MAGI over the threshold, per the statute.
     *  From `contribution_limits` (`obbba_senior_deduction_phaseout_rate`). */
    obbbaSeniorPhaseoutRate?: number;
    /** Last tax year the OBBBA senior deduction applies (2028), from seed data, not a literal.
     *  Undefined ⇒ $0 every year. */
    obbbaSeniorSunsetYear?: number;
    /** Calendar year of the standard deduction (contribution limits), not the projection's
     *  `yearIndex`; undefined ⇒ no growth. Other tables grow from their own years
     *  (`taxBracketsYear`, `ltcgBracketsYear`, `irmaaBracketsYear`, `fplYear`). */
    taxDataYear?: number;
    /** Year `taxBrackets` came from (database rows); undefined ⇒ `taxDataYear`. */
    taxBracketsYear?: number;
    /** Year `ltcgBrackets` came from; undefined ⇒ `taxDataYear`. */
    ltcgBracketsYear?: number;
    /** Year `irmaaBrackets` came from; undefined ⇒ `taxDataYear`. */
    irmaaBracketsYear?: number;
    /** Coverage year `fplByHousehold` came from; undefined ⇒ `taxDataYear`. */
    fplYear?: number;
    /** `tax_params.version` for `taxDataYear`: an informational "rev N" counter. Undefined when
     *  not threaded (fixtures). */
    taxParamsVersion?: number;
  };

  /** Withdrawal/spending strategy. Defaults to 'fixed'. */
  withdrawalStrategy?: WithdrawalStrategyType;

  /** In `bracket_filling`'s cost-ranked tier, whether Roth basis or brokerage 0%-LTCG room drains
   *  first (withdrawal-cost-ranking.ts). Default `"roth_first"`; brokerage gains still count toward
   *  MAGI for ACA/IRMAA. */
  discretionaryWithdrawalOrder?: "roth_first" | "brokerage_first";

  /**
   * Per-strategy params (name → number | boolean, per the registry's `paramFields`); only the
   * active strategy's are read.
   */
  strategyParams?: Partial<
    Record<WithdrawalStrategyType, Record<string, number | boolean>>
  >;

  /**
   * Whether the engine may draw money that incurs the 10% early-withdrawal penalty (default true:
   * avoid it). When avoided, the gap is `penaltyAvoidedShortfall`; the penalty on any penalized
   * dollar drawn always applies.
   */
  avoidPenalizedWithdrawals?: boolean;

  /**
   * RMD money beyond spending need after any QCD: "reinvest" (default) into brokerage, or
   * "spend" (consumed, so net worth ends lower).
   */
  rmdExcessHandling?: "reinvest" | "spend";

  /**
   * In RMD years, apply the largest QCD `qcd.ts` allows (annual limit, each person's IRA
   * Traditional balance); it satisfies RMD, is untaxed and funds no spending. Needs individual
   * accounts. Default `false`.
   */
  qcdMaximize?: boolean;

  /**
   * Size Roth conversions to shrink a future RMD toward projected spending need
   * (`rmd-smoothing.ts`). Needs individual accounts. Default `false`.
   */
  rmdSmoothingEnabled?: boolean;

  /**
   * How far smoothing may raise the effective conversion target rate (never lowers a configured
   * one). Unset falls back to a default in `override-resolution.ts`.
   */
  rmdSmoothingMaxBracketTarget?: number;
};

/** One year's decumulation override, sticky-forward like
 *  AccumulationOverride; fields in `decumulationOverrideArraySchema`. */
export type DecumulationOverride = z.infer<
  typeof decumulationOverrideArraySchema
>[number];

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
  /** Resolved bracket_filling target marginal rate (sticky-forward from overrides). undefined =
   *  use `decumulationDefaults.distributionTaxRates.rothBracketTarget` (see DecumulationOverride). */
  rothBracketTarget?: number;
  /** The Roth bracket overlay, resolved: only `applyRothBracketOverlay` reads it. */
  rothBracketOverlay: boolean;
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
  /** See DecumulationDefaults.rmdSmoothingMaxBracketTarget. Always resolved
   *  (never undefined) — defaults to `RMD_SMOOTHING_MAX_BRACKET_TARGET_FALLBACK`. */
  rmdSmoothingMaxBracketTarget: number;
  /** See DecumulationDefaults.discretionaryWithdrawalOrder. Always
   *  resolved (never undefined) — defaults to `"roth_first"`. */
  discretionaryWithdrawalOrder: "roth_first" | "brokerage_first";
};
