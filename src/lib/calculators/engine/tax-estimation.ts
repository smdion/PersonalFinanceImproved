/**
 * Tax Estimation — tax bracket estimation, SS taxation, and gross-up convergence.
 *
 * Contains:
 *   - estimateEffectiveTaxRate: W-4 bracket-based effective tax rate
 *   - incomeCapForMarginalRate: bracket threshold lookup for bracket-filling
 *   - computeTaxableSS: IRS provisional income formula (3-tier)
 *   - estimateWithdrawalTaxCost: SS convergence loop + gross-up factor
 *
 * Used by the orchestrator (convergence loop) and withdrawal-routing
 * (bracket-filling needs incomeCapForMarginalRate).
 */
import type {
  ResolvedDecumulationConfig,
  AccountBalances,
  TaxBuckets,
  FilingStatusType,
} from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  getAccountTypeConfig,
  isOverflowTarget,
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
} from "../../config/account-types";
import { getLtcgRate, computeLtcgTax } from "../../config/tax-tables";
import { MAX_EFFECTIVE_TAX_RATE } from "../../constants";

// ---------------------------------------------------------------------------
// Tax bracket estimator — computes effective tax rate on traditional withdrawals
// ---------------------------------------------------------------------------

export type WithholdingBracket = {
  threshold: number;
  baseWithholding: number;
  rate: number;
};

/**
 * Estimate effective federal income tax rate on traditional retirement withdrawals.
 * Uses W-4 withholding brackets (which embed the standard deduction in the 0% bracket).
 *
 * @param taxableIncome - Total taxable income (traditional withdrawals + taxable SS)
 * @param brackets - W-4 withholding brackets (from tax_brackets table), sorted by threshold ascending
 * @param taxMultiplier - Scales the computed tax (1.0 = current law, 1.2 = 20% higher, etc.)
 * @returns Effective tax rate as decimal (e.g. 0.14 = 14%)
 */
export function estimateEffectiveTaxRate(
  taxableIncome: number,
  brackets: WithholdingBracket[],
  taxMultiplier: number = 1.0,
): number {
  if (taxableIncome <= 0 || brackets.length === 0) return 0;

  // Find the applicable bracket
  let tax = 0;
  for (let i = brackets.length - 1; i >= 0; i--) {
    const b = brackets[i]!;
    if (taxableIncome >= b.threshold) {
      tax = b.baseWithholding + (taxableIncome - b.threshold) * b.rate;
      break;
    }
  }

  tax *= taxMultiplier;
  return Math.min(tax / taxableIncome, MAX_EFFECTIVE_TAX_RATE); // cap sanity check
}

/**
 * Find the maximum taxable income that stays within a target marginal rate.
 * Returns the threshold of the first bracket whose rate exceeds the target.
 * If no bracket exceeds the target, returns Infinity (no cap needed).
 */
export function incomeCapForMarginalRate(
  targetRate: number,
  brackets: WithholdingBracket[],
): number {
  for (const b of brackets) {
    if (b.rate > targetRate) return b.threshold;
  }
  return Infinity;
}

// ---------------------------------------------------------------------------
// Social Security taxation — IRS provisional income formula (Phase 2)
// ---------------------------------------------------------------------------

/** SS taxation thresholds by filing status (unchanged since 1993). */
const SS_TAX_THRESHOLDS: Record<string, { tier1: number; tier2: number }> = {
  MFJ: { tier1: 32000, tier2: 44000 },
  Single: { tier1: 25000, tier2: 34000 },
  HOH: { tier1: 25000, tier2: 34000 }, // Same as Single
};

/**
 * Compute the taxable portion of Social Security income using the IRS
 * 3-tier provisional income formula.
 *
 * Provisional income = other taxable income + 0.5 × SS income + tax-exempt interest
 *
 * - Below tier 1: 0% taxable
 * - Tier 1 → tier 2: up to 50% taxable
 * - Above tier 2: up to 85% taxable
 *
 * The "tax torpedo" zone between tiers creates effective marginal rates of 40-46%.
 */
