import { followReconciliation, syncAggregateBasis } from "../brokerage-basis";
import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import {
  buildIndividualYearBalances,
  reconcileIndividualToAggregate,
} from "../individual-accounts/reconcile";
import { scopedBalances } from "../balance-utils";
import { computeNonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type { yearGapDraw } from "./goal-draws";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The year's per-account rows, then the accounts reconciled. */
export function closeYearAccounts(
  ledgerRuns: boolean,
  indAccounts: ProjectionContext["indAccounts"],
  indKey: ProjectionContext["indKey"],
  indBalance: ProjectionLoopState["indBalance"],
  indParentCat: ProjectionContext["indParentCat"],
  indContributions: Map<string, number>,
  indMatch: Map<string, number>,
  indGrowth: Map<string, number>,
  indIntentional: Map<string, number>,
  indOverflow: Map<string, number>,
  indRamp: Map<string, number>,
  indBasis: ProjectionLoopState["indBasis"],
  brokBasis: ProjectionLoopState["brokBasis"],
  gapRun: ReturnType<typeof yearGapDraw>["gapRun"],
  routeWarnings: string[],
  balances: ProjectionLoopState["balances"],
  accountBalance: ProjectionLoopState["accountBalance"],
) {
  const indYearBalances: IndividualAccountYearBalance[] = ledgerRuns
    ? buildIndividualYearBalances(
        indAccounts,
        indKey,
        indBalance,
        indParentCat,
        "accumulation",
        {
          contribs: indContributions,
          match: indMatch,
          growth: indGrowth,
          intentional: indIntentional,
          overflow: indOverflow,
          ramp: indRamp,
          basis: indBasis,
          brokerageBasis: brokBasis,
          ...(gapRun?.accounts
            ? {
                withdrawal: gapRun.accounts.withdrawal,
                draws: gapRun.accounts.draws,
              }
            : {}),
        },
        gapRun?.accounts?.eligibility,
      )
    : [];

  // Reconcile indBalance to accountBalance once per year, as decumulation-year.ts does:
  // after the output row is built (output shows pre-cleanup figures, the
  // carried state post-cleanup).
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

  const { allAccountsBalance, retirementBalance } = scopedBalances(
    balances,
    ledgerRuns
      ? computeNonRetirementExclusion(indAccounts, indBalance, indKey)
      : undefined,
  );

  return { indYearBalances, allAccountsBalance, retirementBalance };
}
