/**
 * "Keep data current" recommendations — the data sources the freshness
 * check already flagged (lib/pure/data-freshness.ts). Only maps fields: no
 * new staleness rule.
 */
import type { DataSourceStatus } from "@/lib/pure/data-freshness";
import type { Recommendation } from "@/lib/pure/recommendations";
import { FILING_STATUS_LABELS } from "@/lib/config/display-labels";
import { FILING_STATUS_IF_UNKNOWN } from "@/lib/pure/filing-status";

export function recommendationsFromDataSources(
  statuses: readonly DataSourceStatus[],
  /** The source's display name (the budget sync is named by its service). */
  labelFor: (s: DataSourceStatus) => string,
): Recommendation[] {
  // "Tax data" is already "… data".
  const named = (s: DataSourceStatus) => {
    const label = labelFor(s);
    return /\bdata$/i.test(label) ? label : `${label} data`;
  };
  return statuses
    .filter((s) => s.needsAttention)
    .map((s) => ({
      id: `data:${s.source.key}`,
      area: "data" as const,
      urgency: "soon" as const,
      title: named(s),
      action: `Update ${named(s)}${s.reason ? ` — ${s.reason}` : ""}`,
      context:
        s.lastUpdated === null
          ? "Never updated"
          : `Last updated ${s.ageDays ?? "?"} day${s.ageDays === 1 ? "" : "s"} ago · ${s.source.rhythmLabel}`,
      impact: null,
      focus: s.source.focus,
      source: "ledgr" as const,
    }));
}

/** Nothing says how the household files (no setting, no Retirement
 *  Profile status, no W-4): Ledgr uses the cautious fallback until it's
 *  set. `filingStatus` undefined = not loaded yet (no item). */
export function recommendationsFromFilingStatus(
  filingStatus: string | null | undefined,
): Recommendation[] {
  if (filingStatus !== null) return [];
  return [
    {
      id: "data:filingStatus",
      area: "data",
      urgency: "soon",
      title: "Filing status",
      action: "Set your tax filing status on the Taxes page",
      context: `Nothing says how you file (no setting and no W-4), so Ledgr figures your taxes and Social Security as ${FILING_STATUS_LABELS[FILING_STATUS_IF_UNKNOWN]} — the highest tax and no spousal benefits — until you do.`,
      impact: null,
      focus: { topic: "filingStatus" },
      source: "ledgr",
    },
  ];
}
