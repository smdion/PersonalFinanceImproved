/**
 * Roth conversions: moves Traditional → Roth to fill remaining bracket room.
 * Tax on the conversion is paid from brokerage (after-tax).
 *
 * Runs after withdrawal routing and RMD enforcement, before growth. The
 * conversion feeds MAGI, which the IRMAA and ACA cliff checks
 * (irmaa-check.ts, aca-check.ts) then read.
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
} from "../../config/account-balance";
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
  /** Filing status's standard deduction — Pub 15-T Worksheet 1A residual
   *  threaded into `incomeCapForMarginalRate`/`estimateEffectiveTaxRate`
   *  so bracket-filling room and conversion tax cost are computed against
   *  the correct base. Undefined keeps the prior (overstating) behavior. */
  standardDeduction?: number;
  rothConversionTarget: number | undefined;
  rothBracketTarget: number | undefined;
  /** Total Traditional withdrawals this year (including RMD). */
  totalTraditionalWithdrawal: number;
  /** Taxable SS for this year. */
  taxableSS: number;
  /** Brokerage capital gains portion (for MAGI computation). */
  brokerageGainsPortion: number;
  /** Non-qualified Roth growth income (taxFromSlots.rothTaxableGrowth) —
   *  ordinary income, so it belongs in this year's real taxable income
   *  like any other (`actualTaxableIncome`'s
   *  own docblock, tax-estimation.ts, names
   *  "totalTraditionalWithdrawal + taxableSS alone" as the EXACT bug this
   *  field exists to prevent — this function's yearTaxableIncome/
   *  magiWithoutConversion below were doing precisely that, understating
   *  real income and overstating both the conversion room and the
   *  IRMAA-cliff headroom for any year with a real Roth growth draw). */
  rothTaxableGrowth: number;
  /** Cap conversions to stay below next IRMAA cliff (#38). */
  irmaaAwareRothConversions?: boolean;
  /**
   * IRMAA brackets grown to the vintage that actually applies here —
   * NOT the same growth as `checkIrmaa`'s `irmaaBrackets` (irmaa-check.ts). This
   * cap compares a year-N MAGI against the threshold that will apply
   * TWO YEARS LATER (IRMAA's own 2-year lookback: year-N income sets
   * year-(N+2)'s premium), so the caller must grow this table to year
   * N+2's vintage, not year N's — see `decumulation-year.ts`'s
   * `grownIrmaaBracketsForCap`. */
  irmaaBrackets: Record<string, IrmaaBracket[]>;
  filingStatus?: ReturnFilingStatus | null;
  /** Current balances (mutated in place). */
  balances: TaxBuckets;
  /** Basis ratio of the brokerage money that pays the conversion's tax (the
   *  Retirement brokerages' own, brokerage-basis.ts). Omitted: aggregate. */
  brokerageBasisRatio?: number;
  /** Per-account balances (mutated in place). */
  accountBalance: AccountBalances;
  /** Portfolio-parented ("non-retirement") exclusion for this year —
   *  when supplied, both the conversion SOURCE amount and the tax-payment
   *  capacity gate are capped to Retirement-only money (this half needs
   *  only the pre-aggregated exclusion record, not the raw account list).
   *  When ALSO supplied alongside `indAccounts`/`indBalance`/`indKey`, the
   *  per-account debit is additionally applied directly to
   *  Retirement-parented accounts' `indBalance` instead of being left to
   *  `reconcileIndividualToAggregate`'s parentCategory-blind proportional
   *  redistribution. `decumulation-year.ts`'s real call site always
   *  computes and passes all four together (or none), gated on the same
   *  `hasIndividualAccounts` check — omitting all four ⇒ byte-identical to
   *  the earlier aggregate-only behavior, since there's no Portfolio/Retirement
   *  distinction possible without per-account data anyway. */
  nonRetirement?: NonRetirementExclusion;
  /** Individual accounts, current per-account balances, and the engine's
   *  key function — same triple every other individual-tracking-aware
   *  module in this engine takes. Only used when `nonRetirement` is also
   *  supplied. */
  indAccounts?: IndividualAccountInput[];
  indBalance?: Map<string, number>;
  indKey?: IndKeyFn;
  /** This year's combined household RMD-smoothing minimum (sum of
   *  every person's own target — see `rmd-smoothing.ts`'s
   *  `computeRmdSmoothingTargets`), 0/undefined when smoothing is off or
   *  has nothing to convert this year. When present and positive, this
   *  function proceeds even if `enableRothConversions` is off (smoothing
   *  is a self-contained toggle), and the effective conversion target
   *  rate may be ELEVATED (never lowered) up to
   *  `rmdSmoothingMaxBracketTarget` if the household's own
   *  `rothBracketTarget`/`rothConversionTarget` doesn't provide enough
   *  room. `rothConversionTarget === 0` (an explicit "never convert"
   *  opt-out) still wins regardless. */
  rmdSmoothingTarget?: number;
  /** Ceiling on how far smoothing may elevate the effective target
   *  rate — see `rmdSmoothingTarget`'s docblock. Always resolved by the
   *  caller (never undefined when `rmdSmoothingTarget` is supplied) —
   *  `ResolvedDecumulationConfig.rmdSmoothingMaxBracketTarget` is never
   *  itself undefined. */
  rmdSmoothingMaxBracketTarget?: number;
}

