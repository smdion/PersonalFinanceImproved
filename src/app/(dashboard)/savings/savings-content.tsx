"use client";

/** Savings goals tracking page showing progress, contributions, and projected completion dates. */

import { useRouter } from "next/navigation";
import { focusHref } from "@/lib/config/focus-topics";
import React, { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useFocusMatch, useFocusedState } from "@/lib/hooks/use-focus";
import { useScrollToFocus } from "@/components/ui/focus-target";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { QueryBoundary, queryPending } from "@/components/ui/query-boundary";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, tabPanelProps } from "@/components/ui/tabs";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useLocalStorageSet } from "@/app/(dashboard)/savings/use-local-storage-set";
import { SummaryCards } from "@/components/savings/summary-cards";
import { NewFundFormCard } from "@/components/savings/new-fund-form-card";
import type { GoalProjection, NewFundForm } from "@/components/savings/types";
import {
  projectGoalBalances,
  buildSettledOccurrencesSet,
  computeDerivedPoolByYear,
  type PoolGrowthEarner,
} from "@/lib/pure/savings/savings-projection";
import { TARGET_MODE_VALUES } from "@/lib/config/enum-values";
import type { TargetMode } from "@/lib/config/enum-values";
import { formatCurrency, maskAmountsInText } from "@/lib/utils/format";
import { BudgetCapacityBar } from "@/components/savings/budget-capacity-bar";
import { ExtraPaycheckRulesEditor } from "@/components/savings/extra-paycheck-rules-editor";
import { UpcomingGoals } from "@/components/savings/upcoming-goals";
import {
  FundManagementSection,
  type FundManagementCallbacks,
} from "@/components/savings/fund-management-section";
import { AllocationEditorSection } from "@/components/savings/allocation-editor-section";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import { SavingsTrajectoryTable } from "@/components/savings/savings-trajectory-table";
import { AllTransactionsTab } from "@/components/savings/transactions/tab";
import {
  ApiSyncSection,
  useApiSync,
} from "@/components/savings/api-sync-section";
import { ProjectionImpactBar } from "@/components/savings/projection-impact-bar";
import { CardBoundary } from "@/components/dashboard/utils";
import { useUpdatePlannedTx } from "@/components/savings/use-update-planned-tx";
import {
  computeMaxMonthlyFunding,
  deriveBudgetMonthlyTotal,
  type CapacityPerson,
} from "@/lib/pure/savings/savings-capacity";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useBudgetProfilesList } from "@/lib/hooks/use-budget-profiles-list";
import {
  EditLockToggle,
  EDIT_LOCK_KEYS,
  useEditLock,
} from "@/components/ui/edit-lock-toggle";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_BUDGET_ACTIVE_COLUMN,
  SK_EFUND_BUDGET_COLUMN,
  SK_SAVINGS_PROJECTION_YEARS,
} from "@/lib/constants/settings-keys";

function isTargetMode(v: unknown): v is TargetMode {
  return TARGET_MODE_VALUES.includes(v as TargetMode);
}

// Code-split Recharts-heavy children. Loads on page mount instead of
// bundling into the savings page chunk. ssr:false
// because Recharts isn't SSR-friendly.
const SavingsTrajectoryChart = dynamic(
  () =>
    import("@/components/savings/savings-trajectory-chart").then((m) => ({
      default: m.SavingsTrajectoryChart,
    })),
  { loading: () => <SkeletonChart />, ssr: false },
);

