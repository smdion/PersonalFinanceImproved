"use client";

/** Retirement readiness page (client content). The default-export Page in
 *  retirement/page.tsx is a thin server component that prefetches the most
 *  expensive query before rendering this. */

import { NotConfiguredNotice } from "@/components/ui/not-configured-notice";
import { useSimulationPreset } from "@/lib/hooks/use-simulation-preset";
import { useFocusedState } from "@/lib/hooks/use-focus";
import { useState, useMemo } from "react";
import type { DollarBasis } from "@/lib/config/enum-values";
import dynamic from "next/dynamic";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { formatCurrency } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Disclaimer } from "@/components/ui/disclaimer";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { usePlanEngineInput } from "@/lib/hooks/use-plan-engine-input";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { ProjectionCard } from "@/components/retirement-projection";
import { AssumptionsBand } from "@/components/retirement/assumptions-band";

// Code-split the recharts-heavy withdrawal comparison card. Loads on
// retirement page mount; ssr:false because
// Recharts isn't SSR-friendly.
const WithdrawalComparisonCard = dynamic(
  () =>
    import("@/components/retirement-projection/withdrawal-comparison").then(
      (m) => ({
        default: m.WithdrawalComparisonCard,
      }),
    ),
  { loading: () => <SkeletonChart />, ssr: false },
);
import { CardBoundary } from "@/components/dashboard/utils";
import { PlanHealthCard } from "@/components/retirement/plan-health";
import { SK_RETIREMENT_COMPARISON_EXPANDED } from "@/lib/constants/settings-keys";

