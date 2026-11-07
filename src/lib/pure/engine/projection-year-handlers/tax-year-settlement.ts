/** The decumulation year's tax: priced from its draws, then settled. */
import { roundToCents } from "../../../utils/math";
import { ageInYear } from "../../../utils/date";
import { isOverflowTarget, isPreTaxType } from "../../../config/account-types";
import { computeNiit } from "../../../config/niit";
import {
  computeLtcgTax,
  getLtcgRate,
  toLtcgTaxableIncome,
} from "@/lib/pure/tax/ltcg";
import { yearMagi, type YearIncome } from "@/lib/pure/tax/year-income";
import {
  followDraws,
  followInflows,
  retirementBrokerageBasisRatio,
} from "../brokerage-basis";
import {
  clampBalances,
  deductWithdrawals,
  reinvestRmdExcess,
  trackDepletions,
} from "../balance-deduction";
import { clampIndividualBalances } from "../individual-account-tracking";
import { performRothConversion } from "../post-withdrawal-optimizer";
import { rmdOwnerOf } from "../rmd-enforcement";
import { computeRmdSmoothingTargets } from "../rmd-smoothing";
import { computeTaxFromSlots, taxableSSFor } from "../tax-estimation";
import type { resolveDecumulationConfig } from "../override-resolution";
import { applyLumpSums } from "./lump-sum";
import type { routeForMode } from "../withdrawal-routing";
import type { deriveBasisRankingInputs } from "../withdrawal-cost-ranking";
import type {
  growIrmaaBrackets,
  growLtcgBrackets,
  growWithholdingBrackets,
} from "../bracket-growth";
import type { yearNeed } from "./year-need";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** The year's tax from its routed (post-RMD) draws, with Social Security's
 *  taxable share re-derived from that income; priceTax re-prices it later. */
export function priceYearTax(
  slots: ReturnType<typeof routeForMode>["slots"],
  balances: ProjectionLoopState["balances"],
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  grownTaxBrackets: ReturnType<typeof growWithholdingBrackets> | undefined,
  grownStandardDeduction: number | undefined,
  grownLtcgBrackets: ReturnType<typeof growLtcgBrackets>,
  filingStatus: ProjectionContext["input"]["filingStatus"],
  totalTraditionalWithdrawal: number,
  totalRothWithdrawal: number,
  rothTaxSplit: { taxableGrowth: number },
  earlyWithdrawalPenalty: { penaltyCost: number },
  brokerageBasisRatio: ReturnType<
    typeof deriveBasisRankingInputs
  >["brokerageBasisRatio"],
  taxEst: ReturnType<typeof yearNeed>["taxEst"],
  ssIncome: number,
) {
  // One pricing call, shared with withdrawal-solver.ts's estimate and used
  // again after the conversion (never a hand copy of its formula).
  const priceTax = (ss: number, brokerageTaxCostOverride?: number) =>
    computeTaxFromSlots({
      slots,
      taxableSS: ss,
      balances,
      taxRates: {
        ...taxRates,
        taxBrackets: grownTaxBrackets,
        standardDeduction: grownStandardDeduction,
        ltcgBrackets: grownLtcgBrackets,
      },
      filingStatus,
      // The post-RMD totals, not re-derived from slots: RMD enforcement
      // rounds as it adds, which a fresh sum over the slots wouldn't match.
      totalTraditionalWithdrawal,
      totalRothWithdrawal,
      rothTaxableGrowth: rothTaxSplit.taxableGrowth,
      penaltyCost: earlyWithdrawalPenalty.penaltyCost,
      brokerageBasisRatio,
      brokerageTaxCostOverride,
    });
  // Taxable Social Security from this year's post-RMD income (the first
  // pass only supplies that income), then the year priced with it. Muni
  // bond interest isn't tracked, so no taxExemptInterest is passed.
  let { taxableSS } = taxEst;
  let taxFromSlots = priceTax(taxableSS);
  if (filingStatus && ssIncome > 0) {
    taxableSS = taxableSSFor(ssIncome, taxFromSlots, filingStatus);
    taxFromSlots = priceTax(taxableSS);
  }

  return { priceTax, taxableSS, taxFromSlots };
}

/** The priced year's parts the settlement reads (the brokerage slot's basis
 *  and gains, penalty and SS tax, the surplus credit), and the post-RMD gross-up. */