export function computeTaxableSS(
  ssIncome: number,
  otherTaxableIncome: number,
  filingStatus: FilingStatusType,
  taxExemptInterest: number = 0,
): number {
  if (ssIncome <= 0) return 0;

  const thresholds = SS_TAX_THRESHOLDS[filingStatus];
  if (!thresholds) return ssIncome * 0.85; // fallback

  // IRS Pub 915: provisional income includes tax-exempt interest (e.g. municipal bonds)
  const provisionalIncome =
    otherTaxableIncome + 0.5 * ssIncome + taxExemptInterest;

  if (provisionalIncome <= thresholds.tier1) {
    return 0;
  }

  // Tier 1 → Tier 2: up to 50% of SS is taxable
  const tier1Excess = Math.min(
    provisionalIncome - thresholds.tier1,
    thresholds.tier2 - thresholds.tier1,
  );
  let taxable = Math.min(0.5 * tier1Excess, 0.5 * ssIncome);

  // Above tier 2: up to 85% of SS is taxable
  if (provisionalIncome > thresholds.tier2) {
    const tier2Excess = provisionalIncome - thresholds.tier2;
    taxable = Math.min(taxable + 0.85 * tier2Excess, 0.85 * ssIncome);
  }

  return roundToCents(Math.max(0, taxable));
}

// ---------------------------------------------------------------------------
// SS convergence loop + gross-up estimation
// ---------------------------------------------------------------------------

/** Input for the convergence estimation. */
export interface TaxEstimationInput {
  /** After-tax spending need (expenses - SS income) */
  afterTaxNeed: number;
  /** Social Security income for this year */
  ssIncome: number;
  /** Filing status for SS taxation thresholds */
  filingStatus: FilingStatusType | null | undefined;
  /** Resolved decumulation config for this year */
  config: ResolvedDecumulationConfig;
  /** Tax rate configuration from decumulation defaults */
  taxRates: {
    grossUpForTaxes?: boolean;
    traditionalFallbackRate: number;
    roth: number;
    hsa: number;
    brokerage: number;
    taxBrackets?: WithholdingBracket[];
    rothBracketTarget?: number;
    taxMultiplier?: number;
  };
  /** Current balances by tax bucket */
  balances: TaxBuckets;
  /** Current per-account balances */
  acctBal: AccountBalances;
  /** Total portfolio balance */
  totalBalance: number;
  /** Traditional portion of total balance */
  estTraditionalPortion: number;
}

/** Output from the convergence estimation. */
export interface TaxEstimationResult {
  /** Final taxable Social Security amount */
  taxableSS: number;
  /** Estimated tax cost */
  estTax: number;
  /** Effective tax rate */
  effectiveTaxRate: number;
  /** Gross-up factor (1 / (1 - effectiveTaxRate)) */
  grossUpFactor: number;
  /** Grossed-up withdrawal need */
  grossedUpNeed: number;
  /** Target withdrawal (capped at total balance) */
  targetWithdrawal: number;
}

/**
 * Run the SS convergence loop to estimate tax cost and compute gross-up factor.
 *
 * The convergence loop resolves the circular dependency:
 *   taxableSS depends on Traditional estimate → which depends on bracket cap →
 *   which depends on taxableSS.
 *
 * First pass uses flat 85% SS taxation, second pass uses accurate IRS formula
 * seeded by the first pass's Traditional estimate.
 */
