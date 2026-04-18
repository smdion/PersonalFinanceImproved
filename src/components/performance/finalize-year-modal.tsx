"use client";

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import {
  PERF_CATEGORY_DISPLAY_ORDER,
  type PerfCategory,
} from "@/lib/config/display-labels";
import type { AnnualRow } from "./types";

type CategoryOverride = {
  category: PerfCategory;
  beginningBalance: string;
  totalContributions: string;
  yearlyGainLoss: string;
  endingBalance: string;
  employerContributions: string;
  distributions: string;
  fees: string;
  rollovers: string;
  lifetimeGains: string;
  lifetimeContributions: string;
  lifetimeMatch: string;
};

type FinalizeYearModalProps = {
  year: number;
  rows: AnnualRow[];
  onConfirm: (overrides: CategoryOverride[]) => void;
  onCancel: () => void;
  isPending: boolean;
};

const FIELDS = [
  { key: "beginningBalance", label: "Beginning Balance" },
  { key: "totalContributions", label: "Total Contributions" },
  { key: "employerContributions", label: "Employer Match" },
  { key: "distributions", label: "Distributions" },
  { key: "rollovers", label: "Rollovers" },
  { key: "fees", label: "Fees" },
  { key: "yearlyGainLoss", label: "Gain/Loss" },
  { key: "endingBalance", label: "Ending Balance" },
  { key: "lifetimeGains", label: "Lifetime Gains" },
  { key: "lifetimeContributions", label: "Lifetime Contributions" },
  { key: "lifetimeMatch", label: "Lifetime Match" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export function FinalizeYearModal({
  year,
  rows,
  onConfirm,
  onCancel,
  isPending,
}: FinalizeYearModalProps) {
  // Initialize editable state from computed annual rows
  const [values, setValues] = useState<
    Record<string, Record<FieldKey, string>>
  >(() => {
    const init: Record<string, Record<FieldKey, string>> = {};
    for (const row of rows) {
      init[row.category] = {
        beginningBalance: row.beginningBalance.toFixed(2),
        totalContributions: row.totalContributions.toFixed(2),
        yearlyGainLoss: row.yearlyGainLoss.toFixed(2),
        endingBalance: row.endingBalance.toFixed(2),
        employerContributions: row.employerContributions.toFixed(2),
        distributions: row.distributions.toFixed(2),
        rollovers: row.rollovers.toFixed(2),
        fees: row.fees.toFixed(2),
        lifetimeGains: row.lifetimeGains.toFixed(2),
        lifetimeContributions: row.lifetimeContributions.toFixed(2),
        lifetimeMatch: row.lifetimeMatch.toFixed(2),
      };
    }
    return init;
  });

  const [editingCell, setEditingCell] = useState<{
    cat: string;
    field: FieldKey;
  } | null>(null);

  const categories = rows
    .map((r) => r.category)
    .sort((a, b) => {
      const order: readonly string[] = PERF_CATEGORY_DISPLAY_ORDER;
      return order.indexOf(a) - order.indexOf(b);
    });

  const handleConfirm = () => {
    const overrides: CategoryOverride[] = categories.map((cat) => ({
      category: cat,
      ...values[cat]!,
    }));
    onConfirm(overrides);
  };

  const updateValue = (cat: string, field: FieldKey, val: string) => {
    setValues((prev) => ({
      ...prev,
      [cat]: { ...prev[cat]!, [field]: val },
    }));
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 print:hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Finalize ${year}`}
        className="bg-surface-primary rounded-lg shadow-xl border max-w-4xl w-full mx-4 max-h-[85vh] overflow-auto"
      >
        <div className="sticky top-0 bg-surface-primary border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">
            Finalize {year}
          </h2>
          <p className="text-sm text-muted">
            Review and adjust values before locking
          </p>
        </div>

        <div className="px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 text-muted font-medium w-40">
                  Field
                </th>
                {categories.map((cat) => (
                  <th
                    key={cat}
                    className="text-right py-2 px-3 text-muted font-medium"
                  >
                    {cat}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(({ key, label }) => (
                <tr
                  key={key}
                  className={`border-b border-subtle ${key.startsWith("lifetime") ? "bg-surface-sunken" : ""}`}
                >
                  <td className="py-2 pr-4 text-muted font-medium">{label}</td>
                  {categories.map((cat) => {
                    const val = values[cat]?.[key] ?? "0";
                    const isEditing =
                      editingCell?.cat === cat && editingCell?.field === key;
                    const numVal = parseFloat(val) || 0;

                    return (
                      <td key={cat} className="text-right py-1 px-3">
                        {isEditing ? (
                          <input
                            type="text"
                            autoFocus
                            value={val}
                            onChange={(e) =>
                              updateValue(cat, key, e.target.value)
                            }
                            onBlur={() => setEditingCell(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape")
                                setEditingCell(null);
                            }}
                            className="w-full text-right px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <button
                            onClick={() => setEditingCell({ cat, field: key })}
                            className={`w-full text-right px-2 py-1 rounded hover:bg-blue-50 transition-colors ${
                              numVal < 0 ? "text-red-600" : "text-primary"
                            }`}
                          >
                            {formatCurrency(numVal)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sticky bottom-0 bg-surface-primary border-t px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted hover:bg-surface-elevated rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? "Finalizing..." : `Finalize ${year}`}
          </button>
        </div>
      </div>
    </div>
  );
}
