"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/forms";
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
    <div className="bg-surface-primary/50 mt-3 rounded-lg border p-3">
      <p className="text-faint mb-2 text-xs font-medium">
        Add Transaction &mdash; {goalName}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Date">
          <FormInput
            type="date"
            value={txForm.transactionDate}
            onChange={(e) =>
              setTxForm({ ...txForm, transactionDate: e.target.value })
            }
          />
        </FormField>
        <FormField label="Amount (negative = spending)">
          <FormInput
            type="number"
            step="0.01"
            value={txForm.amount}
            onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
            placeholder="-5000"
          />
        </FormField>
        <FormField label="Description">
          <FormInput
            type="text"
            value={txForm.description}
            onChange={(e) =>
              setTxForm({ ...txForm, description: e.target.value })
            }
            placeholder="Spain trip"
          />
        </FormField>
        <div>
          <label className="text-faint mb-1 block text-xs">Recurring?</label>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={txForm.isRecurring}
              onChange={(e) =>
                setTxForm({ ...txForm, isRecurring: e.target.checked })
              }
            />
            {txForm.isRecurring && (
              <FormInput
                type="number"
                min="1"
                value={txForm.recurrenceMonths}
                onChange={(e) =>
                  setTxForm({ ...txForm, recurrenceMonths: e.target.value })
                }
                placeholder="every N months"
                className="w-24"
              />
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          onClick={onAddTx}
          disabled={createTxPending}
          className="!font-normal"
        >
          {createTxPending ? "Saving..." : "Add"}
        </Button>
        <button
          onClick={onCancel}
          className="text-faint hover:bg-surface-elevated rounded border px-3 py-1 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
