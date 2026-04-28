"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { FUND_COLORS } from "./fund-colors";
import type { GoalProjection } from "./types";

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

interface EditForm {
  goalId: number;
  transactionDate: string;
  description: string;
  amount: string;
  isRecurring: boolean;
  recurrenceMonths: number;
}

const defaultAddForm = {
  goalId: 0,
  transactionDate: "",
  description: "",
  amount: "",
  isNegative: true,
  isRecurring: false,
  recurrenceMonths: 1,
};

const defaultTransferForm = {
  fromGoalId: 0,
  toGoalId: 0,
  transactionDate: "",
  amount: "",
  description: "",
  isRecurring: false,
  recurrenceMonths: 1,
};

export function AllTransactionsTab({
  plannedTransactions,
  goalProjections,
  canEdit,
  projectionEndDate,
}: {
  plannedTransactions: PlannedTransaction[];
  goalProjections: GoalProjection[];
  canEdit?: boolean;
  projectionEndDate?: Date;
}) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"transaction" | "transfer">(
    "transaction",
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addForm, setAddForm] = useState({
    ...defaultAddForm,
    goalId: goalProjections[0]?.goalId ?? 0,
  });
  const [transferForm, setTransferForm] = useState({
    ...defaultTransferForm,
    fromGoalId: goalProjections[0]?.goalId ?? 0,
  });
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  const createTx = trpc.savings.plannedTransactions.create.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setAdding(false);
      setAddForm({
        ...defaultAddForm,
        goalId: goalProjections[0]?.goalId ?? 0,
      });
    },
  });
  const createTransfer = trpc.savings.transfers.create.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setAdding(false);
      setTransferForm({
        ...defaultTransferForm,
        fromGoalId: goalProjections[0]?.goalId ?? 0,
      });
    },
  });
  const updateTx = trpc.savings.plannedTransactions.update.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setEditingId(null);
      setEditForm(null);
    },
  });
  const deleteTx = trpc.savings.plannedTransactions.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const deleteTransfer = trpc.savings.transfers.delete.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });

  const fundColorMap = new Map(
    goalProjections.map((gp, i) => [
      gp.goalId,
      FUND_COLORS[i % FUND_COLORS.length],
    ]),
  );
  const fundNameMap = new Map(
    goalProjections.map((gp) => [gp.goalId, gp.name]),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Show all upcoming transactions including transfers (deduped: only show one leg per pair)
  // Clipped to the projection window end date when provided.
  const seenPairs = new Set<string>();
  const upcoming = plannedTransactions
    .filter((tx) => {
      const date = new Date(tx.transactionDate + "T00:00:00");
      if (!tx.isRecurring && date < today) return false;
      if (projectionEndDate && !tx.isRecurring && date > projectionEndDate)
        return false;
      if (tx.transferPairId) {
        if (seenPairs.has(tx.transferPairId)) return false;
        seenPairs.add(tx.transferPairId);
      }
      return true;
    })
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  const startEdit = (tx: PlannedTransaction) => {
    setEditingId(tx.id);
    setEditForm({
      goalId: tx.goalId,
      transactionDate: tx.transactionDate,
      description: tx.description,
      amount: String(Math.abs(tx.amount)),
      isRecurring: tx.isRecurring,
      recurrenceMonths: tx.recurrenceMonths ?? 1,
    });
  };

  const commitEdit = (tx: PlannedTransaction) => {
    if (!editForm) return;
    const amt = parseFloat(editForm.amount);
    if (isNaN(amt)) return;
    updateTx.mutate({
      id: tx.id,
      goalId: editForm.goalId,
      transactionDate: editForm.transactionDate,
      description: editForm.description,
      amount: String(tx.amount < 0 ? -Math.abs(amt) : Math.abs(amt)),
      isRecurring: editForm.isRecurring,
      recurrenceMonths: editForm.isRecurring ? editForm.recurrenceMonths : null,
    });
  };

  const commitAdd = () => {
    const amt = parseFloat(addForm.amount);
    if (!addForm.description || !addForm.transactionDate || isNaN(amt)) return;
    createTx.mutate({
      goalId: addForm.goalId,
      transactionDate: addForm.transactionDate,
      description: addForm.description,
      amount: String(addForm.isNegative ? -Math.abs(amt) : Math.abs(amt)),
      isRecurring: addForm.isRecurring,
      recurrenceMonths: addForm.isRecurring ? addForm.recurrenceMonths : null,
    });
  };

  const commitTransfer = () => {
    const amt = parseFloat(transferForm.amount);
    if (
      !transferForm.fromGoalId ||
      !transferForm.toGoalId ||
      transferForm.fromGoalId === transferForm.toGoalId ||
      !transferForm.transactionDate ||
      !transferForm.description ||
      isNaN(amt) ||
      amt <= 0
    )
      return;
    createTransfer.mutate({
      fromGoalId: transferForm.fromGoalId,
      toGoalId: transferForm.toGoalId,
      transactionDate: transferForm.transactionDate,
      amount: amt,
      description: transferForm.description,
      isRecurring: transferForm.isRecurring,
      recurrenceMonths: transferForm.isRecurring
        ? transferForm.recurrenceMonths
        : null,
    });
  };

  const cancelAdd = () => {
    setAdding(false);
    setAddMode("transaction");
  };

  const toGoalOptions = goalProjections.filter(
    (gp) => gp.goalId !== transferForm.fromGoalId,
  );

  return (
    <div className="space-y-3">
      {/* Add form */}
      {canEdit !== false && (
        <div>
          {adding ? (
            <div className="rounded-lg border bg-surface-elevated p-3 space-y-3">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 bg-surface-sunken rounded p-0.5 w-fit">
                <button
                  onClick={() => setAddMode("transaction")}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    addMode === "transaction"
                      ? "bg-surface-primary text-primary font-medium shadow-sm"
                      : "text-faint hover:text-muted"
                  }`}
                >
                  Transaction
                </button>
                <button
                  onClick={() => setAddMode("transfer")}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    addMode === "transfer"
                      ? "bg-surface-primary text-primary font-medium shadow-sm"
                      : "text-faint hover:text-muted"
                  }`}
                >
                  Transfer
                </button>
              </div>

              {addMode === "transaction" ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {/* Fund */}
                    <div className="col-span-2 sm:col-span-1">
                      <label className="text-[10px] text-faint block mb-0.5">
                        Fund
                      </label>
                      <select
                        value={addForm.goalId}
                        onChange={(e) =>
                          setAddForm({
                            ...addForm,
                            goalId: Number(e.target.value),
                          })
                        }
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      >
                        {goalProjections.map((gp) => (
                          <option key={gp.goalId} value={gp.goalId}>
                            {gp.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Date */}
                    <div>
                      <label className="text-[10px] text-faint block mb-0.5">
                        Date
                      </label>
                      <input
                        type="date"
                        value={addForm.transactionDate}
                        onChange={(e) =>
                          setAddForm({
                            ...addForm,
                            transactionDate: e.target.value,
                          })
                        }
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      />
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="text-[10px] text-faint block mb-0.5">
                        Amount
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            setAddForm({
                              ...addForm,
                              isNegative: !addForm.isNegative,
                            })
                          }
                          className={`text-xs font-bold w-6 h-6 rounded shrink-0 ${
                            addForm.isNegative
                              ? "bg-red-100 text-red-600"
                              : "bg-green-100 text-green-600"
                          }`}
                        >
                          {addForm.isNegative ? "−" : "+"}
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={addForm.amount}
                          onChange={(e) =>
                            setAddForm({ ...addForm, amount: e.target.value })
                          }
                          className="flex-1 border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                        />
                      </div>
                    </div>

                    {/* Description */}
                    <div className="col-span-2 sm:col-span-3">
                      <label className="text-[10px] text-faint block mb-0.5">
                        Description
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Car registration"
                        value={addForm.description}
                        onChange={(e) =>
                          setAddForm({
                            ...addForm,
                            description: e.target.value,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitAdd();
                          if (e.key === "Escape") cancelAdd();
                        }}
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      />
                    </div>

                    {/* Recurring */}
                    <div className="col-span-2 sm:col-span-3 flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={addForm.isRecurring}
                          onChange={(e) =>
                            setAddForm({
                              ...addForm,
                              isRecurring: e.target.checked,
                            })
                          }
                        />
                        Recurring
                      </label>
                      {addForm.isRecurring && (
                        <div className="flex items-center gap-1 text-xs text-muted">
                          <span>every</span>
                          <input
                            type="number"
                            min={1}
                            value={addForm.recurrenceMonths}
                            onChange={(e) =>
                              setAddForm({
                                ...addForm,
                                recurrenceMonths: Number(e.target.value),
                              })
                            }
                            className="w-12 border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs text-center"
                          />
                          <span>months</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={commitAdd}
                      disabled={createTx.isPending}
                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {createTx.isPending ? "Adding…" : "Add"}
                    </button>
                    <button
                      onClick={cancelAdd}
                      className="px-3 py-1 text-xs text-muted hover:text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {/* From */}
                    <div>
                      <label className="text-[10px] text-faint block mb-0.5">
                        From
                      </label>
                      <select
                        value={transferForm.fromGoalId}
                        onChange={(e) =>
                          setTransferForm({
                            ...transferForm,
                            fromGoalId: Number(e.target.value),
                            toGoalId:
                              transferForm.toGoalId === Number(e.target.value)
                                ? 0
                                : transferForm.toGoalId,
                          })
                        }
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      >
                        <option value={0}>Select fund…</option>
                        {goalProjections.map((gp) => (
                          <option key={gp.goalId} value={gp.goalId}>
                            {gp.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* To */}
                    <div>
                      <label className="text-[10px] text-faint block mb-0.5">
                        To
                      </label>
                      <select
                        value={transferForm.toGoalId}
                        onChange={(e) =>
                          setTransferForm({
                            ...transferForm,
                            toGoalId: Number(e.target.value),
                          })
                        }
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      >
                        <option value={0}>Select fund…</option>
                        {toGoalOptions.map((gp) => (
                          <option key={gp.goalId} value={gp.goalId}>
                            {gp.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="text-[10px] text-faint block mb-0.5">
                        Amount
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={transferForm.amount}
                        onChange={(e) =>
                          setTransferForm({
                            ...transferForm,
                            amount: e.target.value,
                          })
                        }
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      />
                    </div>

                    {/* Date */}
                    <div>
                      <label className="text-[10px] text-faint block mb-0.5">
                        Date
                      </label>
                      <input
                        type="date"
                        value={transferForm.transactionDate}
                        onChange={(e) =>
                          setTransferForm({
                            ...transferForm,
                            transactionDate: e.target.value,
                          })
                        }
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      />
                    </div>

                    {/* Description */}
                    <div className="col-span-2">
                      <label className="text-[10px] text-faint block mb-0.5">
                        Description
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Move travel funds to home projects"
                        value={transferForm.description}
                        onChange={(e) =>
                          setTransferForm({
                            ...transferForm,
                            description: e.target.value,
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitTransfer();
                          if (e.key === "Escape") cancelAdd();
                        }}
                        className="w-full border bg-surface-primary text-primary rounded px-2 py-1 text-xs"
                      />
                    </div>

                    {/* Recurring */}
                    <div className="col-span-2 sm:col-span-3 flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferForm.isRecurring}
                          onChange={(e) =>
                            setTransferForm({
                              ...transferForm,
                              isRecurring: e.target.checked,
                            })
                          }
                        />
                        Recurring
                      </label>
                      {transferForm.isRecurring && (
                        <div className="flex items-center gap-1 text-xs text-muted">
                          <span>every</span>
                          <input
                            type="number"
                            min={1}
                            value={transferForm.recurrenceMonths}
                            onChange={(e) =>
                              setTransferForm({
                                ...transferForm,
                                recurrenceMonths: Number(e.target.value),
                              })
                            }
                            className="w-12 border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs text-center"
                          />
                          <span>months</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {transferForm.fromGoalId > 0 &&
                    transferForm.toGoalId > 0 &&
                    Number(transferForm.amount) > 0 && (
                      <p className="text-[10px] text-faint">
                        {formatCurrency(Number(transferForm.amount))} from{" "}
                        <span className="text-red-500">
                          {fundNameMap.get(transferForm.fromGoalId)}
                        </span>{" "}
                        →{" "}
                        <span className="text-green-600">
                          {fundNameMap.get(transferForm.toGoalId)}
                        </span>
                      </p>
                    )}

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={commitTransfer}
                      disabled={createTransfer.isPending}
                      className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {createTransfer.isPending ? "Adding…" : "Add Transfer"}
                    </button>
                    <button
                      onClick={cancelAdd}
                      className="px-3 py-1 text-xs text-muted hover:text-primary"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="px-3 py-1.5 text-xs bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border"
            >
              + Add transaction
            </button>
          )}
        </div>
      )}

      {/* Transaction table */}
      {upcoming.length === 0 ? (
        <p className="text-sm text-faint text-center py-8">
          No upcoming transactions across any fund.
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-sunken border-b">
                <th className="text-left px-3 py-2 font-medium text-muted whitespace-nowrap">
                  Fund
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted whitespace-nowrap">
                  Date
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted">
                  Description
                </th>
                <th className="text-right px-3 py-2 font-medium text-muted whitespace-nowrap">
                  Amount
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted whitespace-nowrap">
                  Recurring
                </th>
                {canEdit !== false && <th className="px-3 py-2 w-16" />}
              </tr>
            </thead>
            <tbody>
              {upcoming.map((tx) => {
                const isTransfer = !!tx.transferPairId;
                const color = fundColorMap.get(tx.goalId);
                const name = fundNameMap.get(tx.goalId) ?? "Unknown";
                const isEditing = editingId === tx.id;

                // Find the other leg of a transfer to show "From → To"
                const otherLeg = isTransfer
                  ? plannedTransactions.find(
                      (t) =>
                        t.transferPairId === tx.transferPairId &&
                        t.id !== tx.id,
                    )
                  : null;
                const fromLeg = isTransfer
                  ? tx.amount < 0
                    ? tx
                    : (otherLeg ?? tx)
                  : null;
                const toLeg = isTransfer
                  ? tx.amount > 0
                    ? tx
                    : (otherLeg ?? tx)
                  : null;

                if (isEditing && editForm && !isTransfer) {
                  const editColor = fundColorMap.get(editForm.goalId);
                  return (
                    <tr key={tx.id} className="border-b bg-surface-elevated/40">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: editColor }}
                          />
                          <select
                            value={editForm.goalId}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                goalId: Number(e.target.value),
                              })
                            }
                            className="border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs"
                          >
                            {goalProjections.map((gp) => (
                              <option key={gp.goalId} value={gp.goalId}>
                                {gp.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={editForm.transactionDate}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              transactionDate: e.target.value,
                            })
                          }
                          className="border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          autoFocus
                          type="text"
                          value={editForm.description}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              description: e.target.value,
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit(tx);
                            if (e.key === "Escape") {
                              setEditingId(null);
                              setEditForm(null);
                            }
                          }}
                          className="w-full border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.amount}
                          onChange={(e) =>
                            setEditForm({ ...editForm, amount: e.target.value })
                          }
                          className="w-24 border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="checkbox"
                            checked={editForm.isRecurring}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                isRecurring: e.target.checked,
                              })
                            }
                          />
                          {editForm.isRecurring && (
                            <input
                              type="number"
                              min={1}
                              value={editForm.recurrenceMonths}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  recurrenceMonths: Number(e.target.value),
                                })
                              }
                              className="w-10 border bg-surface-primary text-primary rounded px-1 py-0.5 text-xs text-center"
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => commitEdit(tx)}
                            disabled={updateTx.isPending}
                            className="text-blue-600 hover:text-blue-700 text-[10px] font-medium disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditForm(null);
                            }}
                            className="text-muted hover:text-primary text-[10px]"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={tx.id}
                    className="border-b last:border-0 hover:bg-surface-elevated/40 transition-colors"
                  >
                    {/* Fund */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isTransfer ? (
                        <span className="inline-flex items-center gap-1 text-[10px]">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: fundColorMap.get(
                                fromLeg?.goalId ?? 0,
                              ),
                            }}
                          />
                          <span className="text-muted">
                            {fundNameMap.get(fromLeg?.goalId ?? 0) ?? "?"}
                          </span>
                          <span className="text-faint">→</span>
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: fundColorMap.get(
                                toLeg?.goalId ?? 0,
                              ),
                            }}
                          />
                          <span className="text-muted">
                            {fundNameMap.get(toLeg?.goalId ?? 0) ?? "?"}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-secondary font-medium">
                            {name}
                          </span>
                        </span>
                      )}
                    </td>
                    {/* Date */}
                    <td className="px-3 py-2 text-muted whitespace-nowrap tabular-nums">
                      {formatDate(
                        new Date(tx.transactionDate + "T00:00:00"),
                        "short",
                      )}
                    </td>
                    {/* Description */}
                    <td className="px-3 py-2 text-muted">
                      {isTransfer && (
                        <span className="inline-block text-[9px] font-medium text-blue-500 bg-blue-50 dark:bg-blue-950/30 rounded px-1 mr-1.5">
                          transfer
                        </span>
                      )}
                      {tx.description}
                    </td>
                    {/* Amount */}
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap ${
                        isTransfer
                          ? "text-blue-500"
                          : tx.amount < 0
                            ? "text-red-500"
                            : "text-green-600"
                      }`}
                    >
                      {isTransfer
                        ? formatCurrency(Math.abs(tx.amount))
                        : `${tx.amount < 0 ? "−" : "+"}${formatCurrency(Math.abs(tx.amount))}`}
                    </td>
                    {/* Recurring */}
                    <td className="px-3 py-2 text-center text-faint">
                      {tx.isRecurring ? (
                        <span className="text-[10px]">
                          every {tx.recurrenceMonths}mo
                        </span>
                      ) : (
                        <span className="text-[10px] text-faint/40">—</span>
                      )}
                    </td>
                    {/* Actions */}
                    {canEdit !== false && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {!isTransfer && (
                            <button
                              onClick={() => startEdit(tx)}
                              className="text-[10px] text-muted hover:text-blue-600"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            onClick={() =>
                              isTransfer && tx.transferPairId
                                ? deleteTransfer.mutate({
                                    transferPairId: tx.transferPairId,
                                  })
                                : deleteTx.mutate({ id: tx.id })
                            }
                            disabled={
                              deleteTx.isPending || deleteTransfer.isPending
                            }
                            className="text-[10px] text-muted hover:text-red-600 disabled:opacity-50"
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
