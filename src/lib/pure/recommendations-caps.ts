/**
 * IRS-limit recommendations — adapters over the cap pass's verdicts that
 * the contribution summary already carries per account type (capMessages,
 * overBy). Only maps fields: a contribution over its limit is an error to
 * fix (excess deferrals are taxed and must be refunded), so it ranks first
 * until it's changed; a missing owner or HSA coverage type comes soon.
 */
import { getLimitGroup } from "@/lib/config/account-types";
import type { Recommendation } from "@/lib/pure/recommendations";

type CapIssueSource = {
  /** null for the household's joint accounts. */
  personId: number | null;
  personName: string | null;
  accountTypes: readonly {
    accountType: string;
    categoryKey: string;
    overBy: number;
    capMessages: readonly string[];
  }[];
};

/** One item per person per limit group per tax year (a 401(k) and a 403(b)
 *  share one), keyed by ids — a rename never brings it back. */
export function recommendationsFromCaps(
  sources: readonly CapIssueSource[],
  taxYear: number,
): Recommendation[] {
  return sources.flatMap((s) => {
    const byGroup = new Map<string, (typeof s.accountTypes)[number][]>();
    for (const t of s.accountTypes) {
      if (t.capMessages.length === 0) continue;
      const g = getLimitGroup(t.categoryKey) ?? t.categoryKey;
      byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
    }
    return [...byGroup].map(([group, types]): Recommendation => {
      const who = s.personName ? `${s.personName}: ` : "";
      const label = types.map((t) => t.accountType).join(" + ");
      const over = types.some((t) => t.overBy > 0);
      return {
        id: `irsCap:${s.personId ?? "joint"}:${group}:${taxYear}`,
        area: "paycheck",
        urgency: over ? "now" : "soon",
        title: over
          ? `${who}${label} contributions over the IRS limit`
          : `${who}${label} needs a detail to size its IRS limit`,
        // capMessage's "it" is the contribution — name the account type.
        action: types
          .flatMap((t) =>
            t.capMessages.map((m) => `${t.accountType} contribution: ${m}`),
          )
          .join(" "),
        context: over
          ? "Ledgr counts the capped amount everywhere until the contribution is changed — money over the limit is taxed and must be refunded."
          : "Until then Ledgr sizes the limit conservatively.",
        impact: null,
        focus: { topic: "contributionElections" },
        source: "ledgr",
        ...(over ? { snoozeOnly: true } : {}),
      };
    });
  });
}
