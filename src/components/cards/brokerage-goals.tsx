"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { Card, Metric } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { confirm } from "@/components/ui/confirm-dialog";

interface NewGoalForm {
  name: string;
  targetAmount: string;
  targetYear: string;
  priority: string;
  notes: string;
}

const emptyGoalForm: NewGoalForm = {
  name: "",
  targetAmount: "",
  targetYear: String(new Date().getFullYear() + 5),
  priority: "0",
  notes: "",
};

export function BrokerageGoalsSection() {
  const user = useUser();
  const canEdit = hasPermission(user, "brokerage");
  const utils = trpc.useUtils();
  const { data: goals, isLoading } = trpc.brokerage.listGoals.useQuery();
  const invalidateBrokerage = () => {
    utils.brokerage.listGoals.invalidate();
    utils.brokerage.getSummary.invalidate();
  };
  const createGoal = trpc.brokerage.createGoal.useMutation({
    onSuccess: () => {
      invalidateBrokerage();
      setShowCreate(false);
      setForm(emptyGoalForm);
    },
  });
  const updateGoal = trpc.brokerage.updateGoal.useMutation({
    onSuccess: invalidateBrokerage,
  });
  const deleteGoal = trpc.brokerage.deleteGoal.useMutation({
    onSuccess: invalidateBrokerage,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewGoalForm>(emptyGoalForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<NewGoalForm>(emptyGoalForm);

  if (isLoading) {
    return (
      <Card title="Long-Term Goals" className="mb-6">
        <div className="animate-pulse h-20 bg-surface-elevated rounded" />
      </Card>
    );
  }

  const handleCreate = () => {
    if (!form.name || !form.targetAmount || !form.targetYear) return;
    createGoal.mutate({
      name: form.name,
      targetAmount: form.targetAmount,
      targetYear: Number(form.targetYear),
      priority: Number(form.priority) || 0,
      notes: form.notes || null,
    });
  };

  const handleUpdate = (id: number) => {
    updateGoal.mutate({
      id,
      name: editForm.name || undefined,
      targetAmount: editForm.targetAmount || undefined,
      targetYear: editForm.targetYear ? Number(editForm.targetYear) : undefined,
      priority: editForm.priority ? Number(editForm.priority) : undefined,
      notes: editForm.notes || null,
    });
    setEditingId(null);
  };

  const startEdit = (goal: NonNullable<typeof goals>[number]) => {
    setEditingId(goal.id);
    setEditForm({
      name: goal.name,
      targetAmount: String(goal.targetAmount),
      targetYear: String(goal.targetYear),
      priority: String(goal.priority),
      notes: goal.notes ?? "",
    });
  };

  const totalCommitment = (goals ?? []).reduce((s, g) => s + g.targetAmount, 0);

  return (
    <>
      <h2 className="text-lg font-semibold text-primary mb-3 mt-8">
        Long-Term Goals
        <HelpTip text="Goals funded by your brokerage (after-tax) investment account. Unlike sinking funds held in cash, these grow with the market and withdrawals are subject to capital gains tax on the gains portion." />
      </h2>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card>
          <Metric value={formatCurrency(totalCommitment)} />
          <p className="text-sm text-muted mt-1">
            Total Commitments
            <HelpTip text="Sum of all active goal target amounts — total brokerage funds earmarked for future withdrawals" />
          </p>
        </Card>
        <Card>
          <Metric label="Active Goals" value={String((goals ?? []).length)} />
        </Card>
      </div>

      {/* Goal cards */}
      {(goals ?? []).length === 0 && !showCreate && (
        <Card className="mb-4">
          <p className="text-sm text-muted">
            No long-term goals yet. Add a goal to start tracking
            brokerage-funded purchases.
          </p>
        </Card>
      )}

      <div className="space-y-3 mb-4">
        {(goals ?? []).map((goal) => (
          <Card key={goal.id} className="relative">
            {editingId === goal.id ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    placeholder="Name"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                  />
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    placeholder="Amount"
                    value={editForm.targetAmount}
                    onChange={(e) =>
                      setEditForm({ ...editForm, targetAmount: e.target.value })
                    }
                  />
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    placeholder="Target Year"
                    type="number"
                    value={editForm.targetYear}
                    onChange={(e) =>
                      setEditForm({ ...editForm, targetYear: e.target.value })
                    }
                  />
                  <input
                    className="border rounded px-2 py-1 text-sm"
                    placeholder="Priority"
                    type="number"
                    value={editForm.priority}
                    onChange={(e) =>
                      setEditForm({ ...editForm, priority: e.target.value })
                    }
                  />
                </div>
                <input
                  className="border rounded px-2 py-1 text-sm w-full"
                  placeholder="Notes"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                />
                <div className="flex gap-2">
                  <button
                    className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                    onClick={() => handleUpdate(goal.id)}
                  >
                    Save
                  </button>
                  <button
                    className="text-xs text-muted hover:text-secondary"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-sm">{goal.name}</span>
                  <span className="text-xs text-muted ml-2">
                    Target: {goal.targetYear}
                  </span>
                  {goal.notes && (
                    <span className="text-xs text-faint ml-2">
                      — {goal.notes}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">
                    {formatCurrency(goal.targetAmount)}
                  </span>
                  {canEdit && (
                    <button
                      className="text-xs text-blue-500 hover:text-blue-700"
                      onClick={() => startEdit(goal)}
                    >
                      Edit
                    </button>
                  )}
                  {canEdit && (
                    <button
                      className="text-xs text-red-500 hover:text-red-700"
                      onClick={async () => {
                        if (await confirm(`Delete"${goal.name}"?`)) {
                          deleteGoal.mutate({ id: goal.id });
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Create form */}
      {canEdit && showCreate ? (
        <Card title="New Long-Term Goal" className="mb-4">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                className="border rounded px-2 py-1 text-sm"
                placeholder="Goal name (e.g., New Car)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className="border rounded px-2 py-1 text-sm"
                placeholder="Target amount"
                value={form.targetAmount}
                onChange={(e) =>
                  setForm({ ...form, targetAmount: e.target.value })
                }
              />
              <input
                className="border rounded px-2 py-1 text-sm"
                placeholder="Target year"
                type="number"
                value={form.targetYear}
                onChange={(e) =>
                  setForm({ ...form, targetYear: e.target.value })
                }
              />
              <input
                className="border rounded px-2 py-1 text-sm"
                placeholder="Priority (0 = highest)"
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              />
            </div>
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <div className="flex gap-2">
              <button
                className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                onClick={handleCreate}
                disabled={createGoal.isPending}
              >
                {createGoal.isPending ? "Creating..." : "Create Goal"}
              </button>
              <button
                className="text-xs text-muted hover:text-secondary"
                onClick={() => {
                  setShowCreate(false);
                  setForm(emptyGoalForm);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </Card>
      ) : canEdit ? (
        <button
          className="text-sm text-blue-600 hover:text-blue-800 mb-4"
          onClick={() => setShowCreate(true)}
        >
          + Add Long-Term Goal
        </button>
      ) : null}
    </>
  );
}
