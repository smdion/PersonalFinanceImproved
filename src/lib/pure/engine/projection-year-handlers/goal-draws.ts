import {
  followDrawsOnCopies,
  groupBasisRatio,
  sellAtCost,
} from "../brokerage-basis";
import type { BrokerageDraw } from "../types/year-overrides";
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

/** One draw from the Portfolio brokerages after growth: at most what they
 *  hold, priced at their basis. The next draw reads the refreshed totals. */
function drawPortfolioBrokerage(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  wanted: number,
): BrokerageDraw {
  const { ledgerRuns, indAccounts, indKey } = ctx;
  const { balances, indBalance, brokBasis } = state;
  const ledger = [indAccounts, indKey, indBalance, brokBasis] as const;
  const drawAmount = roundToCents(
    Math.min(
      wanted,
      balances.afterTax,
      ledgerRuns
        ? goalFundingBalance(indAccounts, indKey, indBalance)
        : balances.afterTax,
    ),
  );
  if (drawAmount <= 0)
    return { amount: 0, basisPortion: 0, gainsPortion: 0, taxCost: 0 };
  // The aggregate ratio prices the gain when they hold nothing per account.
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
  const rates = ctx.input.decumulationDefaults.distributionTaxRates;
  const taxCost = roundToCents(
    gainsPortion * (rates?.brokerage ?? DEFAULT_TAX_RATE_BROKERAGE),
  );
  const drawn = ledgerRuns
    ? followDrawsOnCopies(...ledger, (p) =>
        distributeGoalWithdrawal(drawAmount, indAccounts, indKey, p),
      )
    : undefined;
  drawn?.land();
  refreshViews(ctx, state);
  return { amount: drawAmount, basisPortion, gainsPortion, taxCost };
}

/** This working year's planned brokerage withdrawals, then each brokerage
 *  goal's draw by priority, all from Portfolio money. */
export function brokerageGoalDraws(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  year: number,
  routeWarnings: string[],
) {
  const planned = ctx.input.brokerageWithdrawals ?? [];
  const brokerageWithdrawals = planned
    .filter((w) => w.year === year)
    .map((w) => ({
      id: w.id,
      ...(w.label ? { label: w.label } : {}),
      requested: w.amount,
      ...drawPortfolioBrokerage(ctx, state, w.amount),
    }));
  const yearGoals = ctx.brokerageGoalsByYear.get(year) ?? [];
  const goalWithdrawals = yearGoals.map((goal) => {
    const draw = drawPortfolioBrokerage(ctx, state, goal.targetAmount);
    if (draw.amount <= 0)
      routeWarnings.push(
        `Brokerage goal "${goal.name}" unfunded — insufficient balance`,
      );
    return { goalId: goal.id, name: goal.name, ...draw };
  });

  return { goalWithdrawals, brokerageWithdrawals };
}
