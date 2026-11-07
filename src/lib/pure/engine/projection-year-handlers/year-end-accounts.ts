import { followReconciliation, syncAggregateBasis } from "../brokerage-basis";
import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import { getAllCategories } from "../../../config/account-types";
import {
  buildIndividualYearBalances,
  reconcileIndividualToAggregate,
} from "../individual-accounts/reconcile";
import { scopedBalances } from "../balance-utils";
import { computeNonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type { yearGapDraw } from "./goal-draws";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The year's per-account rows, then the accounts reconciled and checked. */
export function closeYearAccounts(
  hasIndividualAccounts: boolean,
  indAccts: ProjectionContext["indAccts"],
  indKey: ProjectionContext["indKey"],
  indBal: ProjectionLoopState["indBal"],
  indParentCat: ProjectionContext["indParentCat"],
  indContribs: Map<string, number>,
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
  acctBal: ProjectionLoopState["acctBal"],
  year: number,
  retirementYear: number,
  age: number,
) {
  const indYearBalances: IndividualAccountYearBalance[] = hasIndividualAccounts
    ? buildIndividualYearBalances(
        indAccts,
        indKey,
        indBal,
        indParentCat,
        "accumulation",
        {
          contribs: indContribs,
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

  // Reconcile indBal to acctBal once per year, as decumulation-year.ts does:
  // after the output row is built (output shows pre-cleanup figures, the
  // carried state post-cleanup) and before the divergence check below.
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

  const { allAccountsBalance, retirementBalance } = scopedBalances(
    balances,
    hasIndividualAccounts
      ? computeNonRetirementExclusion(indAccts, indBal, indKey)
      : undefined,
  );

  // Divergence check: last accumulation year
  if (year === retirementYear - 1) {
    const rothTotal = getAllCategories().reduce((s, cat) => {
      const b = acctBal[cat];
      return s + (b.structure === "roth_traditional" ? b.roth : 0);
    }, 0);
    if (Math.abs(rothTotal - balances.taxFree) > 1) {
      routeWarnings.push(
        `[DIAG] Roth divergence at end of accumulation (age ${age}): acctBal.roth=${rothTotal.toFixed(0)}, balances.taxFree=${balances.taxFree.toFixed(0)}, delta=${(balances.taxFree - rothTotal).toFixed(0)}`,
      );
    }
  }

  return { indYearBalances, allAccountsBalance, retirementBalance };
}
