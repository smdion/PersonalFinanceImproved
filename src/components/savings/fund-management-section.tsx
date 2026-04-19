"use client";

import React, { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/lib/hooks/use-toast";
import { FundCardGrid } from "./fund-card-grid";
import { FundCard } from "./fund-card";
import { FundTimelineDetail } from "./fund-timeline-detail";
import { EmergencyFundDetail } from "./emergency-fund-detail";
import { FUND_COLORS } from "./fund-colors";
import type { GoalProjection, PlannedTxForm, NewFundForm } from "./types";
import type { PushPreviewItem } from "@/components/ui/push-preview-modal";
import { useUpdatePlannedTx } from "./use-update-planned-tx";

interface RawGoal {
  id: number;
  name: string;
  monthlyContribution: string | null;
  allocationPercent: string | null;
  isActive: boolean;
  isEmergencyFund: boolean;
  targetDate: string | null;
  targetAmount: string | null;
  targetMode: string;
  parentGoalId: number | null;
  priority: number;
  apiCategoryId?: string | null;
  apiCategoryName?: string | null;
  isApiSyncEnabled?: boolean | null;
}

interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  description: string;
  amount: number;
  isRecurring: boolean;
  recurrenceMonths: number | null;
  transferPairId?: string | null;
}

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

export interface FundManagementSectionProps {
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
    { balance: number; budgeted: number; activity: number }
  >;
  canEdit: boolean;
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
  onConvertToBudgetItem: (goalId: number, name: string) => void;
  onPushPreview: (items: PushPreviewItem[], goalId?: number) => void;
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
      monthlyContribution: string;
      targetAmount: string | null;
      targetMode: "fixed" | "ongoing";
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
  const updateGoal = trpc.settings.savingsGoals.update.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const deleteGoal = trpc.settings.savingsGoals.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const createTx = trpc.savings.plannedTransactions.create.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const deleteTxMut = trpc.savings.plannedTransactions.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const { onUpdateTx: updateTxFn, isPending: updateTxPendingFlag } =
    useUpdatePlannedTx();

  // v0.5 expert-review M27: undoable delete for planned transactions.
  // PlannedTransactions are single-row, no cascade — safe to re-create on
  // undo. We capture the full row (looked up by id from the in-memory list)
  // before firing the delete, and stash it in the undo callback so the toast
  // action can replay the create with the original payload. The new row
  // gets a new auto-id, which is acceptable here because nothing references
  // planned transactions by id.
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

  // ── Local state ──
  const [addingSubGoalForFund, setAddingSubGoalForFund] = useState<
    number | null
  >(null);
  const [timelineGoalId, setTimelineGoalId] = useState<number | null>(null);
  const [timelineMonthIndex, setTimelineMonthIndex] = useState<
    number | undefined
  >(undefined);

  // ── Handlers ──
  const handleGoalUpdate = (goalId: number, field: string, value: string) => {
    const raw = goalById.get(goalId);
    if (!raw) return;
    updateGoal.mutate(
      {
        id: raw.id,
        name: raw.name,
        monthlyContribution: raw.monthlyContribution ?? "0",
        allocationPercent: raw.allocationPercent ?? null,
        isActive: raw.isActive,
        isEmergencyFund: raw.isEmergencyFund,
        targetDate: raw.targetDate ?? null,
        [field]: value,
      },
      {
        onSuccess: () => {
          if (
            field === "monthlyContribution" &&
            raw.isApiSyncEnabled &&
            raw.apiCategoryId
          ) {
            const newAmount = parseFloat(value) || 0;
            const currentBudgeted = apiBalanceMap.get(raw.id)?.budgeted ?? 0;
            const items: PushPreviewItem[] = [
              {
                name: raw.name,
                field: "Budgeted (current + next month)",
                currentYnab: currentBudgeted,
                newValue: newAmount,
              },
            ];
            const target = parseFloat(raw.targetAmount ?? "0") || 0;
            if (target > 0) {
              items.push({
                name: raw.name,
                field: "Goal Target",
                currentYnab: target,
                newValue: target,
              });
            }
            onPushPreview(items, raw.id);
          }
        },
      },
    );
  };

  const handleGoalUpdateMulti = (
    goalId: number,
    fields: Record<string, string>,
  ) => {
    const raw = goalById.get(goalId);
    if (!raw) return;
    updateGoal.mutate(
      {
        id: raw.id,
        name: raw.name,
        monthlyContribution: raw.monthlyContribution ?? "0",
        allocationPercent: raw.allocationPercent ?? null,
        isActive: raw.isActive,
        isEmergencyFund: raw.isEmergencyFund,
        targetDate: raw.targetDate ?? null,
        ...fields,
      },
      {
        onSuccess: () => {
          if (
            "monthlyContribution" in fields &&
            raw.isApiSyncEnabled &&
            raw.apiCategoryId
          ) {
            const newAmount = parseFloat(fields.monthlyContribution!) || 0;
            const currentBudgeted = apiBalanceMap.get(raw.id)?.budgeted ?? 0;
            const items: PushPreviewItem[] = [
              {
                name: raw.name,
                field: "Budgeted (current + next month)",
                currentYnab: currentBudgeted,
                newValue: newAmount,
              },
            ];
            const target =
              parseFloat(fields.targetAmount ?? raw.targetAmount ?? "0") || 0;
            if (target > 0) {
              items.push({
                name: raw.name,
                field: "Goal Target",
                currentYnab: target,
                newValue: target,
              });
            }
            onPushPreview(items, raw.id);
          }
        },
      },
    );
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
        ? parseInt(form.recurrenceMonths) || null
        : null,
    });
  };

  const handleCreateFund = () => {
    if (!newFund.name) return;
    createGoalMutate(
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
          setAddingSubGoalForFund(null);
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

  // Timeline detail panel
  const timelineProjection =
    timelineGoalId !== null
      ? goalProjections.find((gp) => gp.goalId === timelineGoalId)
      : null;

  return (
    <>
      {/* ── Fund Details ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Fund Details
          </h2>
          <div className="flex-1 border-t border-subtle/50" />
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
                        monthlyContribution:
                          efundGoal.monthlyContribution ?? "0",
                        isActive: efundGoal.isActive,
                        isEmergencyFund: efundGoal.isEmergencyFund,
                        targetDate: efundGoal.targetDate ?? null,
                        targetMonths: months,
                      });
                    }
                  }
                : undefined
            }
          />
        )}

        <FundCardGrid>
          {goalProjections.map((gp, i) => {
            const raw = goalById.get(gp.goalId);
            if (!raw) return null;
            const savingsGoal = savings.goals.find(
              (g) => g.goalId === gp.goalId,
            );
            if (!savingsGoal) return null;
            const fundTxs = plannedTransactions.filter(
              (tx) => tx.goalId === raw.id,
            );
            const fundOverrides = (allocationOverrides ?? []).filter(
              (o) => o.goalId === raw.id,
            );
            const children = childGoalsByParent.get(raw.id) ?? [];

            return (
              <div key={gp.goalId} id={`fund-card-${gp.name}`}>
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
                  onDeleteGoal={(p) => deleteGoal.mutate(p)}
                  onDeleteTx={deleteTx}
                  onDeleteTransfer={(p) => deleteTransfer.mutate(p)}
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
                      monthlyContribution: child.monthlyContribution ?? "0",
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
        </FundCardGrid>
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
