/** The decumulation year's tax: priced from its draws, then settled. */
import { roundToCents } from "../../../utils/math";
import { ageInYear } from "../../../utils/date";
import { isOverflowTarget, isPreTaxType } from "../../../config/account-types";
import { soleBeneficiarySpouseAges } from "../../../config/rmd-tables";
import { followDraws, followInflows } from "../brokerage-basis";
import {
  clampBalances,
  deductWithdrawals,
  reinvestRmdExcess,
  trackDepletions,
} from "../balance-deduction";
import { clampIndividualBalances } from "../individual-accounts/reconcile";
import { performRothConversion } from "../roth-conversion";
import { premiumYearHasEnrollee } from "../conversion-irmaa-cap";
import { rmdOwnerOf } from "../rmd-enforcement";
import { computeRmdSmoothingTargets } from "../rmd-smoothing";
import { computeTaxFromSlots, taxableSSFor } from "../tax-estimation";
import { drawCost, surplusCreditFor } from "../draw-cost";
import { applyLumpSums } from "./lump-sum";
import { perOwnerRmds } from "./helpers";
import { irmaaOutsideNeed } from "./irmaa-charge";
import type { yearNeed } from "./year-need";
import type { distributeYearDraws, routeYearDraw } from "./year-draws";
import type { enforceYearRmd } from "./rmd-step";
import type {
  DecumulationYear,
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
  conversion: ReturnType<typeof yearRothConversion>;
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
  const { grownTaxBrackets, grownLtcgBrackets } = thisYear.tables;
  const standardDeduction = thisYear.tables.grownStandardDeduction; // all year
  const { slots } = flow.route;
  const { totalTraditionalWithdrawal, totalRothWithdrawal } = flow.rmd;
  const { rothTaxSplit, earlyWithdrawalPenalty } = flow.drawn;
  const { taxEstimate, ssSurplus } = flow.need;
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
        standardDeduction,
        ltcgBrackets: grownLtcgBrackets,
      },
      filingStatus,
      // The post-RMD totals, not re-derived from slots: RMD enforcement
      // rounds as it adds, which a fresh sum over the slots wouldn't match.
      totalTraditionalWithdrawal,
      totalRothWithdrawal,
      rothTaxableGrowth: rothTaxSplit.taxableGrowth,
      penaltyCost: earlyWithdrawalPenalty.penaltyCost,
      brokerageBasisRatio: thisYear.retirementBasisRatio,
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
  // What the draw was sized to pay (draw-cost.ts, as withdrawal-solver.ts).
  const cost = drawCost(taxFromSlots, taxableSS, filingStatus, ssSurplus);
  return { priceTax, taxableSS, taxFromSlots, standardDeduction, cost };
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
    brokerageSlot.basisPortion = taxFromSlots.brokerageBasisPortion;
    brokerageSlot.gainsPortion = brokerageGainsPortion;
  }

  const penaltyCost = taxFromSlots.penaltyCost;
  const ssTaxCost = taxFromSlots.ssTaxCost;
  const surplusCredit = (tax: number) => surplusCreditFor(ssSurplus, tax);

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
    brokerageGainsPortion,
    actualTaxableIncome,
    penaltyCost,
    ssTaxCost,
    surplusCredit,
    grossUpFactor,
  };
}

/** The year's draws settled: deducted, lump sums in, the RMD excess reinvested
 *  or spent (UD-04: at most what the RMD added), depletions tracked. */
