/** The decumulation year's growth, year-end state and rows, before the reconcile. */
import type { IndividualAccountYearBalance } from "../../accounts/account-balances.types";
import { cleanupDust } from "../balance-deduction";
import { followDraws } from "../brokerage-basis";
import {
  buildIndividualYearBalances,
  clampIndividualBasis,
} from "../individual-accounts/reconcile";
import { updatePerPersonTradBalance } from "./helpers";
import { settle } from "./settle";
import { growYear } from "./year-growth";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import type { DecumulationFlow } from "./tax-year-settlement";
import type { decumulationPortfolioContributions } from "./portfolio-contributions";

/** Growth applied, next year's RMD base and strategy state set, each
 *  account's row built, then dust cleared. */
export function growYearToRows(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "drawn"> & {
    contributions: ReturnType<typeof decumulationPortfolioContributions>;
  },
) {
  const {
    ledgerRuns,
    indAccounts: individualAccounts,
    indKey: individualKey,
    indParentCat: individualParentCategory,
  } = ctx;
  const { balances, accountBalance, spendingState } = state;
  const {
    indBalance: individualBalance,
    indBasis: individualBasis,
    brokBasis: brokerageBasis,
  } = state;
  const { eligibility } = thisYear;
  const { returnRate } = thisYear.setup;
  const { decumContributionByAccount: contributionByAccount } =
    flow.contributions;
  const { decumulationIndWithdrawal: individualWithdrawal, basisDraws } =
    flow.drawn;
  // The Portfolio contributions, reported only, are the last flow before
  // growth: nothing writes between them and here.
  settle(state, "decumulation.portfolioContributions");
  // Apply growth, to each account (negatives at 0) and the totals
  const individualGrowth = growYear(ctx, state, returnRate, true);
  settle(state, "decumulation.growth");

  // Update RMD tracking: year-end Traditional balance (after growth) for next year's RMD
  state.priorYearEndTradBalance = balances.preTax;
  // Update spending strategy state: prior year return + spending
  spendingState.priorYearReturn = returnRate;
  spendingState.priorYearSpending = state.projectedExpenses;
  // Each owner's RMD base is year-end, after growth — like the household's
  // above and accumulation's.
  updatePerPersonTradBalance(ctx, state);

  // The Portfolio contributions passed in, if any.
  const individualContributions =
    contributionByAccount.size > 0 ? contributionByAccount : undefined;

  // Tracked Roth basis clamped to the balance before the row is built
  // (clampBasisToBalance): losses can leave basis above what's held.
  if (ledgerRuns) {
    clampIndividualBasis(
      individualAccounts,
      individualKey,
      individualBasis,
      individualBalance,
    );
  }

  // Build individual account year balances (decumulation)
  const individualYearBalances: IndividualAccountYearBalance[] = ledgerRuns
    ? buildIndividualYearBalances(
        individualAccounts,
        individualKey,
        individualBalance,
        individualParentCategory,
        "decumulation",
        {
          contribs: individualContributions,
          growth: individualGrowth,
          withdrawal: individualWithdrawal,
          basis: individualBasis,
          draws: basisDraws,
          brokerageBasis,
        },
        eligibility,
      )
    : [];

  // Zero out rounding dust
  followDraws(
    individualAccounts,
    individualKey,
    individualBalance,
    brokerageBasis,
    () =>
      cleanupDust(
        balances,
        accountBalance,
        individualAccounts,
        individualKey,
        individualBalance,
      ),
  );
  settle(state, "decumulation.beforeReconcile");
  return { individualYearBalances };
}