export function SavingsContent() {
  const user = useUser();
  const canEdit = hasPermission(user, "savings");
  const utils = trpc.useUtils();
  // Same shared lock the Budget page's four profile tabs all use — locking
  // one surface must lock the other, or a user who locks this data on one
  // page can still freely edit it on the other with no unlock step.
  const [savingsAllocationsLocked, toggleSavingsAllocationsLocked] =
    useEditLock(EDIT_LOCK_KEYS.profileEditLocked);

  // ── Persisted settings ──
  const [efundBudgetColumn, setEfundBudgetColumn] = usePersistedSetting<number>(
    SK_EFUND_BUDGET_COLUMN,
    -1,
  );
  const [budgetColumn] = usePersistedSetting<number>(
    SK_BUDGET_ACTIVE_COLUMN,
    0,
  );
  const [projectionYears, setProjectionYears] = usePersistedSetting<number>(
    SK_SAVINGS_PROJECTION_YEARS,
    3,
  );
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    null,
  );
  // Fetch contribution profiles list for subtitle display.
  const { data: contribProfilesList } =
    trpc.contributionProfile.list.useQuery();

  // ── Shared queries ──
  const efundTierInput =
    efundBudgetColumn >= 0
      ? { budgetTierOverride: efundBudgetColumn }
      : undefined;
  const summary = trpc.savings.computeSummary.useQuery(efundTierInput);
  const { data } = summary;
  const { data: reimbursementsData } =
    trpc.savings.listEfundReimbursements.useQuery();
  const { data: apiBalancesData } = trpc.savings.listApiBalances.useQuery();
  const { data: apiCategoriesData } = trpc.budget.listApiCategories.useQuery();

  // Independent Salary Profile axis — the active one.
  const [activeSalaryProfileId] = useActiveSalaryProfile();
  // The active ids, sent explicitly (null while loading = none).
  const paySelection = {
    contribution: activeContribProfileId,
    salary: activeSalaryProfileId,
  };
  const { data: budgetData } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: budgetColumn,
    selection: paySelection,
  });
  const { data: budgetProfilesList } = useBudgetProfilesList();

  // The active profiles — the same ones computeActiveSummary and the Budget
  // page use, so budget item $ amounts, this page's pool and the payroll
  // breakdown never disagree.
  const paycheckInput = {
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
    ...(activeSalaryProfileId != null
      ? { salaryProfileId: activeSalaryProfileId }
      : {}),
  };
  const { data: paycheckData } = trpc.paycheck.computeSummary.useQuery(
    Object.keys(paycheckInput).length > 0 ? paycheckInput : undefined,
  );

  // ── Budget leftover ──
  const budgetMonthlyTotal = deriveBudgetMonthlyTotal(budgetData);
  const maxMonthlyFunding =
    paycheckData && budgetMonthlyTotal !== null
      ? computeMaxMonthlyFunding(
          paycheckData.people as CapacityPerson[],
          budgetMonthlyTotal,
        )
      : null;

  // Pull In New Pay / Update % use the active budget profile, like every
  // other number on this page.
  const activeProfileId =
    budgetProfilesList?.find((p) => p.isActive)?.id ?? null;
  const recalcMaxMonthlyFunding = maxMonthlyFunding;

  // The profiles this preview used, threaded into the recalculate and
  // lock-in mutations so their live pool matches it.
  const recalcIncomeParams = {
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
    ...(activeSalaryProfileId != null
      ? { salaryProfileId: activeSalaryProfileId }
      : {}),
    selection: paySelection,
  };

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
  // Links can open a tab (lib/config/focus-topics) — extra-paycheck
  // routing is set up only under Plan → Paychecks & Growth.
  const [masterTab, setMasterTab] = useFocusedState("savingsMasterTab", "plan");
  const [editTab, setEditTab] = useFocusedState(
    "savingsEditTab",
    "allocations",
  );
  const router = useRouter();
  const extraPaychecksRef = useRef<HTMLDivElement>(null);
  useScrollToFocus(extraPaychecksRef, useFocusMatch("extraPaychecks") !== null);

  // ── Top-level form state (lives here to render in correct layout position) ──
  const [newFund, setNewFund] = useState<NewFundForm>({
    name: "",
    targetAmount: "",
    targetMode: "fixed",
    targetDate: "",
    parentGoalId: null,
  });
  const createGoal = trpc.savings.savingsGoals.create.useMutation({
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
  if (queryPending(summary)) {
    return (
      <QueryBoundary
        query={summary}
        what="savings data"
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <SkeletonChart height={256} />
          </div>
        }
      />
    );
  }
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
  const derivedPoolByYear: Map<number, number> =
    maxMonthlyFunding !== null && budgetMonthlyTotal !== null && paycheckData
      ? computeDerivedPoolByYear(
          paycheckData.people
            .filter((p) => p.paycheck && p.job)
            .map((p): PoolGrowthEarner => {
              const pc = p.paycheck as {
                netPay: number;
                periodsPerYear: number;
              };
              const routing = (
                p.job as {
                  extraPaycheckRouting?: ExtraPaycheckRoutingData | null;
                }
              ).extraPaycheckRouting;
              return {
                netPay: pc.netPay,
                periodsPerYear: pc.periodsPerYear,
                // Use budgetPerMonth (regular checks only) to match how
                // maxMonthlyFunding is computed — extra biweekly checks are
                // routed separately, not budget income.
                budgetPerMonth: (p as { budgetPerMonth?: number })
                  .budgetPerMonth,
                yearlyGrowth: routing?.yearlyGrowth,
              };
            }),
          { startYear, projectionYears, maxMonthlyFunding, budgetMonthlyTotal },
        )
      : new Map();

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
          currentMonthBudgeted: raw?.currentMonthBudgeted,
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

  // A fund in the chart opens its card (Manage tab) — the same link any
  // other page uses for a goal.
  const handleFundClick = (fundName: string) => {
    const gp = goalProjections.find((g) => g.name === fundName);
    if (gp) router.push(focusHref({ topic: "savingsGoal", goalId: gp.goalId }));
  };

  // ── Extra paycheck net pay map ──
  const netPayByPersonId = new Map<number, number>();
  if (paycheckData) {
    for (const p of paycheckData.people) {
      if (p.paycheck) {
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
          const budgetLabel = budgetData?.columnLabels?.[budgetColumn]; // columnLabels is stored jsonb, typed by $type only: kept guarded.
          if (!budgetLabel) return undefined;
          const profileName =
            activeContribProfileId != null
              ? (contribProfilesList?.find(
                  (p) => p.id === activeContribProfileId,
                )?.name ?? null)
              : null;
          return profileName
            ? `Budget: ${budgetLabel} | Profile: ${profileName}`
            : `Budget: ${budgetLabel} | Profile: Live`;
        })()}
      ></PageHeader>

      {/* Warnings */}
      {savings.warnings.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          {savings.warnings.map((w) => (
            <p key={w} className="text-sm text-yellow-800">
              {maskAmountsInText(w)}
            </p>
          ))}
        </div>
      )}

      {/* ── At a Glance ── */}
      <CardBoundary title="Overview">
        <section className="space-y-4">
          <h2 className="text-primary text-base font-semibold">Overview</h2>
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
      <Tabs
        look="underline-lg"
        id="savings-master"
        value={masterTab}
        onChange={setMasterTab}
        tabs={[
          { value: "plan", label: "Plan" },
          { value: "manage", label: "Manage" },
        ]}
      />

      {/* ── Plan tab ── */}
      {masterTab === "plan" && (
        <CardBoundary title="Plan">
          <section
            {...tabPanelProps("savings-master", "plan")}
            className="bg-surface-primary border-default space-y-4 rounded-lg border p-4 sm:p-5"
          >
            {/* Controls row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {goalProjections.length > 0 && (
                <div className="border-subtle flex overflow-hidden rounded border text-xs">
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
              <div className="border-subtle/60 space-y-4 border-t pt-4">
                <div className="flex items-center border-b">
                  <Tabs
                    look="underline-sm"
                    value={editTab}
                    onChange={setEditTab}
                    tabs={[
                      { value: "allocations", label: "Allocations" },
                      { value: "transactions", label: "Transactions" },
                      { value: "extraPaychecks", label: "Paychecks & Growth" },
                    ]}
                  />
                  {editTab === "allocations" && (
                    <div className="ml-auto pr-2">
                      <EditLockToggle
                        locked={savingsAllocationsLocked}
                        onToggle={toggleSavingsAllocationsLocked}
                        disabled={!canEdit}
                      />
                    </div>
                  )}
                </div>

                {editTab === "allocations" && (
                  <div className="space-y-3">
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
                                    activeProfileId ?? undefined,
                                    recalcIncomeParams,
                                  )
                                }
                                disabled={
                                  apiSync.lockInAllocationPercent.isPending
                                }
                                className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 transition-colors disabled:opacity-50"
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
                                    activeProfileId ?? undefined,
                                    recalcIncomeParams,
                                  )
                                }
                                disabled={
                                  apiSync.recalculateAllocation.isPending
                                }
                                className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 transition-colors disabled:opacity-50"
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
                              className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 transition-colors disabled:opacity-50"
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
                      canEdit={canEdit && !savingsAllocationsLocked}
                      onGoalUpdate={onGoalUpdate}
                      onGoalUpdateMulti={onGoalUpdateMulti}
                      editingMonth={editingMonth}
                      setEditingMonth={setEditingMonth}
                      hiddenGoalIds={hiddenGoalIds}
                      ruleMonthKeys={
                        new Set(
                          allocationOverrides
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
                  <div ref={extraPaychecksRef} className="space-y-4">
                    {/* Pool Growth — full-width compact bar */}
                    <div className="border-subtle/40 flex items-center gap-6 rounded-lg border px-4 py-3">
                      <div>
                        <h3 className="text-primary text-sm font-semibold">
                          Pool Growth
                        </h3>
                        <p className="text-faint mt-0.5 text-xs">
                          Derived from raise rates &middot; flat budget assumed
                        </p>
                      </div>
                      {(() => {
                        if (maxMonthlyFunding === null)
                          return (
                            <p className="text-faint text-xs">
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
                          <p className="text-faint text-xs tabular-nums">
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
                                <span className="ml-1 text-green-600">
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

                    {/* Extra paycheck rules — one column per earner. The
                        Savings/Budget toggle also lives on Profiles → Salary
                        Profiles (comp-layer decision), but the detailed
                        mechanics — splits across savings goals, growth
                        rates, month overrides — are Savings-domain and
                        belong here, not cluttering the profile screen. */}
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
          <section
            {...tabPanelProps("savings-master", "manage")}
            className="bg-surface-primary border-default space-y-3 rounded-lg border p-4 sm:p-5"
          >
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
              activeProfileId={activeProfileId}
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
              fundingLocked={savingsAllocationsLocked}
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
              recalcProfileId={activeProfileId}
              recalcIncomeParams={recalcIncomeParams}
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
        pendingRecalcIncome={apiSync.pendingRecalcIncome}
        setPendingRecalcIncome={apiSync.setPendingRecalcIncome}
        recalculateMutation={apiSync.recalculateAllocation}
        lockInPreviewItems={apiSync.lockInPreviewItems}
        setLockInPreviewItems={apiSync.setLockInPreviewItems}
        pendingLockInGoalId={apiSync.pendingLockInGoalId}
        setPendingLockInGoalId={apiSync.setPendingLockInGoalId}
        pendingLockInProfileId={apiSync.pendingLockInProfileId}
        setPendingLockInProfileId={apiSync.setPendingLockInProfileId}
        pendingLockInIncome={apiSync.pendingLockInIncome}
        setPendingLockInIncome={apiSync.setPendingLockInIncome}
        lockInMutation={apiSync.lockInAllocationPercent}
      />
    </div>
  );
}
