/** The decumulation year's tax: priced from its draws, then settled. */
import { roundToCents } from "../../../utils/math";
import { ageInYear } from "../../../utils/date";
import { isOverflowTarget, isPreTaxType } from "../../../config/account-types";
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
import { clampIndividualBalances } from "../individual-accounts/reconcile";
import { performRothConversion } from "../roth-conversion";
import { rmdOwnerOf } from "../rmd-enforcement";
import { computeRmdSmoothingTargets } from "../rmd-smoothing";
import { computeTaxFromSlots, taxableSSFor } from "../tax-estimation";
import type { resolveDecumulationConfig } from "../override-resolution";
import { applyLumpSums } from "./lump-sum";
import type { yearNeed } from "./year-need";
import type { distributeYearDraws, routeYearDraw } from "./year-draws";
import type { enforceYearRmd } from "./rmd-step";
import type {
  growIrmaaBrackets,
  growWithholdingBrackets,
} from "../bracket-growth";
import type {
  DecumulationYear,
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** What a decumulation year's stages have settled so far, by stage; each
 *  later stage takes the ones it reads (`Pick`). */
export type DecumulationFlow = {
  need: ReturnType<typeof yearNeed>;
  route: ReturnType<typeof routeYearDraw>;
  rmd: ReturnType<typeof enforceYearRmd>;
  drawn: ReturnType<typeof distributeYearDraws>;
  priced: ReturnType<typeof priceYearTax>;
  parts: ReturnType<typeof pricedYearParts>;
};

/** The year's tax from its routed (post-RMD) draws, with Social Security's
 *  taxable share re-derived from that income; priceTax re-prices it later. */
export function priceYearTax(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "need" | "route" | "rmd" | "drawn">,
) {
  const { filingStatus } = ctx.input;
  const { balances } = state;
  const { taxRates, ssIncome } = thisYear;
  const { grownTaxBrackets, grownStandardDeduction, grownLtcgBrackets } =
    thisYear.tables;
  const { slots, brokerageBasisRatio } = flow.route;
  const { totalTraditionalWithdrawal, totalRothWithdrawal } = flow.rmd;
  const { rothTaxSplit, earlyWithdrawalPenalty } = flow.drawn;
  const { taxEstimate } = flow.need;
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
  let { taxableSS } = taxEstimate;
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
  state: ProjectionLoopState,
  flow: Pick<DecumulationFlow, "need" | "route" | "rmd" | "priced">,
) {
  const { balances } = state;
  const { taxFromSlots } = flow.priced;
  const { slots } = flow.route;
  const { ssSurplus, taxEstimate, afterTaxNeed } = flow.need;
  const { rmdOverrodeRouting } = flow.rmd;
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

  let { grossUpFactor } = taxEstimate;
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
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "need" | "route" | "rmd" | "priced" | "parts">,
) {
  const { indAccounts, indKey, hasIndividualAccounts } = ctx;
  const { balances, accountBalance, indBalance, brokBasis } = state;
  const { depletionTracked, accountDepletions } = state;
  const { config, year, age } = thisYear;
  const { slots } = flow.route;
  const { brokerageBasisPortion, surplusCredit } = flow.parts;
  const { taxFromSlots } = flow.priced;
  const { rmdOverrodeRouting, totalWithdrawal } = flow.rmd;
  const { afterTaxNeed } = flow.need;
  // Deduct withdrawals from tax buckets and per-account balances
  deductWithdrawals({ slots, balances, accountBalance, brokerageBasisPortion });

  // Ensure no negative balances
  clampBalances(balances, accountBalance);

  // Lump sums (one-time, outside limits) are cash in: new basis in the
  // brokerage account they land in.
  followInflows(indAccounts, indKey, indBalance, brokBasis, () =>
    applyLumpSums(config.lumpSums, ctx, state),
  );

  // RMD money past the need, shown in the UI; rmdExcessHandling reinvests it
  // (cash in: new basis where it lands) or spends it. The withdrawal pays
  // the tax less Social Security's surplus.
  const withdrawalTax = roundToCents(
    taxFromSlots.taxCost - surplusCredit(taxFromSlots.taxCost),
  );
  const rmdExcessAmount = followInflows(
    indAccounts,
    indKey,
    indBalance,
    brokBasis,
    () =>
      reinvestRmdExcess(
        config.rmdExcessHandling,
        rmdOverrodeRouting,
        totalWithdrawal,
        afterTaxNeed,
        withdrawalTax,
        balances,
        accountBalance,
        hasIndividualAccounts ? indAccounts : undefined,
        hasIndividualAccounts ? indBalance : undefined,
        hasIndividualAccounts ? indKey : undefined,
      ),
  );

  // Clamp individual account balances
  if (hasIndividualAccounts) {
    followDraws(indAccounts, indKey, indBalance, brokBasis, () =>
      clampIndividualBalances(indAccounts, indKey, indBalance),
    );
  }

  // Track per-account depletions
  trackDepletions(
    accountBalance,
    depletionTracked,
    accountDepletions,
    year,
    age,
  );

  return { rmdExcessAmount };
}

/** RMD smoothing's target, then the year's Roth conversion, its tax paid from
 *  retirement brokerage money (UD-08, pending D4: today's tax source and sizing). */
export function yearRothConversion(
  config: ReturnType<typeof resolveDecumulationConfig>,
  hasIndividualAccounts: boolean,
  rmdStartAgeByPerson: ProjectionContext["rmdStartAgeByPerson"],
  indAccounts: ProjectionContext["indAccounts"],
  ctx: ProjectionContext,
  indBalance: ProjectionLoopState["indBalance"],
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
  accountBalance: ProjectionLoopState["accountBalance"],
  nonRetirement: PreYearSetup["nonRetirement"],
) {
  // RMD-aware conversion smoothing (rmd-smoothing.ts), sized each year from
  // each owner's current Traditional balance (indBalance, after this year's
  // draws); per owner, so only with tracked accounts.
  let rmdSmoothingTarget: number | undefined;
  if (
    config.rmdSmoothingEnabled &&
    hasIndividualAccounts &&
    rmdStartAgeByPerson.size > 0
  ) {
    const smoothingPeople = Array.from(rmdStartAgeByPerson.entries()).map(
      ([personId, { startAge, birthYear }]) => {
        const personTraditionalBalance = indAccounts
          .filter(
            (ia) =>
              rmdOwnerOf(ia, ctx.primaryPersonId) === personId &&
              isPreTaxType(ia.taxType),
          )
          .reduce(
            (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
            0,
          );
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

  // The Roth conversion (roth-conversion.ts); its tax is paid from
  // retirement brokerage money (basis leaves at the account's own ratio).
  const rothResult = followDraws(
    indAccounts,
    indKey,
    indBalance,
    brokBasis,
    () =>
      performRothConversion({
        // The conversion's tax comes out of retirement brokerage money.
        brokerageBasisRatio: hasIndividualAccounts
          ? retirementBrokerageBasisRatio(
              indAccounts,
              indKey,
              indBalance,
              brokBasis,
            )
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
        accountBalance,
        // Portfolio-parented money stays out of the conversion and its tax.
        nonRetirement,
        indAccounts: hasIndividualAccounts ? indAccounts : undefined,
        indBalance: hasIndividualAccounts ? indBalance : undefined,
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