export function estimateWithdrawalTaxCost(
  input: TaxEstimationInput,
): TaxEstimationResult {
  const {
    afterTaxNeed,
    ssIncome,
    filingStatus,
    config,
    taxRates,
    balances,
    acctBal,
    totalBalance,
    estTraditionalPortion,
  } = input;

  let taxableSS = ssIncome * 0.85; // initial flat estimate
  let estTax = 0;
  const ssIterations = filingStatus && ssIncome > 0 ? 2 : 1;

  for (let ssIter = 0; ssIter < ssIterations; ssIter++) {
    estTax = 0;
    let iterEstTradTotal = 0; // track Traditional estimate for SS convergence
    // LTCG rate: use graduated brackets when filingStatus available, else flat rate
    const estLtcgRate = filingStatus
      ? getLtcgRate(
          taxableSS + afterTaxNeed * estTraditionalPortion,
          filingStatus,
        )
      : taxRates.brokerage;

    if (config.withdrawalRoutingMode === "bracket_filling") {
      // Simulate bracket-filling 4-phase order to estimate tax on afterTaxNeed.
      // Order: traditional (taxed at bracket rate) → Roth (0%) → brokerage (LTCG on gains) → HSA (0%)
      // Uses per-account balances (acctBal) for consistency with real routing (#44).
      // Respects withdrawalTaxTypeCaps (#43).
      let estRemaining = afterTaxNeed;
      const tradTypeCap = config.withdrawalTaxTypeCaps.traditional;

      // Phase 1: Traditional — capped by bracket target, balance, AND tax-type cap
      const totalTradBal = getAllCategories().reduce(
        (s, cat) => s + getTraditionalBalance(acctBal[cat]),
        0,
      );
      if (totalTradBal > 0 && estRemaining > 0) {
        let tradCap = totalTradBal;
        if (
          taxRates.taxBrackets &&
          taxRates.taxBrackets.length > 0 &&
          taxRates.rothBracketTarget != null
        ) {
          const incomeCap = incomeCapForMarginalRate(
            taxRates.rothBracketTarget,
            taxRates.taxBrackets,
          );
          tradCap = Math.min(tradCap, Math.max(0, incomeCap - taxableSS));
        }
        // Respect cross-account traditional withdrawal cap
        if (tradTypeCap !== null) tradCap = Math.min(tradCap, tradTypeCap);
        const estTradWithdrawal = Math.min(estRemaining, tradCap);
        iterEstTradTotal = estTradWithdrawal;
        const estTaxableIncome = estTradWithdrawal + taxableSS;
        const traditionalRate =
          taxRates.taxBrackets && taxRates.taxBrackets.length > 0
            ? estimateEffectiveTaxRate(
                estTaxableIncome,
                taxRates.taxBrackets,
                taxRates.taxMultiplier,
              )
            : taxRates.traditionalFallbackRate;
        estTax += estTradWithdrawal * traditionalRate;
        estRemaining -= estTradWithdrawal;
      }
      // Phase 2: Roth — 0% tax
      const totalRothBal = getAllCategories().reduce(
        (s, cat) => s + getRothBalance(acctBal[cat]),
        0,
      );
      if (totalRothBal > 0 && estRemaining > 0) {
        let rothDraw = Math.min(estRemaining, totalRothBal);
        const rothTypeCap = config.withdrawalTaxTypeCaps.roth;
        if (rothTypeCap !== null) rothDraw = Math.min(rothDraw, rothTypeCap);
        estRemaining -= rothDraw;
      }
      // Phase 3: Brokerage — LTCG on gains only (progressive stacking)
      if (balances.afterTax > 0 && estRemaining > 0) {
        const brokDraw = Math.min(estRemaining, balances.afterTax);
        const basisRatio =
          balances.afterTaxBasis > 0
            ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
            : 0;
        const estGains = brokDraw * (1 - basisRatio);
        const estOrdinary = iterEstTradTotal + taxableSS;
        estTax += filingStatus
          ? computeLtcgTax(estOrdinary, estGains, filingStatus)
          : estGains * estLtcgRate;
        estRemaining -= brokDraw;
      }
      // Phase 4: HSA — 0% tax (qualified medical)
      // (no tax to add)
    } else if (config.withdrawalRoutingMode === "waterfall") {
      // Simulate waterfall in the actual configured withdrawal order.
      // Respects withdrawalAccountCaps and withdrawalTaxTypeCaps (#43).
      let estRemaining = afterTaxNeed;
      let estTotalTradWithdrawn = 0;
      let estTotalRothWithdrawn = 0;
      for (const category of config.withdrawalOrder) {
        if (estRemaining <= 0) break;
        const accountCap = config.withdrawalAccountCaps[category];
        const maxFromAccount =
          accountCap !== null
            ? Math.min(estRemaining, accountCap)
            : estRemaining;
        const bs = getAccountTypeConfig(category).balanceStructure;
        if (bs === "single_bucket") {
          // HSA — 0% tax (qualified medical), just reduce remaining
          const draw = Math.min(
            maxFromAccount,
            getTotalBalance(acctBal[category]),
          );
          estRemaining -= draw;
        } else if (isOverflowTarget(category)) {
          // Brokerage — LTCG on gains only (progressive stacking)
          const available = getTotalBalance(acctBal[category]);
          const draw = Math.min(maxFromAccount, available);
          const basisRatio =
            balances.afterTax > 0 && balances.afterTaxBasis > 0
              ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
              : 0;
          const estGains = draw * (1 - basisRatio);
          const estOrdinary = iterEstTradTotal + taxableSS;
          estTax += filingStatus
            ? computeLtcgTax(estOrdinary, estGains, filingStatus)
            : estGains * estLtcgRate;
          estRemaining -= draw;
        } else {
          // Roth/traditional split account
          const tradBal = getTraditionalBalance(acctBal[category]);
          const rothBal = getRothBalance(acctBal[category]);
          const available = tradBal + rothBal;
          const canDraw = Math.min(maxFromAccount, available);
          const taxPref = config.withdrawalTaxPreference[category];
          let tradDraw: number;
          let rothDraw: number;
          if (taxPref === "traditional" || taxPref === null) {
            tradDraw = Math.min(canDraw, tradBal);
            rothDraw = Math.min(canDraw - tradDraw, rothBal);
          } else {
            rothDraw = Math.min(canDraw, rothBal);
            tradDraw = Math.min(canDraw - rothDraw, tradBal);
          }
          // Respect cross-account tax-type caps
          const tradTypeCap = config.withdrawalTaxTypeCaps.traditional;
          if (
            tradTypeCap !== null &&
            estTotalTradWithdrawn + tradDraw > tradTypeCap
          ) {
            tradDraw = Math.max(0, tradTypeCap - estTotalTradWithdrawn);
          }
          const rothTypeCap = config.withdrawalTaxTypeCaps.roth;
          if (
            rothTypeCap !== null &&
            estTotalRothWithdrawn + rothDraw > rothTypeCap
          ) {
            rothDraw = Math.max(0, rothTypeCap - estTotalRothWithdrawn);
          }
          estTotalTradWithdrawn += tradDraw;
          estTotalRothWithdrawn += rothDraw;
          if (tradDraw > 0) {
            iterEstTradTotal += tradDraw;
            const estTaxableIncome = iterEstTradTotal + taxableSS;
            const traditionalRate =
              taxRates.taxBrackets && taxRates.taxBrackets.length > 0
                ? estimateEffectiveTaxRate(
                    estTaxableIncome,
                    taxRates.taxBrackets,
                    taxRates.taxMultiplier,
                  )
                : taxRates.traditionalFallbackRate;
            estTax += tradDraw * traditionalRate;
          }
          estRemaining -= tradDraw + rothDraw;
        }
      }
    } else {
      // Percentage or other mode: fall back to portfolio-weight estimation
      const estTradWithdrawal = afterTaxNeed * estTraditionalPortion;
      iterEstTradTotal = estTradWithdrawal;
      const estTaxableIncome = estTradWithdrawal + taxableSS;
      const traditionalRate =
        taxRates.taxBrackets && taxRates.taxBrackets.length > 0
          ? estimateEffectiveTaxRate(
              estTaxableIncome,
              taxRates.taxBrackets,
              taxRates.taxMultiplier,
            )
          : taxRates.traditionalFallbackRate;
      const basisRatio =
        balances.afterTax > 0 && balances.afterTaxBasis > 0
          ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
          : 0;
      if (totalBalance > 0) {
        const estBrokWithdrawal =
          afterTaxNeed * (balances.afterTax / totalBalance);
        const estBrokGains = estBrokWithdrawal * (1 - basisRatio);
        const estBrokTax = filingStatus
          ? computeLtcgTax(estTaxableIncome, estBrokGains, filingStatus)
          : estBrokGains * estLtcgRate;
        estTax =
          afterTaxNeed *
            (estTraditionalPortion * traditionalRate +
              (balances.taxFree / totalBalance) * taxRates.roth +
              (balances.hsa / totalBalance) * taxRates.hsa) +
          estBrokTax;
      } else {
        estTax = 0;
      }
    }

    // After first iteration, recompute taxableSS using accurate IRS formula
    // seeded by the estimated Traditional withdrawal from this pass.
    if (ssIter === 0 && filingStatus && ssIncome > 0) {
      taxableSS = computeTaxableSS(ssIncome, iterEstTradTotal, filingStatus);
    }
  }

  const shouldGrossUp = taxRates.grossUpForTaxes !== false;
  const effectiveTaxRate =
    afterTaxNeed > 0 ? estTax / (afterTaxNeed + estTax) : 0;
  const grossUpFactor =
    shouldGrossUp && effectiveTaxRate < 1 ? 1 / (1 - effectiveTaxRate) : 1;
  const grossedUpNeed = roundToCents(afterTaxNeed * grossUpFactor);
  // Withdraw what's needed to cover expenses (grossed up for taxes).
  // Cap at total portfolio balance — can't withdraw more than you have.
  const targetWithdrawal = roundToCents(Math.min(grossedUpNeed, totalBalance));

  return {
    taxableSS,
    estTax,
    effectiveTaxRate,
    grossUpFactor,
    grossedUpNeed,
    targetWithdrawal,
  };
}
