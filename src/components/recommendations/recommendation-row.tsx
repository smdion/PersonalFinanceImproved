"use client";

import { FocusLink } from "@/components/ui/focus-link";
import type { ReactNode } from "react";
import { Clock, TriangleAlert } from "lucide-react";
import { MILESTONE_SOURCE_LABELS } from "@/lib/config/milestones";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { formatCurrency, maskAmountsInText } from "@/lib/utils/format";
import type {
  Recommendation,
  RecommendationUrgency,
} from "@/lib/pure/advice/recommendations";

/** Urgency at a glance — the same left rail and icon as a milestone's
 *  status (milestone-row.tsx), so the two pages read alike. */
export const URGENCY_STYLE: Record<
  RecommendationUrgency,
  { label: string; icon: string; rail: string }
> = {
  now: {
    label: "Now",
    icon: STATUS_COLORS.red.text,
    rail: "border-l-red-500",
  },
  soon: {
    label: "Soon",
    icon: STATUS_COLORS.amber.text,
    rail: "border-l-amber-500",
  },
};

export function UrgencyIcon({ urgency }: { urgency: RecommendationUrgency }) {
  const className = `h-4 w-4 flex-shrink-0 ${URGENCY_STYLE[urgency].icon}`;
  return urgency === "now" ? (
    <TriangleAlert className={className} aria-label="Now" />
  ) : (
    <Clock className={className} aria-label="Soon" />
  );
}

/** One recommendation: what to do (a line that stands on its own — the
 *  title isn't shown), the detail and figures under it, where it comes
 *  from, and where to do it. */
export function RecommendationRow({
  recommendation: r,
  actions,
  detail,
  fromMilestone,
  retirement,
}: {
  recommendation: Recommendation;
  /** Extra controls (dismiss / snooze / restore), quiet until hovered. */
  actions?: ReactNode;
  /** An extra line under the context (e.g. why it was dismissed). */
  detail?: ReactNode;
  /** The milestone it comes from, linked back to it. */
  fromMilestone?: { id: string; title: string } | null;
  /** What it's worth by retirement at the plan's returns, when it has a
   *  yearly amount. */
  retirement?: { amount: number; year: number } | null;
}) {
  const sourceLabel =
    r.source === "ledgr" ? "Ledgr" : MILESTONE_SOURCE_LABELS[r.source];
  return (
    <div
      className={`group grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2.5 border-l-2 py-2 pr-1 pl-2 ${URGENCY_STYLE[r.urgency].rail}`}
    >
      <span className="mt-0.5">
        <UrgencyIcon urgency={r.urgency} />
      </span>
      <div className="min-w-0">
        <div className="text-primary text-sm font-medium">
          {maskAmountsInText(r.action)}
        </div>
        <div className="text-secondary text-xs">
          {maskAmountsInText(r.context)}
        </div>
        <div className="text-caption text-muted">
          {sourceLabel}
          {fromMilestone && (
            <>
              {" · from "}
              <FocusLink
                focus={{ topic: "milestone", milestoneId: fromMilestone.id }}
                className="hover:text-primary underline decoration-dotted underline-offset-2"
              >
                {fromMilestone.title}
              </FocusLink>
            </>
          )}
        </div>
        {retirement && (
          <div
            className="text-caption text-secondary"
            title="This yearly amount, kept invested each year until you retire, at the return rates your projections use."
          >
            About {maskAmountsInText(formatCurrency(retirement.amount))} by{" "}
            {retirement.year} if invested each year
          </div>
        )}
        {detail}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <FocusLink
          focus={r.focus}
          className="text-caption whitespace-nowrap text-blue-600 hover:underline"
        >
          Go →
        </FocusLink>
        {actions && (
          <div className="transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
