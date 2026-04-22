"use client";

/** Year-by-year expense adjustments panel for the Relocation calculator.
 *  Extracted from tools/page.tsx during the v0.5.2 file-split refactor.
 *  Stateless — all state flows via props.
 */

import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/format";
import type { RelocationBudgetInfo, YearAdjustmentRow } from "./types";

export type RelocAdjFormState = {
  year: string;
  monthlyExpenses: string;
  profileId: string;
  budgetColumn: string;
  notes: string;
};

type Props = {
  budgetInfo: RelocationBudgetInfo;
  relocYearAdjustments: YearAdjustmentRow[];
  setRelocYearAdjustments: React.Dispatch<
    React.SetStateAction<YearAdjustmentRow[]>
  >;
  showRelocAdjForm: boolean;
  setShowRelocAdjForm: React.Dispatch<React.SetStateAction<boolean>>;
  relocAdjMode: "manual" | "profile";
  setRelocAdjMode: React.Dispatch<React.SetStateAction<"manual" | "profile">>;
  relocAdjForm: RelocAdjFormState;
  setRelocAdjForm: React.Dispatch<React.SetStateAction<RelocAdjFormState>>;
};

export function RelocationYearAdjustments({
  budgetInfo,
  relocYearAdjustments,
  setRelocYearAdjustments,
  showRelocAdjForm,
  setShowRelocAdjForm,
  relocAdjMode,
  setRelocAdjMode,
  relocAdjForm,
  setRelocAdjForm,
}: Props) {
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-secondary">
          Year-by-Year Expense Adjustments
        </h4>
        <button
          className="text-xs text-blue-600 hover:underline"
          onClick={() => setShowRelocAdjForm(!showRelocAdjForm)}
        >
          {showRelocAdjForm ? "Cancel" : "+ Add Adjustment"}
        </button>
      </div>

      {relocYearAdjustments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {relocYearAdjustments.map((adj) => {
            const adjProf = adj.profileId
              ? budgetInfo.profiles.find((p) => p.id === adj.profileId)
              : null;
            const adjLabel = adjProf
              ? `${adjProf.name}${adjProf.columnLabels.length > 1 ? ` / ${adjProf.columnLabels[adj.budgetColumn ?? 0] ?? ""}` : ""}`
              : `${formatCurrency(adj.monthlyExpenses)}/mo`;
            return (
              <div
                key={adj.id}
                className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded px-2 py-1 text-xs"
              >
                <span>
                  {adj.year}: {adjLabel}
                </span>
                {adj.notes && (
                  <span className="text-blue-400">({adj.notes})</span>
                )}
                <button
                  className="ml-1 text-blue-400 hover:text-red-600"
                  onClick={() =>
                    setRelocYearAdjustments((prev) =>
                      prev.filter((a) => a.id !== adj.id),
                    )
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showRelocAdjForm && (
        <div className="space-y-2 mb-2 text-sm">
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-muted">Year</label>
              <input
                type="number"
                className="border rounded px-2 py-1 w-20 text-sm"
                value={relocAdjForm.year}
                onChange={(e) =>
                  setRelocAdjForm((f) => ({ ...f, year: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="block text-xs text-muted">Source</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={relocAdjMode}
                onChange={(e) =>
                  setRelocAdjMode(e.target.value as "manual" | "profile")
                }
              >
                <option value="manual">Manual</option>
                <option value="profile">Budget Profile</option>
              </select>
            </div>
            {relocAdjMode === "manual" ? (
              <div>
                <label className="block text-xs text-muted">
                  Monthly Expenses
                </label>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-28 text-sm"
                  placeholder="$"
                  value={relocAdjForm.monthlyExpenses}
                  onChange={(e) =>
                    setRelocAdjForm((f) => ({
                      ...f,
                      monthlyExpenses: e.target.value,
                    }))
                  }
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-muted">Profile</label>
                  <select
                    className="border rounded px-2 py-1 text-sm"
                    value={relocAdjForm.profileId || ""}
                    onChange={(e) => {
                      setRelocAdjForm((f) => ({
                        ...f,
                        profileId: e.target.value,
                        budgetColumn: "0",
                      }));
                    }}
                  >
                    <option value="">Select…</option>
                    {budgetInfo.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {(() => {
                  const selectedProf = budgetInfo.profiles.find(
                    (p) => p.id === Number(relocAdjForm.profileId),
                  );
                  const labels = selectedProf?.columnLabels ?? [];
                  const months = selectedProf?.columnMonths ?? null;
                  const totals = selectedProf?.columnTotals ?? [];
                  if (months) {
                    return (
                      <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1 self-end">
                        Weighted:{" "}
                        {formatCurrency(
                          (selectedProf?.weightedAnnualTotal ?? 0) / 12,
                        )}
                        /mo
                      </span>
                    );
                  }
                  if (labels.length >= 2) {
                    return (
                      <div>
                        <label className="block text-xs text-muted">
                          Column
                        </label>
                        <select
                          className="border rounded px-2 py-1 text-sm"
                          value={relocAdjForm.budgetColumn}
                          onChange={(e) =>
                            setRelocAdjForm((f) => ({
                              ...f,
                              budgetColumn: e.target.value,
                            }))
                          }
                        >
                          {labels.map((label, idx) => (
                            <option key={label} value={idx}>
                              {label} ({formatCurrency(totals[idx] ?? 0)}/mo)
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  return null;
                })()}
              </>
            )}
            <div>
              <label className="block text-xs text-muted">Notes</label>
              <input
                type="text"
                className="border rounded px-2 py-1 w-32 text-sm"
                placeholder="e.g. Cut dining"
                value={relocAdjForm.notes}
                onChange={(e) =>
                  setRelocAdjForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
            <Button
              size="xs"
              onClick={() => {
                const year = parseInt(relocAdjForm.year);
                if (isNaN(year)) return;
                if (relocAdjMode === "profile") {
                  const profId = Number(relocAdjForm.profileId);
                  if (!profId) return;
                  const col = Number(relocAdjForm.budgetColumn);
                  setRelocYearAdjustments((prev) => {
                    const filtered = prev.filter((a) => a.year !== year);
                    return [
                      ...filtered,
                      {
                        id: crypto.randomUUID(),
                        year,
                        monthlyExpenses: 0,
                        profileId: profId,
                        budgetColumn: col,
                        notes: relocAdjForm.notes || undefined,
                      },
                    ].sort((a, b) => a.year - b.year);
                  });
                } else {
                  const monthly = parseFloat(relocAdjForm.monthlyExpenses);
                  if (isNaN(monthly) || monthly < 0) return;
                  setRelocYearAdjustments((prev) => {
                    const filtered = prev.filter((a) => a.year !== year);
                    return [
                      ...filtered,
                      {
                        id: crypto.randomUUID(),
                        year,
                        monthlyExpenses: monthly,
                        notes: relocAdjForm.notes || undefined,
                      },
                    ].sort((a, b) => a.year - b.year);
                  });
                }
                setRelocAdjForm({
                  year: String(year + 1),
                  monthlyExpenses: "",
                  profileId: relocAdjForm.profileId,
                  budgetColumn: relocAdjForm.budgetColumn,
                  notes: "",
                });
                setShowRelocAdjForm(false);
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
