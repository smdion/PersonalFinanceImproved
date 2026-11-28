/** The decumulation year's growth, year-end state and rows, before its close. */
import { cleanupDust } from "../balance-deduction";
import { followDraws } from "../brokerage-basis";
import {
  buildIndividualYearBalances,
  clampIndividualBasis,
} from "../individual-accounts/reconcile";
import { yearAccountView } from "../individual-accounts/year-view";
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
    holdsRealAccount,
    indAccounts: individualAccounts,
    indKey: individualKey,
    indParentCat: individualParentCategory,
  } = ctx;
  const { balances, spendingState } = state;
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
  settle(ctx, state, "decumulation.portfolioContributions");
  // Growth on each account (negatives at 0); the settle gives the totals
  const individualGrowth = growYear(ctx, state, returnRate, true);
  settle(ctx, state, "decumulation.growth");

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

  // Each part's year record (decumulation), and the view the year states
  const records = buildIndividualYearBalances(
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
  );
  const accountView = yearAccountView(
    individualAccounts,
    records,
    holdsRealAccount,
  );

  // Zero out rounding dust
  followDraws(
    individualAccounts,
    individualKey,
    individualBalance,
    brokerageBasis,
    () =>
      cleanupDust(
        balances,
        individualAccounts,
        individualKey,
        individualBalance,
      ),
  );
  settle(ctx, state, "decumulation.beforeReconcile");
  return { accountView };
}
