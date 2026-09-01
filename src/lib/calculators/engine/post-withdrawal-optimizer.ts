/**
 * Post-Withdrawal Optimizer — Roth conversions + IRMAA + ACA checks.
 *
 * Runs after withdrawal routing and RMD enforcement, before growth.
 * These three features share MAGI calculations and form a feedback chain
 * (Roth conversions affect MAGI → IRMAA/ACA cliff checks), so they're
 * co-located in a single module per the refactor plan.
 *
 * Roth conversions: moves Traditional → Roth to fill remaining bracket room.
 *   Tax on the conversion is paid from brokerage (after-tax).
 * IRMAA: checks if MAGI crosses a Medicare surcharge cliff (age 65+).
 * ACA: checks if MAGI crosses the ACA subsidy cliff (pre-65 retirees).
 */
import type { AccountCategory, TaxBuckets, FilingStatusType } from "../types";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  isOverflowTarget,
  getTotalBalance,
  getBasis,
  setTraditional,
  setRoth,
  setBalance,
  setBasis,
  isPortfolioParent,
} from "../../config/account-types";
import type { AccountBalances, IndividualAccountInput } from "../types";
import {
  getIrmaaCost,
  getNextIrmaaCliff,
  type IrmaaBracket,
} from "../../config/irmaa-tables";
import { getAcaSubsidyCliff, acaMagi } from "../../config/aca-tables";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
} from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import type {
  IndKeyFn,
  NonRetirementExclusion,
} from "@/lib/pure/withdrawal-eligibility";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RothConversionInput {
  enableRothConversions: boolean | undefined;
  taxBrackets: WithholdingBracket[] | null | undefined;
  taxMultiplier?: number;
  /** Filing status's standard deduction — Pub 15-T Worksheet 1A residual
   *  (R56), threaded into `incomeCapForMarginalRate`/`estimateEffectiveTaxRate`
   *  so bracket-filling room and conversion tax cost are computed against
   *  the correct base. Undefined keeps pre-R56 (overstating) behavior. */
  standardDeduction?: number;
  rothConversionTarget: number | undefined;
  rothBracketTarget: number | undefined;
  /** Total Traditional withdrawals this year (including RMD). */
  totalTraditionalWithdrawal: number;
  /** Taxable SS for this year. */
  taxableSS: number;
  /** Brokerage capital gains portion (for MAGI computation). */
  brokerageGainsPortion: number;
  /** Cap conversions to stay below next IRMAA cliff (#38). */
  irmaaAwareRothConversions?: boolean;
  /**
   * IRMAA brackets grown to the vintage that actually applies here —
   * NOT the same growth as `checkIrmaa`'s `irmaaBrackets` (below). This
   * cap compares a year-N MAGI against the threshold that will apply
   * TWO YEARS LATER (IRMAA's own 2-year lookback: year-N income sets
   * year-(N+2)'s premium), so the caller must grow this table to year
   * N+2's vintage, not year N's — see `decumulation-year.ts`'s
   * `grownIrmaaBracketsForCap`. Undefined falls back to the hardcoded
   * (ungrown) `IRMAA_BRACKETS` default, same as pre-Phase-3 behavior. */
  irmaaBrackets?: Record<string, IrmaaBracket[]>;
  filingStatus?: FilingStatusType | null;
  /** Current balances (mutated in place). */
  balances: TaxBuckets;
  /** Per-account balances (mutated in place). */
  acctBal: AccountBalances;
  /** Portfolio-parented ("non-retirement") exclusion for this year (R49) —
   *  when supplied, both the conversion SOURCE amount and the tax-payment
   *  capacity gate are capped to Retirement-only money (this half needs
   *  only the pre-aggregated exclusion record, not the raw account list).
   *  When ALSO supplied alongside `indAccts`/`indBal`/`indKey`, the
   *  per-account debit is additionally applied directly to
   *  Retirement-parented accounts' `indBal` instead of being left to
   *  `reconcileIndividualToAggregate`'s parentCategory-blind proportional
   *  redistribution. `decumulation-year.ts`'s real call site always
   *  computes and passes all four together (or none), gated on the same
   *  `hasIndividualAccounts` check — omitting all four ⇒ byte-identical to
   *  pre-R49 aggregate-only behavior, since there's no Portfolio/Retirement
   *  distinction possible without per-account data anyway. See
   *  `.scratch/docs/plans/PLAN-retirement-only-withdrawal-scope.md` § 7. */
  nonRetirement?: NonRetirementExclusion;
  /** Individual accounts, current per-account balances, and the engine's
   *  key function — same triple every other individual-tracking-aware
   *  module in this engine takes. Only used when `nonRetirement` is also
   *  supplied. */
  indAccts?: IndividualAccountInput[];
  indBal?: Map<string, number>;
  indKey?: IndKeyFn;
  /** R47: this year's combined household RMD-smoothing minimum (sum of
   *  every person's own target — see `rmd-smoothing.ts`'s
   *  `computeRmdSmoothingTargets`), 0/undefined when smoothing is off or
   *  has nothing to convert this year. When present and positive, this
   *  function proceeds even if `enableRothConversions` is off (smoothing
   *  is a self-contained toggle), and the effective conversion target
   *  rate may be ELEVATED (never lowered) up to
   *  `rmdSmoothingMaxBracketTarget` if the household's own
   *  `rothBracketTarget`/`rothConversionTarget` doesn't provide enough
   *  room. `rothConversionTarget === 0` (an explicit "never convert"
   *  opt-out) still wins regardless — see
   *  `.scratch/docs/plans/PLAN-r47-rmd-aware-roth-smoothing.md` Part 2. */
  rmdSmoothingTarget?: number;
  /** R47: ceiling on how far smoothing may elevate the effective target
   *  rate — see `rmdSmoothingTarget`'s docblock. Always resolved by the
   *  caller (never undefined when `rmdSmoothingTarget` is supplied) —
   *  `ResolvedDecumulationConfig.rmdSmoothingMaxBracketTarget` is never
   *  itself undefined. */
  rmdSmoothingMaxBracketTarget?: number;
}

