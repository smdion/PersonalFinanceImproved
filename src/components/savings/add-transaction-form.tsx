"use client";

import React from "react";
import { PlannedTxForm } from "./types";

export function AddTransactionForm({
  goalName,
  txForm,
  setTxForm,
  onAddTx,
  createTxPending,
  onCancel,
}: {
  goalName: string;
  txForm: PlannedTxForm;
  setTxForm: (form: PlannedTxForm) => void;
  onAddTx: () => void;
  createTxPending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 border rounded-lg p-3 bg-surface-primary/50">
      <p className="text-xs font-medium text-faint mb-2">
        Add Transaction &mdash; {goalName}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-faint mb-1">Date</label>
          <input
            type="date"
            value={txForm.transactionDate}
            onChange={(e) =>
              setTxForm({ ...txForm, transactionDate: e.target.value })
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
            value={txForm.amount}
            onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
            placeholder="-5000"
            className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-faint mb-1">Description</label>
          <input
            type="text"
            value={txForm.description}
            onChange={(e) =>
              setTxForm({ ...txForm, description: e.target.value })
            }
            placeholder="Spain trip"
            className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-faint mb-1">Recurring?</label>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={txForm.isRecurring}
              onChange={(e) =>
                setTxForm({ ...txForm, isRecurring: e.target.checked })
              }
            />
            {txForm.isRecurring && (
              <input
                type="number"
                value={txForm.recurrenceMonths}
                onChange={(e) =>
                  setTxForm({ ...txForm, recurrenceMonths: e.target.value })
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
          onClick={onAddTx}
          disabled={createTxPending}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {createTxPending ? "Saving..." : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 border text-faint rounded text-sm hover:bg-surface-elevated"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
