/**
 * Roth conversions fill remaining bracket room, tax paid from brokerage. Runs after routing and
 * RMD enforcement, before growth; the conversion feeds the MAGI the IRMAA and ACA checks read.
 */
import type {
  TaxBuckets,
  AccountBalances,
} from "../accounts/account-balances.types";
import { roundToCents, safeDivide } from "../../utils/math";
import { getAllCategories, isOverflowTarget } from "../../config/account-types";
import {
  getTotalBalance,
  getBasis,
  setBalance,
  setBasis,
} from "../accounts/account-balance";
import { convertAcrossCategories } from "./conversion-categories";
import type { IrmaaBracket } from "../../config/irmaa-tables";
import { irmaaConversionHeadroom } from "./conversion-irmaa-cap";
import { basisOut } from "./brokerage-basis";
import {
  debitConvertedParts,
  payConversionTaxFromParts,
  type ConversionParts,
} from "./individual-accounts/conversion";
import type { WithholdingBracket } from "./tax-estimation";
import { conversionRoomFor } from "./conversion-room";
import { conversionTaxPaid } from "./conversion-tax";
import type { NonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export interface RothConversionInput {
  enableRothConversions: boolean | undefined;
  taxBrackets: WithholdingBracket[] | null | undefined;
  taxMultiplier?: number;
  /** Standard deduction (Pub 15-T Worksheet 1A residual) for bracket room and conversion tax;
   *  undefined omits it, overstating income. */
  standardDeduction?: number;
  rothConversionTarget: number | undefined;
  rothBracketTarget: number | undefined;
  /** Total Traditional withdrawals this year (including RMD). */
  totalTraditionalWithdrawal: number;
  /** Taxable SS for this year. */
  taxableSS: number;
  /** Brokerage capital gains portion (for MAGI computation). */
  brokerageGainsPortion: number;
  /** Non-qualified Roth growth income (taxFromSlots.rothTaxableGrowth): ordinary income, counted
   *  in this year's taxable income and MAGI before sizing the conversion. */
  rothTaxableGrowth: number;
  /** Cap conversions to stay below next IRMAA cliff. */
  irmaaAwareRothConversions?: boolean;
  /** IRMAA brackets grown to year N+2's vintage (year-N MAGI sets year N+2's premium), unlike
   *  `checkIrmaa`'s; see `decumulation-year.ts` `grownIrmaaBracketsForCap`. */
  irmaaBrackets: Record<string, IrmaaBracket[]>;
  filingStatus?: ReturnFilingStatus | null;
  /** Current balances (mutated in place). */
  balances: TaxBuckets;
  /** Per-account balances (mutated in place). */
  accountBalance: AccountBalances;
  /** Portfolio-parented exclusion: caps the conversion source and tax-payment capacity to
   *  Retirement money. With `parts` too, the debit goes straight to Retirement-parented
   *  accounts. The caller passes both or neither. */
  nonRetirement?: NonRetirementExclusion;
  /** The account parts, their balances and basis; used only with `nonRetirement`. */
  parts?: ConversionParts;
  /** This year's household RMD-smoothing minimum (`computeRmdSmoothingTargets`). When positive it
   *  runs even with `enableRothConversions` off and may raise the target rate up to
   *  `rmdSmoothingMaxBracketTarget`; `rothConversionTarget === 0` still wins. */
  rmdSmoothingTarget?: number;
  /** Ceiling smoothing may raise the target rate to; always resolved when `rmdSmoothingTarget`
   *  is supplied. */
  rmdSmoothingMaxBracketTarget?: number;
}

interface RothConversionResult {
  rothConversionAmount: number;
  rothConversionTaxCost: number;
  /** Part of a positive `rmdSmoothingTarget` not converted this year (ceiling, IRMAA cap or
   *  balance ran out). Set only when a target was supplied. */
  rmdSmoothingShortfall?: number;
  /** True when the `irmaaAwareRothConversions` clamp reduced this year's conversion; absent
   *  otherwise. Reporting only, no numeric effect. */
  rothConversionIrmaaCapped?: boolean;
}

/**
 * Perform Roth conversions: move Traditional → Roth to fill remaining
 * bracket room. Tax on conversion is paid from brokerage.
 *
 * Mutates `balances` and `accountBalance` in place.
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
    rothTaxableGrowth,
    balances,
    accountBalance,
    nonRetirement,
    parts,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget,
  } = input;
  const hasIndTracking = nonRetirement != null && parts != null;
  // The isOverflowTarget category (brokerage today), found once for the
  // tax-payment capacity gate and the per-account debit loop.
  const overflowCat = getAllCategories().find((c) => isOverflowTarget(c));
  // Smoothing is its own reason to proceed (no enableRothConversions
  // needed); `zero()` carries rmdSmoothingShortfall on every early return
  // so a shortfall is never dropped by another gate.
  const smoothingActive = (rmdSmoothingTarget ?? 0) > 0;
  // Set at the IRMAA-cliff clamp below; `zero()` carries it on every
  // early-return after that point (a conversion clamped to exactly $0 of
  // headroom is the loudest capping case, and it exits through `zero()`).
  let irmaaCapped = false;
  const zero = (): RothConversionResult => ({
    rothConversionAmount: 0,
    rothConversionTaxCost: 0,
    ...(smoothingActive ? { rmdSmoothingShortfall: rmdSmoothingTarget } : {}),
    ...(irmaaCapped ? { rothConversionIrmaaCapped: true } : {}),
  });

  if (
    (!enableRothConversions && !smoothingActive) ||
    !taxBrackets ||
    taxBrackets.length === 0 ||
    balances.preTax <= 0
  ) {
    return zero();
  }

  // target=0 is an explicit household opt-out; smoothing never overrides it.
  const configTarget = input.rothConversionTarget;
  if (configTarget === 0) {
    return zero();
  }

  // Total taxable income this year (Traditional withdrawals + taxable SS +
  // non-qualified Roth growth) -- needed before target resolution now,
  // since smoothing's elevated target (if any) is sized against it.
  const yearTaxableIncome =
    totalTraditionalWithdrawal + taxableSS + rothTaxableGrowth;

  const conversionRoom = conversionRoomFor({
    enableRothConversions,
    configTarget,
    rothBracketTarget: input.rothBracketTarget,
    yearTaxableIncome,
    taxBrackets,
    standardDeduction,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget,
  });
  if (conversionRoom == null || conversionRoom <= 0) return zero();

  // Cap at available Traditional balance -- Retirement-only when
  // exclusion data is available (a Portfolio-parented pretax account isn't
  // retirement money and can't fund a Roth conversion's source amount).
  const retirementOnlyPreTax = nonRetirement
    ? roundToCents(
        balances.preTax -
          getAllCategories().reduce((s, cat) => {
            if (accountBalance[cat].structure !== "roth_traditional") return s;
            return s + nonRetirement.trad[cat];
          }, 0),
      )
    : balances.preTax;
  let conversion = roundToCents(
    Math.min(conversionRoom, Math.max(0, retirementOnlyPreTax)),
  );

  // IRMAA-aware cap: the conversion stays below the next IRMAA cliff.
  if (input.irmaaAwareRothConversions && input.filingStatus && conversion > 0) {
    const maxConversionForCliff = irmaaConversionHeadroom(
      {
        wages: 0,
        traditionalDraws: totalTraditionalWithdrawal,
        rothConversions: 0,
        rothTaxableGrowth,
        realizedGains: input.brokerageGainsPortion,
        socialSecurity: { taxable: taxableSS },
      },
      input.filingStatus,
      input.irmaaBrackets,
    );
    if (maxConversionForCliff != null && maxConversionForCliff < conversion) {
      conversion = maxConversionForCliff;
      irmaaCapped = true;
    }
  }

  if (conversion <= 0) {
    return zero();
  }

  // The tax is paid from brokerage, never Traditional or Roth; with exclusion data only
  // Retirement-parented money counts. A short brokerage shrinks the conversion.
  const retirementOnlyAfterTax =
    nonRetirement && overflowCat
      ? roundToCents(balances.afterTax - nonRetirement.total[overflowCat])
      : balances.afterTax;
  const paid = conversionTaxPaid(
    yearTaxableIncome,
    conversion,
    retirementOnlyAfterTax,
    { taxBrackets, taxMultiplier, standardDeduction },
  );
  if (paid.conversion <= 0) return zero();
  conversion = paid.conversion;
  const taxCostOfConversion = paid.tax;

  // Move balance: Traditional → Roth
  balances.preTax = roundToCents(balances.preTax - conversion);
  balances.taxFree = roundToCents(balances.taxFree + conversion);
  // Pay tax from brokerage
  balances.afterTax = roundToCents(balances.afterTax - taxCostOfConversion);
  // The tax sells brokerage at average cost (parts: by the basis they sell, below)
  const sold = basisOut(
    taxCostOfConversion,
    safeDivide(balances.afterTaxBasis, balances.afterTax + taxCostOfConversion),
  );
  if (!hasIndTracking && balances.afterTaxBasis > 0)
    balances.afterTaxBasis = roundToCents(
      Math.max(0, balances.afterTaxBasis - sold),
    );

  // Traditional → Roth across the categories, by Retirement-only balance.
  const categoryShare = convertAcrossCategories(
    accountBalance,
    conversion,
    nonRetirement,
  );

  if (hasIndTracking) debitConvertedParts(parts, categoryShare);

  // Update brokerage per-account balance for tax payment
  for (const cat of getAllCategories()) {
    if (isOverflowTarget(cat)) {
      setBalance(
        accountBalance[cat],
        roundToCents(
          getTotalBalance(accountBalance[cat]) - taxCostOfConversion,
        ),
      );
      // With parts, the tax comes from them and every track gives up their basis sold.
      if (hasIndTracking)
        payConversionTaxFromParts(parts, cat, taxCostOfConversion, {
          balances,
          category: accountBalance[cat],
        });
      else if (accountBalance[cat].structure === "basis_tracking") {
        const b = getBasis(accountBalance[cat]);
        setBasis(accountBalance[cat], roundToCents(Math.max(0, b - sold)));
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
    ...(irmaaCapped ? { rothConversionIrmaaCapped: true } : {}),
  };
}
