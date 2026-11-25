/** The decumulation year's after-tax need, and the withdrawal that meets it. */
import { roundToCents } from "../../../utils/math";
import { estimateWithdrawalTaxCost } from "../withdrawal-solver";
import { irmaaInNeed, type IrmaaCharge } from "./irmaa-charge";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** Spending less Social Security (plus IRMAA paid on top of the budget),
 *  then the gross withdrawal the solver sizes to cover it and its tax; a
 *  withdrawal-sized year's need is what that withdrawal delivers. */
export function yearNeed(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  irmaa: IrmaaCharge | undefined,
) {
  const { input, ledgerRuns, indAccounts, indKey } = ctx;
  const { filingStatus } = input;
  const { balances, accountBalance, indBalance, indBasis } = state;
  const { year, config, eligibility, taxRates, ssIncome } = thisYear;
  const { retirementBasisRatio } = thisYear;
  const { totalBalance, nonRetirement } = thisYear.setup;
  const { grownTaxBrackets } = thisYear.tables;
  const { grownStandardDeduction, grownLtcgBrackets } = thisYear.tables;
  // IRMAA on top of the budget joins a need-sized year's need (never
  // projectedExpenses or taxCost) when the year starts knowing it.
  const inNeed = irmaaInNeed(irmaa, state);
  // The after-tax need: spending (and that IRMAA) less Social Security — or,
  // for a withdrawal the strategy sized (Social Security on top), what that
  // withdrawal delivers after tax (set from the estimate below).
  let afterTaxNeed = roundToCents(
    Math.max(0, state.projectedExpenses + inNeed - ssIncome),
  );
  // Social Security beyond spending pays the year's tax first — only the
  // rest needs a withdrawal (withdrawal-solver.ts solves with the same credit).
  // A withdrawal-sized year has Social Security on top by definition.
  const ssSurplus =
    state.portfolioWithdrawal === null
      ? Math.max(0, ssIncome - state.projectedExpenses - inNeed)
      : 0;

  const taxEstimate = estimateWithdrawalTaxCost({
    afterTaxNeed,
    fixedGrossWithdrawal: state.portfolioWithdrawal ?? undefined,
    ssIncome,
    ssSurplus,
    filingStatus,
    config,
    // The grown brackets and deduction: the estimate and the year's real
    // routing and tax must see the same values.
    taxRates: {
      ...taxRates,
      taxBrackets: grownTaxBrackets,
      standardDeduction: grownStandardDeduction,
      ltcgBrackets: grownLtcgBrackets,
    },
    balances,
    accountBalance,
    totalBalance,
    brokerageBasisRatio: retirementBasisRatio,
    eligibility,
    nonRetirement,
    indAccounts: ledgerRuns ? indAccounts : undefined,
    indKey: ledgerRuns ? indKey : undefined,
    indBalance: ledgerRuns ? indBalance : undefined,
    indBasis: ledgerRuns ? indBasis : undefined,
    year,
  });
  const { targetWithdrawal } = taxEstimate;
  if (taxEstimate.derivedAfterTaxNeed !== undefined)
    afterTaxNeed = taxEstimate.derivedAfterTaxNeed;

  return { afterTaxNeed, ssSurplus, taxEstimate, targetWithdrawal, irmaa };
}
