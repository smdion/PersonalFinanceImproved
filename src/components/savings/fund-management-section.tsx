"use client";

import React, { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { FundCard } from "./fund-card";
import { FundTimelineDetail } from "./fund-timeline-detail";
import { EmergencyFundDetail } from "./emergency-fund-detail";
import { FUND_COLORS } from "@/lib/utils/colors";
import { parsePositiveInt } from "@/lib/utils/math";
import type {
  GoalProjection,
  PlannedTxForm,
  NewFundForm,
  RawGoal,
} from "./types";
import type { PlannedTransaction } from "@/lib/pure/savings/savings-projection";
import type { TargetMode } from "@/lib/config/enum-values";
import type { PushPreviewItem } from "@/components/ui/push-preview-modal";
import type { RecalcIncomeParams } from "./api-sync-section";
import { useUpdatePlannedTx } from "./use-update-planned-tx";
import { buildSettledOccurrencesSet } from "@/lib/pure/savings/savings-projection";

interface AllocationOverride {
  goalId: number;
  monthDate: string;
  amount: number;
}

interface SavingsGoalSummary {
  goalId: number;
  name: string;
  monthlyAllocation: number;
  current: number;
  target: number;
  progress: number;
  monthsToTarget: number | null;
}

interface EfundData {
  trueBalance: number;
  monthsCovered: number | null;
  targetMonths: number;
  targetAmount: number;
  progress: number;
  neededAfterRepay: number;
}

interface ReimbursementData {
  items: { amount: number; description: string }[];
  total: number;
  balance: number;
  target: number;
  categoryName: string;
}

/** Callbacks exposed via ref so the page can pipe goal updates to other sections */
export interface FundManagementCallbacks {
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onGoalUpdateMulti: (goalId: number, fields: Record<string, string>) => void;
}

interface FundManagementSectionProps {
  /** The active budget profile; funding (monthlyContribution/allocationPercent) is per-profile,
   *  so inline funding edits write to it. */
  activeProfileId: number | null;
  rawGoals: RawGoal[];
  goalProjections: GoalProjection[];
  savings: {
    goals: SavingsGoalSummary[];
    warnings: string[];
    totalSaved: number;
  };
  plannedTransactions: PlannedTransaction[];
  allocationOverrides: AllocationOverride[];
  monthDates: Date[];
  totalMonthlyAllocation: number;
  maxMonthlyFunding: number | null;
  goalById: Map<number, RawGoal>;
  childGoalsByParent: Map<number, RawGoal[]>;
  apiBalanceMap: Map<
    number,
    {
      balance: number;
      budgeted: number;
      activity: number;
      goalTarget: number | null;
    }
  >;
  canEdit: boolean;
  /** The shared EDIT_LOCK_KEYS.profileEditLocked padlock; fund-card funding edits respect it like
   *  every other surface that edits this data. */
  fundingLocked?: boolean;
  /** From AllocationEditorSection — piped through to FundCard */
  onEditMonth: (monthDate: Date) => void;
  onDeleteOverride: (params: { goalId: number; monthDate: string }) => void;
  efund: EfundData | null;
  budgetTierLabels: string[];
  efundTierIndex: number;
  onEfundTierChange: (column: number) => void;
  reimbursementsData?: ReimbursementData | null;
  apiServiceName?: string | null;
  /** From ApiSyncSection — piped through to FundCard */
  onLinkToApi: (goalId: number) => void;
  onUnlinkFromApi: (goalId: number) => void;
  onConvertToBudgetItem: (
    goalId: number,
    name: string,
    goalMet: boolean,
  ) => void;
  onPushPreview: (items: PushPreviewItem[], goalId?: number) => void;
  /** The single mutation instance from useApiSync(), so the bulk "Pull In New Pay" button and the
   *  per-goal buttons share one pending state. */
  recalculateAllocation: ReturnType<
    typeof trpc.savings.recalculateAllocation.useMutation
  >;
  /** Same single-instance rule, for the "Update % (dollar unchanged)" bulk
   *  button and this section's per-goal buttons. */
  lockInAllocationPercent: ReturnType<
    typeof trpc.savings.lockInAllocationPercent.useMutation
  >;
  /** Budget profile to recompute the live pool against for per-goal
   *  recalculate/lock-in; null/undefined uses the active profile (see the
   *  savings page's recalcProfileId for the full explanation). */
  recalcProfileId?: number | null;
  /** The Contribution/Salary Profile selection the live pool preview was computed from, so
   *  per-goal Recalculate/Update % use the same profiles. */
  recalcIncomeParams?: RecalcIncomeParams;
  /** Ref exposing goal update callbacks for the page to pipe to other sections */
  callbacksRef: React.MutableRefObject<FundManagementCallbacks | null>;
  /** Shared new fund form state — page owns for top-level form, shared for sub-goal creation */
  showNewFund: boolean;
  setShowNewFund: (v: boolean) => void;
  newFund: NewFundForm;
  setNewFund: (form: NewFundForm) => void;
  createGoalMutate: (
    params: {
      name: string;
      parentGoalId: number | null;
      targetAmount: string | null;
      targetMode: TargetMode;
      targetDate: string | null;
      isActive: boolean;
      isEmergencyFund: boolean;
      priority: number;
    },
    options?: { onSuccess?: () => void },
  ) => void;
  createGoalPending: boolean;
}

export function FundManagementSection({
  activeProfileId,
  rawGoals,
  goalProjections,
  savings,
  plannedTransactions,
  allocationOverrides,
  monthDates,
  totalMonthlyAllocation,
  maxMonthlyFunding,
  goalById,
  childGoalsByParent,
  apiBalanceMap,
  canEdit,
  fundingLocked = false,
  onEditMonth,
  onDeleteOverride,
  efund,
  budgetTierLabels,
  efundTierIndex,
  onEfundTierChange,
  reimbursementsData,
  apiServiceName,
  onLinkToApi,
  onUnlinkFromApi,
  onConvertToBudgetItem,
  onPushPreview,
  recalculateAllocation,
  lockInAllocationPercent,
  recalcProfileId,
  recalcIncomeParams,
  callbacksRef,
  showNewFund: _showNewFund,
  setShowNewFund: _setShowNewFund,
  newFund,
  setNewFund,
  createGoalMutate,
  createGoalPending,
}: FundManagementSectionProps) {
  const utils = trpc.useUtils();

  // ── Mutations ──
  const updateGoal = trpc.savings.savingsGoals.update.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      utils.budget.computeActiveSummary.invalidate();
    },
  });
  // Funding (monthlyContribution/allocationPercent) lives on
  // savings_goal_profile_allocations, not savings_goals — see
  // activeProfileId's docblock above for which profile these write to.
  const upsertAllocation =
    trpc.savings.goalProfileAllocations.upsert.useMutation({
      onSuccess: () => {
        utils.savings.invalidate();
        utils.budget.computeActiveSummary.invalidate();
      },
    });
  const deleteGoal = trpc.savings.savingsGoals.delete.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      utils.budget.computeActiveSummary.invalidate();
    },
  });
  const createTx = trpc.savings.plannedTransactions.create.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const deleteTxMut = trpc.savings.plannedTransactions.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const { onUpdateTx: updateTxFn, isPending: updateTxPendingFlag } =
    useUpdatePlannedTx();

  // Undoable delete: planned transactions are single rows with no cascade and nothing references
  // them by id, so undo re-creates the captured row (with a new id).
  const deleteTx = useCallback(
    (params: { id: number }) => {
      const row = plannedTransactions.find((t) => t.id === params.id);
      deleteTxMut.mutate(params, {
        onSuccess: () => {
          if (!row) return;
          toast.undo(
            "Removed planned event",
            () => {
              createTx.mutate({
                goalId: row.goalId,
                transactionDate: row.transactionDate,
                amount: String(row.amount),
                description: row.description,
                isRecurring: row.isRecurring,
                recurrenceMonths: row.recurrenceMonths,
              });
            },
            5000,
          );
        },
      });
    },
    [plannedTransactions, deleteTxMut, createTx],
  );
  const deleteTransfer = trpc.savings.transfers.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const settleTxMut = trpc.savings.plannedTransactions.settle.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const settleTx = useCallback(
    (params: { plannedTxId: number; occurrenceMonth: string }) =>
      settleTxMut.mutate(params),
    [settleTxMut],
  );
  const settledOccurrences = buildSettledOccurrencesSet(plannedTransactions);

  // ── Local state ──
  const [addingSubGoalForFund, setAddingSubGoalForFund] = useState<
    number | null
  >(null);
  const [timelineGoalId, setTimelineGoalId] = useState<number | null>(null);
  const [timelineMonthIndex, setTimelineMonthIndex] = useState<
    number | undefined
  >(undefined);

  // ── Handlers ──
  const isFundingField = (field: string) =>
    field === "monthlyContribution" || field === "allocationPercent";

  const handleGoalUpdate = (goalId: number, field: string, value: string) => {
    const raw = goalById.get(goalId);
    if (!raw) return;
    if (isFundingField(field)) {
      if (activeProfileId == null || fundingLocked) return;
      const monthlyContribution =
        field === "monthlyContribution"
          ? parseFloat(value) || 0
          : parseFloat(String(raw.monthlyContribution ?? "0")) || 0;
      const allocationPercent =
        field === "allocationPercent"
          ? value === ""
            ? null
            : parseFloat(value)
          : raw.allocationPercent != null
            ? parseFloat(String(raw.allocationPercent))
            : null;
      upsertAllocation.mutate(
        {
          goalId: raw.id,
          profileId: activeProfileId,
          allocationPercent,
          monthlyContribution,
        },
        {
          onSuccess: () => {
            if (
              field === "monthlyContribution" &&
              raw.isApiSyncEnabled &&
              raw.apiCategoryId
            ) {
              const currentGoalTarget =
                apiBalanceMap.get(raw.id)?.goalTarget ?? 0;
              const items: PushPreviewItem[] = [
                {
                  name: raw.name,
                  field: "Monthly Goal Target",
                  currentYnab: currentGoalTarget,
                  newValue: monthlyContribution,
                },
              ];
              onPushPreview(items, raw.id);
            }
          },
        },
      );
      return;
    }
    updateGoal.mutate({
      id: raw.id,
      name: raw.name,
      isActive: raw.isActive,
      isEmergencyFund: raw.isEmergencyFund,
      targetDate: raw.targetDate ?? null,
      [field]: value,
    });
  };

  const handleGoalUpdateMulti = (
    goalId: number,
    fields: Record<string, string | null>,
  ) => {
    const raw = goalById.get(goalId);
    if (!raw) return;
    const fundingKeys = Object.keys(fields).filter(isFundingField);
    const otherFields = Object.fromEntries(
      Object.entries(fields).filter(([k]) => !isFundingField(k)),
    );
    if (fundingKeys.length > 0 && activeProfileId != null && !fundingLocked) {
      const monthlyContribution =
        "monthlyContribution" in fields
          ? parseFloat(fields.monthlyContribution ?? "0") || 0
          : parseFloat(String(raw.monthlyContribution ?? "0")) || 0;
      const allocationPercentRaw =
        "allocationPercent" in fields
          ? fields.allocationPercent
          : (raw.allocationPercent ?? null);
      const allocationPercent =
        allocationPercentRaw == null || allocationPercentRaw === ""
          ? null
          : parseFloat(String(allocationPercentRaw));
      upsertAllocation.mutate(
        {
          goalId: raw.id,
          profileId: activeProfileId,
          allocationPercent,
          monthlyContribution,
        },
        {
          onSuccess: () => {
            if (raw.isApiSyncEnabled && raw.apiCategoryId) {
              const currentGoalTarget =
                apiBalanceMap.get(raw.id)?.goalTarget ?? 0;
              const items: PushPreviewItem[] = [
                {
                  name: raw.name,
                  field: "Monthly Goal Target",
                  currentYnab: currentGoalTarget,
                  newValue: monthlyContribution,
                },
              ];
              onPushPreview(items, raw.id);
            }
          },
        },
      );
    }
    if (Object.keys(otherFields).length > 0) {
      updateGoal.mutate({
        id: raw.id,
        name: raw.name,
        isActive: raw.isActive,
        isEmergencyFund: raw.isEmergencyFund,
        targetDate: raw.targetDate ?? null,
        ...otherFields,
      });
    }
  };

  // Expose goal update callbacks to parent via ref (in useEffect to avoid ref write during render).
  // No dependency array: handlers close over query data that changes frequently,
  // and ref assignment is trivially cheap.
  useEffect(() => {
    callbacksRef.current = {
      onGoalUpdate: handleGoalUpdate,
      onGoalUpdateMulti: handleGoalUpdateMulti,
    };
  });

  const handleAddTx = (form: PlannedTxForm) => {
    if (!form.transactionDate || !form.amount || !form.description) return;
    createTx.mutate({
      goalId: form.goalId,
      transactionDate: form.transactionDate,
      amount: form.amount,
      description: form.description,
      isRecurring: form.isRecurring,
      recurrenceMonths: form.isRecurring
        ? parsePositiveInt(form.recurrenceMonths)
        : null,
    });
  };

  const handleCreateFund = () => {
    if (!newFund.name) return;
    createGoalMutate(
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
          setAddingSubGoalForFund(null);
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

  // Timeline detail panel
  const timelineProjection =
    timelineGoalId !== null
      ? goalProjections.find((gp) => gp.goalId === timelineGoalId)
      : null;

  // The emergency fund's monthly allocation, for its card.
  const efundGoalId = rawGoals.find((g) => g.isEmergencyFund)?.id;
  const efundAllocation =
    savings.goals.find((g) => g.goalId === efundGoalId)?.monthlyAllocation ?? 0;

  return (
    <>
      {/* ── Fund Details ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-muted text-xs font-semibold tracking-wider uppercase">
            Fund Details
          </h2>
          <div className="border-subtle/50 flex-1 border-t" />
          {canEdit && (
            <button
              onClick={() => _setShowNewFund(true)}
              className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              + New Fund
            </button>
          )}
        </div>

        {efund && (
          <EmergencyFundDetail
            efund={efund}
            budgetTierLabels={budgetTierLabels}
            efundTierIndex={efundTierIndex}
            onTierChange={onEfundTierChange}
            reimbursements={reimbursementsData}
            onTargetMonthsChange={
              canEdit
                ? (months) => {
                    const efundGoal = rawGoals.find((g) => g.isEmergencyFund);
                    if (efundGoal) {
                      updateGoal.mutate({
                        id: efundGoal.id,
                        name: efundGoal.name,
                        isActive: efundGoal.isActive,
                        isEmergencyFund: efundGoal.isEmergencyFund,
                        targetDate: efundGoal.targetDate ?? null,
                        targetMonths: months,
                      });
                    }
                  }
                : undefined
            }
            monthlyAllocation={efundAllocation}
            poolPercent={
              totalMonthlyAllocation > 0
                ? ((efundAllocation / totalMonthlyAllocation) * 100).toFixed(0)
                : "0"
            }
            isApiSyncEnabled={
              rawGoals.find((g) => g.isEmergencyFund)?.isApiSyncEnabled ?? false
            }
          />
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {goalProjections.map((gp, i) => {
            const raw = goalById.get(gp.goalId);
            if (!raw) return null;
            // Income Replacement lives in the EmergencyFundDetail card above
            if (raw.isEmergencyFund) return null;
            const savingsGoal = savings.goals.find(
              (g) => g.goalId === gp.goalId,
            );
            if (!savingsGoal) return null;
            const fundTxs = plannedTransactions.filter(
              (tx) => tx.goalId === raw.id,
            );
            const fundOverrides = allocationOverrides.filter(
              (o) => o.goalId === raw.id,
            );
            const children = childGoalsByParent.get(raw.id) ?? [];

            return (
              <div key={gp.goalId}>
                <FundCard
                  projection={gp}
                  rawGoal={raw}
                  savingsGoal={savingsGoal}
                  savingsGoals={savings.goals}
                  transactions={fundTxs}
                  overrides={fundOverrides}
                  monthDates={monthDates}
                  totalMonthlyAllocation={totalMonthlyAllocation}
                  fundColor={FUND_COLORS[i % FUND_COLORS.length]!}
                  onGoalUpdate={handleGoalUpdate}
                  onGoalUpdateMulti={handleGoalUpdateMulti}
                  maxMonthlyFunding={maxMonthlyFunding}
                  onRecalculateAllocation={() =>
                    recalculateAllocation.mutate({
                      goalId: raw.id,
                      ...(recalcProfileId != null
                        ? { profileId: recalcProfileId }
                        : {}),
                      ...recalcIncomeParams,
                    })
                  }
                  recalculateAllocationPending={recalculateAllocation.isPending}
                  onLockInAllocationPercent={() =>
                    lockInAllocationPercent.mutate({
                      goalId: raw.id,
                      ...(recalcProfileId != null
                        ? { profileId: recalcProfileId }
                        : {}),
                      ...recalcIncomeParams,
                    })
                  }
                  lockInAllocationPercentPending={
                    lockInAllocationPercent.isPending
                  }
                  onDeleteGoal={(p) => deleteGoal.mutate(p)}
                  onDeleteTx={deleteTx}
                  onDeleteTransfer={(p) => deleteTransfer.mutate(p)}
                  onSettleTx={settleTx}
                  settledOccurrences={settledOccurrences}
                  goalById={goalById as Map<number, { name: string }>}
                  onAddTx={handleAddTx}
                  createTxPending={createTx.isPending}
                  onUpdateTx={updateTxFn}
                  updateTxPending={updateTxPendingFlag}
                  onEditMonth={onEditMonth}
                  onDeleteOverride={onDeleteOverride}
                  onTimelineClick={(goalId, monthIndex) => {
                    setTimelineGoalId(goalId);
                    setTimelineMonthIndex(monthIndex);
                  }}
                  addingSubGoalForFund={addingSubGoalForFund}
                  setAddingSubGoalForFund={setAddingSubGoalForFund}
                  newFund={newFund}
                  setNewFund={setNewFund}
                  onCreateFund={handleCreateFund}
                  createGoalPending={createGoalPending}
                  canEdit={canEdit}
                  efundResult={null}
                  apiBalance={apiBalanceMap.get(raw.id) ?? null}
                  apiServiceName={apiServiceName}
                  onLinkToApi={onLinkToApi}
                  onUnlinkFromApi={onUnlinkFromApi}
                  onConvertToBudgetItem={onConvertToBudgetItem}
                  onUpdateParent={(childGoalId, newParentId) => {
                    const child = goalById.get(childGoalId);
                    if (!child) return;
                    updateGoal.mutate({
                      id: child.id,
                      name: child.name,
                      isActive: child.isActive,
                      isEmergencyFund: child.isEmergencyFund,
                      targetDate: child.targetDate ?? null,
                      parentGoalId: newParentId,
                    });
                  }}
                  availableParents={rawGoals
                    .filter((g) => !g.parentGoalId && g.isActive)
                    .map((g) => ({ id: g.id, name: g.name }))}
                >
                  {children}
                </FundCard>
              </div>
            );
          })}
        </div>
      </section>

      {/* Timeline Detail Slide Panel */}
      {timelineProjection && (
        <FundTimelineDetail
          projection={timelineProjection}
          monthDates={monthDates}
          initialMonthIndex={timelineMonthIndex}
          onClose={() => {
            setTimelineGoalId(null);
            setTimelineMonthIndex(undefined);
          }}
          onEditMonth={onEditMonth}
          canEdit={canEdit}
        />
      )}
    </>
  );
}
