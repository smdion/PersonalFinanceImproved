"use client";

import React from "react";
import { Card, ProgressBar } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils/format";
import { BrokerageGoalsSection } from "@/components/cards/brokerage-goals";
import { confirm } from "@/components/ui/confirm-dialog";
import { NewFundForm } from "./types";

interface SavingsGoalSummary {
  goalId: number;
  name: string;
  monthlyAllocation: number;
  current: number;
  target: number;
  progress: number;
  monthsToTarget: number | null;
}

interface RawGoal {
  id: number;
  name: string;
  monthlyContribution: string | null;
  isActive: boolean;
  isEmergencyFund: boolean;
  targetDate: string | null;
  targetAmount: string | null;
  targetMode: string;
  parentGoalId: number | null;
  priority: number;
}

interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  description: string;
  amount: number;
}

export function FundDetailsTab({
  savingsGoals,
  goalById,
  childGoalsByParent,
  onGoalUpdate,
  onDeleteGoal,
  addingSubGoalForFund,
  setAddingSubGoalForFund,
  newFund,
  setNewFund,
  onCreateFund,
  createGoalPending,
  plannedTransactions,
  canEdit,
}: {
  savingsGoals: SavingsGoalSummary[];
  goalById: Map<number, RawGoal>;
  childGoalsByParent: Map<number, RawGoal[]>;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onDeleteGoal: (params: { id: number }) => void;
  addingSubGoalForFund: number | null;
  setAddingSubGoalForFund: (id: number | null) => void;
  newFund: NewFundForm;
  setNewFund: (form: NewFundForm) => void;
  onCreateFund: () => void;
  createGoalPending: boolean;
  plannedTransactions?: PlannedTransaction[];
  canEdit?: boolean;
}) {
  const now = new Date();

  // Build last transaction per goal (most recent by date)
  const lastTxByGoalId = new Map<number, PlannedTransaction>();
  if (plannedTransactions) {
    for (const tx of plannedTransactions) {
      const existing = lastTxByGoalId.get(tx.goalId);
      if (!existing || tx.transactionDate > existing.transactionDate) {
        lastTxByGoalId.set(tx.goalId, tx);
      }
    }
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-primary mb-3">
        Sinking Fund Details
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {savingsGoals
          .filter((goal) => {
            const raw = goalById.get(goal.goalId);
            return !raw?.parentGoalId;
          })
          .map((goal) => {
            const raw = goalById.get(goal.goalId);
            const children = raw ? (childGoalsByParent.get(raw.id) ?? []) : [];
            return (
              <Card key={goal.name} title={goal.name} className="!p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-semibold">
                      {formatCurrency(goal.current)}
                    </span>
                    {/* Target display: fixed goals and e-fund only (ongoing = no fixed target) */}
                    {goal.target > 0 &&
                      (raw?.targetMode === "fixed" || raw?.isEmergencyFund) && (
                        <>
                          <span className="text-faint">/</span>
                          {canEdit !== false ? (
                            <InlineEdit
                              value={String(goal.target)}
                              onSave={(v) =>
                                onGoalUpdate(goal.goalId, "targetAmount", v)
                              }
                              formatDisplay={(v) => formatCurrency(Number(v))}
                              parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                              type="number"
                              className="text-muted"
                            />
                          ) : (
                            <span className="text-muted">
                              {formatCurrency(goal.target)}
                            </span>
                          )}
                        </>
                      )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Months to target: fixed goals and e-fund only */}
                    {(raw?.targetMode === "fixed" || raw?.isEmergencyFund) && (
                      <span className="text-sm text-muted">
                        {goal.monthsToTarget !== null ? (
                          <span>
                            {formatNumber(goal.monthsToTarget, 0)} mo to target
                            {raw?.targetDate && (
                              <span className="text-xs text-faint ml-1">
                                (by {formatDate(raw.targetDate, "short")})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-green-600">Target reached</span>
                        )}
                      </span>
                    )}
                    {raw?.targetDate &&
                      goal.monthsToTarget !== null &&
                      (() => {
                        const targetDate = new Date(
                          raw.targetDate + "T00:00:00",
                        );
                        const monthsUntilTarget =
                          (targetDate.getFullYear() - now.getFullYear()) * 12 +
                          (targetDate.getMonth() - now.getMonth());
                        const onTrack =
                          goal.monthsToTarget <= monthsUntilTarget;
                        return (
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${onTrack ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
                          >
                            {onTrack
                              ? "On track"
                              : `${formatNumber(goal.monthsToTarget - monthsUntilTarget, 0)} mo behind`}
                          </span>
                        );
                      })()}
                    {canEdit !== false && raw && !raw.isEmergencyFund && (
                      <button
                        onClick={async () => {
                          if (await confirm(`Delete "${goal.name}"?`))
                            onDeleteGoal({ id: raw.id });
                        }}
                        className="text-red-300 hover:text-red-500 text-xs ml-1"
                        title="Delete fund"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                <ProgressBar
                  value={
                    raw?.targetMode === "fixed" || raw?.isEmergencyFund
                      ? goal.progress
                      : 0
                  }
                  label={
                    <span className="inline-flex items-center gap-1">
                      {canEdit !== false ? (
                        <InlineEdit
                          value={String(goal.monthlyAllocation)}
                          onSave={(v) =>
                            onGoalUpdate(goal.goalId, "monthlyContribution", v)
                          }
                          formatDisplay={(v) => formatCurrency(Number(v))}
                          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                          type="number"
                          className="text-xs"
                        />
                      ) : (
                        <span className="text-xs">
                          {formatCurrency(goal.monthlyAllocation)}
                        </span>
                      )}
                      <span>/mo</span>
                    </span>
                  }
                  color={goal.progress >= 1 ? "bg-green-500" : "bg-blue-600"}
                />

                {/* Last activity */}
                {raw &&
                  lastTxByGoalId.has(raw.id) &&
                  (() => {
                    const lastTx = lastTxByGoalId.get(raw.id)!;
                    return (
                      <p className="text-[11px] text-faint mt-1.5">
                        Last: {formatDate(lastTx.transactionDate, "medium")}{" "}
                        &mdash; {lastTx.description}{" "}
                        <span
                          className={
                            lastTx.amount < 0
                              ? "text-red-600"
                              : "text-green-500"
                          }
                        >
                          ({lastTx.amount >= 0 ? "+" : ""}
                          {formatCurrency(lastTx.amount)})
                        </span>
                      </p>
                    );
                  })()}

                {/* Sub-goals within this fund */}
                {children.length > 0 && (
                  <div className="mt-3 border-t border-subtle pt-2">
                    <p className="text-[10px] text-faint uppercase tracking-wide mb-1.5">
                      Goals in this fund
                    </p>
                    <div className="space-y-2">
                      {children.map((child) => {
                        const childTarget = parseFloat(
                          child.targetAmount ?? "0",
                        );
                        const childGoalCalc = savingsGoals.find(
                          (g) => g.goalId === child.id,
                        );
                        const childCurrent = childGoalCalc?.current ?? 0;
                        const childProgress =
                          childTarget > 0
                            ? Math.min(childCurrent / childTarget, 1)
                            : 0;
                        return (
                          <div
                            key={child.id}
                            className="flex items-center gap-2"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-secondary truncate">
                                  {child.name}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-muted tabular-nums">
                                    {formatCurrency(childCurrent)} /{" "}
                                    {formatCurrency(childTarget)}
                                  </span>
                                  {canEdit !== false && (
                                    <button
                                      onClick={async () => {
                                        if (
                                          await confirm(
                                            `Delete "${child.name}"?`,
                                          )
                                        )
                                          onDeleteGoal({ id: child.id });
                                      }}
                                      className="text-red-300 hover:text-red-500 text-[10px]"
                                      title="Delete goal"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="w-full bg-surface-strong rounded-full h-1.5 mt-0.5">
                                <div
                                  className={`h-1.5 rounded-full ${childProgress >= 1 ? "bg-green-500" : "bg-indigo-400"}`}
                                  style={{ width: `${childProgress * 100}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Add sub-goal */}
                {canEdit !== false && raw && !raw.isEmergencyFund && (
                  <div className="mt-2">
                    {addingSubGoalForFund === raw.id ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={newFund.name}
                          onChange={(e) =>
                            setNewFund({
                              ...newFund,
                              name: e.target.value,
                              parentGoalId: raw.id,
                            })
                          }
                          placeholder="Goal name..."
                          className="border rounded px-2 py-0.5 text-xs flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onCreateFund();
                            if (e.key === "Escape")
                              setAddingSubGoalForFund(null);
                          }}
                        />
                        <input
                          type="number"
                          value={newFund.targetAmount}
                          onChange={(e) =>
                            setNewFund({
                              ...newFund,
                              targetAmount: e.target.value,
                              parentGoalId: raw.id,
                            })
                          }
                          placeholder="Target $"
                          className="border rounded px-2 py-0.5 text-xs w-24"
                        />
                        <button
                          onClick={onCreateFund}
                          disabled={!newFund.name || createGoalPending}
                          className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => {
                            setAddingSubGoalForFund(null);
                            setNewFund({
                              name: "",
                              monthlyContribution: "",
                              targetAmount: "",
                              targetMode: "fixed",
                              targetDate: "",
                              parentGoalId: null,
                            });
                          }}
                          className="text-faint hover:text-muted text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setAddingSubGoalForFund(raw.id);
                          setNewFund({
                            name: "",
                            monthlyContribution: "0",
                            targetAmount: "",
                            targetMode: "fixed",
                            targetDate: "",
                            parentGoalId: raw.id,
                          });
                        }}
                        className="text-[10px] text-blue-500 hover:text-blue-700"
                      >
                        + Add goal
                      </button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
      </div>

      {/* Long-Term Goals (brokerage-funded) */}
      <BrokerageGoalsSection />
    </>
  );
}
