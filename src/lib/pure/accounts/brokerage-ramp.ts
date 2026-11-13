/** Where the brokerage ramp lands, and so whether it is Portfolio saving. */
import {
  isOverflowTarget,
  isRetirementMoney,
} from "@/lib/config/account-types";
import type { IndividualAccountInput } from "./account-balances.types";

type RampAccount = Pick<
  IndividualAccountInput,
  "category" | "origin" | "parentCategory"
>;

/**
 * The ramp's brokerages: the real Portfolio ones when there are any, else
 * every real one, else the projection-only retirement brokerage.
 */
export function rampBrokerages<T extends RampAccount>(
  accounts: readonly T[],
  parentOf: (account: T) => string | undefined = (a) => a.parentCategory,
): T[] {
  const brokerages = accounts.filter((a) => isOverflowTarget(a.category));
  const real = brokerages.filter((a) => a.origin !== "projected");
  if (real.length === 0) return brokerages;
  const portfolio = real.filter((a) => !isRetirementMoney(parentOf(a)));
  return portfolio.length > 0 ? portfolio : real;
}

/** The ramp is Portfolio saving when it lands in a Portfolio brokerage; otherwise retirement money. */
export function rampIsPortfolioSaving<T extends RampAccount>(
  accounts: readonly T[],
  parentOf: (account: T) => string | undefined = (a) => a.parentCategory,
): boolean {
  return rampBrokerages(accounts, parentOf).some(
    (a) => !isRetirementMoney(parentOf(a)),
  );
}
