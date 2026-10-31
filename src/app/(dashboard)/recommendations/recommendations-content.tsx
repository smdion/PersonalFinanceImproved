"use client";

/** Recommendations page body: the top few first, then the rest by area. */
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingCard, ErrorCard } from "@/components/cards/dashboard/utils";
import { useRecommendations } from "@/lib/hooks/use-recommendations";
import { RECOMMENDATION_AREAS } from "@/lib/config/recommendations";
import Link from "next/link";
import {
  RecommendationRow,
  URGENCY_STYLE,
  UrgencyIcon,
} from "@/components/recommendations/recommendation-row";
import {
  BalancedColumns,
  type ColumnItem,
} from "@/components/ui/balanced-columns";
import { DismissControls } from "@/components/recommendations/dismiss-controls";
import { formatDate } from "@/lib/utils/format";
import { useRecommendationDismissals } from "@/lib/hooks/use-recommendation-dismissals";
import type { Recommendation } from "@/lib/pure/recommendations";

/** How many lead the page before the full list. */
const TOP_COUNT = 3;

export function RecommendationsContent() {
  const { isLoading, error, recommendations, dismissed, results } =
    useRecommendations();
  // A recommendation from a milestone links back to it.
  const milestoneOf = new Map(
    results.map((m) => [m.id, { id: m.id, title: m.title }]),
  );
  const fromOf = (r: Recommendation) =>
    r.source === "ledgr" ? null : (milestoneOf.get(r.id) ?? null);
  const dismissals = useRecommendationDismissals();
  /** Dismiss/snooze controls — admins only (household-wide setting). */
  const actionsFor = (r: Recommendation) =>
    dismissals.canEdit ? (
      <DismissControls
        disabled={dismissals.isPending}
        onSnooze={(note) => dismissals.snooze(r, note)}
        onDismiss={
          r.snoozeOnly ? undefined : (note) => dismissals.dismiss(r, note)
        }
      />
    ) : undefined;
  const dismissedList =
    dismissed.length > 0 ? (
      <Card
        title={`Dismissed or snoozed (${dismissed.length})`}
        subtitle="Hidden from the list above — back if one becomes urgent or a snooze ends."
      >
        {dismissed.map((r) => {
          const d = dismissals.dismissals[r.id];
          const when = d
            ? [
                d.until
                  ? `Snoozed until ${formatDate(d.until, "medium")}`
                  : "Dismissed",
                d.on ? `on ${formatDate(d.on, "medium")}` : null,
              ]
                .filter(Boolean)
                .join(" ")
            : null;
          return (
            <RecommendationRow
              key={r.id}
              recommendation={r}
              fromMilestone={fromOf(r)}
              detail={
                <div className="text-micro text-secondary mt-0.5">
                  {when}
                  {d?.note ? ` — “${d.note}”` : ""}
                </div>
              }
              actions={
                dismissals.canEdit ? (
                  <button
                    type="button"
                    className="text-caption text-muted hover:text-primary"
                    disabled={dismissals.isPending}
                    onClick={() => dismissals.restore(r)}
                  >
                    Restore
                  </button>
                ) : undefined
              }
            />
          );
        })}
      </Card>
    ) : null;
  const header = (
    <PageHeader
      title="Recommendations"
      subtitle="What to do next, most important first — gathered from your milestones and the rest of Ledgr"
    >
      <Link
        href="/milestones"
        className="text-caption text-blue-600 hover:underline"
      >
        Your wins → Milestones
      </Link>
    </PageHeader>
  );
  if (isLoading)
    return (
      <div>
        {header}
        <LoadingCard title="Recommendations" />
      </div>
    );
  if (error)
    return (
      <div>
        {header}
        <ErrorCard title="Recommendations" message="Failed to load" />
      </div>
    );
  if (recommendations.length === 0)
    return (
      <div>
        {header}
        <EmptyState
          message="Nothing to do right now."
          hint="Every milestone Ledgr can judge is reached or on track."
        />
        {dismissedList}
      </div>
    );

  const top = recommendations.slice(0, TOP_COUNT);
  // The area cards hold the rest — "Start here" items aren't repeated.
  const rest = recommendations.slice(TOP_COUNT);
  const counts = (["now", "soon"] as const)
    .map((urgency) => ({
      urgency,
      n: recommendations.filter((r) => r.urgency === urgency).length,
    }))
    .filter((c) => c.n > 0);
  const row = (r: Recommendation) => (
    <RecommendationRow
      key={r.id}
      recommendation={r}
      fromMilestone={fromOf(r)}
      actions={actionsFor(r)}
    />
  );
  return (
    <div className="space-y-3">
      {header}
      {/* The same opening card as Milestones' "Where you stand". */}
      <Card title="What to do">
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {counts.map((c) => (
            <span key={c.urgency} className="flex items-center gap-1.5">
              <UrgencyIcon urgency={c.urgency} />
              <span className="text-primary font-medium tabular-nums">
                {c.n}
              </span>
              <span className="text-muted">
                {URGENCY_STYLE[c.urgency].label.toLowerCase()}
              </span>
            </span>
          ))}
        </div>
        <h3 className="text-caption text-muted mb-1.5 font-medium tracking-wide uppercase">
          Start here
        </h3>
        <div className="space-y-1">{top.map(row)}</div>
      </Card>
      {/* Two columns that end level; cards never move as you use them. */}
      <BalancedColumns
        items={RECOMMENDATION_AREAS.flatMap<ColumnItem>((area) => {
          const rows = rest.filter((r) => r.area === area.key);
          if (rows.length === 0) return [];
          return [
            {
              key: area.key,
              node: (
                <Card title={area.title} subtitle={area.blurb}>
                  <div className="space-y-1">{rows.map(row)}</div>
                </Card>
              ),
              weight: 2 + rows.length * 1.3,
            },
          ];
        }).concat(
          dismissedList
            ? [
                {
                  key: "dismissed",
                  node: dismissedList,
                  weight: 2 + dismissed.length * 1.3,
                },
              ]
            : [],
        )}
      />
    </div>
  );
}
