/** The decumulation year's Portfolio contributions, reported only. */
import { roundToCents } from "../../../utils/math";
import {
  isOverflowTarget,
  isRetirementMoney,
} from "../../../config/account-types";
import { MAX_BROKERAGE_RAMP_YEARS } from "../../../constants";
import { portfolioFirst, specKeyOf } from "../individual-account-tracking";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Contributions that continue into retirement and the brokerage ramp, per
 *  account: shown on the Portfolio page, never added to balances. */
export function decumulationPortfolioContributions(
  input: ProjectionContext["input"],
  yearIndex: number,
  state: ProjectionLoopState,
  ctx: ProjectionContext,
  indKey: ProjectionContext["indKey"],
  indAccts: ProjectionContext["indAccts"],
  indBal: ProjectionLoopState["indBal"],
) {
  // Portfolio contributions after retirement, for the Portfolio page only:
  // never added to balances (Portfolio accounts are read-only inputs here;
  // parentCategory sets the boundary).
  const { brokerageContributionRamp, limitGrowthRate } = input;
  const lgf = Math.pow(1 + limitGrowthRate, yearIndex);
  let decumBrokerageContrib = 0;
  const decumContribByAccount = new Map<string, number>();
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
      decumBrokerageContrib += amount;
      if (spec.accountName) {
        // The spec's account from state.specToAccount (owner-aware, as accumulation
        // matches it), so two owners' same-named accounts don't collide; by name
        // only when the spec has no entry.
        const matchedKey = state.specToAccount.get(specKeyOf(spec));
        const matchingAccount = matchedKey
          ? ctx.indAccts.find((ia) => indKey(ia) === matchedKey)
          : ctx.indAccts.find((ia) => ia.name === spec.accountName);
        if (matchingAccount) {
          const k = indKey(matchingAccount);
          decumContribByAccount.set(
            k,
            (decumContribByAccount.get(k) ?? 0) + amount,
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
    decumBrokerageContrib += decumRampAmount;
    // The ramp spread over brokerages by balance (Portfolio ones first; the
    // projection-only one only with no real brokerage), as accumulation does.
    const brokerages = indAccts.filter((ia) => isOverflowTarget(ia.category));
    const realBrokerages = brokerages.filter((ia) => !ia.projectedOnly);
    const rampAccts =
      realBrokerages.length > 0
        ? portfolioFirst(realBrokerages, (ia) => ia.parentCategory)
        : brokerages;
    const rampTotal = rampAccts.reduce(
      (s, ia) => s + (indBal.get(indKey(ia)) ?? 0),
      0,
    );
    for (const ia of rampAccts) {
      const k = indKey(ia);
      const weight =
        rampTotal > 0 ? (indBal.get(k) ?? 0) / rampTotal : 1 / rampAccts.length;
      const portion = roundToCents(decumRampAmount * weight);
      decumContribByAccount.set(
        k,
        (decumContribByAccount.get(k) ?? 0) + portion,
      );
    }
  }

  return { decumBrokerageContrib, decumContribByAccount, decumRampAmount };
}
