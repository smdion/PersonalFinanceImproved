/** The decumulation year's row: what its stages settled, as the response reports it. */
import { roundToCents, sumBy } from "../../../utils/math";
import {
  getAllCategories,
  nonMedicalPenaltyRate,
} from "../../../config/account-types";
import { cloneAccountBalances } from "../balance-utils";
import type { EngineDecumulationYear } from "../types/projection-result";
import type { rmdIncomeByOwner } from "./decumulation-income";
import type { qcdStep } from "./rmd-step";
import type { settleYearDraws } from "./tax-year-settlement";
import type { fundingShortfallForYear } from "./funding-shortfall";
import type { yearCliffChecks } from "./year-cliffs";
import type { closeDecumulationYear } from "./year-end";
import type { RepricedFlow } from "./conversion-year-reprice";
import type { decumulationPortfolioContributions } from "./portfolio-contributions";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** The stages' results the row reads beyond the flow, by stage. */
export type DecumulationRowParts = {
  owed: ReturnType<typeof rmdIncomeByOwner>;
  qcd: ReturnType<typeof qcdStep>;
  settle: ReturnType<typeof settleYearDraws>;
  shortfall: ReturnType<typeof fundingShortfallForYear>;
  cliffs: ReturnType<typeof yearCliffChecks>;
  closed: ReturnType<typeof closeDecumulationYear>;
};

/** The year's row, its fields in the response's order. */
export function decumulationYearRow(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: RepricedFlow & {
    contributions: ReturnType<typeof decumulationPortfolioContributions>;
  },
  parts: DecumulationRowParts,
): EngineDecumulationYear {
  const { budgetOverrideMap } = ctx;
  const { balances, accountBalance } = state;
  const { year, age, config, eligibility, ssIncome, ssIncomeByPerson } =
    thisYear;
  const { estTraditionalPortion, priorYearEndTradBalance } = thisYear;
  const { returnRate, strategyAction } = thisYear.setup;
  const { grownStandardDeduction } = thisYear.tables;
  const { afterTaxNeed, targetWithdrawal } = flow.need;
  const { preWithdrawalAcctBal, routeResult, slots, routeWarnings } =
    flow.route;
  const { penaltyAvoidedShortfall, nonRetirementShortfall } = flow.route;
  const { totalWithdrawal, totalRothWithdrawal, totalTraditionalWithdrawal } =
    flow.rmd;
  const { rmdDivisor, ownerRmd, rmdOverrodeRouting } = flow.rmd;
  const { rmdShortfallAmount, rmdAmount } = flow.rmd;
  const { taxableSS } = flow.priced;
  const { penaltyCost, ssTaxCost, grossUpFactor } = flow.parts;
  const { rothConversionAmount, rothConversionTaxCost } = flow.conversion;
  const { rmdSmoothingShortfall, rothConversionIrmaaCapped } = flow.conversion;
  const { taxCost, postConversionLtcgRate, niitAmount } = flow.repriced;
  const { rmdByPerson } = parts.owed;
  const { totalQcd, qcdByPerson } = parts.qcd;
  const { rmdExcessAmount } = parts.settle;
  const { deliveredAfterTax, shortfallMaterialityFloor } = parts.shortfall;
  const { unmetNeedRaw, unmetNeedMaterial } = parts.shortfall;
  const { irmaaCost, irmaaPaid, acaSubsidyPreserved, acaMagiHeadroom } =
    parts.cliffs;
  const { yearEnd } = parts.closed;

  return {
    year,
    age,
    phase: "decumulation",
    projectedExpenses: roundToCents(state.projectedExpenses),
    spending: roundToCents(
      deliveredAfterTax -
        irmaaPaid -
        (config.rmdExcessHandling === "reinvest" ? rmdExcessAmount : 0) +
        ssIncome,
    ),
    withdrawalSized: state.portfolioWithdrawal !== null,
    budgetOnlyExpenses: roundToCents(state.budgetOnlyExpenses),
    hasBudgetOverride: budgetOverrideMap.has(year),
    brokerageContribution: flow.contributions.decumBrokerageContribution,
    brokerageRampContribution: flow.contributions.decumRampAmount,
    targetWithdrawal,
    config,
    slots,
    totalWithdrawal,
    totalRothWithdrawal,
    totalTraditionalWithdrawal,
    taxCost,
    // On the withdrawal: tax on Social Security is owed whether or not
    // anything is withdrawn (`ssTaxCost`, shown on its own line).
    effectiveTaxRate:
      totalWithdrawal > 0 ? (taxCost - ssTaxCost) / totalWithdrawal : 0,
    ssTaxCost,
    ssIncome,
    ssIncomeByPerson,
    afterTaxNeed,
    grossUpFactor,
    estTraditionalPortion,
    bracketTraditionalCap: routeResult.traditionalCap,
    standardDeduction: grownStandardDeduction,
    discretionaryTierBreakdown: routeResult.tierBreakdown,
    rothBasisCapacity: routeResult.rothBasisCapacity,
    brokerageZeroLtcgCapacity: routeResult.brokerageZeroLtcgCapacity,
    unmetNeed: unmetNeedRaw,
    unmetNeedMaterial,
    shortfallMaterialityFloor,
    penaltyAvoidedShortfall,
    nonRetirementShortfall,
    penaltyCost,
    deliveredAfterTax,
    penaltyLockedStillExcluded: eligibility
      ? roundToCents(
          sumBy(
            getAllCategories().filter((c) => nonMedicalPenaltyRate(c) == null),
            (c) => eligibility.penaltyExposedTotalStillExcluded[c],
          ),
        )
      : undefined,
    preWithdrawalAcctBal,
    retirementBalance: yearEnd.retirementBalance,
    allAccountsBalance: yearEnd.allAccountsBalance,
    balanceByTaxType: { ...balances },
    balanceByAccount: cloneAccountBalances(accountBalance),
    individualAccountBalances: parts.closed.decumulationIndYearBalances,
    returnRate,
    annualizedReturnRate: returnRate,
    rmdAmount,
    rmdByPerson,
    rmdDivisor,
    priorYearEndTradBalance,
    rmdOverrodeRouting,
    rmdShortfallAmount,
    ...(ownerRmd && ownerRmd.rmdReassignedAmount > 0
      ? { rmdReassignedAmount: ownerRmd.rmdReassignedAmount }
      : {}),
    rmdExcessAmount,
    rmdSmoothingShortfall,
    qcdAmount: totalQcd,
    qcdByPerson: qcdByPerson.length > 0 ? qcdByPerson : undefined,
    taxableSS,
    ltcgRate: postConversionLtcgRate,
    rothConversionAmount,
    rothConversionTaxCost,
    rothConversionIrmaaCapped,
    strategyAction,
    niitAmount,
    irmaaCost,
    ...(irmaaPaid > 0 ? { irmaaPaid } : {}),
    acaSubsidyPreserved,
    acaMagiHeadroom,
    warnings: routeWarnings,
  };
}