export function RetirementContent() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  // Links to Projection Health or a projection year open their tab.
  const [pageTab, setPageTab] = useFocusedState("retirementTab", "projection");
  const [dollarMode, setDollarMode] = useState<DollarBasis>("real");
  // Retirement Profile axis (the assumptions band) — the active profile;
  // the band's picker changes it, same as the header.
  const [activeRetirementId, setActiveRetirementId] =
    useActiveRetirementProfile();
  const retirementProfilesQuery =
    trpc.retirement.retirementProfiles.list.useQuery();
  const retirementProfiles = retirementProfilesQuery.data ?? [];
  const { profileId: effectiveRetirementProfileId } = useEffectiveProfileId(
    "retirement",
    {
      validIds: retirementProfiles.map((p) => p.id),
      localSelection: null,
      activeProfileId: activeRetirementId,
    },
  );
  // Projection input from usePlanEngineInput, shared with the dashboard so both
  // read the same cached runs. Retirement-budget editors live on the Retirement
  // Profile tab; the snapshot picker below writes its setting.
  const plan = usePlanEngineInput();
  const {
    contributionProfileId: effectiveContributionProfileId,
    salaryProfileId: effectiveSalaryProfileId,
    snapshotId,
  } = plan.ids;
  const decumulationBudget = plan.input.selection.decumulationBudget;
  const [, setSnapshotId] = usePersistedSetting<number | null>(
    "retirement_snapshot_id",
    null,
  );
  const snapshotTotalsQuery = trpc.networth.listSnapshotTotals.useQuery();
  const snapshotOptions = snapshotTotalsQuery.data ?? [];
  // The plan input minus the withdrawal-editor defaults these queries skip.
  const baseInput = useMemo(() => {
    const { decumulationDefaults: _decumulationDefaults, ...rest } = plan.input;
    return rest;
  }, [plan.input]);
  const debouncedEngineInput = useDebouncedValue(baseInput, 600);
  const queryEnabled = plan.ready && debouncedEngineInput === baseInput;
  const projectionQuery = trpc.projection.getProjectionMetadata.useQuery(
    debouncedEngineInput,
    // Ready, and the debounce has caught up with it — the debounced value
    // can still be the input from before settings loaded.
    { placeholderData: (prev) => prev, enabled: queryEnabled },
  );
  const { data, isFetching } = projectionQuery;
  // Waiting to run = still loading (a disabled query reports isLoading
  // false, which would read as "no projection").
  const isLoading =
    projectionQuery.isLoading || (!queryEnabled && !projectionQuery.data);
  // Lazy-load strategy comparison only when expanded
  const [comparisonExpanded, setComparisonExpanded] =
    usePersistedSetting<boolean>(SK_RETIREMENT_COMPARISON_EXPANDED, false);
  // The same preset the page's Simulation uses.
  const [simulationPreset] = useSimulationPreset();
  const comparisonInput = useMemo(
    () => ({ ...baseInput, preset: simulationPreset }),
    [baseInput, simulationPreset],
  );
  const { data: comparisonData, isLoading: comparisonLoading } =
    trpc.projection.computeStrategyComparison.useQuery(comparisonInput, {
      enabled:
        plan.ready &&
        (comparisonExpanded || pageTab === "comparison") &&
        !isLoading &&
        !isFetching,
      placeholderData: (prev) => prev,
    });

  // Waiting on the input shows the skeleton; a failed input query shows.
  if (isLoading || queryPending([projectionQuery, plan.gate])) {
    return (
      <QueryBoundary
        query={[projectionQuery, plan.gate]}
        what="retirement data"
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SkeletonChart height={128} />
              <SkeletonChart height={128} />
              <SkeletonChart height={128} />
            </div>
          </div>
        }
      />
    );
  }

  if (!data || !("settings" in data)) {
    return (
      <EmptyState
        message="No retirement data available."
        hint="Configure retirement settings (age, return rates, contribution strategy) in Settings to see projections."
      />
    );
  }

  const { settings, people: peopleLookup, perPersonSettings } = data;
  // Resolve active budget column label for subtitle
  const accProfileSummary = data.budgetProfileSummaries.find(
    (p: { id: number; isActive: boolean }) =>
      data.accumulationBudgetProfileId
        ? p.id === data.accumulationBudgetProfileId
        : p.isActive,
  );
  const accColumnLabel =
    accProfileSummary?.columnLabels?.[data.accumulationBudgetColumn]; // columnLabels is stored jsonb, typed by $type only: kept guarded.

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Retirement Projection"
          subtitle={
            accColumnLabel ? `Budget scenario: ${accColumnLabel}` : undefined
          }
        />
      </div>

      {/* Page-level tabs */}
      <div className="bg-surface-primary/60 mb-4 flex w-fit max-w-full flex-wrap rounded-md border p-0.5 print:hidden">
        <button
          type="button"
          onClick={() => setPageTab("projection")}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            pageTab === "projection"
              ? "bg-surface-primary text-primary border shadow-sm"
              : "text-muted hover:text-secondary"
          }`}
        >
          Projection
        </button>
        <button
          type="button"
          aria-label="Strategy Comparison"
          onClick={() => {
            setPageTab("comparison");
            setComparisonExpanded(true);
          }}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            pageTab === "comparison"
              ? "bg-surface-primary text-primary border shadow-sm"
              : "text-muted hover:text-secondary"
          }`}
        >
          <span aria-hidden="true" className="sm:hidden">
            Comparison
          </span>
          <span aria-hidden="true" className="hidden sm:inline">
            Strategy Comparison
          </span>
        </button>
        <button
          type="button"
          onClick={() => setPageTab("planHealth")}
          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            pageTab === "planHealth"
              ? "bg-surface-primary text-primary border shadow-sm"
              : "text-muted hover:text-secondary"
          }`}
        >
          Projection Health
        </button>
      </div>

      {/* Snapshot selector */}
      {snapshotOptions.length > 1 && (
        <div className="mb-3 flex items-center gap-2 print:hidden">
          <label className="text-muted text-xs">Portfolio Snapshot:</label>
          <select
            aria-label="Portfolio Snapshot"
            className="bg-surface-elevated text-primary rounded border px-2 py-1 text-xs"
            value={snapshotId ?? ""}
            onChange={(e) =>
              setSnapshotId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Latest</option>
            {[...snapshotOptions].reverse().map((s) => (
              <option key={s.id} value={s.id}>
                {s.date} — {formatCurrency(s.total)}
              </option>
            ))}
          </select>
          {snapshotId != null && (
            <button
              onClick={() => setSnapshotId(null)}
              className="text-caption text-blue-400 hover:text-blue-300"
            >
              Reset to latest
            </button>
          )}
        </div>
      )}

      {isFetching && (
        <div className="text-faint mb-2 animate-pulse text-xs">
          Updating projection...
        </div>
      )}

      {pageTab === "planHealth" ? (
        /* Projection Health tab — diagnostic callouts derived from plan state.
           Consumes data.planHealth which the projection router builds
           from contribution accounts and the active glide path. */
        <PlanHealthCard
          returnRate={parseFloat(settings.returnAfterRetirement)}
          inflationRate={parseFloat(settings.annualInflation)}
          salaryGrowthRate={parseFloat(settings.salaryAnnualIncrease)}
          retirementHorizonYears={settings.endAge - settings.retirementAge}
          hasBudgetLink={!!data.accumulationBudgetProfileId}
          hasSocialSecurity={Number(settings.socialSecurityMonthly) > 0}
          accumulationOrder={data.planHealth.accumulationOrder}
          currentAge={data.planHealth.currentAge}
          stockAllocationPercent={
            data.planHealth.currentStockAllocationPercent ?? undefined
          }
        />
      ) : pageTab === "comparison" ? (
        /* Strategy Comparison tab — rendered directly, no collapsible */
        comparisonLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : comparisonData &&
          "notConfigured" in comparisonData &&
          comparisonData.notConfigured === "no_return_rate" ? (
          <div className="p-4">
            <NotConfiguredNotice reason={comparisonData.notConfigured} />
          </div>
        ) : comparisonData && "retirementAge" in comparisonData ? (
          <WithdrawalComparisonCard
            strategies={comparisonData.strategies}
            activeStrategy={comparisonData.activeStrategy}
            presetLabel={comparisonData.presetLabel}
            notConfigured={comparisonData.notConfigured}
            dollarMode={dollarMode}
            onDollarModeChange={setDollarMode}
            inflationRate={parseFloat(settings.annualInflation)}
            analyzerInput={comparisonInput}
          />
        ) : (
          <div className="text-muted p-4 text-center text-xs">
            Loading strategy comparison...
          </div>
        )
      ) : (
        <>
          <AssumptionsBand
            settings={settings}
            perPersonSettings={perPersonSettings}
            profiles={retirementProfiles}
            activeProfileId={effectiveRetirementProfileId}
            onActivate={(id) => {
              setActiveRetirementId(id);
              utils.projection.invalidate();
            }}
            admin={admin}
          />

          {/* Contribution / Distribution Engine — primary view */}
          <CardBoundary title="Retirement Projection">
            <ProjectionCard
              people={peopleLookup}
              withdrawalRate={parseFloat(settings.withdrawalRate) * 100}
              decumulationBudgetProfileId={decumulationBudget?.profileId}
              decumulationBudgetColumn={decumulationBudget?.column}
              decumulationExpenseOverride={decumulationBudget?.annualExpenses}
              parentCategoryFilter="Retirement"
              contributionProfileId={
                effectiveContributionProfileId ?? undefined
              }
              salaryProfileId={effectiveSalaryProfileId ?? undefined}
              retirementProfileId={effectiveRetirementProfileId ?? undefined}
              snapshotId={snapshotId ?? undefined}
              dollarMode={dollarMode}
              onDollarModeChange={setDollarMode}
            />
          </CardBoundary>

          {/* Strategy Comparison moved to page-level tab */}

          {/* Projection Assumptions moved to Budget page's Retirement
              Profile tab — see
              src/components/profiles/retirement/retirement-profile-tab.tsx. */}
        </>
      )}
      {/* Projection Health's card carries its own. */}
      {pageTab !== "planHealth" && <Disclaimer className="mt-3" />}
    </div>
  );
}
