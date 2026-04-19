"use client";

import React, { useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { AddTransactionForm } from "./add-transaction-form";
import { PlannedTxForm, emptyTxForm } from "./types";

function txToForm(tx: PlannedTransaction): PlannedTxForm {
  return {
    goalId: tx.goalId,
    transactionDate: tx.transactionDate,
    amount: String(tx.amount),
    description: tx.description,
    isRecurring: tx.isRecurring,
    recurrenceMonths:
      tx.recurrenceMonths != null ? String(tx.recurrenceMonths) : "",
  };
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

export function FundTransactionList({
  transactions,
  goalId,
  goalName,
  onDeleteTx,
  onDeleteTransfer,
  goalById,
  onAddTx,
  createTxPending,
  onUpdateTx,
  updateTxPending: _updateTxPending,
  canEdit,
}: {
  transactions: PlannedTransaction[];
  goalId: number;
  goalName: string;
  onDeleteTx: (params: { id: number }) => void;
  onDeleteTransfer?: (params: { transferPairId: string }) => void;
  goalById?: Map<number, { name: string }>;
  onAddTx: (form: PlannedTxForm) => void;
  createTxPending: boolean;
  onUpdateTx?: (id: number, form: PlannedTxForm) => Promise<void> | void;
  updateTxPending?: boolean;
  canEdit?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const upcomingCount = transactions.filter(
    (tx) => tx.transactionDate >= today,
  ).length;
  const [isOpen, setIsOpen] = useState(upcomingCount <= 5 && upcomingCount > 0);
  const [showHistory, setShowHistory] = useState(false);
  const [addingTx, setAddingTx] = useState(false);
  const [txForm, setTxForm] = useState<PlannedTxForm>(emptyTxForm(goalId));

  const sorted = [...transactions].sort((a, b) =>
    a.transactionDate.localeCompare(b.transactionDate),
  );
  const upcoming = sorted.filter((tx) => tx.transactionDate >= today);
  const past = sorted.filter((tx) => tx.transactionDate < today);

  const handleAddTx = () => {
    if (!txForm.transactionDate || !txForm.amount || !txForm.description)
      return;
    onAddTx(txForm);
    setTxForm(emptyTxForm(goalId));
    setAddingTx(false);
  };

  const handleDelete = (tx: PlannedTransaction) => {
    if (tx.transferPairId && onDeleteTransfer) {
      onDeleteTransfer({ transferPairId: tx.transferPairId });
    } else {
      onDeleteTx({ id: tx.id });
    }
  };

  return (
    <div className="border-t pt-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-primary"
        >
          <svg
            aria-hidden="true"
            className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
          Transactions ({transactions.length})
        </button>
        {canEdit !== false && (
          <button
            onClick={() => {
              setAddingTx(true);
              setIsOpen(true);
              setTxForm(emptyTxForm(goalId));
            }}
            className="text-[10px] text-blue-600 hover:text-blue-700"
          >
            + Add
          </button>
        )}
      </div>

      {isOpen && (
        <div className="mt-2 space-y-1">
          {upcoming.length === 0 && past.length === 0 && !addingTx && (
            <p className="text-xs text-muted py-1">No planned transactions.</p>
          )}

          {upcoming.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              currentGoalId={goalId}
              goalById={goalById}
              onDelete={() => handleDelete(tx)}
              onUpdate={
                onUpdateTx ? (form) => onUpdateTx(tx.id, form) : undefined
              }
              canEdit={canEdit}
            />
          ))}

          {past.length > 0 && (
            <>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-[10px] text-muted hover:text-primary mt-1"
              >
                {showHistory ? "Hide history" : `Show history (${past.length})`}
              </button>
              {showHistory && (
                <div className="opacity-50">
                  {past.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      currentGoalId={goalId}
                      goalById={goalById}
                      onDelete={() => handleDelete(tx)}
                      onUpdate={
                        onUpdateTx
                          ? (form) => onUpdateTx(tx.id, form)
                          : undefined
                      }
                      canEdit={canEdit}
                      isPast
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {addingTx && (
            <AddTransactionForm
              goalName={goalName}
              txForm={txForm}
              setTxForm={setTxForm}
              onAddTx={handleAddTx}
              createTxPending={createTxPending}
              onCancel={() => setAddingTx(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TransactionRow({
  tx,
  currentGoalId: _currentGoalId,
  goalById,
  onDelete,
  onUpdate,
  canEdit,
  isPast,
}: {
  tx: PlannedTransaction;
  currentGoalId: number;
  goalById?: Map<number, { name: string }>;
  onDelete: () => void;
  onUpdate?: (form: PlannedTxForm) => Promise<void> | void;
  canEdit?: boolean;
  isPast?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<PlannedTxForm>(txToForm(tx));
  const [submitting, setSubmitting] = useState(false);
  const isTransfer = !!tx.transferPairId;

  let transferLabel: string | null = null;
  if (isTransfer && goalById) {
    transferLabel = tx.amount < 0 ? "Transfer out" : "Transfer in";
  }

  if (editing) {
    return (
      <div className="mt-1 mb-1 border rounded-lg p-3 bg-surface-primary/50">
        <p className="text-xs font-medium text-faint mb-2">Edit transaction</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-faint mb-1">Date</label>
            <input
              type="date"
              value={editForm.transactionDate}
              onChange={(e) =>
                setEditForm({ ...editForm, transactionDate: e.target.value })
              }
              className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-faint mb-1">
              Amount (negative = spending)
            </label>
            <input
              type="number"
              step="0.01"
              value={editForm.amount}
              onChange={(e) =>
                setEditForm({ ...editForm, amount: e.target.value })
              }
              className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-faint mb-1">Description</label>
            <input
              type="text"
              value={editForm.description}
              onChange={(e) =>
                setEditForm({ ...editForm, description: e.target.value })
              }
              className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-faint mb-1">Recurring?</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editForm.isRecurring}
                onChange={(e) =>
                  setEditForm({ ...editForm, isRecurring: e.target.checked })
                }
              />
              {editForm.isRecurring && (
                <input
                  type="number"
                  value={editForm.recurrenceMonths}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      recurrenceMonths: e.target.value,
                    })
                  }
                  placeholder="every N months"
                  className="border bg-surface-elevated text-primary rounded px-2 py-1 text-sm w-24"
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={async () => {
              if (
                !editForm.transactionDate ||
                !editForm.amount ||
                !editForm.description
              )
                return;
              if (editForm.isRecurring && !editForm.recurrenceMonths) return;
              setSubmitting(true);
              try {
                await onUpdate?.(editForm);
                setEditing(false);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={
              submitting || (editForm.isRecurring && !editForm.recurrenceMonths)
            }
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save"}
          </button>
          <button
            onClick={() => {
              setEditForm(txToForm(tx));
              setEditing(false);
            }}
            className="px-3 py-1 border text-faint rounded text-sm hover:bg-surface-elevated"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-between text-xs py-1 ${isPast ? "line-through" : ""}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="text-muted w-20 shrink-0">
          {formatDate(tx.transactionDate, "short")}
        </span>
        {isTransfer && (
          <span className="text-[9px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded shrink-0">
            {transferLabel}
          </span>
        )}
        <span className="text-secondary truncate">{tx.description}</span>
        {tx.isRecurring && (
          <span className="text-[9px] text-muted shrink-0">
            every {tx.recurrenceMonths}mo
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`font-medium tabular-nums ${tx.amount < 0 ? "text-red-600" : "text-green-600"}`}
        >
          {tx.amount >= 0 ? "+" : ""}
          {formatCurrency(tx.amount)}
        </span>
        {canEdit !== false && !isTransfer && onUpdate && (
          <button
            onClick={() => {
              setEditForm(txToForm(tx));
              setEditing(true);
            }}
            className="text-muted/50 hover:text-blue-600 text-xs"
            title="Edit"
          >
            ✎
          </button>
        )}
        {canEdit !== false && (
          <button
            onClick={onDelete}
            className="text-red-600/50 hover:text-red-600 text-xs"
            title={isTransfer ? "Delete transfer (both sides)" : "Delete"}
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}