export function pricedYearParts(
  taxFromSlots: ReturnType<typeof priceYearTax>["taxFromSlots"],
  slots: ReturnType<typeof routeForMode>["slots"],
  balances: ProjectionLoopState["balances"],
  ssSurplus: number,
  taxEst: ReturnType<typeof yearNeed>["taxEst"],
  rmdOverrodeRouting: boolean,
  afterTaxNeed: number,
  state: ProjectionLoopState,
) {
  const brokerageBasisPortion = taxFromSlots.brokerageBasisPortion;
  const brokerageGainsPortion = taxFromSlots.brokerageGainsPortion;
  // This year's taxable income, non-qualified Roth growth included, as
  // computeTaxFromSlots computed it (LTCG bracket selection and MAGI read it).
  const actualTaxableIncome = taxFromSlots.actualTaxableIncome;
  // The brokerage slot's basis and gains, under computeTaxFromSlots's own
  // gate (left undefined otherwise, never 0/0).
  const brokerageSlot = slots.find((s) => isOverflowTarget(s.category));
  if (
    brokerageSlot &&
    taxFromSlots.brokerageWithdrawal > 0 &&
    balances.afterTax > 0
  ) {
    brokerageSlot.basisPortion = brokerageBasisPortion;
    brokerageSlot.gainsPortion = brokerageGainsPortion;
  }

  const penaltyCost = taxFromSlots.penaltyCost;
  const ssTaxCost = taxFromSlots.ssTaxCost;
  // Never more than the tax: the surplus isn't banked.
  const surplusCredit = (tax: number) =>
    roundToCents(Math.min(ssSurplus, Math.max(0, tax)));

  let { grossUpFactor } = taxEst;
  // grossUpFactor after the RMD (diagnostics): an RMD can add Traditional
  // tax the estimate didn't see. Penalty cost counts too (RMD dollars carry
  // none). Nothing is grossed up when the strategy fixed the withdrawal.
  if (
    rmdOverrodeRouting &&
    afterTaxNeed > 0 &&
    state.portfolioWithdrawal === null
  ) {
    const postRmdTotalCost = roundToCents(taxFromSlots.taxCost + penaltyCost);
    const postRmdEffRate = postRmdTotalCost / (afterTaxNeed + postRmdTotalCost);
    // Not safeDivide: the guard is `< 1`, and a rate above 1 (over-withheld)
    // is a distinct case from a zero denominator.
    grossUpFactor =
      postRmdEffRate < 1 ? 1 / (1 - postRmdEffRate) : grossUpFactor;
  }

  return {
    brokerageBasisPortion,
    brokerageGainsPortion,
    actualTaxableIncome,
    penaltyCost,
    ssTaxCost,
    surplusCredit,
    grossUpFactor,
  };
}

/** The year's draws settled: deducted, lump sums in, the RMD excess reinvested
 *  or spent (UD-04, pending D1: the RMD adds to the draw), depletions tracked. */
export function settleYearDraws(
  slots: ReturnType<typeof routeForMode>["slots"],
  balances: ProjectionLoopState["balances"],
  acctBal: ProjectionLoopState["acctBal"],
  brokerageBasisPortion: number,
  indAccts: ProjectionContext["indAccts"],
  indKey: ProjectionContext["indKey"],
  indBal: ProjectionLoopState["indBal"],
  brokBasis: ProjectionLoopState["brokBasis"],
  config: ReturnType<typeof resolveDecumulationConfig>,
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  taxFromSlots: ReturnType<typeof priceYearTax>["taxFromSlots"],
  surplusCredit: ReturnType<typeof pricedYearParts>["surplusCredit"],
  rmdOverrodeRouting: boolean,
  totalWithdrawal: number,
  afterTaxNeed: number,
  hasIndividualAccounts: boolean,
  depletionTracked: ProjectionLoopState["depletionTracked"],
  accountDepletions: ProjectionLoopState["accountDepletions"],
  year: number,
  age: number,
) {
  // Deduct withdrawals from tax buckets and per-account balances
  deductWithdrawals({ slots, balances, acctBal, brokerageBasisPortion });

  // Ensure no negative balances
  clampBalances(balances, acctBal);

  // Lump sums (one-time, outside limits) are cash in: new basis in the
  // brokerage account they land in.
  followInflows(indAccts, indKey, indBal, brokBasis, () =>
    applyLumpSums(config.lumpSums, ctx, state),
  );

  // RMD money past the need, shown in the UI; rmdExcessHandling reinvests it
  // (cash in: new basis where it lands) or spends it. The withdrawal pays
  // the tax less Social Security's surplus.
  const withdrawalTax = roundToCents(
    taxFromSlots.taxCost - surplusCredit(taxFromSlots.taxCost),
  );
  const rmdExcessAmount = followInflows(
    indAccts,
    indKey,
    indBal,
    brokBasis,
    () =>
      reinvestRmdExcess(
        config.rmdExcessHandling,
        rmdOverrodeRouting,
        totalWithdrawal,
        afterTaxNeed,
        withdrawalTax,
        balances,
        acctBal,
        hasIndividualAccounts ? indAccts : undefined,
        hasIndividualAccounts ? indBal : undefined,
        hasIndividualAccounts ? indKey : undefined,
      ),
  );

  // Clamp individual account balances
  if (hasIndividualAccounts) {
    followDraws(indAccts, indKey, indBal, brokBasis, () =>
      clampIndividualBalances(indAccts, indKey, indBal),
    );
  }

  // Track per-account depletions
  trackDepletions(acctBal, depletionTracked, accountDepletions, year, age);

  return { rmdExcessAmount };
}

