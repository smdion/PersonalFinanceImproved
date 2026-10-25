"use client";

/** Recommendations page body: the top few first, then everything by area. */
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingCard, ErrorCard } from "@/components/cards/dashboard/utils";
import { useRecommendations } from "@/lib/hooks/use-recommendations";
import { RECOMMENDATION_AREAS } from "@/lib/config/recommendations";
import { RecommendationRow } from "@/components/recommendations/recommendation-row";
import { DismissControls } from "@/components/recommendations/dismiss-controls";
import { formatDate } from "@/lib/utils/format";
import { useRecommendationDismissals } from "@/lib/hooks/use-recommendation-dismissals";
import type { Recommendation } from "@/lib/pure/recommendations";

/** How many lead the page before the full list. */
const TOP_COUNT = 3;

export function RecommendationsContent() {
  const { isLoading, error, recommendations, dismissed } = useRecommendations();
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
    />
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
  return (
    <div className="space-y-3">
      {header}
      <Card title="Start here">
        {top.map((r) => (
          <RecommendationRow
            key={r.id}
            recommendation={r}
            actions={actionsFor(r)}
          />
        ))}
      </Card>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {RECOMMENDATION_AREAS.map((area) => {
          const rows = recommendations.filter((r) => r.area === area.key);
          if (rows.length === 0) return null;
          return (
            <Card key={area.key} title={area.title} subtitle={area.blurb}>
              {rows.map((r) => (
                <RecommendationRow
                  key={r.id}
                  recommendation={r}
                  actions={actionsFor(r)}
                />
              ))}
            </Card>
          );
        })}
      </div>
      {dismissedList}
    </div>
  );
}
