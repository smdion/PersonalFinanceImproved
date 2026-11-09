/** The decumulation year's close: growth, year-end state and balances. */
import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import {
  computeNonRetirementExclusion,
  type computeWithdrawalEligibility,
} from "@/lib/pure/accounts/eligibility";
import type { BasisDraw } from "@/lib/pure/accounts/roth-basis-tracking";
import { scopedBalances } from "../balance-utils";
import { cleanupDust } from "../balance-deduction";
import {
  followDraws,
  followReconciliation,
  syncAggregateBasis,
} from "../brokerage-basis";
import { applyGrowth } from "../growth-application";
import { applyIndividualGrowth } from "../individual-accounts/ledger";
import {
  buildIndividualYearBalances,
  clampIndividualBasis,
  reconcileIndividualToAggregate,
} from "../individual-accounts/reconcile";
import { updatePerPersonTradBalance } from "./helpers";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The year closed: growth applied, next year's RMD and strategy state set,
 *  each account's row built, dust cleared, accounts reconciled to the
 *  aggregate, and retirement depletion tracked. */
export function closeDecumulationYear(
  returnRate: number,
  balances: ProjectionLoopState["balances"],
  accountBalance: ProjectionLoopState["accountBalance"],
  state: ProjectionLoopState,
  spendingState: ProjectionLoopState["spendingState"],
  hasIndividualAccounts: boolean,
  indAccounts: ProjectionContext["indAccounts"],
  indKey: ProjectionContext["indKey"],
  indBalance: ProjectionLoopState["indBalance"],
  ctx: ProjectionContext,
  decumContributionByAccount: Map<string, number>,
  indBasis: ProjectionLoopState["indBasis"],
  indParentCat: ProjectionContext["indParentCat"],
  decumulationIndWithdrawal: Map<string, number>,
  basisDraws: Map<string, BasisDraw>,
  brokBasis: ProjectionLoopState["brokBasis"],
  eligibility: ReturnType<typeof computeWithdrawalEligibility> | undefined,
  routeWarnings: string[],
  year: number,
  age: number,
) {
  // Apply growth
  applyGrowth({ effectiveReturn: returnRate, balances, accountBalance });

  // Update RMD tracking: year-end Traditional balance (after growth) for next year's RMD
  state.priorYearEndTradBalance = balances.preTax;
  // Update spending strategy state: prior year return + spending
  spendingState.priorYearReturn = returnRate;
  spendingState.priorYearSpending = state.projectedExpenses;
  // Per-individual-account growth (decumulation)
  const decumulationIndGrowth = hasIndividualAccounts
    ? applyIndividualGrowth(indAccounts, indKey, indBalance, returnRate, true)
    : new Map<string, number>();
  // Each owner's RMD base is year-end, after growth — like the household's
  // above and accumulation's.
  updatePerPersonTradBalance(ctx, state);

  // The Portfolio contributions passed in, if any.
  const decumulationIndContributions =
    decumContributionByAccount.size > 0
      ? decumContributionByAccount
      : undefined;

  // Tracked Roth basis clamped to the balance before the row is built
  // (clampBasisToBalance): losses can leave basis above what's held.
  if (hasIndividualAccounts) {
    clampIndividualBasis(indAccounts, indKey, indBasis, indBalance);
  }

  // Build individual account year balances (decumulation)
  const decumulationIndYearBalances: IndividualAccountYearBalance[] =
    hasIndividualAccounts
      ? buildIndividualYearBalances(
          indAccounts,
          indKey,
          indBalance,
          indParentCat,
          "decumulation",
          {
            contribs: decumulationIndContributions,
            growth: decumulationIndGrowth,
            withdrawal: decumulationIndWithdrawal,
            basis: indBasis,
            draws: basisDraws,
            brokerageBasis: brokBasis,
          },
          eligibility,
        )
      : [];

  // Zero out rounding dust
  followDraws(indAccounts, indKey, indBalance, brokBasis, () =>
    cleanupDust(balances, accountBalance, indAccounts, indKey, indBalance),
  );

  // indBalance reconciled to accountBalance once a year (the tracks drift), after dust
  // cleanup and before the basis re-clamp, so next year's eligibility can't
  // see an eligible balance in a locked category.
  if (hasIndividualAccounts) {
    routeWarnings.push(
      ...followReconciliation(
        indAccounts,
        indKey,
        indBalance,
        brokBasis,
        balances.afterTaxBasis,
        () =>
          reconcileIndividualToAggregate(
            indAccounts,
            indKey,
            indBalance,
            accountBalance,
          ),
      ),
    );
    // The aggregate basis is the accounts' sum.
    syncAggregateBasis(
      indAccounts,
      indKey,
      indBalance,
      brokBasis,
      balances,
      accountBalance,
      routeWarnings,
    );
  }

  // Basis re-clamped after dust cleanup: an account cleaned to $0 carries $0
  // basis into next year (the row already shows the pre-cleanup figure).
  if (hasIndividualAccounts) {
    clampIndividualBasis(indAccounts, indKey, indBasis, indBalance);
  }
  const yearEnd = scopedBalances(
    balances,
    hasIndividualAccounts
      ? computeNonRetirementExclusion(indAccounts, indBalance, indKey)
      : undefined,
  );

  // Track depletion: retirement money running out (Portfolio money is
  // never spent in retirement, so it can't keep a plan alive).
  if (yearEnd.retirementBalance < 1 && state.retirementDepletionYear === null) {
    state.retirementDepletionYear = year;
    state.retirementDepletionAge = age;
  }

  return { decumulationIndYearBalances, yearEnd };
}
