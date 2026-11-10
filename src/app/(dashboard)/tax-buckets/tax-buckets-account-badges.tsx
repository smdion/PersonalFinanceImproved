import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import type { AccountAnalysisEntry } from "@/lib/pure/accounts/tax-buckets/tax-bucket-analysis";

export type RuleOf55BadgeProps = {
  entry: AccountAnalysisEntry;
};

/** An account's Rule of 55 badge, with its separation year and help tip. */
export function RuleOf55Badge({ entry }: RuleOf55BadgeProps) {
  return (
    <>
      {entry.ruleOf55 && (
        <div className="text-caption mt-1 flex items-center gap-2">
          <Badge
            color={
              entry.ruleOf55.eligible
                ? "green"
                : entry.ruleOf55.eligible === false
                  ? "amber"
                  : "gray"
            }
          >
            Rule of 55:{" "}
            {entry.ruleOf55.eligible == null
              ? "unknown"
              : entry.ruleOf55.eligible
                ? "eligible"
                : "not yet"}
          </Badge>
          {entry.ruleOf55.separationYear != null && (
            <span className="text-faint">
              separation year {entry.ruleOf55.separationYear} (
              {entry.ruleOf55.source})
            </span>
          )}
          <HelpTip text="Rule of 55: separating from that plan's employer in or after the year you turn 55 grants permanent penalty-free access to that specific plan — even if it later sits dormant. Rolling it into an IRA forfeits this for that money. Many plans only permit a lump-sum withdrawal, not partial, once separated." />
        </div>
      )}
    </>
  );
}
