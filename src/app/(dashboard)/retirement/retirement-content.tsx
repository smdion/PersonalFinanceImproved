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
      <div className="inline-flex rounded-md border bg-surface-primary/60 p-0.5 mb-4">
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
          Strategy Comparison
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
                    {/* Timeline */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                          Timeline
                        </h4>
                        <span className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">
                          Baseline + Simulation
                        </span>
                        <div className="flex-1 border-t" />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                        {perPersonSettings && perPersonSettings.length > 1 ? (
                          <>
                            {perPersonSettings.map((ps) => (
                              <div key={ps.personId}>
                                <span className="text-muted">
                                  {ps.name}&apos;s Retirement Age
                                </span>
                                <div className="font-medium flex items-baseline gap-1">
                                  <InlineEdit
                                    value={String(ps.retirementAge)}
                                    onSave={(v) =>
                                      handlePerPersonRetirementAge(
                                        ps.personId,
                                        parseInt(v, 10),
                                      )
                                    }
                                    type="number"
                                    className="text-sm"
                                    editable={!!settings}
                                  />
                                  <span className="text-[10px] text-faint">
                                    (now{" "}
                                    {new Date().getFullYear() - ps.birthYear})
                                  </span>
                                </div>
                              </div>
                            ))}
                            <div>
                              <span className="text-muted">
                                Household Retirement
                              </span>
                              <div className="font-medium text-blue-600">
                                {Math.max(
                                  ...perPersonSettings.map(
                                    (p) => p.retirementAge,
                                  ),
                                )}
                                <span className="text-[10px] text-faint font-normal ml-1">
                                  when last person retires
                                </span>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div>
                            <span className="text-muted">
                              Retirement Age
                              <HelpTip text="When contributions stop and withdrawals begin." />
                            </span>
                            <div className="font-medium">
                              <InlineEdit
                                value={String(settings.retirementAge)}
                                onSave={(v) =>
                                  handleRetirementSettingUpdate(
                                    "retirementAge",
                                    v,
                                  )
                                }
                                type="number"
                                className="text-sm"
                                editable={!!settings}
                              />
                            </div>
                          </div>
                        )}
                        <div>
                          <span className="text-muted">
                            Plan Through
                            <HelpTip text="How long your money needs to last. Higher = more safety margin." />
                          </span>
                          <div className="font-medium flex items-baseline gap-1">
                            <InlineEdit
                              value={String(settings.endAge)}
                              onSave={(v) =>
                                handleRetirementSettingUpdate("endAge", v)
                              }
                              type="number"
                              className="text-sm"
                              editable={!!settings}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Income (same box as Timeline) */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                          Income
                        </h4>
                        <div className="flex-1 border-t" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                        <div>
                          <span className="text-muted">
                            Household Salary
                            <HelpTip text="Combined annual salary from your jobs. This is your starting income — grows each year by the Pre-Retirement Raise rate until retirement." />
                          </span>
                          <div className="font-medium">
                            {data.combinedSalary != null
                              ? formatCurrency(data.combinedSalary)
                              : "—"}
                            <span className="text-[10px] text-faint font-normal ml-1">
                              from jobs
                            </span>
                          </div>
                        </div>
                        <div>
                          <span className="text-muted">
                            Pre-Retirement Raise
                            <HelpTip text="Annual salary raise % during working years. Affects future contributions and employer match." />
                          </span>
                          <div className="font-medium">
                            <InlineEdit
                              value={decToWhole(settings.salaryAnnualIncrease)}
                              onSave={(v) =>
                                handleSettingPercentUpdate(
                                  "salaryAnnualIncrease",
                                  v,
                                )
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
                            Salary Cap
                            <HelpTip text="Growth stops at this amount. Leave blank for no cap." />
                          </span>
                          <div className="font-medium">
                            <InlineEdit
                              value={
                                settings.salaryCap
                                  ? String(
                                      Math.round(
                                        parseFloat(settings.salaryCap),
                                      ),
                                    )
                                  : ""
                              }
                              onSave={(v) => {
                                if (!settings) return;
                                const val = v.replace(/[^0-9]/g, "");
                                upsertSettings.mutate({
                                  personId: settings.personId,
                                  retirementAge: settings.retirementAge,
                                  endAge: settings.endAge,
                                  returnAfterRetirement:
                                    settings.returnAfterRetirement,
                                  annualInflation: settings.annualInflation,
                                  salaryAnnualIncrease:
                                    settings.salaryAnnualIncrease,
                                  salaryCap: val === "" ? null : val,
                                });
                              }}
                              formatDisplay={(v) =>
                                v ? formatCurrency(Number(v)) : "None"
                              }
                              parseInput={(v) => v.replace(/[^0-9]/g, "")}
                              type="number"
                              className="text-sm"
                              editable={!!settings}
                            />
                          </div>
                        </div>
                        <div>
                          <span className="text-muted">
                            Contribution Profile
                            <HelpTip text="Select a contribution profile to override salary and contribution assumptions in the projection. 'Live' uses your current paycheck/contribution settings." />
                          </span>
                          <div className="font-medium">
                            <select
                              className="text-sm border rounded px-2 py-1 bg-surface-primary w-full"
                              value={contribProfileId ?? ""}
                              onChange={(e) =>
                                setContribProfileId(
                                  e.target.value
                                    ? Number(e.target.value)
                                    : null,
                                )
                              }
                            >
                              {contribProfiles.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                  {!p.name.includes("(Live)") && p.isDefault
                                    ? " (Live)"
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
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

                    {/* Per-phase budget profile + column selection */}
                    {(() => {
                      const activeStrategy = (settings?.withdrawalStrategy ??
                        "fixed") as WithdrawalStrategyType;
                      const strategyMeta = getStrategyMeta(activeStrategy);
                      const { incomeSource } = strategyMeta;
                      const budgetNotUsed =
                        incomeSource === "formula" || incomeSource === "rate";
                      const { usesWithdrawalRate, usesPostRetirementRaise } =
                        strategyMeta;
                      const profiles = data.budgetProfileSummaries ?? [];
                      if (profiles.length === 0) return null;

                      const decProfile =
                        profiles.find(
                          (p) => p.id === data.decumulationBudgetProfileId,
                        ) ?? profiles.find((p) => p.isActive);
                      const decLabels = decProfile?.columnLabels ?? [];
                      const decTotals = decProfile?.columnTotals ?? [];
                      const decMonths =
                        (decProfile?.columnMonths as number[] | null) ?? null;
                      const decWeighted =
                        (decProfile?.weightedAnnualTotal as number | null) ??
                        null;

                      return (
                        <div>
                          {(budgetNotUsed ||
                            !usesWithdrawalRate ||
                            !usesPostRetirementRaise) && (
                            <div className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1.5 mb-2">
                              {`${strategyMeta.label} computes spending from ${
                                incomeSource === "formula"
                                  ? "your portfolio balance using IRS/endowment formulas"
                                  : incomeSource === "rate"
                                    ? "withdrawal rate × portfolio"
                                    : "your retirement budget"
                              }.`}
                              {(() => {
                                const dimmed: string[] = [];
                                if (budgetNotUsed) dimmed.push("budget source");
                                if (!usesWithdrawalRate)
                                  dimmed.push("initial withdrawal rate");
                                if (!usesPostRetirementRaise)
                                  dimmed.push("post-retirement raise");
                                return dimmed.length > 0
                                  ? ` Dimmed settings (${dimmed.join(", ")}) are not used by this strategy.`
                                  : "";
                              })()}
                            </div>
                          )}
                          <div
                            className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm ${budgetNotUsed ? "opacity-40" : ""}`}
                          >
                            {/* Retirement Budget source */}
                            <div>
                              <span className="text-muted">
                                Budget Source
                                <HelpTip text="Your starting retirement 'salary' — what you pay yourself from your portfolio each year. Grows by the Post-Retirement Raise rate. Set a manual override or use a budget profile." />
                              </span>
                              <div className="font-medium flex flex-col gap-1">
                                {decExpenseOverride ? (
                                  <span className="text-faint text-xs italic">
                                    Using manual override
                                  </span>
                                ) : (
                                  <>
                                    <select
                                      className="text-sm border rounded px-2 py-1 bg-surface-primary"
                                      value={
                                        data.decumulationBudgetProfileId ?? ""
                                      }
                                      onChange={(e) => {
                                        setDecBudgetProfileId(
                                          e.target.value
                                            ? Number(e.target.value)
                                            : null,
                                        );
                                        setDecBudgetCol(null);
                                      }}
                                    >
                                      {profiles.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                          {p.isActive ? " (active)" : ""}
                                        </option>
                                      ))}
                                    </select>
                                    {decMonths ? (
                                      <span className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                                        Weighted:{" "}
                                        {formatCurrency(decWeighted ?? 0)}
                                        /yr
                                        <span className="text-[10px] text-faint ml-1">
                                          (
                                          {decMonths
                                            .map(
                                              (m, i) =>
                                                `${m}mo ${decLabels[i] ?? ""}`,
                                            )
                                            .join(" +")}
                                          )
                                        </span>
                                      </span>
                                    ) : decLabels.length >= 2 ? (
                                      <select
                                        className="text-sm border rounded px-2 py-1 bg-surface-primary"
                                        value={data.decumulationBudgetColumn}
                                        onChange={(e) =>
                                          setDecBudgetCol(
                                            Number(e.target.value),
                                          )
                                        }
                                      >
                                        {decLabels.map(
                                          (label: string, idx: number) => (
                                            <option key={label} value={idx}>
                                              {label} (
                                              {formatCurrency(
                                                (decTotals[idx] ?? 0) * 12,
                                              )}
                                              /yr)
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            </div>
                            {/* Retirement salary override */}
                            <div>
                              <span className="text-muted">
                                Salary Override
                                <HelpTip text="Set a flat annual amount as your starting retirement salary. Overrides the budget profile. Grows by the Post-Retirement Raise rate each year." />
                              </span>
                              <div className="font-medium flex items-center gap-1">
                                <InlineEdit
                                  value={decExpenseOverride ?? ""}
                                  onSave={(v) => {
                                    const cleaned = v.replace(/[^0-9]/g, "");
                                    setDecExpenseOverride(cleaned || null);
                                  }}
                                  formatDisplay={(v) =>
                                    v
                                      ? `${formatCurrency(Number(v))}/yr`
                                      : "None (using budget)"
                                  }
                                  parseInput={(v) => v.replace(/[^0-9]/g, "")}
                                  type="number"
                                  className="text-sm"
                                  editable={!!settings}
                                />
                                {decExpenseOverride && (
                                  <button
                                    className="text-[10px] text-red-400 hover:text-red-600"
                                    onClick={() => setDecExpenseOverride(null)}
                                  >
                                    clear
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Post-Retirement Raise + Withdrawal Rate side by side */}
                    {(() => {
                      const s = (settings?.withdrawalStrategy ??
                        "fixed") as WithdrawalStrategyType;
                      const meta = getStrategyMeta(s);
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm mt-2">
                          <div
                            className={
                              !meta.usesPostRetirementRaise ? "opacity-40" : ""
                            }
                          >
                            <span className="text-muted">
                              Post-Retirement Raise
                              <HelpTip text="Your annual 'raise' in retirement. The base is set by your Retirement Budget — this rate grows it each year, like a cost-of-living adjustment. Independent of the Inflation rate." />
                            </span>
                            <div className="font-medium">
                              <InlineEdit
                                value={decToWhole(
                                  settings.postRetirementInflation ??
                                    settings.annualInflation,
                                )}
                                onSave={(v) =>
                                  handleSettingPercentUpdate(
                                    "postRetirementInflation",
                                    v,
                                  )
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
                          <div
                            className={
                              !meta.usesWithdrawalRate ? "opacity-40" : ""
                            }
                          >
                            <span className="text-muted">
                              {meta.incomeSource === "budget"
                                ? "Withdrawal Rate"
                                : "Initial Withdrawal Rate"}
                              <HelpTip
                                text={
                                  !meta.usesWithdrawalRate
                                    ? `Not used by ${meta.label} — this strategy computes spending from its own formula (${meta.incomeSource === "formula" ? "IRS factors" : "base percentage of portfolio"}).`
                                    : meta.incomeSource === "rate"
                                      ? `Starting withdrawal rate for ${meta.label}. Sets the initial withdrawal amount, which the strategy then adjusts yearly based on portfolio performance.`
                                      : "Your withdrawal rate applied to the projected retirement balance. Determines the annual withdrawal amount, which grows by the Post-Retirement Raise rate each year."
                                }
                              />
                            </span>
                            <div className="font-medium">
                              <InlineEdit
                                value={decToWhole(settings.withdrawalRate)}
                                onSave={(v) =>
                                  handleSettingPercentUpdate(
                                    "withdrawalRate",
                                    v,
                                  )
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
                        </div>
                      );
                    })()}

                    {/* Strategy-specific parameters — data-driven from registry */}
                    {(() => {
                      const strategyKey = (settings?.withdrawalStrategy ??
                        "fixed") as WithdrawalStrategyType;
                      const meta = getStrategyMeta(strategyKey);
                      if (meta.paramFields.length === 0) return null;

                      // Map registry param keys to DB column names for reading/writing
                      const paramToDbColumn: Record<string, string> = {
                        // GK
                        upperGuardrail: "gkUpperGuardrail",
                        lowerGuardrail: "gkLowerGuardrail",
                        increasePercent: "gkIncreasePct",
                        decreasePercent: "gkDecreasePct",
                        skipInflationAfterLoss: "gkSkipInflationAfterLoss",
                        // Spending Decline
                        annualDeclineRate: "sdAnnualDeclineRate",
                        // Constant Percentage
                        withdrawalPercent:
                          strategyKey === "constant_percentage"
                            ? "cpWithdrawalPercent"
                            : strategyKey === "endowment"
                              ? "enWithdrawalPercent"
                              : "cpWithdrawalPercent",
                        floorPercent:
                          strategyKey === "constant_percentage"
                            ? "cpFloorPercent"
                            : strategyKey === "endowment"
                              ? "enFloorPercent"
                              : strategyKey === "vanguard_dynamic"
                                ? "vdFloorPercent"
                                : "cpFloorPercent",
                        // Endowment
                        rollingYears: "enRollingYears",
                        // Vanguard Dynamic
                        basePercent: "vdBasePercent",
                        ceilingPercent: "vdCeilingPercent",
                        // RMD
                        rmdMultiplier: "rmdMultiplier",
                      };

                      // Partition fields into layout items: grouped pairs or standalone
                      type LayoutItem =
                        | {
                            kind: "standalone";
                            field: (typeof meta.paramFields)[number];
                          }
                        | {
                            kind: "group";
                            groupName: string;
                            fields: (typeof meta.paramFields)[number][];
                          };
                      const layoutItems: LayoutItem[] = [];
                      const seenGroups = new Set<string>();
                      for (const field of meta.paramFields) {
                        if (field.group) {
                          if (seenGroups.has(field.group)) continue;
                          seenGroups.add(field.group);
                          const grouped = meta.paramFields.filter(
                            (f) => f.group === field.group,
                          );
                          layoutItems.push({
                            kind: "group",
                            groupName: field.group,
                            fields: grouped,
                          });
                        } else {
                          layoutItems.push({ kind: "standalone", field });
                        }
                      }

                      const renderField = (
                        field: (typeof meta.paramFields)[number],
                      ) => {
                        const dbCol = paramToDbColumn[field.key];
                        if (!dbCol || !settings) return null;
                        const currentVal = (
                          settings as Record<string, unknown>
                        )[dbCol];

                        if (field.type === "boolean") {
                          const boolVal =
                            currentVal != null
                              ? Boolean(currentVal)
                              : Boolean(field.default);
                          return (
                            <div key={field.key}>
                              <span className="text-muted">
                                {field.label}
                                {field.tooltip && (
                                  <HelpTip text={field.tooltip} />
                                )}
                              </span>
                              <div className="font-medium">
                                <button
                                  onClick={() => {
                                    upsertSettings.mutate({
                                      personId: settings.personId,
                                      retirementAge: settings.retirementAge,
                                      endAge: settings.endAge,
                                      returnAfterRetirement:
                                        settings.returnAfterRetirement,
                                      annualInflation: settings.annualInflation,
                                      salaryAnnualIncrease:
                                        settings.salaryAnnualIncrease,
                                      [dbCol]: !boolVal,
                                    });
                                  }}
                                  className={`text-sm px-2 py-0.5 rounded ${
                                    boolVal
                                      ? "bg-green-100 text-green-700"
                                      : "bg-surface-elevated text-muted"
                                  }`}
                                >
                                  {boolVal ? "On" : "Off"}
                                </button>
                              </div>
                            </div>
                          );
                        }

                        if (
                          field.type === "number" &&
                          field.key === "rollingYears"
                        ) {
                          const numVal =
                            currentVal != null
                              ? Number(currentVal)
                              : Number(field.default);
                          return (
                            <div key={field.key}>
                              <span className="text-muted">
                                {field.label}
                                {field.tooltip && (
                                  <HelpTip text={field.tooltip} />
                                )}
                              </span>
                              <div className="font-medium">
                                <select
                                  value={String(numVal)}
                                  onChange={(e) => {
                                    upsertSettings.mutate({
                                      personId: settings.personId,
                                      retirementAge: settings.retirementAge,
                                      endAge: settings.endAge,
                                      returnAfterRetirement:
                                        settings.returnAfterRetirement,
                                      annualInflation: settings.annualInflation,
                                      salaryAnnualIncrease:
                                        settings.salaryAnnualIncrease,
                                      [dbCol]: Number(e.target.value),
                                    });
                                  }}
                                  className="text-sm border rounded px-1.5 py-0.5"
                                >
                                  {Array.from(
                                    {
                                      length:
                                        ((field.max ?? 20) - (field.min ?? 3)) /
                                          (field.step ?? 1) +
                                        1,
                                    },
                                    (_, i) => {
                                      const v =
                                        (field.min ?? 3) +
                                        i * (field.step ?? 1);
                                      return (
                                        <option key={v} value={String(v)}>
                                          {v} years
                                        </option>
                                      );
                                    },
                                  )}
                                </select>
                              </div>
                            </div>
                          );
                        }

                        if (field.type === "number") {
                          const numVal =
                            currentVal != null
                              ? Number(currentVal)
                              : Number(field.default);
                          return (
                            <div key={field.key}>
                              <span className="text-muted">
                                {field.label}
                                {field.tooltip && (
                                  <HelpTip text={field.tooltip} />
                                )}
                              </span>
                              <div className="font-medium">
                                <select
                                  value={String(numVal)}
                                  onChange={(e) => {
                                    upsertSettings.mutate({
                                      personId: settings.personId,
                                      retirementAge: settings.retirementAge,
                                      endAge: settings.endAge,
                                      returnAfterRetirement:
                                        settings.returnAfterRetirement,
                                      annualInflation: settings.annualInflation,
                                      salaryAnnualIncrease:
                                        settings.salaryAnnualIncrease,
                                      [dbCol]: e.target.value,
                                    });
                                  }}
                                  className="text-sm border rounded px-1.5 py-0.5"
                                >
                                  {Array.from(
                                    {
                                      length:
                                        Math.round(
                                          ((field.max ?? 3) -
                                            (field.min ?? 0.5)) /
                                            (field.step ?? 0.1),
                                        ) + 1,
                                    },
                                    (_, i) => {
                                      const v =
                                        (field.min ?? 0.5) +
                                        i * (field.step ?? 0.1);
                                      const rounded = Math.round(v * 100) / 100;
                                      return (
                                        <option
                                          key={rounded}
                                          value={String(rounded)}
                                        >
                                          {rounded}x
                                        </option>
                                      );
                                    },
                                  )}
                                </select>
                              </div>
                            </div>
                          );
                        }

                        // type === 'percent'
                        const pctVal =
                          currentVal != null
                            ? Number(currentVal)
                            : Number(field.default);
                        return (
                          <div key={field.key}>
                            <span className="text-muted">
                              {field.label}
                              {field.tooltip && (
                                <HelpTip text={field.tooltip} />
                              )}
                            </span>
                            <div className="font-medium">
                              <select
                                value={String(pctVal)}
                                onChange={(e) => {
                                  upsertSettings.mutate({
                                    personId: settings.personId,
                                    retirementAge: settings.retirementAge,
                                    endAge: settings.endAge,
                                    returnAfterRetirement:
                                      settings.returnAfterRetirement,
                                    annualInflation: settings.annualInflation,
                                    salaryAnnualIncrease:
                                      settings.salaryAnnualIncrease,
                                    [dbCol]: e.target.value,
                                  });
                                }}
                                className="text-sm border rounded px-1.5 py-0.5"
                              >
                                {Array.from(
                                  {
                                    length:
                                      Math.round(
                                        ((field.max ?? 1) - (field.min ?? 0)) /
                                          (field.step ?? 0.01),
                                      ) + 1,
                                  },
                                  (_, i) => {
                                    const v =
                                      (field.min ?? 0) +
                                      i * (field.step ?? 0.01);
                                    const rounded = Math.round(v * 1000) / 1000;
                                    return (
                                      <option
                                        key={rounded}
                                        value={String(rounded)}
                                      >
                                        {formatPercent(rounded, 1)}
                                      </option>
                                    );
                                  },
                                )}
                              </select>
                            </div>
                          </div>
                        );
                      };

                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm mt-2">
                          {layoutItems.map((item) => {
                            if (item.kind === "group") {
                              return item.fields.map((f) => renderField(f));
                            }
                            return renderField(item.field);
                          })}
                        </div>
                      );
                    })()}
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
                    upsertSettings={upsertSettings}
                  />

                  <TaxesSection
                    settings={settings}
                    selectedScenario={selectedScenario}
                    upsertSettings={upsertSettings}
                  />

                  <HealthcareSection
                    settings={settings}
                    upsertSettings={upsertSettings}
                  />

                  {/* Investment Returns Glide Path */}
                  {returnRateSummary && (
                    <div className="bg-surface-sunken rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                          Returns
                        </h4>
                        <span className="text-[10px] text-faint">
                          age-based glide path
                        </span>
                        <HelpTip text="Your portfolio return rate shifts with age based on the glide path configured in Settings. Deterministic mode uses these rates directly as fixed annual returns. Monte Carlo (Simple + Advanced) uses them as the mean of a probability distribution — each trial samples random returns around these rates, capturing real-world volatility and sequence-of-returns risk. Darker segments in the bar below indicate higher return rates (younger, more aggressive allocation)." />
                        <span className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">
                          Baseline + Simulation
                        </span>
                        <div className="flex-1 border-t" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 text-sm mb-2">
                        <div>
                          <span className="text-muted">Now</span>
                          <div className="font-medium text-blue-600">
                            {returnRateSummary.currentRate != null
                              ? formatPercent(returnRateSummary.currentRate, 1)
                              : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted">At Retirement</span>
                          <div className="font-medium text-blue-600">
                            {returnRateSummary.retirementRate != null
                              ? formatPercent(
                                  returnRateSummary.retirementRate,
                                  1,
                                )
                              : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted">Post-Retirement</span>
                          <div className="font-medium text-blue-600">
                            {returnRateSummary.postRetirementRate != null
                              ? formatPercent(
                                  returnRateSummary.postRetirementRate,
                                  1,
                                )
                              : "—"}
                          </div>
                        </div>
                        <div>
                          <span className="text-muted">Avg (Accumulation)</span>
                          <div className="font-medium text-blue-600">
                            {formatPercent(
                              returnRateSummary.avgAccumulation,
                              1,
                            )}
                          </div>
                        </div>
                      </div>
                      {/* Glide path bar */}
                      <div className="flex items-center gap-2 text-[10px] text-faint">
                        <span>{returnRateSummary.schedule[0]?.age ?? "—"}</span>
                        <div className="flex-1 flex h-2.5 rounded-full overflow-hidden bg-surface-strong">
                          {(() => {
                            const sched = returnRateSummary.schedule;
                            if (sched.length === 0) return null;
                            const minRate = Math.min(
                              ...sched.map((s) => s.rate),
                            );
                            const maxRate = Math.max(
                              ...sched.map((s) => s.rate),
                            );
                            const range = maxRate - minRate || 1;
                            const samples = sched.filter(
                              (_, i) =>
                                i === 0 ||
                                i === sched.length - 1 ||
                                i % 5 === 0,
                            );
                            return samples.map((s) => {
                              const intensity = (s.rate - minRate) / range;
                              const lightness = 78 - intensity * 38;
                              return (
                                <div
                                  key={s.age}
                                  className="flex-1 transition-all"
                                  style={{
                                    backgroundColor: `hsl(210, 70%, ${lightness}%)`,
                                  }}
                                  title={`Age ${s.age}: ${formatPercent(s.rate, 1)}`}
                                />
                              );
                            });
                          })()}
                        </div>
                        <span>
                          {returnRateSummary.schedule[
                            returnRateSummary.schedule.length - 1
                          ]?.age ?? "—"}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-faint mt-0.5 px-6">
                        <span>
                          {returnRateSummary.currentRate != null
                            ? formatPercent(returnRateSummary.currentRate, 1)
                            : "—"}
                        </span>
                        <span>darker = higher return</span>
                        <span>
                          {(() => {
                            const lastRate =
                              returnRateSummary.schedule[
                                returnRateSummary.schedule.length - 1
                              ]?.rate;
                            return lastRate != null
                              ? formatPercent(lastRate, 1)
                              : "—";
                          })()}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              </div>
            </Card>
          </CardBoundary>
        </>
      )}
    </div>
  );
}