/** RMD smoothing's target, then the year's Roth conversion, its tax paid from
 *  retirement brokerage money (UD-08, undecided: today's tax source and sizing). */
export function yearRothConversion(
  config: ReturnType<typeof resolveDecumulationConfig>,
  hasIndividualAccounts: boolean,
  rmdStartAgeByPerson: ProjectionContext["rmdStartAgeByPerson"],
  indAccts: ProjectionContext["indAccts"],
  ctx: ProjectionContext,
  indBal: ProjectionLoopState["indBal"],
  indKey: ProjectionContext["indKey"],
  year: number,
  balances: ProjectionLoopState["balances"],
  totalTraditionalWithdrawal: number,
  totalWithdrawal: number,
  targetWithdrawal: number,
  brokBasis: ProjectionLoopState["brokBasis"],
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  grownTaxBrackets: ReturnType<typeof growWithholdingBrackets> | undefined,
  grownStandardDeduction: number | undefined,
  resolvedConversionTarget: number | undefined,
  taxableSS: number,
  taxFromSlots: ReturnType<typeof priceYearTax>["taxFromSlots"],
  brokerageGainsPortion: number,
  input: ProjectionContext["input"],
  enableIrmaaAwareness: ProjectionContext["input"]["enableIrmaaAwareness"],
  grownIrmaaBracketsForCap: ReturnType<typeof growIrmaaBrackets>,
  filingStatus: ProjectionContext["input"]["filingStatus"],
  acctBal: ProjectionLoopState["acctBal"],
  nonRetirement: PreYearSetup["nonRetirement"],
) {
  // RMD-aware conversion smoothing (rmd-smoothing.ts), sized each year from
  // each owner's current Traditional balance (indBal, after this year's
  // draws); per owner, so only with tracked accounts.
  let rmdSmoothingTarget: number | undefined;
  if (
    config.rmdSmoothingEnabled &&
    hasIndividualAccounts &&
    rmdStartAgeByPerson.size > 0
  ) {
    const smoothingPeople = Array.from(rmdStartAgeByPerson.entries()).map(
      ([personId, { startAge, birthYear }]) => {
        const personTraditionalBalance = indAccts
          .filter(
            (ia) =>
              rmdOwnerOf(ia, ctx.primaryPersonId) === personId &&
              isPreTaxType(ia.taxType),
          )
          .reduce((s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0), 0);
        return {
          personId,
          currentAge: ageInYear(birthYear, year),
          rmdStartAge: startAge,
          personTraditionalBalance,
        };
      },
    );
    const smoothingResult = computeRmdSmoothingTargets({
      enabled: true,
      people: smoothingPeople,
      householdTraditionalBalance: balances.preTax,
      returnRateMap: ctx.returnRateMap,
      totalTraditionalWithdrawal,
      totalWithdrawal,
      // What leaves the portfolio this year — not spending, which Social
      // Security partly covers (and which a portfolio-sized strategy with
      // Social Security on top doesn't size at all).
      currentProjectedAnnualSpendingNeed: targetWithdrawal,
      postRetirementInflationRate: ctx.validatedPostRetirementInflation,
    });
    if (smoothingResult.householdSmoothingTarget > 0) {
      rmdSmoothingTarget = smoothingResult.householdSmoothingTarget;
    }
  }

  // The Roth conversion (post-withdrawal-optimizer.ts); its tax is paid from
  // retirement brokerage money (basis leaves at the account's own ratio).
  const rothResult = followDraws(indAccts, indKey, indBal, brokBasis, () =>
    performRothConversion({
      // The conversion's tax comes out of retirement brokerage money.
      brokerageBasisRatio: hasIndividualAccounts
        ? retirementBrokerageBasisRatio(indAccts, indKey, indBal, brokBasis)
        : undefined,
      enableRothConversions: taxRates.enableRothConversions,
      taxBrackets: grownTaxBrackets,
      taxMultiplier: taxRates.taxMultiplier,
      standardDeduction: grownStandardDeduction,
      rothConversionTarget: config.rothConversionTarget,
      // The fallback when config.rothConversionTarget is unset:
      // resolvedConversionTarget, the same chain the routing reservation used
      // (engine-snapshot fixtures 31/41/54/55/61 pin its order).
      rothBracketTarget: resolvedConversionTarget,
      totalTraditionalWithdrawal,
      taxableSS,
      rothTaxableGrowth: taxFromSlots.rothTaxableGrowth,
      brokerageGainsPortion,
      irmaaAwareRothConversions:
        input.irmaaAwareRothConversions ??
        (enableIrmaaAwareness ? true : undefined),
      irmaaBrackets: grownIrmaaBracketsForCap,
      filingStatus,
      balances,
      acctBal,
      // Portfolio-parented money stays out of the conversion and its tax.
      nonRetirement,
      indAccts: hasIndividualAccounts ? indAccts : undefined,
      indBal: hasIndividualAccounts ? indBal : undefined,
      indKey: hasIndividualAccounts ? indKey : undefined,
      rmdSmoothingTarget,
      rmdSmoothingMaxBracketTarget: config.rmdSmoothingMaxBracketTarget,
    }),
  );
  const {
    rothConversionAmount,
    rothConversionTaxCost,
    rmdSmoothingShortfall,
    rothConversionIrmaaCapped,
  } = rothResult;

  return {
    rothConversionAmount,
    rothConversionTaxCost,
    rmdSmoothingShortfall,
    rothConversionIrmaaCapped,
  };
}

