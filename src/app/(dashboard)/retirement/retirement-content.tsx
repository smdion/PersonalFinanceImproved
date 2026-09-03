"use client";

/** Retirement readiness page (client content). The default-export Page in
 *  retirement/page.tsx is a thin server component that prefetches the most
 *  expensive query before rendering this. */

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { formatCurrency } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { ProjectionCard } from "@/components/cards/projection";
import { AssumptionsBand } from "@/components/retirement/assumptions-band";

// Code-split the recharts-heavy withdrawal comparison card. Loads on
// retirement page mount; ssr:false because
// Recharts isn't SSR-friendly.
const WithdrawalComparisonCard = dynamic(
  () =>
    import("@/components/cards/withdrawal-comparison").then((m) => ({
      default: m.WithdrawalComparisonCard,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
import { CardBoundary } from "@/components/cards/dashboard/utils";
import { PlanHealthCard } from "@/components/cards/plan-health";

export function RetirementContent() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const [pageTab, setPageTab] = useState<
    "projection" | "comparison" | "planHealth"
  >("projection");
  const [dollarMode, setDollarMode] = useState<"nominal" | "real">("real");
  // Retirement Profile axis (phase 4, the assumptions band) — same
  // three-tier resolution as Contribution/Salary above: Plan pin -> this
  // page's local viewing selection -> globally-active profile. Unlike
  // those two, retirement previously had NO "view without activating"
  // support server-side; retirementProfileId in baseInput below is what
  // adds it (build-engine-payload.ts, phase 4).
  const [activeRetirementId, setActiveRetirementId] =
    useActiveRetirementProfile();
  const retirementProfilesQuery =
    trpc.retirement.retirementProfiles.list.useQuery();
  const retirementProfiles = retirementProfilesQuery.data ?? [];
  const [viewingRetirementId, setViewingRetirementId] = useState<number | null>(
    null,
  );
  const {
    profileId: effectiveRetirementProfileId,
    source: retirementProfileSource,
  } = useEffectiveProfileId("retirement", {
    validIds: retirementProfiles.map((p) => p.id),
    localSelection: viewingRetirementId,
    globalDefaultId: activeRetirementId,
  });
  const salaryActiveFields = useActiveSalaries();
  // Read-only here — the editor for these moved to the Budget page's
  // Retirement Profile tab (retirement-profile-tab.tsx), which writes the
  // same app_settings keys. This page's ProjectionCard/baseInput still need
  // the current values.
  const [decBudgetProfileId] = usePersistedSetting<number | null>(
    "retirement_dec_budget_profile_id",
    null,
  );
  const [decBudgetCol] = usePersistedSetting<number | null>(
    "retirement_decumulation_budget_column",
    null,
  );
  const [decExpenseOverride] = usePersistedSetting<string | null>(
    "retirement_dec_expense_override",
    null,
  );
  // Contribution/Salary Profile *pickers* (and Plan-pin display) live on the
  // Budget page's Retirement Profile tab now — see retirement-profile-tab.tsx.
  // This page still needs the globally-active + Plan-pin-aware effective ids
  // to feed ProjectionCard/comparisonInput, so the read side stays here.
  const [contribProfileId] = useActiveContribProfile();
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();
  const contribProfiles = contribProfilesQuery.data ?? [];
  const [salaryProfileId] = useActiveSalaryProfile();
  const salaryProfilesQuery = trpc.salaryProfile.list.useQuery();
  const salaryProfiles = salaryProfilesQuery.data ?? [];

  const { profileId: effectiveContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfiles.map((p) => p.id),
      localSelection: null,
      globalDefaultId: contribProfileId,
    },
  );
  const { profileId: effectiveSalaryProfileId } = useEffectiveProfileId(
    "salary",
    {
      validIds: salaryProfiles.map((p) => p.id),
      localSelection: null,
      globalDefaultId: salaryProfileId,
    },
  );
  const [snapshotId, setSnapshotId] = usePersistedSetting<number | null>(
    "retirement_snapshot_id",
    null,
  );
  const snapshotTotalsQuery = trpc.networth.listSnapshotTotals.useQuery();
  const snapshotOptions = snapshotTotalsQuery.data ?? [];
  // Shared across engineInput and comparisonInput below — both projection
  // queries take the same set of optional overrides, differing only in
  // whether metadataOnly is set.
  const baseInput = useMemo(
    () => ({
      ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
      ...(effectiveContribProfileId != null
        ? { contributionProfileId: effectiveContribProfileId }
        : {}),
      ...(effectiveSalaryProfileId != null
        ? { salaryProfileId: effectiveSalaryProfileId }
        : {}),
      ...(decBudgetProfileId != null
        ? { decumulationBudgetProfileId: decBudgetProfileId }
        : {}),
      ...(decBudgetCol != null
        ? { decumulationBudgetColumn: decBudgetCol }
        : {}),
      ...(decExpenseOverride
        ? { decumulationExpenseOverride: parseFloat(decExpenseOverride) }
        : {}),
      ...(snapshotId != null ? { snapshotId } : {}),
      ...(effectiveRetirementProfileId != null
        ? { retirementProfileId: effectiveRetirementProfileId }
        : {}),
    }),
    [
      salaryActiveFields,
      effectiveContribProfileId,
      effectiveSalaryProfileId,
      decBudgetProfileId,
      decBudgetCol,
      decExpenseOverride,
      snapshotId,
      effectiveRetirementProfileId,
    ],
  );
  const engineInput = useMemo(
    () => ({ metadataOnly: true as const, ...baseInput }),
    [baseInput],
  );
  const debouncedEngineInput = useDebouncedValue(engineInput, 600);
  const { data, isLoading, isFetching, error } =
    trpc.projection.computeProjection.useQuery(debouncedEngineInput, {
      placeholderData: (prev) => prev,
    });
  // Lazy-load strategy comparison only when expanded
  const [comparisonExpanded, setComparisonExpanded] =
    usePersistedSetting<boolean>("retirement_comparison_expanded", false);
  const comparisonInput = baseInput;
  const { data: comparisonData, isLoading: comparisonLoading } =
    trpc.projection.computeStrategyComparison.useQuery(comparisonInput, {
      enabled:
        (comparisonExpanded || pageTab === "comparison") &&
        !isLoading &&
        !isFetching,
      placeholderData: (prev) => prev,
    });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load retirement data: {error.message}
      </p>
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
  const accProfileSummary = data.budgetProfileSummaries?.find(
    (p: { id: number; isActive: boolean }) =>
      data.accumulationBudgetProfileId
        ? p.id === data.accumulationBudgetProfileId
        : p.isActive,
  );
  const accColumnLabel =
    accProfileSummary?.columnLabels?.[data.accumulationBudgetColumn ?? 0];

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
          Plan Health
        </button>
      </div>

      {/* Snapshot selector */}
      {snapshotOptions.length > 1 && (
        <div className="mb-3 flex items-center gap-2 print:hidden">
          <label className="text-muted text-xs">Portfolio Snapshot:</label>
          <select
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

      {isFetching && !isLoading && (
        <div className="text-faint mb-2 animate-pulse text-xs">
          Updating projection...
        </div>
      )}

      {pageTab === "planHealth" ? (
        /* Plan Health tab — diagnostic callouts derived from plan state.
           Consumes data.planHealth which the projection router builds
           from contribution accounts and the active glide path. */
        <PlanHealthCard
          returnRate={parseFloat(settings.returnAfterRetirement)}
          inflationRate={parseFloat(settings.annualInflation)}
          salaryGrowthRate={parseFloat(settings.salaryAnnualIncrease)}
          retirementHorizonYears={settings.endAge - settings.retirementAge}
          hasBudgetLink={!!data.accumulationBudgetProfileId}
          hasSocialSecurity={Number(settings.socialSecurityMonthly) > 0}
          deterministicNestEgg={
            data.result?.projectionByYear.find(
              (p: { age: number }) => p.age === settings.retirementAge,
            )?.endBalance
          }
          accumulationOrder={data.planHealth?.accumulationOrder}
          currentAge={data.planHealth?.currentAge}
          stockAllocationPercent={
            data.planHealth?.currentStockAllocationPercent ?? undefined
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
        ) : comparisonData && "retirementAge" in comparisonData ? (
          <WithdrawalComparisonCard
            strategies={comparisonData.strategies}
            activeStrategy={comparisonData.activeStrategy}
            retirementAge={comparisonData.retirementAge}
            dollarMode={dollarMode}
            onDollarModeChange={setDollarMode}
            inflationRate={parseFloat(settings.annualInflation)}
            currentAge={
              data.planHealth?.currentAge ?? settings.retirementAge - 20
            }
            analyzerInput={comparisonInput ?? undefined}
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
            viewingProfileId={effectiveRetirementProfileId}
            onViewingProfileChange={setViewingRetirementId}
            activeProfileId={activeRetirementId}
            onActivate={(id) => {
              setActiveRetirementId(id);
              utils.projection.invalidate();
            }}
            effectiveSource={retirementProfileSource}
            admin={admin}
          />

          {/* Contribution / Distribution Engine — primary view */}
          <CardBoundary title="Retirement Projection">
            <ProjectionCard
              people={peopleLookup}
              withdrawalRate={parseFloat(settings.withdrawalRate) * 100}
              decumulationBudgetProfileId={decBudgetProfileId ?? undefined}
              decumulationBudgetColumn={decBudgetCol ?? undefined}
              decumulationExpenseOverride={
                decExpenseOverride ? parseFloat(decExpenseOverride) : undefined
              }
              parentCategoryFilter="Retirement"
              contributionProfileId={effectiveContribProfileId ?? undefined}
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
              src/components/retirement/retirement-profile-tab.tsx. */}
        </>
      )}
    </div>
  );
}
