/** The decumulation year's Portfolio contributions, reported only. */
import { roundToCents } from "../../../utils/math";
import {
  isOverflowTarget,
  isRetirementMoney,
} from "../../../config/account-types";
import { MAX_BROKERAGE_RAMP_YEARS } from "../../../constants";
import { portfolioFirst, specKeyOf } from "../individual-accounts/ledger";
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
      if (spec.accountName) {
        // The spec's account from state.specToAccount (owner-aware, as accumulation
        // matches it), so two owners' same-named accounts don't collide; by name
        // only when the spec has no entry.
        const matchedKey = state.specToAccount.get(specKeyOf(spec));
        const matchingAccount = matchedKey
          ? ctx.indAccounts.find((ia) => indKey(ia) === matchedKey)
          : ctx.indAccounts.find((ia) => ia.name === spec.accountName);
        if (matchingAccount) {
          const k = indKey(matchingAccount);
          decumContributionByAccount.set(
            k,
            (decumContributionByAccount.get(k) ?? 0) + amount,
          );
        }
      }
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
    const brokerages = indAccounts.filter((ia) =>
      isOverflowTarget(ia.category),
    );
    const realBrokerages = brokerages.filter((ia) => !ia.projectedOnly);
    const rampAccounts =
      realBrokerages.length > 0
        ? portfolioFirst(realBrokerages, (ia) => ia.parentCategory)
        : brokerages;
    const rampTotal = rampAccounts.reduce(
      (s, ia) => s + (indBalance.get(indKey(ia)) ?? 0),
      0,
    );
    for (const ia of rampAccounts) {
      const k = indKey(ia);
      const weight =
        rampTotal > 0
          ? (indBalance.get(k) ?? 0) / rampTotal
          : 1 / rampAccounts.length;
      const portion = roundToCents(decumRampAmount * weight);
      decumContributionByAccount.set(
        k,
        (decumContributionByAccount.get(k) ?? 0) + portion,
      );
    }
  }

  return {
    decumBrokerageContribution,
    decumContributionByAccount,
    decumRampAmount,
  };
}
