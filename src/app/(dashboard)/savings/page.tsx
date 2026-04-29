"use client";

/** Savings goals tracking page showing progress, contributions, and projected completion dates. */

import React, { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import {
  SummaryCards,
  NewFundFormCard,
  GoalProjection,
  monthKey,
  type NewFundForm,
} from "@/components/savings";
import { BudgetCapacityBar } from "@/components/savings/budget-capacity-bar";

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
import { TransferForm } from "@/components/savings/transfer-form";
import {
  FundManagementSection,
  type FundManagementCallbacks,
} from "@/components/savings/fund-management-section";
import { AllocationEditorSection } from "@/components/savings/allocation-editor-section";
import { SavingsTrajectoryTable } from "@/components/savings/savings-trajectory-table";
import { AllTransactionsTab } from "@/components/savings/all-transactions-tab";
import {
  ApiSyncSection,
  useApiSync,
} from "@/components/savings/api-sync-section";
import { CardBoundary } from "@/components/cards/dashboard/utils";
import { useUpdatePlannedTx } from "@/components/savings/use-update-planned-tx";
import {
  computeMaxMonthlyFunding,
  type CapacityPerson,
} from "@/lib/calculators/savings-capacity";

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
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );

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

  const { data: budgetData } = trpc.budget.computeActiveSummary.useQuery({
    selectedColumn: budgetColumn,
  });

  // Derive contribution profile from the budget column's linked profile (holistic rule)
  const linkedProfileId =
    (
      budgetData?.profile?.columnContributionProfileIds as
        | (number | null)[]
        | null
    )?.[budgetColumn] ?? null;
  const effectiveContribProfileId = linkedProfileId ?? activeContribProfileId;

  const salaryOverrides = useSalaryOverrides();
  const paycheckInput = {
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    ...(effectiveContribProfileId != null
      ? { contributionProfileId: effectiveContribProfileId }
      : {}),
  };
  const { data: paycheckData } = trpc.paycheck.computeSummary.useQuery(
    Object.keys(paycheckInput).length > 0 ? paycheckInput : undefined,
  );

  // Fetch contribution profiles list for subtitle display
  const { data: contribProfilesList } =
    trpc.contributionProfile.list.useQuery();

  // ── Cross-section coordination ──
  const apiSync = useApiSync();
  const [editingMonth, setEditingMonth] = useState<Date | null>(null);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [showNewFund, setShowNewFund] = useState(false);
  const [projectionsTab, setProjectionsTab] = useState<
    "table" | "chart" | "edit" | "transactions"
  >("table");
  const [yearlyGrowth, setYearlyGrowth] = useState<
    Record<number, { type: "pct" | "dollar"; value: number }>
  >({});

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
  const createTransfer = trpc.savings.transfers.create.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setShowTransferForm(false);
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
  const overrideMap = new Map<string, number>();
  for (const o of allocationOverrides ?? []) {
    const d = new Date(o.monthDate + "T00:00:00");
    overrideMap.set(`${o.goalId}:${monthKey(d)}`, o.amount);
  }
  const goalById = new Map(rawGoals.map((g) => [g.id, g]));

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
    { balance: number; budgeted: number; activity: number }
  >();
  if (apiBalancesData?.balances) {
    for (const b of apiBalancesData.balances) {
      apiBalanceMap.set(b.goalId, {
        balance: b.balance,
        budgeted: b.budgeted,
        activity: b.activity,
      });
    }
  }

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

  // ── Expand planned transactions ──
  let eventSeq = 0;
  const txByGoalMonth = new Map<
    number,
    Map<string, { id: string; amount: number; description: string }[]>
  >();
  for (const tx of plannedTransactions) {
    const addEntry = (
      goalId: number,
      mk: string,
      amount: number,
      desc: string,
    ) => {
      if (!txByGoalMonth.has(goalId)) txByGoalMonth.set(goalId, new Map());
      const m = txByGoalMonth.get(goalId)!;
      if (!m.has(mk)) m.set(mk, []);
      m.get(mk)!.push({ id: `ev-${++eventSeq}`, amount, description: desc });
    };
    const txDate = new Date(tx.transactionDate + "T00:00:00");
    addEntry(tx.goalId, monthKey(txDate), tx.amount, tx.description);
    if (tx.isRecurring && tx.recurrenceMonths && tx.recurrenceMonths > 0) {
      const last = monthDates[monthDates.length - 1]!;
      let d = new Date(
        txDate.getFullYear(),
        txDate.getMonth() + tx.recurrenceMonths,
        1,
      );
      while (d <= last) {
        addEntry(tx.goalId, monthKey(d), tx.amount, tx.description);
        d = new Date(d.getFullYear(), d.getMonth() + tx.recurrenceMonths, 1);
      }
    }
  }

  // ── Growth multipliers ──
  const startYear = now.getFullYear();
  const growthMultiplierByYear = new Map<number, number>();
  {
    let prevPool = 1;
    for (let yr = startYear; yr <= startYear + projectionYears; yr++) {
      const entry = yearlyGrowth[yr];
      if (yr === startYear || !entry || entry.value === 0) {
        growthMultiplierByYear.set(yr, prevPool);
      } else if (entry.type === "pct") {
        prevPool = prevPool * (1 + entry.value / 100);
        growthMultiplierByYear.set(yr, prevPool);
      } else {
        growthMultiplierByYear.set(yr, prevPool);
      }
    }
  }

  const dollarIncreaseByYear = new Map<number, number>();
  {
    let cumDollar = 0;
    for (let yr = startYear; yr <= startYear + projectionYears; yr++) {
      const entry = yearlyGrowth[yr];
      if (entry && entry.type === "dollar" && yr > startYear) {
        cumDollar += entry.value;
      }
      dollarIncreaseByYear.set(yr, cumDollar);
    }
  }

  function getAllocationForYear(baseAmount: number, year: number): number {
    const multiplier = growthMultiplierByYear.get(year) ?? 1;
    const dollarAdd = dollarIncreaseByYear.get(year) ?? 0;
    return baseAmount * multiplier + dollarAdd;
  }

  // ── Goal projections ──
  const parentFundGoals = savings.goals.filter((goal) => {
    const raw = goalById.get(goal.goalId);
    return !raw?.parentGoalId;
  });
  const goalProjections: GoalProjection[] = parentFundGoals.map((goal) => {
    const raw = goalById.get(goal.goalId);
    const goalId = goal.goalId;
    const goalTxMap = txByGoalMonth.get(goalId);
    const balances: number[] = [];
    const monthEvents: (
      | { id: string; amount: number; description: string }[]
      | null
    )[] = [];
    const monthlyAllocations: number[] = [];
    const hasOverride: boolean[] = [];
    let balance = goal.current;
    const pct = raw?.allocationPercent
      ? parseFloat(raw.allocationPercent)
      : null;
    const baseAllocation =
      pct !== null && maxMonthlyFunding !== null
        ? (pct / 100) * maxMonthlyFunding
        : goal.monthlyAllocation;

    for (let i = 0; i < projectionMonths; i++) {
      const mk = monthKey(monthDates[i]!);
      const events = goalTxMap?.get(mk) ?? null;
      const overrideKey = `${goalId}:${mk}`;
      const overrideAmount = overrideMap.get(overrideKey);
      const yr = monthDates[i]!.getFullYear();
      const defaultAllocation = getAllocationForYear(baseAllocation, yr);
      const allocation =
        overrideAmount !== undefined ? overrideAmount : defaultAllocation;
      balance += allocation;
      if (events) {
        for (const ev of events) balance += ev.amount;
      }
      balances.push(balance);
      monthEvents.push(events);
      monthlyAllocations.push(allocation);
      hasOverride.push(overrideAmount !== undefined);
    }

    return {
      name: goal.name,
      goalId,
      current: goal.current,
      target: goal.target,
      targetMode: (raw?.targetMode ?? "fixed") as "fixed" | "ongoing",
      monthlyAllocation: baseAllocation,
      monthlyAllocations,
      balances,
      monthEvents,
      hasOverride,
    };
  });

  const totalMonthlyAllocation = goalProjections.reduce(
    (s, g) => s + g.monthlyAllocation,
    0,
  );

  const basePool = maxMonthlyFunding ?? totalMonthlyAllocation;
  const monthlyPools = monthDates.map((d) =>
    getAllocationForYear(basePool, d.getFullYear()),
  );

  const handleFundClick = (fundName: string) => {
    const gp = goalProjections.find((g) => g.name === fundName);
    if (!gp) return;
    const el = document.getElementById(`fund-card-${gp.goalId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

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
      >
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {apiBalancesData?.service && (
              <button
                onClick={() =>
                  apiSync.buildPushAllPreview(
                    rawGoals,
                    apiBalanceMap,
                    efund?.targetAmount ?? undefined,
                  )
                }
                disabled={apiSync.pushToApiPending}
                className="px-3 py-1.5 border border-green-600 text-green-400 rounded text-sm hover:bg-green-600/20 disabled:opacity-50"
                title="Push monthly contributions as budget API goal targets"
              >
                {apiSync.pushToApiPending
                  ? "Pushing..."
                  : "Push Contributions \u2192"}
              </button>
            )}
            <Button
              variant="secondary"
              onClick={() => setShowTransferForm(true)}
            >
              Transfer
            </Button>
            <Button onClick={() => setShowNewFund(true)}>+ New Fund</Button>
          </div>
        )}
      </PageHeader>

      {/* Warnings */}
      {savings.warnings.length > 0 && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3">
          {savings.warnings.map((w) => (
            <p key={w} className="text-sm text-yellow-400">
              {w}
            </p>
          ))}
        </div>
      )}

      {canEdit && showTransferForm && (
        <TransferForm
          goals={rawGoals
            .filter((g) => g.isActive && !g.parentGoalId)
            .map((g) => ({ id: g.id, name: g.name }))}
          onSubmit={(data) => createTransfer.mutate(data)}
          isPending={createTransfer.isPending}
          onCancel={() => setShowTransferForm(false)}
        />
      )}

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

      {/* ── At a Glance ── */}
      <CardBoundary title="Overview">
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-primary">Overview</h2>
          <SummaryCards savings={savings} efund={efund} />

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

      {/* ── Projections ── */}
      <CardBoundary title="Projections">
        <section className="bg-surface-primary rounded-lg border p-4 sm:p-5 space-y-4">
          {/* Section header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-primary">
                Projections
              </h2>
              <p className="text-xs text-faint mt-0.5">
                Where your funds are headed based on current allocations
              </p>
            </div>
            {/* Settings toolbar */}
            <BudgetCapacityBar
              maxMonthlyFunding={maxMonthlyFunding}
              totalMonthlyAllocation={totalMonthlyAllocation}
              projectionYears={projectionYears}
              setProjectionYears={setProjectionYears}
              budgetNote={budgetNote}
            />
          </div>

          {/* Tab bar */}
          {goalProjections.length > 0 && (
            <div className="flex border-b -mx-4 sm:-mx-5 px-4 sm:px-5">
              {(
                [
                  { key: "table", label: "Monthly Balances" },
                  { key: "chart", label: "Chart" },
                  { key: "edit", label: "Allocations" },
                  { key: "transactions", label: "Transactions" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setProjectionsTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    projectionsTab === key
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-muted hover:text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Tab content */}
          {goalProjections.length > 0 && projectionsTab === "table" && (
            <SavingsTrajectoryTable
              goalProjections={goalProjections}
              monthDates={monthDates}
            />
          )}

          {goalProjections.length > 0 && projectionsTab === "chart" && (
            <SavingsTrajectoryChart
              goalProjections={goalProjections}
              monthDates={monthDates}
              onFundClick={handleFundClick}
            />
          )}

          {projectionsTab === "transactions" && (
            <AllTransactionsTab
              plannedTransactions={plannedTransactions}
              goalProjections={goalProjections}
              canEdit={canEdit}
            />
          )}

          {projectionsTab === "edit" && (
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
              projectionYears={projectionYears}
              yearlyGrowth={yearlyGrowth}
              setYearlyGrowth={setYearlyGrowth}
            />
          )}
        </section>
      </CardBoundary>

      {/* ── Funds ── */}
      <CardBoundary title="Funds">
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-primary">Funds</h2>
            <p className="text-xs text-faint mt-0.5">
              These funds set the allocation amounts used in the projections
              above — click any fund to expand
            </p>
          </div>
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
      />
    </div>
  );
}