/** The conversion year's gains re-priced, then NIIT, after the RMD excess is
 *  reinvested: today's order (funding NIIT first is v0.11). */
export function repriceConversionYear(
  taxFromSlots: ReturnType<typeof priceYearTax>["taxFromSlots"],
  actualTaxableIncome: number,
  rothConversionAmount: number,
  grownStandardDeduction: number | undefined,
  filingStatus: ProjectionContext["input"]["filingStatus"],
  brokerageGainsPortion: number,
  grownLtcgBrackets: ReturnType<typeof growLtcgBrackets>,
  priceTax: ReturnType<typeof priceYearTax>["priceTax"],
  taxableSS: number,
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  totalTraditionalWithdrawal: number,
  ssIncome: number,
) {
  let brokerageTaxCost = taxFromSlots.brokerageTaxCost;
  let taxCost = taxFromSlots.taxCost;
  // Roth conversions are ordinary income and can push the gains into a higher
  // LTCG bracket: recompute on the revised ordinary income, converted once to
  // the taxable income the LTCG calls below use (they're its only readers).
  let postConversionLtcgRate: number;
  const revisedOrdinary = toLtcgTaxableIncome(
    actualTaxableIncome + rothConversionAmount,
    grownStandardDeduction,
  );
  if (rothConversionAmount > 0 && filingStatus && brokerageGainsPortion > 0) {
    brokerageTaxCost = roundToCents(
      computeLtcgTax(
        revisedOrdinary,
        brokerageGainsPortion,
        filingStatus,
        grownLtcgBrackets,
      ),
    );
    // Marginal rate at the top of the gains stack — display only, tax is in brokerageTaxCost
    postConversionLtcgRate = getLtcgRate(
      revisedOrdinary + brokerageGainsPortion,
      filingStatus,
      grownLtcgBrackets,
    );
    // Re-priced through the same computeTaxFromSlots call, never a hand copy.
    taxCost = priceTax(taxableSS, brokerageTaxCost).taxCost;
  } else {
    // Display-only: marginal bracket at the ceiling of the gains stack.
    // No tax is actually computed from this value.
    postConversionLtcgRate =
      brokerageGainsPortion > 0 && filingStatus
        ? getLtcgRate(
            revisedOrdinary + brokerageGainsPortion,
            filingStatus,
            grownLtcgBrackets,
          )
        : brokerageGainsPortion > 0
          ? taxRates.brokerage
          : filingStatus
            ? getLtcgRate(revisedOrdinary, filingStatus, grownLtcgBrackets)
            : taxRates.brokerage;
  }

  const income: YearIncome = {
    traditionalDraws: totalTraditionalWithdrawal,
    rothTaxableGrowth: taxFromSlots.rothTaxableGrowth,
    rothConversions: rothConversionAmount,
    realizedGains: brokerageGainsPortion,
    socialSecurity: { gross: ssIncome, taxable: taxableSS },
  };
  // --- NIIT (Net Investment Income Tax, 3.8% surtax) ---
  // Applies to lesser of net investment income or MAGI exceeding threshold.
  // Roth conversions raise MAGI but are NOT net investment income.
  const currentYearMagi = yearMagi(income, "niit");
  const niitAmount = filingStatus
    ? computeNiit(currentYearMagi, brokerageGainsPortion, filingStatus)
    : 0;
  if (niitAmount > 0) {
    taxCost = roundToCents(taxCost + niitAmount);
  }

  return { taxCost, postConversionLtcgRate, income, niitAmount };
}
