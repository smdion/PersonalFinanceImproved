/** The decumulation year's close: growth, year-end state and balances. */
import { computeNonRetirementExclusion } from "@/lib/pure/accounts/eligibility";
import { scopedBalances } from "../balance-utils";
import { clampIndividualBasis } from "../individual-accounts/reconcile";
import { growYearToRows } from "./year-end-rows";
import type {
  DecumulationYear,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";
import type { DecumulationFlow } from "./tax-year-settlement";
import type { decumulationPortfolioContributions } from "./portfolio-contributions";

/** The year closed: growth applied, next year's RMD and strategy state set,
 *  each account's row built, dust cleared, and retirement depletion
 *  tracked. */
export function closeDecumulationYear(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  thisYear: DecumulationYear,
  flow: Pick<DecumulationFlow, "drawn"> & {
    contributions: ReturnType<typeof decumulationPortfolioContributions>;
  },
) {
  const { ledgerRuns, indAccounts, indKey } = ctx;
  const { balances, indBalance, indBasis } = state;
  const { year, age } = thisYear;
  const { individualYearBalances } = growYearToRows(ctx, state, thisYear, flow);

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