interface RothConversionResult {
  rothConversionAmount: number;
  rothConversionTaxCost: number;
  /** Portion of `rmdSmoothingTarget` that did NOT end up converted
   *  this year (0 in the common case) — a real, expected shortfall when
   *  even the elevated ceiling, IRMAA-cliff cap, or available balance
   *  isn't enough to hit the target, not silently dropped. Only ever
   *  set when `rmdSmoothingTarget` was supplied and positive. */
  rmdSmoothingShortfall?: number;
  /** True when this year's Roth conversion was reduced (or eliminated) to
   *  keep MAGI below the next IRMAA threshold — the `irmaaAwareRothConversions`
   *  clamp actually bit. Undefined/absent when it never applied. Surfaced so
   *  the Tax Optimization page and advisor report can say "N years had
   *  conversions capped for IRMAA" instead of the cap being invisible.
   *  Records a decision the engine already made — zero numeric
   *  effect. */
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
  // Smoothing is a self-contained reason to proceed -- it must not
  // require the household to separately flip the unrelated
  // enableRothConversions toggle (same "own complete toggle" pattern
  // rmdExcessHandling/qcdMaximize already use). `zero()` below carries
  // rmdSmoothingShortfall on every early-return path when smoothing was
  // active, so a shortfall is never silently dropped just because some
  // OTHER gate (no tax brackets, no Traditional balance, an explicit
  // opt-out) stopped the conversion before smoothing's own logic ran.
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

  // Override can disable conversions with target=0 -- an EXPLICIT
  // household opt-out, stronger and more deliberate than the default-off
  // enableRothConversions toggle. Smoothing must not silently override
  // this even when active.
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

  // Pay tax from brokerage (after-tax) if available, otherwise skip --
  // Retirement-only capacity when exclusion data is available (a hard
  // "don't even start the conversion" gate, matching this whole feature's
  // hard-exclusion philosophy, not a soft preference).
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

  // Update per-account balances: distribute proportionally across Traditional
  // accounts, each category weighted by its Retirement-only balance
  // (`balance.traditional - nonRetirement.trad[cat]`), not the blended one: a
  // Portfolio-parented account would otherwise inflate a category's share
  // of the capped `conversion`, and the aggregate mutation below (full-
  // category-sized by design, both trackers move together) would disagree
  // with what the individual debit can place in Retirement-only accounts.
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

  // With the category weight above already Retirement-only-scoped,
  // each category's captured `categoryShare` is guaranteed <= what
  // Retirement-parented accounts in it actually hold — so debiting them
  // directly here, instead of leaving it to
  // reconcileIndividualToAggregate's parentCategory-blind proportional
  // redistribution, keeps indBalance and accountBalance in agreement rather than
  // letting the reconcile pass silently pull the difference from a
  // Portfolio-parented account.
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
      // Same direct-debit approach as the Traditional→Roth move above
      // — the aggregate mutation stays full-category-sized (unchanged), but
      // when individual tracking is available, distribute the ACTUAL tax
      // payment across Retirement-parented accounts in this category only,
      // proportional to their own balance.
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