export interface RothConversionResult {
  rothConversionAmount: number;
  rothConversionTaxCost: number;
  /** R47: portion of `rmdSmoothingTarget` that did NOT end up converted
   *  this year (0 in the common case) — a real, expected shortfall when
   *  even the elevated ceiling, IRMAA-cliff cap, or available balance
   *  isn't enough to hit the target, not silently dropped. Only ever
   *  set when `rmdSmoothingTarget` was supplied and positive. */
  rmdSmoothingShortfall?: number;
}

export interface IrmaaInput {
  enableIrmaaAwareness: boolean | undefined;
  filingStatus: FilingStatusType | null | undefined;
  /** Whether ANY household member is ≥65. */
  anyPersonAge65: boolean;
  /**
   * MAGI for IRMAA determination. Per IRS rules, year N IRMAA is based on
   * year N-2 MAGI. The orchestrator should pass the 2-year-lookback MAGI
   * when available, or current-year MAGI as a fallback for the first 2 years.
   */
  projectedMagi: number;
  /** Current-year Roth conversion amount (for cliff warning logic). */
  rothConversionAmount: number;
  /**
   * IRMAA brackets grown to year N's vintage (the surcharge SCHEDULE
   * that applies this year, regardless of which year's MAGI it's
   * evaluated against — see `decumulation-year.ts`'s
   * `grownIrmaaBracketsForCheck`). Undefined falls back to the
   * hardcoded (ungrown) `IRMAA_BRACKETS` default, same as pre-Phase-3
   * behavior. NOT the same growth vintage as `RothConversionInput.irmaaBrackets` —
   * see that field's docblock for why the two differ. */
  irmaaBrackets?: Record<string, IrmaaBracket[]>;
}

