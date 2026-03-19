"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatPercent } from "@/lib/utils/format";

export function ReturnRatesSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.returnRates.list.useQuery();
  const upsertMut = trpc.settings.returnRates.upsert.useMutation({
    onSuccess: () => utils.settings.returnRates.list.invalidate(),
  });
  const deleteMut = trpc.settings.returnRates.delete.useMutation({
    onSuccess: () => utils.settings.returnRates.list.invalidate(),
  });

  const [showAddRow, setShowAddRow] = useState(false);
  const [newAge, setNewAge] = useState("");
  const [newRate, setNewRate] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  if (isLoading)
    return <div className="text-muted">Loading return rates...</div>;

  const rows = data ?? [];

  const handleSaveRate = (age: number, rawPercent: string) => {
    const pct = parseFloat(rawPercent);
    if (isNaN(pct)) return;
    upsertMut.mutate({ age, rateOfReturn: String(pct / 100) });
  };

  const handleAddRow = () => {
    const age = parseInt(newAge);
    const pct = parseFloat(newRate);
    if (isNaN(age) || age < 0 || age > 120) return;
    if (isNaN(pct)) return;
    // Check for duplicate age
    if (rows.some((r) => r.age === age)) return;
    upsertMut.mutate(
      { age, rateOfReturn: String(pct / 100) },
      {
        onSuccess: () => {
          setShowAddRow(false);
          setNewAge("");
          setNewRate("");
        },
      },
    );
  };

  const handleDelete = (id: number) => {
    deleteMut.mutate({ id }, { onSuccess: () => setConfirmDeleteId(null) });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Return Rate Table</h2>
        {admin && (
          <button
            onClick={() => {
              setShowAddRow(!showAddRow);
              setNewAge("");
              setNewRate("");
            }}
            className="px-2 py-1 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-full hover:bg-blue-50 transition-colors"
          >
            + Age
          </button>
        )}
      </div>

      {/* Add row dialog */}
      {showAddRow && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <label className="text-sm text-secondary">
              Age:
              <input
                type="number"
                value={newAge}
                onChange={(e) => setNewAge(e.target.value)}
                className="ml-2 w-20 px-2 py-1 text-sm border rounded"
                min={0}
                max={120}
              />
            </label>
            <label className="text-sm text-secondary">
              Rate (%):
              <input
                type="number"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                className="ml-2 w-24 px-2 py-1 text-sm border rounded"
                step="0.1"
              />
            </label>
            <button
              onClick={handleAddRow}
              disabled={upsertMut.isPending}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAddRow(false);
                setNewAge("");
                setNewRate("");
              }}
              className="px-3 py-1 text-sm text-muted hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-muted text-sm">No return rates configured.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface-sunken border-b">
                <th className="text-left px-4 py-2 font-medium text-secondary">
                  Age
                </th>
                <th className="text-right px-4 py-2 font-medium text-secondary">
                  Return Rate (%)
                </th>
                {admin && (
                  <th className="text-right px-4 py-2 font-medium text-secondary w-20">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-subtle">
                  <td className="px-4 py-1.5 text-primary">{row.age}</td>
                  <td className="px-4 py-1.5 text-right">
                    <InlineEdit
                      value={String(Number(row.rateOfReturn) * 100)}
                      onSave={(v) => handleSaveRate(row.age, v)}
                      formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
                      parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                      type="number"
                      className="font-medium"
                      editable={admin}
                    />
                  </td>
                  {admin && (
                    <td className="px-4 py-1.5 text-right">
                      {confirmDeleteId === row.id ? (
                        <span className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleDelete(row.id)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-muted hover:text-secondary"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(row.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-faint mt-4">
        Expected annual return rates by age. Click any rate to edit. Rates are
        stored as decimals (e.g., enter 7 for 7%).
      </p>
    </div>
  );
}
