"use client";

import type { ReactNode } from "react";
import { MILESTONE_SOURCE_LABELS } from "@/lib/config/milestones";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { compactCurrency, maskAmountsInText } from "@/lib/utils/format";
import type { Recommendation } from "@/lib/pure/recommendations";

const URGENCY = {
  now: {
    label: "Now",
    chip: `${STATUS_COLORS.red.bg} ${STATUS_COLORS.red.text}`,
  },
  soon: {
    label: "Soon",
    chip: `${STATUS_COLORS.amber.bg} ${STATUS_COLORS.amber.text}`,
  },
} as const;

/** One recommendation: what to do, where things stand, the dollars
 *  involved, and where to do it. */
export function RecommendationRow({
  recommendation: r,
  actions,
  detail,
}: {
  recommendation: Recommendation;
  /** Extra controls (dismiss / snooze / restore). */
  actions?: ReactNode;
  /** An extra line under the context (e.g. why it was dismissed). */
  detail?: ReactNode;
}) {
  const sourceLabel =
    r.source === "ledgr" ? "Ledgr" : MILESTONE_SOURCE_LABELS[r.source];
  return (
    <div className="border-subtle flex items-start gap-2 border-b py-2 last:border-b-0">
      <span
        className={`text-caption mt-0.5 rounded-full px-1.5 py-0.5 font-medium whitespace-nowrap ${URGENCY[r.urgency].chip}`}
      >
        {URGENCY[r.urgency].label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-primary text-sm">
          {maskAmountsInText(r.action)}
        </div>
        <div className="text-micro text-faint">
          {r.title} · {maskAmountsInText(r.context)} · {sourceLabel}
        </div>
        {detail}
      </div>
      {r.impact && (
        <span className="text-secondary text-sm whitespace-nowrap">
          {compactCurrency(r.impact.amount)}
          {r.impact.kind === "perYear" ? "/yr" : ""}
        </span>
      )}
      <a
        href={r.href}
        className="text-caption whitespace-nowrap text-blue-600 hover:underline"
      >
        Go →
      </a>
      {actions}
    </div>
  );
}