export function settleYearDraws(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Omit<DecumulationFlow, "conversion">,
) {
  const { indAccounts, indKey, holdsAccounts } = ctx;
  // Each account's draw (distributeYearDraws) lands with the deduction below.
  for (const [k, v] of flow.drawn.ledger.indBalance) state.indBalance.set(k, v);
  for (const [k, v] of flow.drawn.ledger.brokBasis) state.brokBasis.set(k, v);
  for (const [k, v] of flow.drawn.ledger.indBasis) state.indBasis.set(k, v);
  const { balances, accountBalance, indBalance, brokBasis } = state;
  const { depletionTracked, accountDepletions } = state;
  const { config, year, age } = thisYear;
  const { slots } = flow.route;
  const { taxFromSlots, cost } = flow.priced;
  const { rmdAdded, totalWithdrawal } = flow.rmd;
  const { afterTaxNeed, irmaa } = flow.need;
  const basisOut = taxFromSlots.brokerageBasisOut;
  deductWithdrawals({ slots, balances, accountBalance, basisOut });
  clampBalances(balances, accountBalance);
  // Lump sums (one-time, outside limits) are cash in: new basis in the
  // brokerage account they land in.
  followInflows(indAccounts, indKey, indBalance, brokBasis, () =>
    applyLumpSums(config.lumpSums, ctx, state),
  );

  // RMD money past the need and the year-start charge, reinvested or spent,
  // after the draw's whole cost: tax, NIIT and penalty, less the SS surplus
  // (the row's NIIT is charged in the re-price).
  const rmdExcessAmount = followInflows(
    indAccounts,
    indKey,
    indBalance,
    brokBasis,
    () =>
      reinvestRmdExcess(
        config.rmdExcessHandling,
        rmdAdded,
        totalWithdrawal,
        afterTaxNeed + irmaaOutsideNeed(irmaa, state),
        cost.netCost,
        balances,
        accountBalance,
        holdsAccounts ? indAccounts : undefined,
        holdsAccounts ? indBalance : undefined,
        holdsAccounts ? indKey : undefined,
      ),
  );

  if (holdsAccounts) {
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
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "need" | "route" | "rmd" | "priced" | "parts">,
) {
  const { holdsAccounts, rmdStartAgeByPerson, indAccounts, indKey } = ctx;
  const { input } = ctx;
  const { enableIrmaaAwareness, filingStatus } = input;
  const { indBalance, balances, brokBasis, accountBalance } = state;
  const { config, year, taxRates } = thisYear;
  const { nonRetirement } = thisYear.setup;
  const { grownTaxBrackets, grownIrmaaBracketsForCap } = thisYear.tables;
  const { totalTraditionalWithdrawal } = flow.rmd;
  const { targetWithdrawal } = flow.need;
  const { resolvedConversionTarget } = flow.route;
  const { taxableSS, taxFromSlots } = flow.priced;
  const grownStandardDeduction = flow.priced.standardDeduction;
  const { brokerageGainsPortion } = flow.parts;
  // RMD-aware conversion smoothing (rmd-smoothing.ts): per owner, so tracked accounts only.
  let rmdSmoothingTarget: number | undefined;
  if (config.rmdSmoothingEnabled && perOwnerRmds(ctx)) {
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
      spouses: soleBeneficiarySpouseAges(
        filingStatus,
        rmdStartAgeByPerson,
        year,
      ),
      householdTraditionalBalance: balances.preTax,
      returnRateMap: ctx.returnRateMap,
      // Retirement money's Traditional share, never this year's draw mix.
      traditionalShare: thisYear.estTraditionalPortion,
      // What leaves the portfolio this year, not spending (Social Security partly covers
      // it, and a portfolio-sized strategy with Social Security on top doesn't size it).
      currentProjectedAnnualSpendingNeed: targetWithdrawal,
      postRetirementInflationRate: ctx.validatedPostRetirementInflation,
    });
    if (smoothingResult.householdSmoothingTarget > 0) {
      rmdSmoothingTarget = smoothingResult.householdSmoothingTarget;
    }
  }

  // The Roth conversion; its tax is paid from retirement brokerage money.
  const rothResult = performRothConversion({
    enableRothConversions: taxRates.enableRothConversions,
    taxBrackets: grownTaxBrackets,
    taxMultiplier: taxRates.taxMultiplier,
    standardDeduction: grownStandardDeduction,
    rothConversionTarget: config.rothConversionTarget,
    // The fallback with no rothConversionTarget: the routing reservation's chain
    // (engine-snapshot fixtures 31/41/54/55/61 pin its order).
    rothBracketTarget: resolvedConversionTarget,
    totalTraditionalWithdrawal,
    taxableSS,
    rothTaxableGrowth: taxFromSlots.rothTaxableGrowth,
    brokerageGainsPortion,
    irmaaAwareRothConversions:
      (input.irmaaAwareRothConversions ??
        (enableIrmaaAwareness ? true : undefined)) &&
      premiumYearHasEnrollee(input.perPersonBirthYears, thisYear.age, year),
    irmaaBrackets: grownIrmaaBracketsForCap,
    filingStatus,
    balances,
    accountBalance,
    // Portfolio-parented money stays out of the conversion and its tax.
    nonRetirement,
    parts: holdsAccounts
      ? {
          accounts: indAccounts,
          balances: indBalance,
          keyOf: indKey,
          basis: brokBasis,
        }
      : undefined,
    rmdSmoothingTarget,
    rmdSmoothingMaxBracketTarget: config.rmdSmoothingMaxBracketTarget,
  });
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
