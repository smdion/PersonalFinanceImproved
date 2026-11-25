/** The decumulation year's Portfolio contributions, reported only. */
import { roundToCents } from "../../../utils/math";
import { isRetirementMoney } from "../../../config/account-types";
import { MAX_BROKERAGE_RAMP_YEARS } from "../../../constants";
import { rampBrokerages } from "../../accounts/brokerage-ramp";
import { specKeyOf } from "../individual-accounts/ledger";
import {
  creditWhole,
  equalShares,
  inflowShares,
} from "../individual-accounts/part-weights";
import { creditSpecParts } from "../individual-accounts/spec-accounts";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Contributions that continue into retirement and the brokerage ramp, per
 *  account: shown on the Portfolio page, never added to balances. */
export function decumulationPortfolioContributions(
  ctx: ProjectionContext,
  state: ProjectionLoopState,
  yearIndex: number,
) {
  const { input, indKey, indAccounts } = ctx;
  const { indBalance } = state;
  // Portfolio contributions after retirement, for the Portfolio page only:
  // never added to balances (Portfolio accounts are read-only inputs here;
  // parentCategory sets the boundary).
  const { brokerageContributionRamp, limitGrowthRate } = input;
  const lgf = Math.pow(1 + limitGrowthRate, yearIndex);
  let decumBrokerageContribution = 0;
  const decumContributionByAccount = new Map<string, number>();
  if (state.contributionSpecs) {
    const portfolioSpecs = state.contributionSpecs.filter(
      (s) =>
        !isRetirementMoney(s.parentCategory) &&
        s.retirementBehavior === "continues_after_retirement" &&
        s.method !== "percent_of_salary",
    );
    for (const spec of portfolioSpecs) {
      const amount = roundToCents(spec.baseAnnual * lgf);
      if (amount <= 0) continue;
      decumBrokerageContribution += amount;
      // The spec's parts, as accumulation pays them.
      const parts = state.specToAccount.get(specKeyOf(spec));
      if (parts)
        creditSpecParts({ indAccounts, indKey, indBalance }, parts, amount, [
          decumContributionByAccount,
        ]);
    }
  }
  // Portfolio contribution ramp (report-only — not applied to balances)
  const rampYear = Math.min(yearIndex, MAX_BROKERAGE_RAMP_YEARS);
  const decumRampAmount =
    (brokerageContributionRamp ?? 0) > 0 && yearIndex > 0
      ? roundToCents(brokerageContributionRamp! * rampYear)
      : 0;
  if (decumRampAmount > 0) {
    decumBrokerageContribution += decumRampAmount;
    // The ramp spread over brokerages by balance (Portfolio ones first; the
    // projection-only one only with no real brokerage), as accumulation does.
    const rampAccounts = rampBrokerages(indAccounts);
    const shares = inflowShares(
      rampAccounts.map((ia) => indBalance.get(indKey(ia)) ?? 0),
      equalShares(rampAccounts.length),
    );
    const raw = shares.map((s) => decumRampAmount * s);
    creditWhole(rampAccounts.map(indKey), decumRampAmount, raw, [
      decumContributionByAccount,
    ]);
  }

  return {
    decumBrokerageContribution,
    decumContributionByAccount,
    decumRampAmount,
  };
}
