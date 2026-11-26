import {
  followDrawsSoldOnCopies,
  groupBasisRatio,
  sellAtCost,
} from "../brokerage-basis";
import type { EngineAccumulationYear } from "../types/projection-result";
import { roundToCents } from "../../../utils/math";
import { DEFAULT_TAX_RATE_BROKERAGE } from "../../../constants";
import {
  distributeGoalWithdrawal,
  goalFundingAccounts,
  goalFundingBalance,
} from "../individual-accounts/withdrawals";
import { runGapYearDraw } from "../gap-year-draw";
import type { GapYearNeed } from "../gap-year-need";
import { refreshViews } from "./settle";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** A gap year's spending, drawn from the accounts before growth. */
export function yearGapDraw(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  gapNeed: GapYearNeed | null,
  routeWarnings: string[],
) {
  const gapRun = gapNeed ? runGapYearDraw(ctx, state, gapNeed) : null;
  const gapDraw = gapRun?.draw ?? null;
  if (gapDraw) routeWarnings.push(...gapDraw.warnings);

  return { gapRun, gapDraw };
}

/** Each brokerage goal's draw this working year, from Portfolio money: it
 *  moves the accounts, and the next goal reads the refreshed totals. */
export function brokerageGoalDraws(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  year: number,
  routeWarnings: string[],
) {
  const { brokerageGoalsByYear, ledgerRuns, indAccounts, indKey } = ctx;
  const { decumulationDefaults } = ctx.input;
  const { balances, indBalance, brokBasis } = state;
  const yearGoals = brokerageGoalsByYear.get(year) ?? [];
  const ledger = [indAccounts, indKey, indBalance, brokBasis] as const;
  const goalWithdrawals: EngineAccumulationYear["brokerageGoalWithdrawals"] =
    [];
  for (const goal of yearGoals) {
    // Goals are Portfolio money: with individual accounts, the most a goal
    // can draw is what the Portfolio-parented brokerages hold.
    const drawAmount = roundToCents(
      Math.min(
        goal.targetAmount,
        balances.afterTax,
        ledgerRuns
          ? goalFundingBalance(indAccounts, indKey, indBalance)
          : balances.afterTax,
      ),
    );
    if (drawAmount <= 0) {
      goalWithdrawals.push({
        goalId: goal.id,
        name: goal.name,
        amount: 0,
        basisPortion: 0,
        gainsPortion: 0,
        taxCost: 0,
      });
      routeWarnings.push(
        `Brokerage goal "${goal.name}" unfunded — insufficient balance`,
      );
      continue;
    }
    // Goals draw Portfolio brokerages, so their own basis prices the gain
    // (the aggregate ratio when they hold nothing per account).
    const basisRatio =
      (ledgerRuns
        ? groupBasisRatio(
            goalFundingAccounts(indAccounts),
            indKey,
            indBalance,
            brokBasis,
          )
        : undefined) ??
      (balances.afterTax > 0 ? balances.afterTaxBasis / balances.afterTax : 0);
    const { basisPortion, gainsPortion } = sellAtCost(drawAmount, basisRatio);
    const taxCost = roundToCents(
      gainsPortion *
        (decumulationDefaults.distributionTaxRates?.brokerage ??
          DEFAULT_TAX_RATE_BROKERAGE),
    );
    const drawn = ledgerRuns
      ? followDrawsSoldOnCopies(...ledger, (p) =>
          distributeGoalWithdrawal(drawAmount, indAccounts, indKey, p),
        )
      : undefined;
    drawn?.land();
    refreshViews(ctx, state);
    goalWithdrawals.push({
      goalId: goal.id,
      name: goal.name,
      amount: drawAmount,
      basisPortion,
      gainsPortion,
      taxCost,
    });
  }

  return { goalWithdrawals };
}
