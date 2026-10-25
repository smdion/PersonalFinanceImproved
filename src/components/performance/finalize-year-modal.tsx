"use client";

import React, { useState } from "react";
import { accountDisplayName, formatCurrency } from "@/lib/utils/format";
import { describeCheck, PERF_FIELD_HELP } from "@/lib/config/performance-help";
import {
  PERF_CATEGORY_DISPLAY_ORDER,
  type PerfCategory,
} from "@/lib/config/display-labels";
import type { AccountRow, AnnualRow } from "./types";

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
  /** The year's account rows — their open checks are listed before locking. */
  accounts?: AccountRow[];
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
  accounts = [],
  onConfirm,
  onCancel,
  isPending,
}: FinalizeYearModalProps) {
  // Finalizing doesn't clear estimate marks: only confirming them does.
  const toLookAt = accounts
    .map((a) => ({
      a,
      open: (a.checks ?? []).filter((c) => !c.accepted),
      estimated: a.estimatedFields ?? [],
    }))
    .filter((x) => x.open.length > 0 || x.estimated.length > 0);
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
        className="bg-surface-primary mx-4 max-h-[85vh] w-full max-w-4xl overflow-auto rounded-lg border shadow-xl"
      >
        <div className="bg-surface-primary sticky top-0 flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-primary text-lg font-semibold">
            Finalize {year}
          </h2>
          <p className="text-muted text-sm">
            Review and adjust values before locking
          </p>
        </div>

        {toLookAt.length > 0 && (
          <div className="mx-6 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">
              Before you lock {year}: figures to look at
            </p>
            <ul className="mt-1 list-disc pl-5">
              {toLookAt.map(({ a, open, estimated }) => (
                <li key={a.id}>
                  <span className="font-medium">
                    {accountDisplayName({
                      ...a,
                      accountType: a.accountType ?? undefined,
                    })}
                  </span>
                  :{" "}
                  {[
                    ...open.map((c) => describeCheck(c).title),
                    estimated.length > 0 &&
                      `still estimated: ${estimated
                        .map((f) => PERF_FIELD_HELP[f].label)
                        .join(", ")}`,
                  ]
                    .filter(Boolean)
                    .join("; ")}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Fix them in the table, accept a gap that&apos;s on purpose, or
              confirm an estimate (click the mark next to the account). Once
              locked, a correction to {year} carries into later years.
            </p>
          </div>
        )}

        <div className="px-6 py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-muted w-40 py-2 pr-4 text-left font-medium">
                  Field
                </th>
                {categories.map((cat) => (
                  <th
                    key={cat}
                    className="text-muted px-3 py-2 text-right font-medium"
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
                  className={`border-subtle border-b ${key.startsWith("lifetime") ? "bg-surface-sunken" : ""}`}
                >
                  <td className="text-muted py-2 pr-4 font-medium">{label}</td>
                  {categories.map((cat) => {
                    const val = values[cat]?.[key] ?? "0";
                    const isEditing =
                      editingCell?.cat === cat && editingCell?.field === key;
                    const numVal = parseFloat(val) || 0;

                    return (
                      <td key={cat} className="px-3 py-1 text-right">
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
                            className="w-full rounded border border-blue-400 px-2 py-1 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => setEditingCell({ cat, field: key })}
                            className={`w-full rounded px-2 py-1 text-right transition-colors hover:bg-blue-50 ${
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

        <div className="bg-surface-primary sticky bottom-0 flex justify-end gap-3 border-t px-6 py-4">
          <button
            onClick={onCancel}
            className="text-muted hover:bg-surface-elevated rounded-md px-4 py-2 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
          >
            {isPending
              ? "Finalizing..."
              : toLookAt.length > 0
                ? `Finalize ${year} anyway`
                : `Finalize ${year}`}
          </button>
        </div>
      </div>
    </div>
  );
}
