"use client";

/** Retirement readiness page (client content). The default-export Page in
 *  retirement/page.tsx is a thin server component that prefetches the most
 *  expensive query before rendering this — see v0.5 expert-review M7. */

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Card } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import {
  getAllStrategyKeys,
  getStrategyMeta,
} from "@/lib/config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { recommendWithdrawalStrategy } from "@/lib/pure/withdrawal-strategy-recommendation";
import { SocialSecuritySection } from "@/components/retirement/sections/social-security";
import { TaxesSection } from "@/components/retirement/sections/taxes";
import { HealthcareSection } from "@/components/retirement/sections/healthcare";
import { GlidePathSection } from "@/components/retirement/sections/glide-path";
import { TimelineSection } from "@/components/retirement/sections/timeline";
import { IncomeSection } from "@/components/retirement/sections/income";
import { StrategyParamsSection } from "@/components/retirement/sections/strategy-params";
import { PerPhaseBudgetSection } from "@/components/retirement/sections/per-phase-budget";
import { RaiseAndRateSection } from "@/components/retirement/sections/raise-and-rate";
import type { UpsertSettingsMutation } from "@/components/retirement/sections/types";

// v0.5 expert-review M4: bridge the recommendation helper's kebab-case
// strategy keys to the snake_case keys in WITHDRAWAL_STRATEGY_CONFIG /
// settings.withdrawalStrategy. The helper is its own pure module with its
// own naming convention; the mapping lives at the call site so the helper
// stays untouched.
const RECOMMENDED_KEY_MAP: Record<string, WithdrawalStrategyType> = {
  fixed: "fixed",
  "guyton-klinger": "guyton_klinger",
  "vanguard-dynamic": "vanguard_dynamic",
  "constant-percentage": "constant_percentage",
  endowment: "endowment",
  "spending-decline": "spending_decline",
  "forgo-inflation": "forgo_inflation_after_loss",
  "rmd-spending": "rmd_spending",
};

import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { ProjectionCard } from "@/components/cards/projection";

