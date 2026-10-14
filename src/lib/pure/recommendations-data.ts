/**
 * "Keep data current" recommendations — the data sources the freshness
 * check already flagged (lib/pure/data-freshness.ts). Only maps fields: no
 * new staleness rule.
 */
import type { DataSourceStatus } from "@/lib/pure/data-freshness";
import type { Recommendation } from "@/lib/pure/recommendations";

export function recommendationsFromDataSources(
  statuses: readonly DataSourceStatus[],
  /** The source's display name (the budget sync is named by its service). */
  labelFor: (s: DataSourceStatus) => string,
): Recommendation[] {
  return statuses
    .filter((s) => s.needsAttention)
    .map((s) => ({
      id: `data:${s.source.key}`,
      area: "data" as const,
      urgency: "soon" as const,
      title: `${labelFor(s)} data`,
      action: s.reason ?? `Update ${labelFor(s).toLowerCase()} data`,
      context:
        s.lastUpdated === null
          ? "Never updated"
          : `Last updated ${s.ageDays ?? "?"} day${s.ageDays === 1 ? "" : "s"} ago · ${s.source.rhythmLabel}`,
      impact: null,
      href: s.source.href,
      source: "ledgr" as const,
    }));
}
