/**
 * Roth conversions fill remaining bracket room, tax paid from brokerage. Runs after routing and
 * RMD enforcement, before growth; the conversion feeds the MAGI the IRMAA and ACA checks read.
 */
import type {
  TaxBuckets,
  AccountBalances,
} from "../accounts/account-balances.types";
import { roundToCents } from "../../utils/math";
import { getAllCategories, isOverflowTarget } from "../../config/account-types";
import { conversionCategoryShares } from "./conversion-categories";
import type { IrmaaBracket } from "../../config/irmaa-tables";
import { irmaaConversionHeadroom } from "./conversion-irmaa-cap";
import {
  debitConvertedParts,
  payConversionTaxFromParts,
  type ConversionParts,
} from "./individual-accounts/conversion";
import type { WithholdingBracket } from "./tax-estimation";
import {
  conversionOff,
  conversionRoomFor,
  convertiblePreTax,
} from "./conversion-room";
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
  /** Current tax buckets (read only). */
  balances: TaxBuckets;
  /** Per-category balances (read only). */
  accountBalance: AccountBalances;
  /** Portfolio-parented exclusion: caps the conversion source and tax-payment capacity to
   *  Retirement money. */
  nonRetirement?: NonRetirementExclusion;
  /** The account parts the conversion and its tax move, their balances and basis. */
  parts: ConversionParts;
  /** This year's household RMD-smoothing minimum (`computeRmdSmoothingTargets`). When positive it
   *  runs even with `enableRothConversions` off and may raise the target rate up to
   *  `rmdSmoothingMaxBracketTarget`; a resolved target of 0 still wins. */
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

/** Perform Roth conversions: move Traditional → Roth to fill remaining bracket
 *  room, the tax paid from brokerage, on the account parts only; the settled
 *  point after it gives the categories and the tax buckets. */
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
  // The isOverflowTarget category (brokerage today), found once for the
  // tax-payment capacity gate and the parts that pay the tax.
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

  // A resolved target of 0 is off (conversionOff); smoothing never overrides it.
  const configTarget = input.rothConversionTarget;
  if (conversionOff(configTarget ?? input.rothBracketTarget)) return zero();

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
  // exclusion data is available.
  const retirementOnlyPreTax = convertiblePreTax(
    balances,
    accountBalance,
    nonRetirement,
  );
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

  // Traditional → Roth on each category's parts, by Retirement-only balance;
  // the tax from the overflow category's parts, each at its own basis.
  debitConvertedParts(
    parts,
    conversionCategoryShares(accountBalance, conversion, nonRetirement),
  );
  if (overflowCat)
    payConversionTaxFromParts(parts, overflowCat, taxCostOfConversion);

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