// Code-split the recharts-heavy withdrawal comparison card (v0.5
// expert-review M8). Loads on retirement page mount; ssr:false because
// Recharts isn't SSR-friendly.
const WithdrawalComparisonCard = dynamic(
  () =>
    import("@/components/cards/withdrawal-comparison").then((m) => ({
      default: m.WithdrawalComparisonCard,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
import { StrategyGuideButton } from "@/components/cards/strategy-guide-panel";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import { PlanHealthCard } from "@/components/cards/plan-health";

/** Convert a decimal string (e.g. '0.04') to a whole-number string for display ('4'). */
function decToWhole(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return "0";
  return String(Math.round(n * 10000) / 100); // 0.04 → 4
}

/** Convert a whole-number string (e.g. '4') to a decimal string for storage ('0.04'). */
function wholeToDec(v: string): string {
  const n = parseFloat(v);
  if (isNaN(n)) return "0";
  return String(Math.round(n * 100) / 10000); // 4 → 0.04
}

export function RetirementContent() {
  const [pageTab, setPageTab] = useState<
    "projection" | "comparison" | "planHealth"
  >("projection");
  const [dollarMode, setDollarMode] = useState<"nominal" | "real">("real");
  const utils = trpc.useUtils();
  const salaryOverrides = useSalaryOverrides();
  const [decBudgetProfileId, setDecBudgetProfileId] = usePersistedSetting<
    number | null
  >("retirement_dec_budget_profile_id", null);
  const [decBudgetCol, setDecBudgetCol] = usePersistedSetting<number | null>(
    "retirement_decumulation_budget_column",
    null,
  );
  const [decExpenseOverride, setDecExpenseOverride] = usePersistedSetting<
    string | null
  >("retirement_dec_expense_override", null);
  const [contribProfileId, setContribProfileId] = useActiveContribProfile();
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();
  const contribProfiles = contribProfilesQuery.data ?? [];
  const [snapshotId, setSnapshotId] = usePersistedSetting<number | null>(
    "retirement_snapshot_id",
    null,
  );
  const snapshotTotalsQuery = trpc.networth.listSnapshotTotals.useQuery();
  const snapshotOptions = snapshotTotalsQuery.data ?? [];
  const engineInput = useMemo(
    () => ({
      metadataOnly: true as const,
      ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
      ...(contribProfileId != null
        ? { contributionProfileId: contribProfileId }
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
    }),
    [
      salaryOverrides,
      contribProfileId,
      decBudgetProfileId,
      decBudgetCol,
      decExpenseOverride,
      snapshotId,
    ],
  );
  const debouncedEngineInput = useDebouncedValue(engineInput, 600);
  const { data, isLoading, isFetching, error } =
    trpc.projection.computeProjection.useQuery(debouncedEngineInput, {
      placeholderData: (prev) => prev,
    });
  const upsertSettings = trpc.settings.retirementSettings.upsert.useMutation({
    onMutate: async (newSettings) => {
      // Optimistic update: immediately reflect the changed setting in the UI
      // so dropdowns/inputs update without waiting for the server round-trip.
      await utils.projection.computeProjection.cancel();
      const defined = Object.fromEntries(
        Object.entries(newSettings).filter(([, v]) => v !== undefined),
      );
      utils.projection.computeProjection.setData(
        debouncedEngineInput,
        (old) => {
          if (!old || !("settings" in old) || !old.settings) return old;
          return {
            ...old,
            settings: { ...old.settings, ...defined },
          } as typeof old;
        },
      );
    },
    onSuccess: () => {
      utils.retirement.invalidate();
      utils.projection.invalidate();
    },
  });
  // tRPC's inferred input uses the specific withdrawalStrategy enum union and
  // omits null from optional strategy fields; our Settings layer mirrors the
  // raw DB shape (string / string|null). The gap is a TypeScript inference
  // artifact — buildSettingsPatch only ever sends fields that Zod accepts.
  const upsertSettingsMutation =
    upsertSettings as unknown as UpsertSettingsMutation; // eslint-disable-line no-restricted-syntax

  // Lazy-load strategy comparison only when expanded
  const [comparisonExpanded, setComparisonExpanded] =
    usePersistedSetting<boolean>("retirement_comparison_expanded", false);
  const comparisonInput = useMemo(
    () => ({
      ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
      ...(contribProfileId != null
        ? { contributionProfileId: contribProfileId }
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
    }),
    [
      salaryOverrides,
      contribProfileId,
      decBudgetProfileId,
      decBudgetCol,
      decExpenseOverride,
      snapshotId,
    ],
  );
  const { data: comparisonData, isLoading: comparisonLoading } =
    trpc.projection.computeStrategyComparison.useQuery(comparisonInput, {
      enabled:
        (comparisonExpanded || pageTab === "comparison") &&
        !isLoading &&
        !isFetching,
      placeholderData: (prev) => prev,
    });

  // Memoized callbacks — must be before early returns to preserve hook order.
  // These safely no-op when data/settings is not yet available.
  const handleRetirementSettingUpdate = useCallback(
    (field: string, value: string) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings) return;
      const numVal = parseInt(value, 10);
      if (isNaN(numVal)) return;
      upsertSettings.mutate({
        personId: settings.personId,
        retirementAge: settings.retirementAge,
        endAge: settings.endAge,
        returnAfterRetirement: settings.returnAfterRetirement,
        annualInflation: settings.annualInflation,
        salaryAnnualIncrease: settings.salaryAnnualIncrease,
        [field]: numVal,
      });
    },
    [data, upsertSettings],
  );

  const handleSettingPercentUpdate = useCallback(
    (field: string, wholePercent: string) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings) return;
      const dec = wholeToDec(wholePercent);
      upsertSettings.mutate({
        personId: settings.personId,
        retirementAge: settings.retirementAge,
        endAge: settings.endAge,
        returnAfterRetirement: settings.returnAfterRetirement,
        annualInflation: settings.annualInflation,
        salaryAnnualIncrease: settings.salaryAnnualIncrease,
        [field]: dec,
      });
    },
    [data, upsertSettings],
  );

  const handlePerPersonRetirementAge = useCallback(
    (personId: number, newAge: number) => {
      const settings = data && "settings" in data ? data.settings : null;
      const perPersonSettings =
        data && "perPersonSettings" in data ? data.perPersonSettings : null;
      if (!settings || isNaN(newAge)) return;
      const ps = perPersonSettings?.find(
        (p: { personId: number }) => p.personId === personId,
      );
      upsertSettings.mutate({
        personId,
        retirementAge: newAge,
        endAge: ps?.endAge ?? settings.endAge,
        returnAfterRetirement: settings.returnAfterRetirement,
        annualInflation: settings.annualInflation,
        salaryAnnualIncrease: settings.salaryAnnualIncrease,
      });
    },
    [data, upsertSettings],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
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

  const {
    settings,
    people: peopleLookup,
    returnRateSummary,
    perPersonSettings,
    selectedScenario,
  } = data;

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
      <PageHeader
        title="Retirement Projection"
        subtitle={
          accColumnLabel ? `Budget scenario: ${accColumnLabel}` : undefined
        }
      />

      {/* Page-level tabs */}
      <div className="flex flex-wrap rounded-md border bg-surface-primary/60 p-0.5 mb-4 w-fit max-w-full">
        <button
          type="button"
          onClick={() => setPageTab("projection")}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            pageTab === "projection"
              ? "bg-surface-primary text-primary shadow-sm border"
              : "text-muted hover:text-secondary"
          }`}
        >
          Projection
        </button>
        <button
          type="button"
          onClick={() => {
            setPageTab("comparison");
            setComparisonExpanded(true);
          }}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            pageTab === "comparison"
              ? "bg-surface-primary text-primary shadow-sm border"
              : "text-muted hover:text-secondary"
          }`}
        >
          <span className="sm:hidden">Comparison</span>
          <span className="hidden sm:inline">Strategy Comparison</span>
        </button>
        <button
          type="button"
          onClick={() => setPageTab("planHealth")}
          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
            pageTab === "planHealth"
              ? "bg-surface-primary text-primary shadow-sm border"
              : "text-muted hover:text-secondary"
          }`}
        >
          Plan Health
        </button>
      </div>

      {/* Snapshot selector */}
      {snapshotOptions.length > 1 && (
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-muted">Portfolio Snapshot:</label>
          <select
            className="text-xs bg-surface-elevated border rounded px-2 py-1 text-primary"
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
              className="text-[10px] text-blue-400 hover:text-blue-300"
            >
              Reset to latest
            </button>
          )}
        </div>
      )}

      {isFetching && !isLoading && (
        <div className="text-xs text-faint animate-pulse mb-2">
          Updating projection...
        </div>
      )}

      {pageTab === "planHealth" ? (
        /* Plan Health tab — diagnostic callouts derived from plan state.
           Consumes data.planHealth which the projection router builds
           from contribution accounts (M1) and the active glide path (M6). */
        <PlanHealthCard
          returnRate={parseFloat(settings.returnAfterRetirement)}
          inflationRate={parseFloat(settings.annualInflation)}
          salaryGrowthRate={parseFloat(settings.salaryAnnualIncrease)}
          retirementHorizonYears={settings.endAge - settings.retirementAge}
          hasBudgetLink={!!data.accumulationBudgetProfileId}
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
              perPersonSettings && perPersonSettings.length > 0
                ? Math.min(
                    ...perPersonSettings.map(
                      (p) => new Date().getFullYear() - p.birthYear,
                    ),
                  )
                : settings.retirementAge - 20
            }
            analyzerInput={comparisonInput ?? undefined}
          />
        ) : (
          <div className="text-xs text-muted p-4 text-center">
            Loading strategy comparison...
          </div>
        )
      ) : (
        <>
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
              contributionProfileId={contribProfileId ?? undefined}
              snapshotId={snapshotId ?? undefined}
              dollarMode={dollarMode}
              onDollarModeChange={setDollarMode}
            />
          </CardBoundary>

          {/* Strategy Comparison moved to page-level tab */}

          {/* Assumptions / Settings Card */}
          <CardBoundary title="Projection Assumptions">
            <Card title="Projection Assumptions" className="mb-6">
              <div className="space-y-4">
                {/* Two-column layout: Timeline+Income (left) | Decumulation Plan (right) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left column: Timeline + Income */}
                  <div className="bg-surface-sunken rounded-lg p-3 space-y-4">
                    <TimelineSection
                      settings={settings}
                      perPersonSettings={perPersonSettings}
                      handlePerPersonRetirementAge={
                        handlePerPersonRetirementAge
                      }
                      handleRetirementSettingUpdate={
                        handleRetirementSettingUpdate
                      }
                    />

                    <IncomeSection
                      settings={settings}
                      combinedSalary={data.combinedSalary}
                      upsertSettings={upsertSettingsMutation}
                      handleSettingPercentUpdate={handleSettingPercentUpdate}
                      contribProfiles={contribProfiles}
                      contribProfileId={contribProfileId}
                      setContribProfileId={setContribProfileId}
                    />
                  </div>

                  {/* Right column: Decumulation Plan */}
                  <div className="bg-surface-sunken rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                        Decumulation Plan
                      </h4>
                      <span className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">
                        Baseline + Simulation
                      </span>
                      <div className="flex-1 border-t" />
                      <StrategyGuideButton />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 text-sm">
                      <div className="col-span-2">
                        <span className="text-muted">
                          Strategy
                          <HelpTip text="How annual spending is determined during retirement. Fixed Real: perfectly predictable income that never changes based on market performance. Dynamic strategies (all others) automatically adjust spending when your portfolio rises or falls — this protects against depletion (higher success rates) but means your income varies year to year. The more a strategy self-corrects, the higher its success rate but the less stable your income. See Full Methodology for detailed guidance on when to use each strategy." />
                        </span>
                        <div className="font-medium">
                          <select
                            value={settings?.withdrawalStrategy ?? "fixed"}
                            onChange={(e) => {
                              if (!settings) return;
                              upsertSettings.mutate({
                                personId: settings.personId,
                                retirementAge: settings.retirementAge,
                                endAge: settings.endAge,
                                returnAfterRetirement:
                                  settings.returnAfterRetirement,
                                annualInflation: settings.annualInflation,
                                salaryAnnualIncrease:
                                  settings.salaryAnnualIncrease,
                                withdrawalStrategy: e.target
                                  .value as WithdrawalStrategyType,
                              });
                            }}
                            className="text-sm border rounded px-1.5 py-0.5 w-full"
                          >
                            {(() => {
                              const rec = recommendWithdrawalStrategy({
                                retirementHorizonYears:
                                  settings.endAge - settings.retirementAge,
                                hasBudgetLink:
                                  !!data.accumulationBudgetProfileId,
                                hasSocialSecurity: false,
                                mostlyTaxAdvantaged: false,
                              });
                              const recKey =
                                RECOMMENDED_KEY_MAP[rec.strategy] ?? "fixed";
                              return getAllStrategyKeys().map((key) => {
                                const meta = getStrategyMeta(key);
                                const isRecommended = key === recKey;
                                return (
                                  <option key={key} value={key}>
                                    {isRecommended ? "★ " : ""}
                                    {meta.label}
                                    {isRecommended ? " — Recommended" : ""}
                                  </option>
                                );
                              });
                            })()}
                          </select>
                        </div>
                      </div>
                      <div>
                        <span className="text-muted text-[10px]">
                          {(() => {
                            const key = (settings?.withdrawalStrategy ??
                              "fixed") as WithdrawalStrategyType;
                            const meta = getStrategyMeta(key);
                            return meta.description;
                          })()}
                        </span>
                      </div>
                    </div>

                    <PerPhaseBudgetSection
                      settings={settings}
                      budgetProfileSummaries={data.budgetProfileSummaries}
                      decumulationBudgetProfileId={
                        data.decumulationBudgetProfileId
                      }
                      decumulationBudgetColumn={data.decumulationBudgetColumn}
                      decExpenseOverride={decExpenseOverride}
                      setDecExpenseOverride={setDecExpenseOverride}
                      setDecBudgetProfileId={setDecBudgetProfileId}
                      setDecBudgetCol={setDecBudgetCol}
                    />

                    <RaiseAndRateSection
                      settings={settings}
                      handleSettingPercentUpdate={handleSettingPercentUpdate}
                    />

                    <StrategyParamsSection
                      settings={settings}
                      upsertSettings={upsertSettingsMutation}
                    />
                  </div>
                </div>

                {/* Plan Assumptions */}
                <div className="bg-surface-sunken rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                      Plan Assumptions
                    </h4>
                    <span className="text-[9px] text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded">
                      Baseline
                    </span>
                    <div className="flex-1 border-t" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <span className="text-muted">
                        Inflation
                        <HelpTip text="Constant CPI rate used for the deterministic projection — expense growth, real-dollar conversions, and IRS limit growth. In Monte Carlo mode, this is replaced by the Stochastic Inflation setting from your MC preset (View Assumptions)." />
                      </span>
                      <div className="font-medium">
                        <InlineEdit
                          value={decToWhole(settings.annualInflation)}
                          onSave={(v) =>
                            handleSettingPercentUpdate("annualInflation", v)
                          }
                          formatDisplay={(v) =>
                            formatPercent(Number(v) / 100, 2)
                          }
                          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                          type="number"
                          className="text-sm"
                          editable={!!settings}
                        />
                      </div>
                    </div>
                    <div>
                      <span className="text-muted">
                        IRS Limit Growth
                        <HelpTip text="Annual increase in 401k/IRA/HSA contribution limits. Historically ~2%/yr." />
                      </span>
                      <div className="font-medium text-muted">~2%/yr</div>
                    </div>
                  </div>
                </div>
                {/* Advanced settings */}
                <>
                  <SocialSecuritySection
                    settings={settings}
                    perPersonSettings={perPersonSettings}
                    upsertSettings={upsertSettingsMutation}
                  />

                  <TaxesSection
                    settings={settings}
                    selectedScenario={selectedScenario}
                    upsertSettings={upsertSettingsMutation}
                  />

                  <HealthcareSection
                    settings={settings}
                    upsertSettings={upsertSettingsMutation}
                  />

                  <GlidePathSection returnRateSummary={returnRateSummary} />
                </>
              </div>
            </Card>
          </CardBoundary>
        </>
      )}
    </div>
  );
}
