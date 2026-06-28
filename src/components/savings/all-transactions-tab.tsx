"use client";

import React, { useState, useRef } from "react";
import { Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
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
  source?: string;
}

interface EditForm {
  goalId: number;
  transactionDate: string;
  description: string;
  amount: string;
  isRecurring: boolean;
  recurrenceMonths: number;
}

type ActiveCellField = "goalId" | "transactionDate" | "description" | "amount";

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
  hiddenGoalIds,
}: {
  plannedTransactions: PlannedTransaction[];
  goalProjections: GoalProjection[];
  canEdit?: boolean;
  projectionEndDate?: Date;
  hiddenGoalIds?: Set<number>;
}) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"transaction" | "transfer">(
    "transaction",
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [historyWindow, setHistoryWindow] = useLocalStorage<
    0 | 3 | 6 | 12 | "all"
  >("ledgr:savings:txHistoryWindow", 0);
  const [tableLocked, setTableLocked] = useLocalStorage<boolean>(
    "ledgr:savings:txLocked",
    true,
  );
  const [showRuleTx, setShowRuleTx] = useLocalStorage<boolean>(
    "ledgr:savings:showRuleTx",
    false,
  );
  const [addForm, setAddForm] = useState({
    ...defaultAddForm,
    goalId: goalProjections[0]?.goalId ?? 0,
  });
  const [transferForm, setTransferForm] = useState({
    ...defaultTransferForm,
    fromGoalId: goalProjections[0]?.goalId ?? 0,
  });
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [activeCell, setActiveCell] = useState<{
    id: number;
    field: ActiveCellField;
  } | null>(null);

  // Prevents double-mutation when Enter fires blur immediately after
  const committingRef = useRef(false);

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
    onSuccess: () => {
      utils.savings.invalidate();
      setActiveCell(null);
    },
  });
  const deleteTransfer = trpc.savings.transfers.delete.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setActiveCell(null);
    },
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
  // Rule-generated rows hidden by default unless showRuleTx is on.
  const seenPairs = new Set<string>();
  const upcoming = plannedTransactions
    .filter((tx) => {
      if (hiddenGoalIds?.has(tx.goalId)) return false;
      if (tx.source === "rule" && !showRuleTx) return false;
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

  // "After" balance: use the pre-computed GoalProjection.balances[] which already
  // includes contributions, recurring expansion, and overrides — matching the Plan table.
  // Map from goalId for O(1) lookup.
  const gpByGoalId = new Map(goalProjections.map((gp) => [gp.goalId, gp]));
  // Projection months start on the 1st of the current month, or next month once
  // the 1st has passed — mirror the same logic used on the savings page.
  const projectionStart = new Date(
    today.getFullYear(),
    today.getMonth() + (today.getDate() > 1 ? 1 : 0),
    1,
  );
  const getBalanceAfter = (
    goalId: number,
    dateStr: string,
  ): number | undefined => {
    const gp = gpByGoalId.get(goalId);
    if (!gp) return undefined;
    const d = new Date(dateStr + "T00:00:00");
    const mi =
      (d.getFullYear() - projectionStart.getFullYear()) * 12 +
      (d.getMonth() - projectionStart.getMonth());
    if (mi < 0 || mi >= gp.balances.length) return undefined;
    return gp.balances[mi];
  };

  // Past non-recurring transactions for the history window.
  const historyWindowStart =
    historyWindow === 0
      ? null
      : historyWindow === "all"
        ? new Date(0)
        : (() => {
            const d = new Date(today);
            d.setMonth(d.getMonth() - historyWindow);
            return d;
          })();

  const seenHistPairs = new Set<string>();
  const past =
    historyWindowStart === null
      ? []
      : plannedTransactions
          .filter((tx) => {
            if (hiddenGoalIds?.has(tx.goalId)) return false;
            if (tx.source === "rule" && !showRuleTx) return false;
            if (tx.isRecurring) return false;
            const date = new Date(tx.transactionDate + "T00:00:00");
            if (date >= today) return false;
            if (date < historyWindowStart) return false;
            if (tx.transferPairId) {
              if (seenHistPairs.has(tx.transferPairId)) return false;
              seenHistPairs.add(tx.transferPairId);
            }
            return true;
          })
          .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)); // newest first

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

  const activateCell = (tx: PlannedTransaction, field: ActiveCellField) => {
    if (tableLocked) return;
    // Initialize editForm for this row only when switching rows.
    // Blur on the departing cell commits before activateCell fires on the new cell.
    if (editingId !== tx.id) startEdit(tx);
    setActiveCell({ id: tx.id, field });
  };

  const commitEdit = (tx: PlannedTransaction) => {
    if (!editForm) return;
    const amt = parseFloat(editForm.amount);
    if (isNaN(amt)) {
      // Revert invalid amount and close without saving
      setEditForm({ ...editForm, amount: String(Math.abs(tx.amount)) });
      setActiveCell(null);
      return;
    }
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

  const isCellActive = (txId: number, field: ActiveCellField) =>
    activeCell?.id === txId && activeCell.field === field;

  // Shared blur/keydown handlers for inline inputs
  const makeInputHandlers = (tx: PlannedTransaction) => ({
    onBlur: () => {
      if (committingRef.current) {
        committingRef.current = false;
        return;
      }
      commitEdit(tx);
      setActiveCell(null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        committingRef.current = true;
        commitEdit(tx);
        setActiveCell(null);
      }
      if (e.key === "Escape") {
        setEditingId(null);
        setEditForm(null);
        setActiveCell(null);
      }
    },
  });

  return (
    <div className="space-y-3">
      {/* Add form */}
      {canEdit !== false && adding && (
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
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Amount */}
                <div>
                  <label className="text-caption text-faint block mb-0.5">
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
                      className="flex-1 border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="col-span-2 sm:col-span-3">
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                        className="w-12 border border-default rounded px-1.5 py-0.5 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
                      />
                      <span>months</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={commitAdd}
                  disabled={createTx.isPending}
                >
                  {createTx.isPending ? "Adding…" : "Add"}
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelAdd}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {/* From */}
                <div>
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {/* Description */}
                <div className="col-span-2">
                  <label className="text-caption text-faint block mb-0.5">
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
                    className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                        className="w-12 border border-default rounded px-1.5 py-0.5 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500 text-center"
                      />
                      <span>months</span>
                    </div>
                  )}
                </div>
              </div>

              {transferForm.fromGoalId > 0 &&
                transferForm.toGoalId > 0 &&
                Number(transferForm.amount) > 0 && (
                  <p className="text-caption text-faint">
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={commitTransfer}
                  disabled={createTransfer.isPending}
                >
                  {createTransfer.isPending ? "Adding…" : "Add Transfer"}
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelAdd}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Toolbar: add button + history selector + lock */}
      <div className="flex items-center justify-between gap-4 text-label text-faint px-1">
        <div className="flex items-center gap-2">
          {canEdit !== false && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="px-2.5 py-1 text-label bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border"
            >
              + Add transaction
            </button>
          )}
          {plannedTransactions.some((tx) => tx.source === "rule") && (
            <button
              onClick={() => setShowRuleTx(!showRuleTx)}
              className={`px-2 py-0.5 text-label rounded border transition-colors ${
                showRuleTx
                  ? "border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/20"
                  : "border-surface-strong text-faint hover:text-primary"
              }`}
              title={
                showRuleTx
                  ? "Hide extra paycheck transactions"
                  : "Show extra paycheck transactions"
              }
            >
              {showRuleTx ? "Hide" : "Show"} extra paychecks
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={String(historyWindow)}
            onChange={(e) => {
              const v = e.target.value;
              setHistoryWindow(
                v === "all" ? "all" : (Number(v) as 0 | 3 | 6 | 12),
              );
            }}
            aria-label="History window"
            className="text-label border border-surface-strong rounded px-1.5 py-0.5 bg-surface-primary text-faint hover:text-primary"
          >
            <option value="0">No history</option>
            <option value="3">3 months history</option>
            <option value="6">6 months history</option>
            <option value="12">1 year history</option>
            <option value="all">All history</option>
          </select>
          {canEdit !== false && (
            <button
              onClick={() => setTableLocked(!tableLocked)}
              title={tableLocked ? "Unlock to edit" : "Lock editing"}
              aria-label={tableLocked ? "Unlock to edit" : "Lock editing"}
              className="text-faint hover:text-primary transition-colors"
            >
              {tableLocked ? (
                <Lock className="w-3.5 h-3.5" />
              ) : (
                <LockOpen className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Transaction table */}
      {past.length === 0 && upcoming.length === 0 ? (
        <p className="text-sm text-faint text-center py-8">
          No transactions across any fund.
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
                <th
                  className="text-right px-3 py-2 font-medium text-muted whitespace-nowrap"
                  title="Projected end-of-month balance for this fund — includes contributions, recurring expenses, and overrides (matches the Plan table)"
                >
                  After
                </th>
                <th className="text-center px-3 py-2 font-medium text-muted whitespace-nowrap">
                  Recurring
                </th>
                {canEdit !== false && <th className="px-3 py-2 w-8" />}
              </tr>
            </thead>
            <tbody>
              {/* Past (history) rows */}
              {past.map((tx) => {
                const isTransfer = !!tx.transferPairId;
                const color = fundColorMap.get(tx.goalId);
                const name = fundNameMap.get(tx.goalId) ?? "Unknown";
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
                return (
                  <tr
                    key={`hist-${tx.id}`}
                    className="border-b bg-surface-elevated/20"
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isTransfer ? (
                        <span className="inline-flex items-center gap-1 text-caption">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: fundColorMap.get(
                                fromLeg?.goalId ?? 0,
                              ),
                            }}
                          />
                          <span className="text-faint">
                            {fundNameMap.get(fromLeg?.goalId ?? 0) ?? "?"}
                          </span>
                          <span className="text-faint/50">→</span>
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: fundColorMap.get(
                                toLeg?.goalId ?? 0,
                              ),
                            }}
                          />
                          <span className="text-faint">
                            {fundNameMap.get(toLeg?.goalId ?? 0) ?? "?"}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-faint font-medium">{name}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-faint whitespace-nowrap tabular-nums">
                      {formatDate(
                        new Date(tx.transactionDate + "T00:00:00"),
                        "short",
                      )}
                    </td>
                    <td className="px-3 py-2 text-faint">
                      {isTransfer && (
                        <span className="inline-block text-micro font-medium text-blue-400/70 bg-blue-50/50 dark:bg-blue-950/20 rounded px-1 mr-1.5">
                          transfer
                        </span>
                      )}
                      {tx.description}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap ${
                        isTransfer
                          ? "text-blue-400/70"
                          : tx.amount < 0
                            ? "text-red-400/70"
                            : "text-green-500/70"
                      }`}
                    >
                      {isTransfer
                        ? formatCurrency(Math.abs(tx.amount))
                        : `${tx.amount < 0 ? "−" : "+"}${formatCurrency(Math.abs(tx.amount))}`}
                    </td>
                    <td className="px-3 py-2 text-right text-faint/40 tabular-nums">
                      <span className="text-caption">—</span>
                    </td>
                    <td className="px-3 py-2 text-center text-faint/40">
                      <span className="text-caption">—</span>
                    </td>
                    {canEdit !== false && <td className="px-3 py-2" />}
                  </tr>
                );
              })}

              {/* Separator between history and upcoming */}
              {past.length > 0 && upcoming.length > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={canEdit !== false ? 7 : 6}
                    className="px-3 py-1 text-caption text-faint/50 text-center bg-surface-sunken border-b border-t tracking-widest"
                  >
                    ─── Upcoming ───
                  </td>
                </tr>
              )}

              {upcoming.map((tx) => {
                const isTransfer = !!tx.transferPairId;
                const color = fundColorMap.get(tx.goalId);
                const name = fundNameMap.get(tx.goalId) ?? "Unknown";

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

                const isRuleRow = tx.source === "rule";
                const editable =
                  !tableLocked &&
                  !isTransfer &&
                  !isRuleRow &&
                  canEdit !== false;
                const handlers = makeInputHandlers(tx);

                return (
                  <tr
                    key={tx.id}
                    className="border-b last:border-0 hover:bg-surface-elevated/40 transition-colors"
                  >
                    {/* Fund */}
                    <td
                      className={`px-3 py-2 whitespace-nowrap${editable ? " cursor-pointer" : ""}`}
                      onClick={
                        editable ? () => activateCell(tx, "goalId") : undefined
                      }
                    >
                      {isCellActive(tx.id, "goalId") && editForm ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: fundColorMap.get(
                                editForm.goalId,
                              ),
                            }}
                          />
                          <select
                            autoFocus
                            value={editForm.goalId}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                goalId: Number(e.target.value),
                              })
                            }
                            onBlur={handlers.onBlur}
                            onKeyDown={handlers.onKeyDown}
                            className="border border-default bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            {goalProjections.map((gp) => (
                              <option key={gp.goalId} value={gp.goalId}>
                                {gp.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : isTransfer ? (
                        <span className="inline-flex items-center gap-1 text-caption">
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
                    <td
                      className={`px-3 py-2 text-muted whitespace-nowrap tabular-nums${editable ? " cursor-pointer" : ""}`}
                      onClick={
                        editable
                          ? () => activateCell(tx, "transactionDate")
                          : undefined
                      }
                    >
                      {isCellActive(tx.id, "transactionDate") && editForm ? (
                        <input
                          autoFocus
                          type="date"
                          value={editForm.transactionDate}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              transactionDate: e.target.value,
                            })
                          }
                          onBlur={handlers.onBlur}
                          onKeyDown={handlers.onKeyDown}
                          className="border border-default bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        formatDate(
                          new Date(tx.transactionDate + "T00:00:00"),
                          "short",
                        )
                      )}
                    </td>

                    {/* Description */}
                    <td
                      className={`px-3 py-2 text-muted${editable ? " cursor-pointer" : ""}`}
                      onClick={
                        editable
                          ? () => activateCell(tx, "description")
                          : undefined
                      }
                    >
                      {isCellActive(tx.id, "description") && editForm ? (
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
                          onBlur={handlers.onBlur}
                          onKeyDown={handlers.onKeyDown}
                          className="w-full border border-default bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : (
                        <>
                          {isTransfer && (
                            <span className="inline-block text-micro font-medium text-blue-500 bg-blue-50 dark:bg-blue-950/30 rounded px-1 mr-1.5">
                              transfer
                            </span>
                          )}
                          {isRuleRow && (
                            <span className="inline-block text-micro font-medium text-purple-500 bg-purple-50 dark:bg-purple-950/30 rounded px-1 mr-1.5">
                              extra paycheck
                            </span>
                          )}
                          {tx.description}
                        </>
                      )}
                    </td>

                    {/* Amount */}
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap${editable ? " cursor-pointer" : ""} ${
                        isTransfer
                          ? "text-blue-500"
                          : tx.amount < 0
                            ? "text-red-500"
                            : "text-green-600"
                      }`}
                      onClick={
                        editable ? () => activateCell(tx, "amount") : undefined
                      }
                    >
                      {isCellActive(tx.id, "amount") && editForm ? (
                        <input
                          autoFocus
                          type="number"
                          min="0"
                          step="0.01"
                          value={editForm.amount}
                          onChange={(e) =>
                            setEditForm({ ...editForm, amount: e.target.value })
                          }
                          onBlur={handlers.onBlur}
                          onKeyDown={handlers.onKeyDown}
                          className="w-24 border border-default bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      ) : isTransfer ? (
                        formatCurrency(Math.abs(tx.amount))
                      ) : (
                        `${tx.amount < 0 ? "−" : "+"}${formatCurrency(Math.abs(tx.amount))}`
                      )}
                    </td>

                    {/* Balance after — end-of-month projected balance for this fund */}
                    {(() => {
                      // Transfer rows are collapsed to a single leg (deduped by
                      // transferPairId), so a per-fund balance here would reflect
                      // only whichever leg survived. Suppress it to avoid showing
                      // an ambiguous balance for a two-fund movement.
                      if (isTransfer)
                        return (
                          <td className="px-3 py-2 text-right text-faint/40 tabular-nums text-xs">
                            —
                          </td>
                        );
                      const bal = getBalanceAfter(
                        tx.goalId,
                        tx.transactionDate,
                      );
                      if (bal === undefined)
                        return (
                          <td className="px-3 py-2 text-right text-faint/40 tabular-nums text-xs">
                            —
                          </td>
                        );
                      return (
                        <td
                          className={`px-3 py-2 text-right tabular-nums text-xs font-medium whitespace-nowrap ${
                            bal < 0 ? "text-red-500" : "text-muted"
                          }`}
                        >
                          {formatCurrency(bal)}
                        </td>
                      );
                    })()}

                    {/* Recurring */}
                    <td className="px-3 py-2 text-center text-faint">
                      {tx.isRecurring ? (
                        <span className="text-caption">
                          every {tx.recurrenceMonths}mo
                        </span>
                      ) : (
                        <span className="text-caption text-faint/40">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    {canEdit !== false && (
                      <td className="px-3 py-2">
                        {!tableLocked && !isRuleRow && (
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
                            className="text-xs text-faint hover:text-red-600 transition-colors disabled:opacity-50"
                          >
                            ×
                          </button>
                        )}
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
