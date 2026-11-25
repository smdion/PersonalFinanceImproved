/** The decumulation year's close: growth, year-end state and balances. */
import { computeNonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import { scopedBalances } from "../balance-utils";
import { followReconciliation, syncAggregateBasis } from "../brokerage-basis";
import {
  clampIndividualBasis,
  reconcileIndividualToAggregate,
} from "../individual-accounts/reconcile";
import { growYearToRows } from "./year-end-rows";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import type { DecumulationFlow } from "./tax-year-settlement";
import type { decumulationPortfolioContributions } from "./portfolio-contributions";

/** The year closed: growth applied, next year's RMD and strategy state set,
 *  each account's row built, dust cleared, accounts reconciled to the
 *  aggregate, and retirement depletion tracked. */
export function closeDecumulationYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "route" | "drawn"> & {
    contributions: ReturnType<typeof decumulationPortfolioContributions>;
  },
) {
  const { ledgerRuns, indAccounts, indKey } = ctx;
  const { balances, accountBalance } = state;
  const { indBalance, indBasis, brokBasis } = state;
  const { year, age } = thisYear;
  const { routeWarnings } = flow.route;
  const { individualYearBalances } = growYearToRows(ctx, state, thisYear, flow);

  // indBalance reconciled to accountBalance once a year (the tracks drift), after dust
  // cleanup and before the basis re-clamp, so next year's eligibility can't
  // see an eligible balance in a locked category.
  if (ledgerRuns) {
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
  if (ledgerRuns) {
    clampIndividualBasis(indAccounts, indKey, indBasis, indBalance);
  }
  const yearEnd = scopedBalances(
    balances,
    ledgerRuns
      ? computeNonRetirementExclusion(indAccounts, indBalance, indKey)
      : undefined,
  );

  // Track depletion: retirement money running out (Portfolio money is
  // never spent in retirement, so it can't keep a plan alive).
  if (yearEnd.retirementBalance < 1 && state.retirementDepletionYear === null) {
    state.retirementDepletionYear = year;
    state.retirementDepletionAge = age;
  }

  return { individualYearBalances, yearEnd };
}
