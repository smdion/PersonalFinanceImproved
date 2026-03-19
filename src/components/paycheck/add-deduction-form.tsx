"use client";

import React, { useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import type { CreateDeductionData } from "./types";

export function AddDeductionForm({
  jobId,
  isPretax,
  onSave,
  onCancel,
}: {
  jobId: number;
  isPretax: boolean;
  onSave: (data: CreateDeductionData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [ficaExempt, setFicaExempt] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !amount.trim()) return;
    onSave({
      jobId,
      deductionName: name.trim(),
      amountPerPeriod: amount.replace(/[^0-9.]/g, ""),
      isPretax,
      ficaExempt,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2 text-sm"
    >
      <p className="text-xs font-medium text-blue-700 uppercase">
        New {isPretax ? "Pre-Tax" : "Post-Tax"} Deduction
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Name (e.g. Dental)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 border border-strong rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          autoFocus
        />
        <input
          type="number"
          placeholder="$/period"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="0.01"
          min="0"
          className="w-24 border border-strong rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>
      {isPretax && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={ficaExempt}
            onChange={(e) => setFicaExempt(e.target.checked)}
            className="rounded border-strong"
          />
          FICA exempt (Section 125)
          <HelpTip text="If checked, this deduction also reduces Social Security and Medicare taxes — common for health/dental premiums" />
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 bg-surface-strong text-secondary rounded text-xs hover:bg-surface-strong transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
