"use client";

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";

interface Goal {
  id: number;
  name: string;
}

export function TransferForm({
  goals,
  fromGoalId,
  onSubmit,
  isPending,
  onCancel,
}: {
  goals: Goal[];
  fromGoalId?: number;
  onSubmit: (data: {
    fromGoalId: number;
    toGoalId: number;
    transactionDate: string;
    amount: number;
    description: string;
    isRecurring: boolean;
    recurrenceMonths: number | null;
  }) => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(fromGoalId ?? 0);
  const [to, setTo] = useState(0);
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceMonths, setRecurrenceMonths] = useState("");

  const canSubmit =
    from > 0 &&
    to > 0 &&
    from !== to &&
    date &&
    Number(amount) > 0 &&
    description;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      fromGoalId: from,
      toGoalId: to,
      transactionDate: date,
      amount: Number(amount),
      description,
      isRecurring,
      recurrenceMonths: isRecurring ? parseInt(recurrenceMonths) || null : null,
    });
  };

  const otherGoals = goals.filter((g) => g.id !== from);

  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50">
      <p className="text-xs font-medium text-blue-300 mb-2">
        Transfer Between Funds
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-faint mb-1">From</label>
          <select
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
            className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
          >
            <option value={0}>Select fund...</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-faint mb-1">To</label>
          <select
            value={to}
            onChange={(e) => setTo(Number(e.target.value))}
            className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
          >
            <option value={0}>Select fund...</option>
            {otherGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-faint mb-1">Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
            className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-faint mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-faint mb-1">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Move travel funds to home projects"
            className="w-full border bg-surface-elevated text-primary rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-faint mb-1">Recurring?</label>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
            />
            {isRecurring && (
              <input
                type="number"
                value={recurrenceMonths}
                onChange={(e) => setRecurrenceMonths(e.target.value)}
                placeholder="every N months"
                className="border bg-surface-elevated text-primary rounded px-2 py-1 text-sm w-24"
              />
            )}
          </div>
        </div>
      </div>
      {from > 0 && to > 0 && Number(amount) > 0 && (
        <p className="text-xs text-faint mt-2">
          {formatCurrency(Number(amount))} will move from{" "}
          <span className="text-red-600">
            {goals.find((g) => g.id === from)?.name}
          </span>{" "}
          &rarr;{" "}
          <span className="text-green-600">
            {goals.find((g) => g.id === to)?.name}
          </span>
        </p>
      )}
      <div className="flex gap-2 mt-3">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Create Transfer"}
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
