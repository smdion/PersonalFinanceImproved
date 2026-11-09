import { followDraws, groupBasisRatio } from "../brokerage-basis";
import type { EngineAccumulationYear } from "../types/projection-result";
import { roundToCents } from "../../../utils/math";
import {
  addBalance,
  setBasis,
  getBasis,
} from "../../../config/account-balance";
import { DEFAULT_TAX_RATE_BROKERAGE } from "../../../constants";
import {
  distributeGoalWithdrawal,
  goalFundingAccounts,
  goalFundingBalance,
} from "../individual-accounts/withdrawals";
import { shortfallFloor, runGapYearDraw } from "../gap-year-draw";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** A gap year's spending, drawn from the accounts before growth. */
export function yearGapDraw(
  setup: PreYearSetup,
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  year: number,
  age: number,
  proRate: number,
  hasPerPersonSalary: boolean,
  projectedSalaryByPerson: PreYearSetup["effectiveSalaryByPerson"],
  projectedSalary: number,
  totalEmployee: number,
  rampAmount: number,
  totalTraditional: number,
  routeWarnings: string[],
) {
  const gapRun = setup.gapYear
    ? runGapYearDraw(ctx, state, {
        year,
        age,
        fraction: proRate,
        payByPerson: (hasPerPersonSalary
          ? [...projectedSalaryByPerson.values()]
          : [projectedSalary]
        ).map((p) => p * proRate),
        budget: state.projectedExpenses * proRate,
        employeeContributions: totalEmployee + rampAmount,
        pretaxContributions: totalTraditional,
      })
    : null;
  const gapDraw = gapRun?.draw ?? null;
  if (gapDraw) {
    routeWarnings.push(...gapDraw.warnings);
    if (gapDraw.unmetNeed >= shortfallFloor(gapDraw.need))
      routeWarnings.push(
        `${year}: $${Math.round(gapDraw.unmetNeed).toLocaleString()} of spending can't be funded with a paycheck gone: no reachable money without a penalty.`,
      );
  }

  return { gapRun, gapDraw };
}

/** Each brokerage goal's draw this working year, from Portfolio money. */
export function brokerageGoalDraws(
  brokerageGoalsByYear: ProjectionContext["brokerageGoalsByYear"],
  year: number,
  balances: ProjectionLoopState["balances"],
  hasIndividualAccounts: boolean,
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
        hasIndividualAccounts
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
      (hasIndividualAccounts
        ? groupBasisRatio(
            goalFundingAccounts(indAccounts),
            indKey,
            indBalance,
            brokBasis,
          )
        : undefined) ??
      (balances.afterTax > 0
        ? Math.min(1, balances.afterTaxBasis / balances.afterTax)
        : 0);
    const basisPortion = roundToCents(drawAmount * basisRatio);
    const gainsPortion = roundToCents(drawAmount - basisPortion);
    const taxCost = roundToCents(
      gainsPortion *
        (decumulationDefaults.distributionTaxRates?.brokerage ??
          DEFAULT_TAX_RATE_BROKERAGE),
    );
    balances.afterTax = roundToCents(balances.afterTax - drawAmount);
    balances.afterTaxBasis = roundToCents(
      Math.max(0, balances.afterTaxBasis - basisPortion),
    );
    addBalance(accountBalance[OVERFLOW_CATEGORY], -drawAmount);
    setBasis(
      accountBalance[OVERFLOW_CATEGORY],
      roundToCents(
        Math.max(0, getBasis(accountBalance[OVERFLOW_CATEGORY]) - basisPortion),
      ),
    );
    if (hasIndividualAccounts) {
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
