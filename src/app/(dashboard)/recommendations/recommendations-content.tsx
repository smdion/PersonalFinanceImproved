"use client";

/** Recommendations page body: the top few first, then everything by area. */
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingCard, ErrorCard } from "@/components/cards/dashboard/utils";
import { useRecommendations } from "@/lib/hooks/use-recommendations";
import { RECOMMENDATION_AREAS } from "@/lib/config/recommendations";
import { RecommendationRow } from "@/components/recommendations/recommendation-row";

/** How many lead the page before the full list. */
const TOP_COUNT = 3;

export function RecommendationsContent() {
  const { isLoading, error, recommendations } = useRecommendations();
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
      </div>
    );

  const top = recommendations.slice(0, TOP_COUNT);
  return (
    <div className="space-y-3">
      {header}
      <Card title="Start here">
        {top.map((r) => (
          <RecommendationRow key={r.id} recommendation={r} />
        ))}
      </Card>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {RECOMMENDATION_AREAS.map((area) => {
          const rows = recommendations.filter((r) => r.area === area.key);
          if (rows.length === 0) return null;
          return (
            <Card key={area.key} title={area.title} subtitle={area.blurb}>
              {rows.map((r) => (
                <RecommendationRow key={r.id} recommendation={r} />
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
