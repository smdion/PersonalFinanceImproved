"use client";

/** Savings goals tracking page showing progress, contributions, and projected completion dates. */

import React, { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useLocalStorageSet } from "@/lib/hooks/use-local-storage-set";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import {
  SummaryCards,
  NewFundFormCard,
  GoalProjection,
  type NewFundForm,
} from "@/components/savings";
import {
  projectGoalBalances,
  buildSettledOccurrencesSet,
} from "@/lib/pure/savings-projection";
import { TARGET_MODE_VALUES } from "@/lib/config/enum-values";
import type { TargetMode } from "@/lib/config/enum-values";

function isTargetMode(v: unknown): v is TargetMode {
  return TARGET_MODE_VALUES.includes(v as TargetMode);
}
import { formatCurrency } from "@/lib/utils/format";
import { BudgetCapacityBar } from "@/components/savings/budget-capacity-bar";
import { ExtraPaycheckRulesEditor } from "@/components/savings/extra-paycheck-rules-editor";

// Code-split Recharts-heavy children (v0.5 expert-review M8). Loads on
// page mount instead of bundling into the savings page chunk. ssr:false
// because Recharts isn't SSR-friendly.
const SavingsTrajectoryChart = dynamic(
  () =>
    import("@/components/savings/savings-trajectory-chart").then((m) => ({
      default: m.SavingsTrajectoryChart,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);
import { UpcomingGoals } from "@/components/savings/upcoming-goals";
import {
  FundManagementSection,
  type FundManagementCallbacks,
} from "@/components/savings/fund-management-section";
import { AllocationEditorSection } from "@/components/savings/allocation-editor-section";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import { SavingsTrajectoryTable } from "@/components/savings/savings-trajectory-table";
import { AllTransactionsTab } from "@/components/savings/all-transactions-tab";
import {
  ApiSyncSection,
  useApiSync,
} from "@/components/savings/api-sync-section";
import { ProjectionImpactBar } from "@/components/savings/projection-impact-bar";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import { useUpdatePlannedTx } from "@/components/savings/use-update-planned-tx";
import {
  computeMaxMonthlyFunding,
  type CapacityPerson,
} from "@/lib/calculators/savings-capacity";
import { resolveContributionProfileId } from "@/lib/calculators/contribution-profile-resolution";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";

export default function SavingsPage() {
  const user = useUser();
  const canEdit = hasPermission(user, "savings");
  const utils = trpc.useUtils();

  // ── Persisted settings ──
  const [efundBudgetColumn, setEfundBudgetColumn] = usePersistedSetting<number>(
    "efund_budget_column",
    -1,
  );
  const [budgetColumn] = usePersistedSetting<number>("budget_active_column", 0);
  const [projectionYears, setProjectionYears] = usePersistedSetting<number>(
    "savings_projection_years",
    3,
  );
  const [rawActiveContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  // Fetch contribution profiles list for subtitle display + Plan-pin validIds.
  const { data: contribProfilesList } =
    trpc.contributionProfile.list.useQuery();
  // Plan pin -> globally-active contribution profile (single computation
  // path — matches expenses/page.tsx, paycheck/page.tsx, contributions/page.tsx).
  const { profileId: activeContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfilesList?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: rawActiveContribProfileId,
    },
  );
  // null = "use whichever budget profile is active" (today's behavior,
  // unchanged). Only affects the live pool used by Pull In New Pay /
  // Update % — goal balances, targets, and the e-fund always reflect the
  // real active profile regardless of this selection.
  const [recalcProfileId, setRecalcProfileId] = usePersistedSetting<
    number | null
  >("savings_recalc_profile_id", null);

  // ── Shared queries ──
  const efundTierInput =
    efundBudgetColumn >= 0
      ? { budgetTierOverride: efundBudgetColumn }
      : undefined;
  const { data, isLoading, error } =
    trpc.savings.computeSummary.useQuery(efundTierInput);
  const { data: reimbursementsData } =
    trpc.savings.listEfundReimbursements.useQuery();
  const { data: apiBalancesData } = trpc.savings.listApiBalances.useQuery();
  const { data: apiCategoriesData } = trpc.budget.listApiCategories.useQuery();

  const salaryOverrides = useSalaryOverrides();
  const { data: budgetData } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: budgetColumn,
    activeContribProfileId,
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
  });
  const { data: budgetProfilesList } = trpc.budget.listProfiles.useQuery();

  // Derive contribution profile from the budget column's linked profile
  // (holistic rule) — resolveContributionProfileId is the only path this
  // and computeActiveSummary/use-budget-derived-data.ts should use, so
  // budget item $ amounts, this page's pool, and the payroll breakdown
  // never disagree about which contribution profile is in effect.
  const effectiveContribProfileId = resolveContributionProfileId(
    budgetData?.profile?.columnContributionProfileIds as
      (number | null)[] | null,
    budgetColumn,
    budgetData?.columnLabels?.length ?? 0,
    activeContribProfileId,
  );

  const paycheckInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(effectiveContribProfileId != null
      ? { contributionProfileId: effectiveContribProfileId }
      : {}),
  };
  const { data: paycheckData } = trpc.paycheck.computeSummary.useQuery(
    Object.keys(paycheckInput).length > 0 ? paycheckInput : undefined,
  );

  // ── Budget leftover ──
  const budgetMonthlyTotal = budgetData?.result
    ? budgetData.columnMonths
      ? (budgetData.weightedAnnualTotal ?? 0) / 12
      : (budgetData.result.totalMonthly ?? 0)
    : null;
  const maxMonthlyFunding =
    paycheckData && budgetMonthlyTotal !== null
      ? computeMaxMonthlyFunding(
          paycheckData.people as CapacityPerson[],
          budgetMonthlyTotal,
        )
      : null;

  // ── Recalculate/lock-in pool, scoped to whichever profile is selected ──
  // Only feeds the "Pull In New Pay" / "Update %" preview + mutations
  // below — every other number on this page (goal balances, targets,
  // e-fund, chart, capacity bar) always reflects the real active profile,
  // matching computeSummary's own scope (see savings.ts computeSummary,
  // which is not profile-scoped).
  const activeProfileId =
    budgetProfilesList?.find((p) => p.isActive)?.id ?? null;
  // Plan pin -> the page's own recalc-profile picker -> true active profile
  // (single computation path — see useEffectiveProfileId).
  const { profileId: effectiveRecalcProfileId } = useEffectiveProfileId(
    "budget",
    {
      validIds: budgetProfilesList?.map((p) => p.id),
      localSelection: recalcProfileId,
      globalDefaultId: activeProfileId,
    },
  );
  const isPreviewingOtherProfile =
    effectiveRecalcProfileId !== null &&
    effectiveRecalcProfileId !== activeProfileId;
  const { data: recalcBudgetData } = trpc.budget.computeActiveSummary.useQuery(
    {
      selectedColumn: budgetColumn,
      profileId: effectiveRecalcProfileId ?? undefined,
      activeContribProfileId,
      ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    },
    { enabled: isPreviewingOtherProfile },
  );
  const recalcMonthlyTotal =
    isPreviewingOtherProfile && recalcBudgetData?.result
      ? recalcBudgetData.columnMonths
        ? (recalcBudgetData.weightedAnnualTotal ?? 0) / 12
        : (recalcBudgetData.result.totalMonthly ?? 0)
      : null;
  const recalcMaxMonthlyFunding =
    isPreviewingOtherProfile && paycheckData && recalcMonthlyTotal !== null
      ? computeMaxMonthlyFunding(
          paycheckData.people as CapacityPerson[],
          recalcMonthlyTotal,
        )
      : maxMonthlyFunding;

  // ── Cross-section coordination ──
  const apiSync = useApiSync();
  const [editingMonth, setEditingMonth] = useState<Date | null>(null);
  const [showNewFund, setShowNewFund] = useState(false);
  const [hiddenGoalIds, setHiddenGoalIds] = useLocalStorageSet(
    "ledgr:savings:hiddenFunds",
  );

  const handleToggleGoalColumn = (id: number) => {
    const s = new Set(hiddenGoalIds);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setHiddenGoalIds(s);
  };
  const [projectionView, setProjectionView] = useState<"table" | "chart">(
    "table",
  );
  const [masterTab, setMasterTab] = useState<"plan" | "manage">("plan");
  const [editTab, setEditTab] = useState<
    "allocations" | "transactions" | "extraPaychecks"
  >("allocations");

  // ── Top-level form state (lives here to render in correct layout position) ──
  const [newFund, setNewFund] = useState<NewFundForm>({
    name: "",
    monthlyContribution: "",
    targetAmount: "",
    targetMode: "fixed",
    targetDate: "",
    parentGoalId: null,
  });
  const createGoal = trpc.settings.savingsGoals.create.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setShowNewFund(false);
    },
  });
  const { onUpdateTx: updateTxFn, isPending: updateTxPending } =
    useUpdatePlannedTx();

  // ── Ref for FundManagementSection callbacks (goal updates used by other sections) ──
  const fundCallbacksRef = useRef<FundManagementCallbacks | null>(null);

  // ── Loading / error states ──
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <SkeletonChart height={256} />
      </div>
    );
  }

  if (error)
    return (
      <p className="text-red-600 text-sm">
        Failed to load savings data: {error.message}
      </p>
    );
  if (!data)
    return (
      <EmptyState
        message="No savings data available."
        hint="Create a savings fund to start tracking goals."
      />
    );

  const {
    savings,
    efund,
    goals: rawGoals,
    plannedTransactions,
    allocationOverrides,
    budgetTierLabels,
    efundTierIndex,
  } = data;

  // ── Shared derived state ──
  const goalById = new Map(rawGoals.map((g) => [g.id, g]));
  const settledOccurrences = buildSettledOccurrencesSet(plannedTransactions);

  const childGoalsByParent = new Map<number, typeof rawGoals>();
  for (const g of rawGoals) {
    if (g.parentGoalId) {
      const children = childGoalsByParent.get(g.parentGoalId) ?? [];
      children.push(g);
      childGoalsByParent.set(g.parentGoalId, children);
    }
  }

  const apiBalanceMap = new Map<
    number,
    {
      balance: number;
      budgeted: number;
      activity: number;
      goalTarget: number | null;
    }
  >();
  if (apiBalancesData?.balances) {
    for (const b of apiBalancesData.balances) {
      apiBalanceMap.set(b.goalId, {
        balance: b.balance,
        budgeted: b.budgeted,
        activity: b.activity,
        goalTarget: b.goalTarget ?? null,
      });
    }
  }

  // ── Budget frequency note for help text ──
  const budgetNote = (() => {
    if (!paycheckData) return undefined;
    const notes = paycheckData.people
      .filter((d) => d.paycheck && d.job)
      .map((d) => (d as { budgetNote?: string }).budgetNote)
      .filter(Boolean);
    return notes.length > 0 ? notes.join("; ") : undefined;
  })();

  // ── Projection months ──
  const projectionMonths = projectionYears * 12;
  const now = new Date();
  const monthDates: Date[] = [];
  for (let i = 0; i < projectionMonths; i++) {
    monthDates.push(new Date(now.getFullYear(), now.getMonth() + i, 1));
  }

  // ── Derived pool growth from per-person paycheck raise rates ──
  // Projects the monthly savings pool forward by applying each earner's stored
  // raise rates to their current net pay. Assumes flat budget expenses.
  const startYear = now.getFullYear();
  const derivedPoolByYear = new Map<number, number>();

  if (
    maxMonthlyFunding !== null &&
    budgetMonthlyTotal !== null &&
    paycheckData
  ) {
    derivedPoolByYear.set(startYear, maxMonthlyFunding);
    const activeEarners = paycheckData.people.filter(
      (p) => p.paycheck && p.job,
    );
    for (let yr = startYear + 1; yr <= startYear + projectionYears; yr++) {
      let projectedMonthlyNet = 0;
      for (const p of activeEarners) {
        const pc = p.paycheck as { netPay: number; periodsPerYear: number };
        // Use budgetPerMonth (regular checks only) to match how maxMonthlyFunding
        // is computed — extra biweekly checks are routed separately, not budget income.
        const perMonth =
          (p as { budgetPerMonth?: number }).budgetPerMonth ??
          pc.periodsPerYear / 12;
        const routing = (
          p.job as { extraPaycheckRouting?: ExtraPaycheckRoutingData | null }
        )?.extraPaycheckRouting;
        const raises = routing?.yearlyGrowth ?? {};
        let netPerCheck = pc.netPay;
        for (let y = startYear + 1; y <= yr; y++) {
          const e = raises[String(y)];
          if (!e || e.value === 0) continue;
          netPerCheck =
            e.type === "pct"
              ? netPerCheck * (1 + e.value / 100)
              : netPerCheck + e.value;
        }
        projectedMonthlyNet += netPerCheck * perMonth;
      }
      derivedPoolByYear.set(
        yr,
        Math.max(0, projectedMonthlyNet - budgetMonthlyTotal),
      );
    }
  }

  function getAllocationForYear(baseAmount: number, year: number): number {
    const projectedPool = derivedPoolByYear.get(year);
    if (projectedPool === undefined) return baseAmount;
    const refPool = derivedPoolByYear.get(startYear) ?? projectedPool;
    if (refPool <= 0) return baseAmount;
    return baseAmount * (projectedPool / refPool);
  }

  // ── Goal projections ──
  const parentFundGoals = savings.goals.filter((goal) => {
    const raw = goalById.get(goal.goalId);
    return !raw?.parentGoalId;
  });
  const goalProjections: GoalProjection[] = parentFundGoals.map((goal) => {
    const raw = goalById.get(goal.goalId);
    const goalId = goal.goalId;
    // The stored snapshot (goal.monthlyAllocation) is the source of truth
    // even for percentage-based goals — it only moves when the user
    // explicitly hits "Recalculate" (recalculateAllocation), not whenever
    // paycheck/budget data shifts underneath it.
    const baseAllocation = goal.monthlyAllocation;
    const { balances, monthEvents, monthlyAllocations, hasOverride } =
      projectGoalBalances(
        {
          id: goalId,
          current: goal.current,
          monthlyAllocation: baseAllocation,
          isApiSyncEnabled: raw?.isApiSyncEnabled,
          apiCategoryId: raw?.apiCategoryId,
        },
        {
          now,
          projectionMonths,
          plannedTransactions,
          allocationOverrides,
          settledOccurrences,
          allocationForYear: getAllocationForYear,
        },
      );

    return {
      name: goal.name,
      goalId,
      current: goal.current,
      target: goal.target,
      targetMode: isTargetMode(raw?.targetMode) ? raw.targetMode : "fixed",
      monthlyAllocation: baseAllocation,
      monthlyAllocations,
      balances,
      monthEvents,
      hasOverride,
    };
  });

  goalProjections.sort((a, b) => b.monthlyAllocation - a.monthlyAllocation);

  const totalMonthlyAllocation = goalProjections.reduce(
    (s, g) => s + g.monthlyAllocation,
    0,
  );

  const basePool = maxMonthlyFunding ?? totalMonthlyAllocation;
  const monthlyPools = monthDates.map(
    (d) => derivedPoolByYear.get(d.getFullYear()) ?? basePool,
  );

  const handleFundClick = (fundName: string) => {
    const gp = goalProjections.find((g) => g.name === fundName);
    if (!gp) return;
    const el = document.getElementById(`fund-card-${gp.goalId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ── Extra paycheck net pay map ──
  const netPayByPersonId = new Map<number, number>();
  if (paycheckData) {
    for (const p of paycheckData.people) {
      if (p.paycheck && p.job) {
        netPayByPersonId.set(p.person.id, p.paycheck.netPay);
      }
    }
  }

  // ── Top-level form handlers ──
  const handleCreateFund = () => {
    if (!newFund.name) return;
    createGoal.mutate(
      {
        name: newFund.name,
        parentGoalId: newFund.parentGoalId ?? null,
        monthlyContribution: newFund.monthlyContribution || "0",
        targetAmount: newFund.targetAmount || null,
        targetMode: newFund.targetMode,
        targetDate: newFund.targetDate || null,
        isActive: true,
        isEmergencyFund: false,
        priority: rawGoals.length,
      },
      {
        onSuccess: () => {
          setNewFund({
            name: "",
            monthlyContribution: "",
            targetAmount: "",
            targetMode: "fixed",
            targetDate: "",
            parentGoalId: null,
          });
        },
      },
    );
  };

  // Stable wrappers for goal update callbacks (from FundManagementSection via ref)
  const onGoalUpdate = (goalId: number, field: string, value: string) => {
    fundCallbacksRef.current?.onGoalUpdate(goalId, field, value);
  };
  const onGoalUpdateMulti = (
    goalId: number,
    fields: Record<string, string>,
  ) => {
    fundCallbacksRef.current?.onGoalUpdateMulti(goalId, fields);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Savings"
        subtitle={(() => {
          const budgetLabel = budgetData?.columnLabels?.[budgetColumn];
          if (!budgetLabel) return undefined;
          const profileName =
            effectiveContribProfileId != null
              ? (contribProfilesList?.find(
                  (p) => p.id === effectiveContribProfileId,
                )?.name ?? null)
              : null;
          return profileName
            ? `Budget: ${budgetLabel} | Profile: ${profileName}`
            : `Budget: ${budgetLabel} | Profile: Live`;
        })()}
      ></PageHeader>

      {/* Warnings */}
      {savings.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          {savings.warnings.map((w) => (
            <p key={w} className="text-sm text-yellow-800">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* ── At a Glance ── */}
      <CardBoundary title="Overview">
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-primary">Overview</h2>
          <SummaryCards
            savings={savings}
            efund={efund}
            goalProjections={goalProjections}
          />

          {goalProjections.length > 0 && (
            <UpcomingGoals
              goalProjections={goalProjections}
              savingsGoals={savings.goals}
              plannedTransactions={plannedTransactions}
              monthDates={monthDates}
              onUpdateTx={updateTxFn}
              updateTxPending={updateTxPending}
            />
          )}
        </section>
      </CardBoundary>

      {/* ── Master tabs ── */}
      <div className="flex border-b border-subtle">
        {(
          [
            { key: "plan", label: "Plan" },
            { key: "manage", label: "Manage" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMasterTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              masterTab === key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted hover:text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Plan tab ── */}
      {masterTab === "plan" && (
        <CardBoundary title="Plan">
          <section className="bg-surface-primary rounded-lg border border-default p-4 sm:p-5 space-y-4">
            {/* Controls row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {goalProjections.length > 0 && (
                <div className="flex rounded border border-subtle overflow-hidden text-xs">
                  <button
                    onClick={() => setProjectionView("table")}
                    className={`px-2.5 py-1 transition-colors ${
                      projectionView === "table"
                        ? "bg-surface-elevated text-primary"
                        : "text-muted hover:text-primary"
                    }`}
                  >
                    Table
                  </button>
                  <button
                    onClick={() => setProjectionView("chart")}
                    className={`px-2.5 py-1 transition-colors ${
                      projectionView === "chart"
                        ? "bg-surface-elevated text-primary"
                        : "text-muted hover:text-primary"
                    }`}
                  >
                    Chart
                  </button>
                </div>
              )}
              <BudgetCapacityBar
                maxMonthlyFunding={maxMonthlyFunding}
                totalMonthlyAllocation={totalMonthlyAllocation}
                projectionYears={projectionYears}
                setProjectionYears={setProjectionYears}
                budgetNote={budgetNote}
              />
            </div>

            {/* Impact bar */}
            {goalProjections.length > 0 && (
              <ProjectionImpactBar
                goalProjections={goalProjections}
                monthDates={monthDates}
                hiddenGoalIds={hiddenGoalIds}
                onToggle={handleToggleGoalColumn}
              />
            )}

            {/* Projection output */}
            {goalProjections.length > 0 && projectionView === "table" && (
              <SavingsTrajectoryTable
                goalProjections={goalProjections}
                monthDates={monthDates}
                hiddenGoalIds={hiddenGoalIds}
              />
            )}
            {goalProjections.length > 0 && projectionView === "chart" && (
              <SavingsTrajectoryChart
                goalProjections={goalProjections.filter(
                  (gp) => !hiddenGoalIds.has(gp.goalId),
                )}
                monthDates={monthDates}
                onFundClick={handleFundClick}
              />
            )}

            {/* Edit tabs */}
            {goalProjections.length > 0 && (
              <div className="border-t border-subtle/60 pt-4 space-y-4">
                <div className="flex border-b">
                  {(
                    [
                      { key: "allocations", label: "Allocations" },
                      { key: "transactions", label: "Transactions" },
                      { key: "extraPaychecks", label: "Paychecks & Growth" },
                    ] as const
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setEditTab(key)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        editTab === key
                          ? "border-blue-600 text-blue-600"
                          : "border-transparent text-muted hover:text-primary"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {editTab === "allocations" && (
                  <div className="space-y-3">
                    {canEdit &&
                      rawGoals.some((g) => g.allocationPercent != null) &&
                      budgetProfilesList &&
                      budgetProfilesList.length > 1 && (
                        <div className="flex items-center justify-end gap-2 text-label text-faint">
                          <label htmlFor="recalc-profile-select">
                            Budget for Pull In / Update %:
                          </label>
                          <select
                            id="recalc-profile-select"
                            value={recalcProfileId ?? ""}
                            onChange={(e) =>
                              setRecalcProfileId(
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                            className="px-1.5 py-0.5 rounded border border-surface-strong bg-surface-elevated text-secondary"
                          >
                            <option value="">
                              Active
                              {activeProfileId != null
                                ? ` (${budgetProfilesList.find((p) => p.id === activeProfileId)?.name ?? ""})`
                                : ""}
                            </option>
                            {budgetProfilesList
                              .filter((p) => p.id !== activeProfileId)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                          {isPreviewingOtherProfile && (
                            <span className="text-amber-600">
                              Previewing — goal balances/targets still reflect
                              your active budget.
                            </span>
                          )}
                        </div>
                      )}
                    {canEdit &&
                      (apiBalancesData?.service ||
                        rawGoals.some((g) => g.allocationPercent != null)) && (
                        <div className="flex justify-end gap-2">
                          {rawGoals.some(
                            (g) => g.allocationPercent != null,
                          ) && (
                            <>
                              <button
                                onClick={() =>
                                  apiSync.buildLockInAllPreview(
                                    rawGoals,
                                    recalcMaxMonthlyFunding,
                                    undefined,
                                    effectiveRecalcProfileId ?? undefined,
                                  )
                                }
                                disabled={
                                  apiSync.lockInAllocationPercent.isPending
                                }
                                className="px-2.5 py-1 text-label rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors disabled:opacity-50"
                                title="Keep every percentage-based goal's dollar amount as-is; just update its % to reflect current income"
                              >
                                {apiSync.lockInAllocationPercent.isPending
                                  ? "Updating..."
                                  : "Update % (dollar unchanged)"}
                              </button>
                              <button
                                onClick={() =>
                                  apiSync.buildRecalculateAllPreview(
                                    rawGoals,
                                    recalcMaxMonthlyFunding,
                                    undefined,
                                    effectiveRecalcProfileId ?? undefined,
                                  )
                                }
                                disabled={
                                  apiSync.recalculateAllocation.isPending
                                }
                                className="px-2.5 py-1 text-label rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors disabled:opacity-50"
                                title="Preview and recompute every percentage-based goal's dollar amount from current income"
                              >
                                {apiSync.recalculateAllocation.isPending
                                  ? "Pulling in pay..."
                                  : "Pull In New Pay →"}
                              </button>
                            </>
                          )}
                          {apiBalancesData?.service && (
                            <button
                              onClick={() =>
                                apiSync.buildPushAllPreview(
                                  rawGoals,
                                  apiBalanceMap,
                                  efund?.targetAmount ?? undefined,
                                  maxMonthlyFunding,
                                )
                              }
                              disabled={apiSync.pushToApiPending}
                              className="px-2.5 py-1 text-label rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors disabled:opacity-50"
                              title="Push monthly allocation amounts as budget API goal targets"
                            >
                              {apiSync.pushToApiPending
                                ? "Pushing..."
                                : "Push Monthly Targets →"}
                            </button>
                          )}
                        </div>
                      )}
                    <AllocationEditorSection
                      goalProjections={goalProjections}
                      monthDates={monthDates}
                      totalMonthlyAllocation={totalMonthlyAllocation}
                      maxMonthlyFunding={maxMonthlyFunding}
                      monthlyPools={monthlyPools}
                      canEdit={canEdit}
                      onGoalUpdate={onGoalUpdate}
                      onGoalUpdateMulti={onGoalUpdateMulti}
                      editingMonth={editingMonth}
                      setEditingMonth={setEditingMonth}
                      hiddenGoalIds={hiddenGoalIds}
                      ruleMonthKeys={
                        new Set(
                          (allocationOverrides ?? [])
                            .filter((o) => o.source === "rule")
                            .map((o) => o.monthDate.slice(0, 7)),
                        )
                      }
                    />
                  </div>
                )}

                {editTab === "transactions" && (
                  <AllTransactionsTab
                    plannedTransactions={plannedTransactions}
                    goalProjections={goalProjections}
                    canEdit={canEdit}
                    projectionEndDate={monthDates[monthDates.length - 1]}
                    hiddenGoalIds={hiddenGoalIds}
                  />
                )}

                {editTab === "extraPaychecks" && (
                  <div className="space-y-4">
                    {/* Pool Growth — full-width compact bar */}
                    <div className="flex items-center gap-6 rounded-lg border border-subtle/40 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold text-primary">
                          Pool Growth
                        </h3>
                        <p className="text-xs text-faint mt-0.5">
                          Derived from raise rates &middot; flat budget assumed
                        </p>
                      </div>
                      {(() => {
                        if (maxMonthlyFunding === null)
                          return (
                            <p className="text-xs text-faint">
                              Requires paycheck and budget data.
                            </p>
                          );
                        const endYear = startYear + projectionYears;
                        const endPool =
                          derivedPoolByYear.get(endYear) ?? maxMonthlyFunding;
                        const totalGrowthPct =
                          maxMonthlyFunding > 0
                            ? ((endPool - maxMonthlyFunding) /
                                maxMonthlyFunding) *
                              100
                            : 0;
                        const hasGrowth = Math.abs(totalGrowthPct) >= 0.01;
                        return (
                          <p className="text-xs text-faint tabular-nums">
                            {hasGrowth ? (
                              <>
                                <span className="text-primary font-medium">
                                  {formatCurrency(maxMonthlyFunding)}/mo
                                </span>
                                {" → "}
                                <span className="text-primary font-medium">
                                  {formatCurrency(endPool)}/mo
                                </span>
                                {" by "}
                                {endYear}
                                <span className="text-green-600 ml-1">
                                  (+{totalGrowthPct.toFixed(1)}%)
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-primary font-medium">
                                  {formatCurrency(maxMonthlyFunding)}/mo
                                </span>
                                <span className="text-faint/60 ml-1">
                                  · set raise rates to project growth
                                </span>
                              </>
                            )}
                          </p>
                        );
                      })()}
                    </div>

                    {/* Extra paycheck rules — one column per earner */}
                    <ExtraPaycheckRulesEditor
                      goals={rawGoals
                        .filter((g) => g.isActive && !g.parentGoalId)
                        .map((g) => ({ id: g.id, name: g.name }))}
                      netPayByPersonId={netPayByPersonId}
                      monthDates={monthDates}
                      layout="columns"
                    />
                  </div>
                )}
              </div>
            )}
          </section>
        </CardBoundary>
      )}

      {/* ── Manage tab ── */}
      {masterTab === "manage" && (
        <CardBoundary title="Manage">
          <section className="bg-surface-primary rounded-lg border border-default p-4 sm:p-5 space-y-3">
            {canEdit && showNewFund && (
              <NewFundFormCard
                newFund={newFund}
                setNewFund={setNewFund}
                onSubmit={handleCreateFund}
                onCancel={() => setShowNewFund(false)}
                isPending={createGoal.isPending}
                availableParents={rawGoals
                  .filter((g) => !g.parentGoalId && g.isActive)
                  .map((g) => ({ id: g.id, name: g.name }))}
              />
            )}
            <FundManagementSection
              rawGoals={rawGoals}
              goalProjections={goalProjections}
              savings={savings}
              plannedTransactions={plannedTransactions}
              allocationOverrides={allocationOverrides}
              monthDates={monthDates}
              totalMonthlyAllocation={totalMonthlyAllocation}
              maxMonthlyFunding={maxMonthlyFunding}
              goalById={goalById}
              childGoalsByParent={childGoalsByParent}
              apiBalanceMap={apiBalanceMap}
              apiServiceName={apiBalancesData?.service}
              canEdit={canEdit}
              onEditMonth={setEditingMonth}
              onDeleteOverride={apiSync.onDeleteOverride}
              efund={efund}
              budgetTierLabels={budgetTierLabels}
              efundTierIndex={efundTierIndex}
              onEfundTierChange={setEfundBudgetColumn}
              reimbursementsData={reimbursementsData}
              onLinkToApi={apiSync.onLinkToApi}
              onUnlinkFromApi={apiSync.onUnlinkFromApi}
              onConvertToBudgetItem={apiSync.onConvertToBudgetItem}
              onPushPreview={apiSync.onPushPreview}
              recalculateAllocation={apiSync.recalculateAllocation}
              lockInAllocationPercent={apiSync.lockInAllocationPercent}
              recalcProfileId={effectiveRecalcProfileId}
              callbacksRef={fundCallbacksRef}
              showNewFund={showNewFund}
              setShowNewFund={setShowNewFund}
              newFund={newFund}
              setNewFund={setNewFund}
              createGoalMutate={(params, options) =>
                createGoal.mutate(params, options)
              }
              createGoalPending={createGoal.isPending}
            />
          </section>
        </CardBoundary>
      )}

      {/* ── API Sync Modals ── */}
      <ApiSyncSection
        rawGoals={rawGoals}
        apiBalanceMap={apiBalanceMap}
        apiBalancesData={apiBalancesData}
        apiCategoriesData={apiCategoriesData}
        canEdit={canEdit}
        linkingGoalId={apiSync.linkingGoalId}
        setLinkingGoalId={apiSync.setLinkingGoalId}
        pushPreviewItems={apiSync.pushPreviewItems}
        setPushPreviewItems={apiSync.setPushPreviewItems}
        pendingPushGoalId={apiSync.pendingPushGoalId}
        setPendingPushGoalId={apiSync.setPendingPushGoalId}
        pushMutation={apiSync.pushToApi}
        recalcPreviewItems={apiSync.recalcPreviewItems}
        setRecalcPreviewItems={apiSync.setRecalcPreviewItems}
        pendingRecalcGoalId={apiSync.pendingRecalcGoalId}
        setPendingRecalcGoalId={apiSync.setPendingRecalcGoalId}
        pendingRecalcProfileId={apiSync.pendingRecalcProfileId}
        setPendingRecalcProfileId={apiSync.setPendingRecalcProfileId}
        recalculateMutation={apiSync.recalculateAllocation}
        lockInPreviewItems={apiSync.lockInPreviewItems}
        setLockInPreviewItems={apiSync.setLockInPreviewItems}
        pendingLockInGoalId={apiSync.pendingLockInGoalId}
        setPendingLockInGoalId={apiSync.setPendingLockInGoalId}
        pendingLockInProfileId={apiSync.pendingLockInProfileId}
        setPendingLockInProfileId={apiSync.setPendingLockInProfileId}
        lockInMutation={apiSync.lockInAllocationPercent}
      />
    </div>
  );
}
