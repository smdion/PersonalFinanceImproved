/**
 * IRS-limit recommendations — adapters over the cap pass's verdicts that
 * the contribution summary already carries per account type (capMessages,
 * overBy). Only maps fields: a contribution over its limit is an error to
 * fix (excess deferrals are taxed and must be refunded), so it ranks first
 * until it's changed; a missing owner or HSA coverage type comes soon.
 */
import type { Recommendation } from "@/lib/pure/recommendations";

type CapIssueSource = {
  /** null for the household's joint accounts. */
  personName: string | null;
  accountTypes: readonly {
    accountType: string;
    overBy: number;
    capMessages: readonly string[];
  }[];
};

export function recommendationsFromCaps(
  sources: readonly CapIssueSource[],
): Recommendation[] {
  return sources.flatMap((s) =>
    s.accountTypes
      .filter((t) => t.capMessages.length > 0)
      .map((t): Recommendation => {
        const who = s.personName ? `${s.personName}: ` : "";
        const over = t.overBy > 0;
        return {
          id: `irsCap:${s.personName ?? "joint"}:${t.accountType}`,
          area: "paycheck",
          urgency: over ? "now" : "soon",
          title: over
            ? `${who}${t.accountType} contributions over the IRS limit`
            : `${who}${t.accountType} needs a detail to size its IRS limit`,
          action: t.capMessages.join(" "),
          context: over
            ? "Ledgr counts the capped amount everywhere until the contribution is changed — money over the limit is taxed and must be refunded."
            : "Until then Ledgr sizes the limit conservatively.",
          impact: null,
          href: "/paycheck",
          source: "ledgr",
        };
      }),
  );
}
