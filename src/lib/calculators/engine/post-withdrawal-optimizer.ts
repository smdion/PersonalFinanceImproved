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
} from "../../config/account-types";
import type { AccountBalances } from "../types";
import { getIrmaaCost, getNextIrmaaCliff } from "../../config/irmaa-tables";
import { getAcaSubsidyCliff } from "../../config/aca-tables";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
} from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RothConversionInput {
  enableRothConversions: boolean | undefined;
  taxBrackets: WithholdingBracket[] | null | undefined;
  taxMultiplier?: number;
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
  filingStatus?: FilingStatusType | null;
  /** Current balances (mutated in place). */
  balances: TaxBuckets;
  /** Per-account balances (mutated in place). */
  acctBal: AccountBalances;
}

export interface RothConversionResult {
  rothConversionAmount: number;
  rothConversionTaxCost: number;
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
  taxableSS: number;
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
    totalTraditionalWithdrawal,
    taxableSS,
    balances,
    acctBal,
  } = input;

  if (
    !enableRothConversions ||
    !taxBrackets ||
    taxBrackets.length === 0 ||
    balances.preTax <= 0
  ) {
    return { rothConversionAmount: 0, rothConversionTaxCost: 0 };
  }

  // Override can disable conversions with target=0
  const configTarget = input.rothConversionTarget;
  if (configTarget === 0) {
    return { rothConversionAmount: 0, rothConversionTaxCost: 0 };
  }

  const conversionTarget = configTarget ?? input.rothBracketTarget;
  if (conversionTarget == null) {
    return { rothConversionAmount: 0, rothConversionTaxCost: 0 };
  }

  const bracketCap = incomeCapForMarginalRate(conversionTarget, taxBrackets);
  // Total taxable income this year (Traditional withdrawals + taxable SS)
  const yearTaxableIncome = totalTraditionalWithdrawal + taxableSS;
  const conversionRoom = roundToCents(
    Math.max(0, bracketCap - yearTaxableIncome),
  );

  if (conversionRoom <= 0) {
    return { rothConversionAmount: 0, rothConversionTaxCost: 0 };
  }

  // Cap at available Traditional balance
  let conversion = roundToCents(Math.min(conversionRoom, balances.preTax));

  // IRMAA-aware cap (#38): reduce conversion to stay below next IRMAA cliff.
  if (input.irmaaAwareRothConversions && input.filingStatus && conversion > 0) {
    const magiWithoutConversion =
      totalTraditionalWithdrawal + input.brokerageGainsPortion + taxableSS;
    const nextCliff = getNextIrmaaCliff(
      magiWithoutConversion,
      input.filingStatus,
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
    return { rothConversionAmount: 0, rothConversionTaxCost: 0 };
  }

  // Compute incremental tax cost of the conversion:
  // tax(income + conversion) - tax(income), not effective_rate × conversion.
  const taxWithConversion = roundToCents(
    (yearTaxableIncome + conversion) *
      estimateEffectiveTaxRate(
        yearTaxableIncome + conversion,
        taxBrackets,
        taxMultiplier,
      ),
  );
  const taxWithout = roundToCents(
    yearTaxableIncome > 0
      ? yearTaxableIncome *
          estimateEffectiveTaxRate(
            yearTaxableIncome,
            taxBrackets,
            taxMultiplier,
          )
      : 0,
  );
  const taxCostOfConversion = roundToCents(
    Math.max(0, taxWithConversion - taxWithout),
  );

  // Pay tax from brokerage (after-tax) if available, otherwise skip
  if (balances.afterTax < taxCostOfConversion) {
    // If brokerage can't cover tax, skip conversion (don't sell Traditional to pay tax on itself)
    return { rothConversionAmount: 0, rothConversionTaxCost: 0 };
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

  // Update per-account balances: distribute proportionally across Traditional accounts
  const tradAccounts: { cat: AccountCategory; balance: number }[] = [];
  for (const cat of getAllCategories()) {
    const bal = acctBal[cat];
    if (bal.structure === "roth_traditional" && bal.traditional > 0) {
      tradAccounts.push({ cat, balance: bal.traditional });
    }
  }
  const totalTradBal = tradAccounts.reduce((s, a) => s + a.balance, 0);
  if (totalTradBal > 0) {
    let distributed = 0;
    for (const acct of tradAccounts) {
      const bal = acctBal[acct.cat];
      if (bal.structure !== "roth_traditional") continue;
      const share = roundToCents(conversion * (acct.balance / totalTradBal));
      const capped = Math.min(share, acct.balance);
      setTraditional(bal, roundToCents(bal.traditional - capped));
      setRoth(bal, roundToCents(bal.roth + capped));
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
      break;
    }
  }

  return {
    rothConversionAmount: conversion,
    rothConversionTaxCost: taxCostOfConversion,
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
  } = input;

  const warnings: string[] = [];

  if (!enableIrmaaAwareness || !filingStatus || !anyPersonAge65) {
    return { irmaaCost: 0, warnings };
  }

  // projectedMagi is the 2-year-lookback MAGI per IRS rules (or current-year fallback).
  const irmaaCost = getIrmaaCost(projectedMagi, filingStatus);

  // If Roth conversion pushed us over a cliff, check if reducing it helps.
  // Note: this warning uses the lookback MAGI which already includes the conversion
  // from 2 years ago. For the first 2 years we use current-year MAGI as fallback,
  // so the warning is still meaningful.
  if (rothConversionAmount > 0 && irmaaCost > 0) {
    const magiWithoutConversion = projectedMagi - rothConversionAmount;
    const irmaaCostWithout = getIrmaaCost(magiWithoutConversion, filingStatus);
    if (irmaaCostWithout < irmaaCost) {
      const nextCliff = getNextIrmaaCliff(magiWithoutConversion, filingStatus);
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
    taxableSS,
  } = input;

  const warnings: string[] = [];

  if (!enableAcaAwareness || !allPersonsUnder65) {
    return { acaSubsidyPreserved: false, acaMagiHeadroom: 0, warnings };
  }

  const acaCliff = getAcaSubsidyCliff(householdSize);
  // Use taxableSS (0–85% per IRS) for MAGI, not flat 50%.
  const projectedMagi =
    totalTraditionalWithdrawal +
    rothConversionAmount +
    brokerageGainsPortion +
    taxableSS;
  const acaMagiHeadroom = roundToCents(Math.max(0, acaCliff - projectedMagi));
  const acaSubsidyPreserved = projectedMagi < acaCliff;

  if (!acaSubsidyPreserved) {
    warnings.push(
      `ACA: MAGI $${projectedMagi.toFixed(0)} exceeds $${acaCliff.toLocaleString()} cliff — subsidy lost`,
    );
  }

  return { acaSubsidyPreserved, acaMagiHeadroom, warnings };
}
