import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import { buildIndividualYearBalances } from "../individual-accounts/reconcile";
import { scopedBalances } from "../balance-utils";
import { computeNonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import type { yearGapDraw } from "./goal-draws";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** The year's per-account rows and its year-end balances. */
export function closeYearAccounts(
  ctx: Pick<ProjectionContext, "ledgerRuns" | "holdsRealAccount">,
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
  balances: ProjectionLoopState["balances"],
) {
  const { ledgerRuns, holdsRealAccount } = ctx;
  const indYearBalances: IndividualAccountYearBalance[] = holdsRealAccount
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

  const { allAccountsBalance, retirementBalance } = scopedBalances(
    balances,
    ledgerRuns
      ? computeNonRetirementExclusion(indAccounts, indBalance, indKey)
      : undefined,
  );

  return { indYearBalances, allAccountsBalance, retirementBalance };
}
