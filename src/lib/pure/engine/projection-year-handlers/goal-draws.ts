import { followDraws, groupBasisRatio, sellAtCost } from "../brokerage-basis";
import type { EngineAccumulationYear } from "../types/projection-result";
import { roundToCents } from "../../../utils/math";
import { addBalance, setBasis, getBasis } from "../../accounts/account-balance";
import { DEFAULT_TAX_RATE_BROKERAGE } from "../../../constants";
import {
  distributeGoalWithdrawal,
  goalFundingAccounts,
  goalFundingBalance,
} from "../individual-accounts/withdrawals";
import { runGapYearDraw } from "../gap-year-draw";
import type { GapYearNeed } from "../gap-year-need";
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

/** Each brokerage goal's draw this working year, from Portfolio money. */
export function brokerageGoalDraws(
  brokerageGoalsByYear: ProjectionContext["brokerageGoalsByYear"],
  year: number,
  balances: ProjectionLoopState["balances"],
  holdsAccounts: boolean,
  indAccounts: ProjectionContext["indAccounts"],
  indKey: ProjectionContext["indKey"],
  indBalance: ProjectionLoopState["indBalance"],
  routeWarnings: string[],
  brokBasis: ProjectionLoopState["brokBasis"],
  decumulationDefaults: ProjectionContext["input"]["decumulationDefaults"],
  accountBalance: ProjectionLoopState["accountBalance"],
  OVERFLOW_CATEGORY: ProjectionContext["OVERFLOW_CATEGORY"],
) {
  const yearGoals = brokerageGoalsByYear.get(year) ?? [];
  const goalWithdrawals: EngineAccumulationYear["brokerageGoalWithdrawals"] =
    [];
  for (const goal of yearGoals) {
    // Goals are Portfolio money: with individual accounts, the most a goal
    // can draw is what the Portfolio-parented brokerages hold.
    const drawAmount = roundToCents(
      Math.min(
        goal.targetAmount,
        balances.afterTax,
        holdsAccounts
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
      (holdsAccounts
        ? groupBasisRatio(
            goalFundingAccounts(indAccounts),
            indKey,
            indBalance,
            brokBasis,
          )
        : undefined) ??
      (balances.afterTax > 0 ? balances.afterTaxBasis / balances.afterTax : 0);
    const { basisOut, basisPortion, gainsPortion } = sellAtCost(
      drawAmount,
      basisRatio,
    );
    const taxCost = roundToCents(
      gainsPortion *
        (decumulationDefaults.distributionTaxRates?.brokerage ??
          DEFAULT_TAX_RATE_BROKERAGE),
    );
    balances.afterTax = roundToCents(balances.afterTax - drawAmount);
    balances.afterTaxBasis = roundToCents(
      Math.max(0, balances.afterTaxBasis - basisOut),
    );
    addBalance(accountBalance[OVERFLOW_CATEGORY], -drawAmount);
    setBasis(
      accountBalance[OVERFLOW_CATEGORY],
      roundToCents(
        Math.max(0, getBasis(accountBalance[OVERFLOW_CATEGORY]) - basisOut),
      ),
    );
    if (holdsAccounts) {
      followDraws(indAccounts, indKey, indBalance, brokBasis, () =>
        distributeGoalWithdrawal(drawAmount, indAccounts, indKey, indBalance),
      );
    }
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
