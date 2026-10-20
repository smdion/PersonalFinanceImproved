"use client";

import React, { useState } from "react";
import type { CreateDeductionData } from "./types";
import { DEDUCTION_PRESETS } from "@/lib/config/paycheck-presets";

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
  // The presets for the stub section this form adds to.
  const presets = DEDUCTION_PRESETS.filter((p) => p.isPretax === isPretax);
  const [presetKey, setPresetKey] = useState(presets[0]!.key);
  const preset = presets.find((p) => p.key === presetKey) ?? presets[0]!;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !amount.trim()) return;
    onSave({
      jobId,
      deductionName: name.trim(),
      amountPerPeriod: amount.replace(/[^0-9.]/g, ""),
      isPretax: preset.isPretax,
      ficaExempt: preset.ficaExempt,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm"
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
          className="border-strong flex-1 rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
          autoFocus
        />
        <input
          type="number"
          placeholder="$/period"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="0.01"
          min="0"
          className="border-strong w-24 rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
        />
      </div>
      {presets.length > 1 && (
        <select
          aria-label="How your pay stub lists it"
          value={presetKey}
          onChange={(e) => setPresetKey(e.target.value)}
          className="border-strong w-full rounded border px-2 py-1 text-xs"
        >
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-surface-strong text-secondary hover:bg-surface-strong rounded px-3 py-1 text-xs transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
