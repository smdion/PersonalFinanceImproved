"use client";

import React, { useState } from "react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { AddTransactionForm } from "./add-transaction-form";
import { PlannedTxForm, emptyTxForm } from "./types";

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
  canEdit?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(
    transactions.length <= 5 && transactions.length > 0,
  );
  const [addingTx, setAddingTx] = useState(false);
  const [txForm, setTxForm] = useState<PlannedTxForm>(emptyTxForm(goalId));

  const today = new Date().toISOString().slice(0, 10);
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
              canEdit={canEdit}
            />
          ))}

          {past.length > 0 && (
            <div className="opacity-50">
              {past.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  currentGoalId={goalId}
                  goalById={goalById}
                  onDelete={() => handleDelete(tx)}
                  canEdit={canEdit}
                  isPast
                />
              ))}
            </div>
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
  canEdit,
  isPast,
}: {
  tx: PlannedTransaction;
  currentGoalId: number;
  goalById?: Map<number, { name: string }>;
  onDelete: () => void;
  canEdit?: boolean;
  isPast?: boolean;
}) {
  const isTransfer = !!tx.transferPairId;

  // For transfers, figure out the other fund's name
  let transferLabel: string | null = null;
  if (isTransfer && goalById) {
    // This tx is one half of a transfer pair. The amount sign tells us direction:
    // negative = money leaving this fund (transfer out), positive = money arriving (transfer in)
    if (tx.amount < 0) {
      // We're the source — description should mention destination, but we show generic label
      transferLabel = "Transfer out";
    } else {
      transferLabel = "Transfer in";
    }
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
