"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { confirm } from "@/components/ui/confirm-dialog";
import type { WhatIfResultRow, WhatIfScenarioRow, TrpcUtils } from "./types";

export function WhatIfSection({
  whatIfResults,
  whatIfScenarios,
  utils,
}: {
  whatIfResults: WhatIfResultRow[];
  whatIfScenarios: WhatIfScenarioRow[];
  utils: TrpcUtils;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [oneTimeAmount, setOneTimeAmount] = useState("");

  const createMut = trpc.settings.mortgageWhatIfScenarios.create.useMutation({
    onSuccess: () => {
      utils.mortgage.getActiveSummary.invalidate();
      setAdding(false);
      resetForm();
    },
  });

  const updateMut = trpc.settings.mortgageWhatIfScenarios.update.useMutation({
    onSuccess: () => {
      utils.mortgage.getActiveSummary.invalidate();
      setEditingId(null);
      resetForm();
    },
  });

  const deleteMut = trpc.settings.mortgageWhatIfScenarios.delete.useMutation({
    onSuccess: () => utils.mortgage.getActiveSummary.invalidate(),
  });

  const reorderMut = trpc.settings.mortgageWhatIfScenarios.update.useMutation({
    onSuccess: () => utils.mortgage.getActiveSummary.invalidate(),
  });

  function resetForm() {
    setLabel("");
    setAmount("");
    setOneTimeAmount("");
  }

  function startEdit(s: WhatIfScenarioRow) {
    setEditingId(s.id);
    setLabel(s.label);
    setAmount(s.extraMonthlyPrincipal);
    setOneTimeAmount(
      s.extraOneTimePayment !== "0" ? s.extraOneTimePayment : "",
    );
    setAdding(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setAdding(false);
    resetForm();
  }

  function handleSwap(indexA: number, indexB: number) {
    const a = whatIfScenarios[indexA];
    const b = whatIfScenarios[indexB];
    if (!a || !b) return;
    // Swap sortOrder values
    reorderMut.mutate({
      id: a.id,
      label: a.label,
      extraMonthlyPrincipal: a.extraMonthlyPrincipal,
      extraOneTimePayment: a.extraOneTimePayment,
      sortOrder: b.sortOrder,
    });
    reorderMut.mutate({
      id: b.id,
      label: b.label,
      extraMonthlyPrincipal: b.extraMonthlyPrincipal,
      extraOneTimePayment: b.extraOneTimePayment,
      sortOrder: a.sortOrder,
    });
  }

  function handleSave() {
    if (!label.trim() || !amount.trim()) return;
    if (editingId !== null) {
      const existing = whatIfScenarios.find((s) => s.id === editingId);
      updateMut.mutate({
        id: editingId,
        label: label.trim(),
        extraMonthlyPrincipal: amount.trim(),
        extraOneTimePayment: oneTimeAmount.trim() || "0",
        sortOrder: existing?.sortOrder ?? 0,
      });
    } else {
      const maxSort = whatIfScenarios.reduce(
        (m, s) => Math.max(m, s.sortOrder),
        0,
      );
      createMut.mutate({
        label: label.trim(),
        extraMonthlyPrincipal: amount.trim(),
        extraOneTimePayment: oneTimeAmount.trim() || "0",
        sortOrder: maxSort + 1,
      });
    }
  }

  return (
    <Card
      title={
        <>
          What-If Scenarios
          <HelpTip text="See how extra monthly or one-time payments would change your payoff date and total interest" />
        </>
      }
      className="mb-6"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-4 text-muted font-medium">
                Scenario
              </th>
              <th className="text-right py-2 px-4 text-muted font-medium">
                Payoff Date
              </th>
              <th className="text-right py-2 px-4 text-muted font-medium">
                Total Interest
              </th>
              <th className="text-right py-2 px-4 text-muted font-medium">
                Interest Saved
              </th>
              <th className="text-right py-2 px-4 text-muted font-medium">
                Months Saved
              </th>
              <th className="text-center py-2 px-2 text-muted font-medium w-16">
                Order
              </th>
              <th className="text-right py-2 pl-4 text-muted font-medium w-20" />
            </tr>
          </thead>
          <tbody>
            {whatIfResults.map((s) => {
              const scenarioRow = s.scenarioId
                ? whatIfScenarios.find((sc) => sc.id === s.scenarioId)
                : whatIfScenarios.find((sc) => s.label.endsWith(sc.label));
              return (
                <tr key={s.label} className="border-b border-subtle">
                  <td className="py-2 pr-4 font-medium">{s.label}</td>
                  <td className="text-right py-2 px-4">
                    {formatDate(s.payoffDate, "short")}
                  </td>
                  <td className="text-right py-2 px-4">
                    {formatCurrency(s.totalInterest)}
                  </td>
                  <td className="text-right py-2 px-4 text-green-700">
                    {formatCurrency(s.interestSaved)}
                  </td>
                  <td className="text-right py-2 px-4 text-green-700">
                    {formatNumber(s.monthsSaved)}
                  </td>
                  <td className="text-center py-2 px-2">
                    {scenarioRow &&
                      (() => {
                        const idx = whatIfScenarios.findIndex(
                          (sc) => sc.id === scenarioRow.id,
                        );
                        return (
                          <div className="flex gap-0.5 justify-center">
                            <button
                              onClick={() => handleSwap(idx, idx - 1)}
                              disabled={idx <= 0 || reorderMut.isPending}
                              className="text-xs text-muted hover:text-secondary disabled:opacity-30 disabled:cursor-not-allowed px-1"
                              title="Move up"
                            >
                              &#9650;
                            </button>
                            <button
                              onClick={() => handleSwap(idx, idx + 1)}
                              disabled={
                                idx >= whatIfScenarios.length - 1 ||
                                reorderMut.isPending
                              }
                              className="text-xs text-muted hover:text-secondary disabled:opacity-30 disabled:cursor-not-allowed px-1"
                              title="Move down"
                            >
                              &#9660;
                            </button>
                          </div>
                        );
                      })()}
                  </td>
                  <td className="text-right py-2 pl-4">
                    {scenarioRow && (
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => startEdit(scenarioRow)}
                          className="text-xs text-blue-600 hover:text-blue-800"
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          onClick={async () => {
                            if (
                              await confirm(
                                `Delete scenario "${scenarioRow.label}"?`,
                              )
                            ) {
                              deleteMut.mutate({ id: scenarioRow.id });
                            }
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                          title="Delete"
                        >
                          Del
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Inline add / edit form */}
            {(adding || editingId !== null) && (
              <tr className="border-b border-subtle bg-surface-sunken">
                <td className="py-2 pr-4" colSpan={3}>
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Label (e.g. +$200/mo)"
                      className="border rounded px-2 py-1 text-sm w-36"
                    />
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="Extra $/mo"
                      className="border rounded px-2 py-1 text-sm w-28"
                      step="50"
                      min="0"
                    />
                    <input
                      type="number"
                      value={oneTimeAmount}
                      onChange={(e) => setOneTimeAmount(e.target.value)}
                      placeholder="One-time $ (optional)"
                      className="border rounded px-2 py-1 text-sm w-36"
                      step="1000"
                      min="0"
                    />
                  </div>
                </td>
                <td colSpan={3} />
                <td className="text-right py-2 pl-4">
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={handleSave}
                      disabled={createMut.isPending || updateMut.isPending}
                      className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {editingId !== null ? "Save" : "Add"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="text-xs text-muted hover:text-secondary px-2 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!adding && editingId === null && (
        <button
          onClick={() => {
            setAdding(true);
            resetForm();
          }}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          + Add scenario
        </button>
      )}

      {whatIfResults.length === 0 && !adding && (
        <p className="text-sm text-faint mt-2">
          No scenarios configured. Add one above.
        </p>
      )}
    </Card>
  );
}
