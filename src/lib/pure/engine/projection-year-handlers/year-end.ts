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
  acctBal: ProjectionLoopState["acctBal"],
  state: ProjectionLoopState,
  spendingState: ProjectionLoopState["spendingState"],
  hasIndividualAccounts: boolean,
  indAccts: ProjectionContext["indAccts"],
  indKey: ProjectionContext["indKey"],
  indBal: ProjectionLoopState["indBal"],
  ctx: ProjectionContext,
  decumContribByAccount: Map<string, number>,
  indBasis: ProjectionLoopState["indBasis"],
  indParentCat: ProjectionContext["indParentCat"],
  decIndWithdrawal: Map<string, number>,
  basisDraws: Map<string, BasisDraw>,
  brokBasis: ProjectionLoopState["brokBasis"],
  eligibility: ReturnType<typeof computeWithdrawalEligibility> | undefined,
  routeWarnings: string[],
  year: number,
  age: number,
) {
  // Apply growth
  applyGrowth({ effectiveReturn: returnRate, balances, acctBal });

  // Update RMD tracking: year-end Traditional balance (after growth) for next year's RMD
  state.priorYearEndTradBalance = balances.preTax;
  // Update spending strategy state: prior year return + spending
  spendingState.priorYearReturn = returnRate;
  spendingState.priorYearSpending = state.projectedExpenses;
  // Per-individual-account growth (decumulation)
  const decIndGrowth = hasIndividualAccounts
    ? applyIndividualGrowth(indAccts, indKey, indBal, returnRate, true)
    : new Map<string, number>();
  // Each owner's RMD base is year-end, after growth — like the household's
  // above and accumulation's.
  updatePerPersonTradBalance(ctx, state);

  // The Portfolio contributions passed in, if any.
  const decIndContribs =
    decumContribByAccount.size > 0 ? decumContribByAccount : undefined;

  // Tracked Roth basis clamped to the balance before the row is built
  // (clampBasisToBalance): losses can leave basis above what's held.
  if (hasIndividualAccounts) {
    clampIndividualBasis(indAccts, indKey, indBasis, indBal);
  }

  // Build individual account year balances (decumulation)
  const decIndYearBalances: IndividualAccountYearBalance[] =
    hasIndividualAccounts
      ? buildIndividualYearBalances(
          indAccts,
          indKey,
          indBal,
          indParentCat,
          "decumulation",
          {
            contribs: decIndContribs,
            growth: decIndGrowth,
            withdrawal: decIndWithdrawal,
            basis: indBasis,
            draws: basisDraws,
            brokerageBasis: brokBasis,
          },
          eligibility,
        )
      : [];

  // Zero out rounding dust
  followDraws(indAccts, indKey, indBal, brokBasis, () =>
    cleanupDust(balances, acctBal, indAccts, indKey, indBal),
  );

  // indBal reconciled to acctBal once a year (the tracks drift), after dust
  // cleanup and before the basis re-clamp, so next year's eligibility can't
  // see an eligible balance in a locked category.
  if (hasIndividualAccounts) {
    routeWarnings.push(
      ...followReconciliation(
        indAccts,
        indKey,
        indBal,
        brokBasis,
        balances.afterTaxBasis,
        () => reconcileIndividualToAggregate(indAccts, indKey, indBal, acctBal),
      ),
    );
    // The aggregate basis is the accounts' sum.
    syncAggregateBasis(
      indAccts,
      indKey,
      indBal,
      brokBasis,
      balances,
      acctBal,
      routeWarnings,
    );
  }

  // Basis re-clamped after dust cleanup: an account cleaned to $0 carries $0
  // basis into next year (the row already shows the pre-cleanup figure).
  if (hasIndividualAccounts) {
    clampIndividualBasis(indAccts, indKey, indBasis, indBal);
  }
  const yearEnd = scopedBalances(
    balances,
    hasIndividualAccounts
      ? computeNonRetirementExclusion(indAccts, indBal, indKey)
      : undefined,
  );

  // Track depletion: retirement money running out (Portfolio money is
  // never spent in retirement, so it can't keep a plan alive).
  if (yearEnd.retirementBalance < 1 && state.retirementDepletionYear === null) {
    state.retirementDepletionYear = year;
    state.retirementDepletionAge = age;
  }

  return { decIndYearBalances, yearEnd };
}
