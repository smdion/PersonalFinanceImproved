/**
 * Roth conversions fill remaining bracket room, tax paid from brokerage. Runs after routing and
 * RMD enforcement, before growth; the conversion feeds the MAGI the IRMAA and ACA checks read.
 */
import type { AccountCategory } from "../../config/account-types";
import type {
  TaxBuckets,
  AccountBalances,
  IndividualAccountInput,
} from "../accounts/account-balances.types";
import { roundToCents } from "../../utils/math";
import {
  getAllCategories,
  isOverflowTarget,
  isRetirementMoney,
} from "../../config/account-types";
import {
  getTotalBalance,
  getBasis,
  setTraditional,
  setRoth,
  setBalance,
  setBasis,
} from "../accounts/account-balance";
import {
  getNextIrmaaCliff,
  type IrmaaBracket,
} from "../../config/irmaa-tables";
import {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
} from "./tax-estimation";
import type { WithholdingBracket } from "./tax-estimation";
import type { NonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
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
  /** Basis ratio of the brokerage money that pays the conversion's tax (the
   *  Retirement brokerages' own, brokerage-basis.ts). Omitted: aggregate. */
  brokerageBasisRatio?: number;
  /** Per-account balances (mutated in place). */
  accountBalance: AccountBalances;
  /** Portfolio-parented exclusion: caps the conversion source and tax-payment capacity to
   *  Retirement money. With `indAccounts`/`indBalance`/`indKey` too, the debit goes straight to
   *  Retirement-parented accounts. The caller passes all four or none. */
  nonRetirement?: NonRetirementExclusion;
  /** Individual accounts, per-account balances and the key function; used only with
   *  `nonRetirement`. */
  indAccounts?: IndividualAccountInput[];
  indBalance?: Map<string, number>;
  indKey?: IndKeyFn;
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
    indAccounts,
    indBalance,
    indKey,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget,
  } = input;
  const hasIndTracking =
    nonRetirement != null &&
    indAccounts != null &&
    indBalance != null &&
    indKey != null;
  // Single isOverflowTarget category (brokerage today) — hoisted so both
  // the tax-payment capacity gate and the later per-account debit loop can
  // use it without duplicating the search.
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

  let conversionTarget = configTarget ?? input.rothBracketTarget;
  if (smoothingActive) {
    // The lowest marginal rate whose cap fits this year's income plus the
    // smoothing target (incomeCapForMarginalRate over each bracket, in
    // order). The top bracket's cap is Infinity, so some rate always fits.
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

  // IRMAA-aware cap (#38): reduce conversion to stay below next IRMAA cliff.
  if (input.irmaaAwareRothConversions && input.filingStatus && conversion > 0) {
    // Today's term order (float ties at a cliff); yearMagi once it rounds to cents.
    const magiWithoutConversion =
      totalTraditionalWithdrawal +
      input.brokerageGainsPortion +
      taxableSS +
      rothTaxableGrowth;
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
        irmaaCapped = true;
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

  // Pay tax from brokerage, else skip: with exclusion data, only
  // Retirement-parented money counts (a hard gate).
  const retirementOnlyAfterTax =
    nonRetirement && overflowCat
      ? roundToCents(balances.afterTax - nonRetirement.total[overflowCat])
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
    const basisRatio =
      input.brokerageBasisRatio ??
      Math.min(
        1,
        balances.afterTaxBasis / (balances.afterTax + taxCostOfConversion),
      );
    balances.afterTaxBasis = roundToCents(
      Math.max(0, balances.afterTaxBasis - taxCostOfConversion * basisRatio),
    );
  }

  // Spread across Traditional accounts weighted by Retirement-only balance
  // (`balance.traditional - nonRetirement.trad[cat]`), so each category's
  // share fits what its Retirement-parented accounts can be debited.
  const tradAccounts: { cat: AccountCategory; balance: number }[] = [];
  for (const cat of getAllCategories()) {
    const balance = accountBalance[cat];
    if (balance.structure !== "roth_traditional") continue;
    const weight = nonRetirement
      ? Math.max(0, balance.traditional - nonRetirement.trad[cat])
      : balance.traditional;
    if (weight > 0) tradAccounts.push({ cat, balance: weight });
  }
  const totalTradBalance = tradAccounts.reduce((s, a) => s + a.balance, 0);
  const categoryShare = new Map<AccountCategory, number>();
  if (totalTradBalance > 0) {
    let distributed = 0;
    for (const account of tradAccounts) {
      const balance = accountBalance[account.cat];
      if (balance.structure !== "roth_traditional") continue;
      const share = roundToCents(
        conversion * (account.balance / totalTradBalance),
      );
      const capped = Math.min(share, balance.traditional);
      setTraditional(balance, roundToCents(balance.traditional - capped));
      setRoth(balance, roundToCents(balance.roth + capped));
      categoryShare.set(
        account.cat,
        (categoryShare.get(account.cat) ?? 0) + capped,
      );
      distributed += capped;
    }
    // Handle rounding remainder
    if (distributed < conversion - 0.01 && tradAccounts.length > 0) {
      const remainder = roundToCents(conversion - distributed);
      const firstAccount = tradAccounts[0]!;
      const firstBalance = accountBalance[firstAccount.cat];
      if (firstBalance.structure === "roth_traditional") {
        const extra = Math.min(remainder, firstBalance.traditional);
        setTraditional(
          firstBalance,
          roundToCents(firstBalance.traditional - extra),
        );
        setRoth(firstBalance, roundToCents(firstBalance.roth + extra));
        categoryShare.set(
          firstAccount.cat,
          (categoryShare.get(firstAccount.cat) ?? 0) + extra,
        );
      }
    }
  }

  // Each `categoryShare` fits its Retirement-parented accounts, so debit them
  // directly; reconcile would otherwise spread the difference by balance and
  // could pull it from a Portfolio-parented account.
  if (hasIndTracking) {
    for (const [cat, amount] of categoryShare) {
      if (amount <= 0) continue;
      const catAccounts = indAccounts.filter(
        (ia) => ia.category === cat && isRetirementMoney(ia.parentCategory),
      );
      const catTotal = catAccounts.reduce(
        (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
        0,
      );
      if (catTotal <= 0) continue;
      let accountDistributed = 0;
      for (const ia of catAccounts) {
        const k = indKey(ia);
        const balance = Math.max(0, indBalance.get(k) ?? 0);
        const share = roundToCents(amount * (balance / catTotal));
        const capped = Math.min(share, balance);
        indBalance.set(k, roundToCents(balance - capped));
        accountDistributed += capped;
      }
      const remainder = roundToCents(amount - accountDistributed);
      if (remainder > 0.005 && catAccounts.length > 0) {
        const first = catAccounts[0]!;
        const k = indKey(first);
        const balance = Math.max(0, indBalance.get(k) ?? 0);
        indBalance.set(k, roundToCents(Math.max(0, balance - remainder)));
      }
    }
  }

  // Update brokerage per-account balance for tax payment
  for (const cat of getAllCategories()) {
    if (isOverflowTarget(cat)) {
      setBalance(
        accountBalance[cat],
        roundToCents(
          getTotalBalance(accountBalance[cat]) - taxCostOfConversion,
        ),
      );
      if (accountBalance[cat].structure === "basis_tracking") {
        const currentBasis = getBasis(accountBalance[cat]);
        const currentBalance = getTotalBalance(accountBalance[cat]);
        setBasis(
          accountBalance[cat],
          roundToCents(Math.min(currentBasis, currentBalance)),
        );
      }
      // As above: the aggregate moves full-category-sized; with individual
      // tracking, the tax comes from this category's Retirement-parented
      // accounts by balance.
      if (hasIndTracking) {
        const catAccounts = indAccounts.filter(
          (ia) => ia.category === cat && isRetirementMoney(ia.parentCategory),
        );
        const catTotal = catAccounts.reduce(
          (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
          0,
        );
        if (catTotal > 0) {
          let taxDistributed = 0;
          for (const ia of catAccounts) {
            const k = indKey(ia);
            const balance = Math.max(0, indBalance.get(k) ?? 0);
            const share = roundToCents(
              taxCostOfConversion * (balance / catTotal),
            );
            const capped = Math.min(share, balance);
            indBalance.set(k, roundToCents(balance - capped));
            taxDistributed += capped;
          }
          const remainder = roundToCents(taxCostOfConversion - taxDistributed);
          if (remainder > 0.005 && catAccounts.length > 0) {
            const first = catAccounts[0]!;
            const k = indKey(first);
            const balance = Math.max(0, indBalance.get(k) ?? 0);
            indBalance.set(k, roundToCents(Math.max(0, balance - remainder)));
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
    ...(irmaaCapped ? { rothConversionIrmaaCapped: true } : {}),
  };
}