export interface IrmaaResult {
  irmaaCost: number;
  warnings: string[];
}

export interface AcaInput {
  enableAcaAwareness: boolean | undefined;
  /** Whether ALL household members are <65. */
  allPersonsUnder65: boolean;
  householdSize: number;
  totalTraditionalWithdrawal: number;
  rothConversionAmount: number;
  brokerageGainsPortion: number;
  /** Full gross Social Security benefit (not the 0-85% taxable slice) — ACA
   *  MAGI per 26 U.S.C. §36B(d)(2)(B) requires adding back the entire
   *  benefit, unlike income-tax provisional income or IRMAA MAGI. */
  ssIncome: number;
}

export interface AcaResult {
  acaSubsidyPreserved: boolean;
  acaMagiHeadroom: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Roth Conversions (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Perform Roth conversions: move Traditional → Roth to fill remaining
 * bracket room. Tax on conversion is paid from brokerage.
 *
 * Mutates `balances` and `acctBal` in place.
 */
export function performRothConversion(
  input: RothConversionInput,
): RothConversionResult {
  const {
    enableRothConversions,
    taxBrackets,
    taxMultiplier,
    standardDeduction,
    totalTraditionalWithdrawal,
    taxableSS,
    balances,
    acctBal,
    nonRetirement,
    indAccts,
    indBal,
    indKey,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget,
  } = input;
  const hasIndTracking =
    nonRetirement != null &&
    indAccts != null &&
    indBal != null &&
    indKey != null;
  // Single isOverflowTarget category (brokerage today) — hoisted so both
  // the tax-payment capacity gate and the later per-account debit loop can
  // use it without duplicating the search.
  const overflowCat = getAllCategories().find((c) => isOverflowTarget(c));
  // R47: smoothing is a self-contained reason to proceed -- it must not
  // require the household to separately flip the unrelated
  // enableRothConversions toggle (same "own complete toggle" pattern
  // rmdExcessHandling/qcdMaximize already use). `zero()` below carries
  // rmdSmoothingShortfall on every early-return path when smoothing was
  // active, so a shortfall is never silently dropped just because some
  // OTHER gate (no tax brackets, no Traditional balance, an explicit
  // opt-out) stopped the conversion before smoothing's own logic ran.
  const smoothingActive = (rmdSmoothingTarget ?? 0) > 0;
  const zero = (): RothConversionResult => ({
    rothConversionAmount: 0,
    rothConversionTaxCost: 0,
    ...(smoothingActive ? { rmdSmoothingShortfall: rmdSmoothingTarget } : {}),
  });

  if (
    (!enableRothConversions && !smoothingActive) ||
    !taxBrackets ||
    taxBrackets.length === 0 ||
    balances.preTax <= 0
  ) {
    return zero();
  }

  // Override can disable conversions with target=0 -- an EXPLICIT
  // household opt-out, stronger and more deliberate than the default-off
  // enableRothConversions toggle. Smoothing must not silently override
  // this even when active (R47 Part 2).
  const configTarget = input.rothConversionTarget;
  if (configTarget === 0) {
    return zero();
  }

  // Total taxable income this year (Traditional withdrawals + taxable SS)
  // -- needed before target resolution now, since smoothing's elevated
  // target (if any) is sized against it.
  const yearTaxableIncome = totalTraditionalWithdrawal + taxableSS;

  let conversionTarget = configTarget ?? input.rothBracketTarget;
  if (smoothingActive) {
    // R47 Part 2: find the MINIMUM marginal rate whose cap accommodates
    // this year's income plus the smoothing target, by reusing the
    // already-tested incomeCapForMarginalRate over each bracket's own
    // rate (ascending, ordinary array order) -- not a new reverse
    // bracket-walk, which would carry real off-by-one risk at a value
    // landing exactly on a threshold. The top bracket's cap is always
    // Infinity, so this always finds SOME rate -- "no bracket
    // accommodates it" is not a real failure mode here.
    const neededIncome = yearTaxableIncome + rmdSmoothingTarget!;
    let minimumRateNeeded: number | undefined;
    for (const b of taxBrackets) {
      if (
        incomeCapForMarginalRate(b.rate, taxBrackets, standardDeduction) >=
        neededIncome
      ) {
        minimumRateNeeded = b.rate;
        break;
      }
    }
    if (minimumRateNeeded != null) {
      // Can only RAISE the effective ceiling above whatever the household
      // already configured, never lower it -- a household already above
      // rmdSmoothingMaxBracketTarget keeps their own higher target.
      const effectiveCeiling = Math.max(
        conversionTarget ?? -Infinity,
        rmdSmoothingMaxBracketTarget ?? -Infinity,
      );
      conversionTarget = Math.min(
        Math.max(conversionTarget ?? -Infinity, minimumRateNeeded),
        effectiveCeiling,
      );
    }
  }
  if (conversionTarget == null) {
    return zero();
  }

  const bracketCap = incomeCapForMarginalRate(
    conversionTarget,
    taxBrackets,
    standardDeduction,
  );
  const conversionRoom = roundToCents(
    Math.max(0, bracketCap - yearTaxableIncome),
  );

  if (conversionRoom <= 0) {
    return zero();
  }

  // Cap at available Traditional balance -- Retirement-only when R49
  // exclusion data is available (a Portfolio-parented pretax account isn't
  // retirement money and can't fund a Roth conversion's source amount).
  const retirementOnlyPreTax = nonRetirement
    ? roundToCents(
        balances.preTax -
          getAllCategories().reduce((s, cat) => {
            if (acctBal[cat].structure !== "roth_traditional") return s;
            return s + (nonRetirement.trad[cat] ?? 0);
          }, 0),
      )
    : balances.preTax;
  let conversion = roundToCents(
    Math.min(conversionRoom, Math.max(0, retirementOnlyPreTax)),
  );

  // IRMAA-aware cap (#38): reduce conversion to stay below next IRMAA cliff.
  if (input.irmaaAwareRothConversions && input.filingStatus && conversion > 0) {
    const magiWithoutConversion =
      totalTraditionalWithdrawal + input.brokerageGainsPortion + taxableSS;
    const nextCliff = getNextIrmaaCliff(
      magiWithoutConversion,
      input.filingStatus,
      input.irmaaBrackets,
    );
    if (nextCliff != null) {
      const maxConversionForCliff = roundToCents(
        Math.max(0, nextCliff - magiWithoutConversion),
      );
      if (maxConversionForCliff < conversion) {
        conversion = maxConversionForCliff;
      }
    }
  }

  if (conversion <= 0) {
    return zero();
  }

  // Compute incremental tax cost of the conversion:
  // tax(income + conversion) - tax(income), not effective_rate × conversion.
  const taxWithConversion = roundToCents(
    (yearTaxableIncome + conversion) *
      estimateEffectiveTaxRate(
        yearTaxableIncome + conversion,
        taxBrackets,
        taxMultiplier,
        standardDeduction,
      ),
  );
  const taxWithout = roundToCents(
    yearTaxableIncome > 0
      ? yearTaxableIncome *
          estimateEffectiveTaxRate(
            yearTaxableIncome,
            taxBrackets,
            taxMultiplier,
            standardDeduction,
          )
      : 0,
  );
  const taxCostOfConversion = roundToCents(
    Math.max(0, taxWithConversion - taxWithout),
  );

  // Pay tax from brokerage (after-tax) if available, otherwise skip --
  // Retirement-only capacity when R49 exclusion data is available (a hard
  // "don't even start the conversion" gate, matching this whole feature's
  // hard-exclusion philosophy, not a soft preference).
  const retirementOnlyAfterTax =
    nonRetirement && overflowCat
      ? roundToCents(
          balances.afterTax - (nonRetirement.total[overflowCat] ?? 0),
        )
      : balances.afterTax;
  if (retirementOnlyAfterTax < taxCostOfConversion) {
    // If brokerage can't cover tax, skip conversion (don't sell Traditional to pay tax on itself)
    return zero();
  }

  // Move balance: Traditional → Roth
  balances.preTax = roundToCents(balances.preTax - conversion);
  balances.taxFree = roundToCents(balances.taxFree + conversion);
  // Pay tax from brokerage
  balances.afterTax = roundToCents(balances.afterTax - taxCostOfConversion);
  // Reduce basis proportionally
  if (balances.afterTax > 0 && balances.afterTaxBasis > 0) {
    const basisRatio = Math.min(
      1,
      balances.afterTaxBasis / (balances.afterTax + taxCostOfConversion),
    );
    balances.afterTaxBasis = roundToCents(
      Math.max(0, balances.afterTaxBasis - taxCostOfConversion * basisRatio),
    );
  }

  // Update per-account balances: distribute proportionally across Traditional
  // accounts. R49: the WEIGHT used to size each category's share must also
  // be Retirement-only (`bal.traditional - nonRetirement.trad[cat]`), not
  // the raw blended `bal.traditional` — otherwise a category whose blended
  // balance is inflated by a Portfolio-parented account gets an oversized
  // share of an already-correctly-capped `conversion` total, and the
  // aggregate mutation below (still full-category-sized, by design — both
  // trackers must move together) would disagree with what the individual
  // debit further down can actually place in Retirement-only accounts.
  const tradAccounts: { cat: AccountCategory; balance: number }[] = [];
  for (const cat of getAllCategories()) {
    const bal = acctBal[cat];
    if (bal.structure !== "roth_traditional") continue;
    const weight = nonRetirement
      ? Math.max(0, bal.traditional - (nonRetirement.trad[cat] ?? 0))
      : bal.traditional;
    if (weight > 0) tradAccounts.push({ cat, balance: weight });
  }
  const totalTradBal = tradAccounts.reduce((s, a) => s + a.balance, 0);
  const categoryShare = new Map<AccountCategory, number>();
  if (totalTradBal > 0) {
    let distributed = 0;
    for (const account of tradAccounts) {
      const bal = acctBal[account.cat];
      if (bal.structure !== "roth_traditional") continue;
      const share = roundToCents(conversion * (account.balance / totalTradBal));
      const capped = Math.min(share, bal.traditional);
      setTraditional(bal, roundToCents(bal.traditional - capped));
      setRoth(bal, roundToCents(bal.roth + capped));
      categoryShare.set(
        account.cat,
        (categoryShare.get(account.cat) ?? 0) + capped,
      );
      distributed += capped;
    }
    // Handle rounding remainder
    if (distributed < conversion - 0.01 && tradAccounts.length > 0) {
      const remainder = roundToCents(conversion - distributed);
      const firstAcct = tradAccounts[0]!;
      const firstBal = acctBal[firstAcct.cat];
      if (firstBal.structure === "roth_traditional") {
        const extra = Math.min(remainder, firstBal.traditional);
        setTraditional(firstBal, roundToCents(firstBal.traditional - extra));
        setRoth(firstBal, roundToCents(firstBal.roth + extra));
        categoryShare.set(
          firstAcct.cat,
          (categoryShare.get(firstAcct.cat) ?? 0) + extra,
        );
      }
    }
  }

  // R49: with the category weight above already Retirement-only-scoped,
  // each category's captured `categoryShare` is guaranteed <= what
  // Retirement-parented accounts in it actually hold — so debiting them
  // directly here, instead of leaving it to
  // reconcileIndividualToAggregate's parentCategory-blind proportional
  // redistribution, keeps indBal and acctBal in agreement rather than
  // letting the reconcile pass silently pull the difference from a
  // Portfolio-parented account.
  if (hasIndTracking) {
    for (const [cat, amount] of categoryShare) {
      if (amount <= 0) continue;
      const catAccts = indAccts.filter(
        (ia) => ia.category === cat && !isPortfolioParent(ia.parentCategory),
      );
      const catTotal = catAccts.reduce(
        (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
        0,
      );
      if (catTotal <= 0) continue;
      let acctDistributed = 0;
      for (const ia of catAccts) {
        const k = indKey(ia);
        const bal = Math.max(0, indBal.get(k) ?? 0);
        const share = roundToCents(amount * (bal / catTotal));
        const capped = Math.min(share, bal);
        indBal.set(k, roundToCents(bal - capped));
        acctDistributed += capped;
      }
      const remainder = roundToCents(amount - acctDistributed);
      if (remainder > 0.005 && catAccts.length > 0) {
        const first = catAccts[0]!;
        const k = indKey(first);
        const bal = Math.max(0, indBal.get(k) ?? 0);
        indBal.set(k, roundToCents(Math.max(0, bal - remainder)));
      }
    }
  }

  // Update brokerage per-account balance for tax payment
  for (const cat of getAllCategories()) {
    if (isOverflowTarget(cat)) {
      setBalance(
        acctBal[cat],
        roundToCents(getTotalBalance(acctBal[cat]) - taxCostOfConversion),
      );
      if (acctBal[cat].structure === "basis_tracking") {
        const currentBasis = getBasis(acctBal[cat]);
        const currentBalance = getTotalBalance(acctBal[cat]);
        setBasis(
          acctBal[cat],
          roundToCents(Math.min(currentBasis, currentBalance)),
        );
      }
      // R49: same direct-debit approach as the Traditional→Roth move above
      // — the aggregate mutation stays full-category-sized (unchanged), but
      // when individual tracking is available, distribute the ACTUAL tax
      // payment across Retirement-parented accounts in this category only,
      // proportional to their own balance.
      if (hasIndTracking) {
        const catAccts = indAccts.filter(
          (ia) => ia.category === cat && !isPortfolioParent(ia.parentCategory),
        );
        const catTotal = catAccts.reduce(
          (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
          0,
        );
        if (catTotal > 0) {
          let taxDistributed = 0;
          for (const ia of catAccts) {
            const k = indKey(ia);
            const bal = Math.max(0, indBal.get(k) ?? 0);
            const share = roundToCents(taxCostOfConversion * (bal / catTotal));
            const capped = Math.min(share, bal);
            indBal.set(k, roundToCents(bal - capped));
            taxDistributed += capped;
          }
          const remainder = roundToCents(taxCostOfConversion - taxDistributed);
          if (remainder > 0.005 && catAccts.length > 0) {
            const first = catAccts[0]!;
            const k = indKey(first);
            const bal = Math.max(0, indBal.get(k) ?? 0);
            indBal.set(k, roundToCents(Math.max(0, bal - remainder)));
          }
        }
      }
      break;
    }
  }

  return {
    rothConversionAmount: conversion,
    rothConversionTaxCost: taxCostOfConversion,
    ...(smoothingActive
      ? {
          rmdSmoothingShortfall: roundToCents(
            Math.max(0, rmdSmoothingTarget! - conversion),
          ),
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// IRMAA Awareness (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Check if projected MAGI crosses an IRMAA cliff (Medicare surcharge).
 * Reports cost and warns if Roth conversion pushed MAGI over a cliff.
 */
export function checkIrmaa(input: IrmaaInput): IrmaaResult {
  const {
    enableIrmaaAwareness,
    filingStatus,
    anyPersonAge65,
    projectedMagi,
    rothConversionAmount,
    irmaaBrackets,
  } = input;

  const warnings: string[] = [];

  if (!enableIrmaaAwareness || !filingStatus || !anyPersonAge65) {
    return { irmaaCost: 0, warnings };
  }

  // projectedMagi is the 2-year-lookback MAGI per IRS rules (or current-year fallback).
  const irmaaCost = getIrmaaCost(projectedMagi, filingStatus, irmaaBrackets);

  // If Roth conversion pushed us over a cliff, check if reducing it helps.
  // Note: this warning uses the lookback MAGI which already includes the conversion
  // from 2 years ago. For the first 2 years we use current-year MAGI as fallback,
  // so the warning is still meaningful.
  if (rothConversionAmount > 0 && irmaaCost > 0) {
    const magiWithoutConversion = projectedMagi - rothConversionAmount;
    const irmaaCostWithout = getIrmaaCost(
      magiWithoutConversion,
      filingStatus,
      irmaaBrackets,
    );
    if (irmaaCostWithout < irmaaCost) {
      const nextCliff = getNextIrmaaCliff(
        magiWithoutConversion,
        filingStatus,
        irmaaBrackets,
      );
      if (nextCliff != null) {
        const maxConversionForCliff = Math.max(
          0,
          nextCliff - magiWithoutConversion,
        );
        if (maxConversionForCliff < rothConversionAmount) {
          warnings.push(
            `IRMAA: Roth conversion of $${rothConversionAmount.toFixed(0)} pushes MAGI over $${nextCliff.toLocaleString()} cliff — $${irmaaCost.toLocaleString()}/yr surcharge`,
          );
        }
      }
    }
  }

  return { irmaaCost, warnings };
}

// ---------------------------------------------------------------------------
// ACA Subsidy Awareness (Phase 7)
// ---------------------------------------------------------------------------

/**
 * Check if projected MAGI stays below the ACA subsidy cliff.
 * Reports headroom and warns if cliff is exceeded.
 */
export function checkAca(input: AcaInput): AcaResult {
  const {
    enableAcaAwareness,
    allPersonsUnder65,
    householdSize,
    totalTraditionalWithdrawal,
    rothConversionAmount,
    brokerageGainsPortion,
    ssIncome,
  } = input;

  const warnings: string[] = [];

  if (!enableAcaAwareness || !allPersonsUnder65) {
    return { acaSubsidyPreserved: false, acaMagiHeadroom: 0, warnings };
  }

  const acaCliff = getAcaSubsidyCliff(householdSize);
  const projectedMagi = acaMagi({
    totalTraditionalWithdrawal,
    rothConversionAmount,
    brokerageGainsPortion,
    ssIncome,
  });
  const acaMagiHeadroom = roundToCents(Math.max(0, acaCliff - projectedMagi));
  const acaSubsidyPreserved = projectedMagi < acaCliff;

  if (!acaSubsidyPreserved) {
    const overage = roundToCents(projectedMagi - acaCliff);
    // R55 (advisor review, 2026-08-30): a ranking change to avoid this was
    // considered and rejected — brokerage gains aren't actually "free" MAGI
    // below the cliff either (the subsidy phases out continuously, see
    // estimateAcaSubsidyValue's sliding scale), so preferring brokerage
    // over Roth basis would cost more than it saves. This warning instead
    // reports whether re-sourcing the overage from Roth (which doesn't
    // touch MAGI at all) would have kept the household under the cliff —
    // actionable information without the engine silently re-ordering
    // withdrawals against a value it can't fully price.
    const brokerageCouldCoverOverage = brokerageGainsPortion >= overage;
    const attribution = brokerageCouldCoverOverage
      ? ` — sourcing $${overage.toFixed(0)} less from brokerage (and more from Roth) would keep MAGI under the cliff`
      : "";
    warnings.push(
      `ACA: MAGI $${projectedMagi.toFixed(0)} exceeds $${acaCliff.toLocaleString()} cliff by $${overage.toFixed(0)} — subsidy lost${attribution}`,
    );
  }

  return { acaSubsidyPreserved, acaMagiHeadroom, warnings };
}
