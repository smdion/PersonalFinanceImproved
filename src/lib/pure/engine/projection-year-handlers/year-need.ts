/** The decumulation year's after-tax need, and the withdrawal that meets it. */
import { roundToCents } from "../../../utils/math";
import { yearMagi } from "@/lib/pure/tax/year-income";
import type { computeWithdrawalEligibility } from "@/lib/pure/accounts/eligibility";
import type {
  growIrmaaBrackets,
  growLtcgBrackets,
  growWithholdingBrackets,
} from "../bracket-growth";
import { checkHouseholdIrmaa } from "../household-irmaa";
import type { resolveDecumulationConfig } from "../override-resolution";
import { estimateWithdrawalTaxCost } from "../withdrawal-solver";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** Spending less Social Security (plus IRMAA paid on top of the budget),
 *  then the gross withdrawal the solver sizes to cover it and its tax; a
 *  withdrawal-sized year's need is what that withdrawal delivers. */
export function yearNeed(
  state: ProjectionLoopState,
  ssIncome: number,
  input: ProjectionContext["input"],
  incomeHistory: ProjectionLoopState["incomeHistory"],
  enableIrmaaAwareness: ProjectionContext["input"]["enableIrmaaAwareness"],
  filingStatus: ProjectionContext["input"]["filingStatus"],
  personsAge65Plus: number,
  grownIrmaaBracketsForCheck: ReturnType<typeof growIrmaaBrackets>,
  config: ReturnType<typeof resolveDecumulationConfig>,
  taxRates: ProjectionContext["input"]["decumulationDefaults"]["distributionTaxRates"],
  grownTaxBrackets: ReturnType<typeof growWithholdingBrackets> | undefined,
  grownStandardDeduction: number | undefined,
  grownLtcgBrackets: ReturnType<typeof growLtcgBrackets>,
  balances: ProjectionLoopState["balances"],
  accountBalance: ProjectionLoopState["accountBalance"],
  totalBalance: PreYearSetup["totalBalance"],
  retirementBasisRatio: number | undefined,
  eligibility: ReturnType<typeof computeWithdrawalEligibility> | undefined,
  nonRetirement: PreYearSetup["nonRetirement"],
  hasIndividualAccounts: boolean,
  indAccounts: ProjectionContext["indAccounts"],
  indKey: ProjectionContext["indKey"],
  indBalance: ProjectionLoopState["indBalance"],
  indBasis: ProjectionLoopState["indBasis"],
  year: number,
) {
  // The year's after-tax need: spending less Social Security — or, when
  // the strategy sized the gross withdrawal (Social Security on top), what
  // that withdrawal delivers after tax (set from the estimate below).
  let afterTaxNeed = roundToCents(
    Math.max(0, state.projectedExpenses - ssIncome),
  );
  // Social Security beyond spending pays the year's tax first — only the
  // rest needs a withdrawal (withdrawal-solver.ts solves with the same credit).
  // A withdrawal-sized year has Social Security on top by definition.
  let ssSurplus =
    state.portfolioWithdrawal === null
      ? Math.max(0, ssIncome - state.projectedExpenses)
      : 0;

  // IRMAA paid on top of the budget joins a need-sized year's need (never
  // projectedExpenses or taxCost), once the year-N-2 MAGI is known; until
  // then, or in a withdrawal-sized year, it only lowers what's spent.
  if (
    input.irmaaOnTopOfBudget === true &&
    state.portfolioWithdrawal === null &&
    incomeHistory.length >= 2
  ) {
    const irmaaInNeed = checkHouseholdIrmaa({
      enableIrmaaAwareness,
      filingStatus,
      personsAge65Plus,
      projectedMagi: yearMagi(incomeHistory.at(-2)!, "irmaa"),
      rothConversionAmount: 0,
      irmaaBrackets: grownIrmaaBracketsForCheck,
    }).irmaaCost;
    afterTaxNeed = roundToCents(
      Math.max(0, state.projectedExpenses + irmaaInNeed - ssIncome),
    );
    ssSurplus = Math.max(0, ssIncome - state.projectedExpenses - irmaaInNeed);
  }

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
    indAccounts: hasIndividualAccounts ? indAccounts : undefined,
    indKey: hasIndividualAccounts ? indKey : undefined,
    indBalance: hasIndividualAccounts ? indBalance : undefined,
    indBasis: hasIndividualAccounts ? indBasis : undefined,
    year,
  });
  const { targetWithdrawal } = taxEstimate;
  if (taxEstimate.derivedAfterTaxNeed !== undefined)
    afterTaxNeed = taxEstimate.derivedAfterTaxNeed;

  return { afterTaxNeed, ssSurplus, taxEstimate, targetWithdrawal };
}
