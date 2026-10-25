"use client";

/**
 * The household's recommendations, ranked — gathered from what the
 * Milestones engine already judged, less any dismissed or snoozed. The
 * Recommendations page and the dashboard Checkup both read this, so their
 * counts agree.
 */
import {
  useContributionSummaryInput,
  useMilestones,
} from "@/lib/hooks/use-milestones";
import { trpc } from "@/lib/trpc";
import { recommendationsFromCaps } from "@/lib/pure/recommendations-caps";
import { useRecommendationDismissals } from "@/lib/hooks/use-recommendation-dismissals";
import { applyDismissals } from "@/lib/pure/recommendation-dismissals";
import { useDataSourceStatuses } from "@/lib/hooks/use-data-source-statuses";
import { recommendationsFromDataSources } from "@/lib/pure/recommendations-data";
import { budgetApiServiceLabel } from "@/lib/utils/format";
import { useRothIra } from "@/lib/hooks/use-roth-ira";
import { recommendationsFromRothIra } from "@/lib/pure/recommendations-roth";
import { useInvestingFindings } from "@/lib/hooks/use-investing-findings";
import { recommendationsFromCash } from "@/lib/pure/recommendations-cash";
import { classesUnderTarget } from "@/lib/pure/milestones";
import { recommendationsFromFunds } from "@/lib/pure/recommendations-funds";
import {
  rankRecommendations,
  recommendationsFromMilestones,
  type Recommendation,
} from "@/lib/pure/recommendations";

export function useRecommendations(): ReturnType<typeof useMilestones> & {
  recommendations: Recommendation[];
  dismissed: Recommendation[];
} {
  const milestones = useMilestones();
  const { dismissals, today } = useRecommendationDismissals();
  const data = useDataSourceStatuses();
  const roth = useRothIra();
  const cash = useInvestingFindings();
  const contribs = trpc.contribution.computeSummary.useQuery(
    useContributionSummaryInput(),
  );
  const ranked = rankRecommendations([
    ...recommendationsFromCaps(
      [
        ...(contribs.data?.people ?? []).map((p) => ({
          personId: p.person.id,
          personName: p.person.name,
          accountTypes: p.accountTypes,
        })),
        {
          personId: null,
          personName: null,
          accountTypes: contribs.data?.jointAccountTypes ?? [],
        },
      ],
      Number(today.slice(0, 4)),
    ),
    // A fund the cheaper-equivalent item already names (with its saving)
    // isn't repeated by the fund-costs milestone.
    ...recommendationsFromMilestones(
      milestones.results,
      new Set(cash.cheaper.map((f) => f.fund)),
    ),
    ...recommendationsFromDataSources(data.statuses, (s) =>
      s.source.key === "budgetApi"
        ? budgetApiServiceLabel(data.syncStatus?.service)
        : s.source.label,
    ),
    ...recommendationsFromRothIra(
      roth.view,
      roth.taxYear ?? Number(today.slice(0, 4)),
      today,
    ),
    ...recommendationsFromCash({
      ...cash,
      underTarget: classesUnderTarget(milestones.input?.holdings ?? null),
    }),
    ...recommendationsFromFunds(cash),
  ]);
  const { shown, dismissed } = applyDismissals(ranked, dismissals, today);
  return {
    ...milestones,
    // Wait for the data-source checks too, or "Nothing to do" flashes
    // before the "Keep data current" items arrive.
    isLoading:
      milestones.isLoading ||
      !data.loaded ||
      roth.isLoading ||
      cash.isLoading ||
      contribs.isLoading,
    recommendations: shown,
    dismissed,
  };
}
