"use client";

/**
 * Settings tab for managing the age-based expected annual return rate
 * table used by projection calculators, with inline rate editing and row
 * add/delete.
 *
 * The engine reads this as a SPARSE breakpoint table, not one rate per
 * age: `resolveReturnRateForAge` (growth-application.ts) looks up the
 * exact age, and falls back to the closest configured age at or below it
 * — so a row at age 60 with 5% applies to every age from 60 up until the
 * next configured breakpoint. The old UI just listed (age, rate) pairs
 * with no indication of that — it read like "repeat the same number for
 * every age," not a glide path. This shows each row as the age RANGE it
 * actually covers (computed from the next breakpoint), plus a proportional
 * bar visualizing the whole glide path at a glance. Same underlying CRUD
 * as before — add/edit-rate/delete a breakpoint — nothing about what can
 * be configured changed, only how it reads.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent } from "@/lib/utils/format";

/** Display-only cap for the glide-path bar and the last breakpoint's
 *  open-ended range label — the engine itself has no upper bound, a
 *  breakpoint's rate just keeps applying past this. */
const DISPLAY_AGE_CAP = 100;

/** Blue saturation scales with the rate so higher-return segments read as
 *  "bolder" on the glide-path bar — purely a display aid, not a new color
 *  semantic (this isn't a status/severity color, so STATUS_COLORS doesn't
 *  apply here). */
function barColorForRate(rate: number, minRate: number, maxRate: number) {
  if (maxRate === minRate) return "bg-blue-500";
  const t = (rate - minRate) / (maxRate - minRate);
  if (t < 0.2) return "bg-blue-300";
  if (t < 0.4) return "bg-blue-400";
  if (t < 0.6) return "bg-blue-500";
  if (t < 0.8) return "bg-blue-600";
  return "bg-blue-700";
}

export function ReturnRatesSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.retirement.returnRates.list.useQuery();
  const upsertMut = trpc.retirement.returnRates.upsert.useMutation({
    onSuccess: () => utils.retirement.returnRates.list.invalidate(),
  });
  const deleteMut = trpc.retirement.returnRates.delete.useMutation({
    onSuccess: () => utils.retirement.returnRates.list.invalidate(),
  });

  const [showAddRow, setShowAddRow] = useState(false);
  const [newAge, setNewAge] = useState("");
  const [newRate, setNewRate] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  if (isLoading) return <Skeleton className="h-6 w-48" />;

  const rows = [...(data ?? [])].sort((a, b) => a.age - b.age);

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

  // Each breakpoint's effective range runs to just before the next one
  // (or the display cap for the last, open-ended breakpoint) — this is
  // the piece the old flat table never showed.
  const ranges = rows.map((row, i) => {
    const next = rows[i + 1];
    const endAge = next ? next.age - 1 : null;
    return { ...row, rate: Number(row.rateOfReturn), endAge };
  });
  const rates = ranges.map((r) => r.rate);
  const minRate = rates.length ? Math.min(...rates) : 0;
  const maxRate = rates.length ? Math.max(...rates) : 0;
  const barStartAge = rows[0]?.age ?? 0;
  const barSpan = Math.max(1, DISPLAY_AGE_CAP - barStartAge);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Return Rate Table</h2>
        {admin && (
          <button
            onClick={() => {
              setShowAddRow(!showAddRow);
              setNewAge("");
              setNewRate("");
            }}
            className="rounded-full border border-blue-200 px-2 py-1 text-sm text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800"
          >
            + Age
          </button>
        )}
      </div>

      {/* Add row dialog */}
      {showAddRow && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-3">
            <label className="text-secondary text-sm">
              Age:
              <input
                type="number"
                value={newAge}
                onChange={(e) => setNewAge(e.target.value)}
                className="ml-2 w-20 rounded border px-2 py-1 text-sm"
                min={0}
                max={120}
              />
            </label>
            <label className="text-secondary text-sm">
              Rate (%):
              <input
                type="number"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                className="ml-2 w-24 rounded border px-2 py-1 text-sm"
                step="0.1"
              />
            </label>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAddRow}
              disabled={upsertMut.isPending}
            >
              Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAddRow(false);
                setNewAge("");
                setNewRate("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-muted text-sm">No return rates configured.</p>
      ) : (
        <>
          {/* Glide-path bar — one proportionally-sized segment per
              breakpoint, so the whole age->rate shape is visible at a
              glance instead of implied by a bare list. */}
          <div className="mb-4 overflow-hidden rounded-lg border">
            <div className="flex h-8 w-full">
              {ranges.map((r) => {
                const span = (r.endAge ?? DISPLAY_AGE_CAP) - r.age + 1;
                const widthPct = (span / barSpan) * 100;
                return (
                  <div
                    key={r.id}
                    className={`text-caption flex items-center justify-center font-medium text-white ${barColorForRate(r.rate, minRate, maxRate)}`}
                    style={{ width: `${widthPct}%` }}
                    title={`Age ${r.age}${r.endAge ? `–${r.endAge}` : "+"}: ${formatPercent(r.rate, 1)}`}
                  >
                    {widthPct > 8 ? formatPercent(r.rate, 1) : ""}
                  </div>
                );
              })}
            </div>
            <div className="text-caption text-faint bg-surface-sunken flex justify-between px-2 py-1">
              <span>Age {barStartAge}</span>
              <span>Age {DISPLAY_AGE_CAP}+</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-sunken border-b">
                  <th className="text-secondary px-4 py-2 text-left font-medium">
                    Age Range
                  </th>
                  <th className="text-secondary px-4 py-2 text-right font-medium">
                    Return Rate (%)
                  </th>
                  {admin && (
                    <th className="text-secondary w-20 px-4 py-2 text-right font-medium">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {ranges.map((row) => (
                  <tr key={row.id} className="border-subtle border-t">
                    <td className="text-primary px-4 py-1.5">
                      {row.endAge ? `${row.age}–${row.endAge}` : `${row.age}+`}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <InlineEdit
                        value={String(row.rate * 100)}
                        onSave={(v) => handleSaveRate(row.age, v)}
                        formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
                        parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                        type="number"
                        className="font-medium"
                        isEditable={admin}
                      />
                    </td>
                    {admin && (
                      <td className="px-4 py-1.5 text-right">
                        {confirmDeleteId === row.id ? (
                          <span className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleDelete(row.id)}
                              className="text-xs font-medium text-red-600 hover:text-red-800"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-muted hover:text-secondary text-xs"
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
        </>
      )}

      <p className="text-faint mt-4 text-xs">
        Each row is a breakpoint, not a fixed single-age rate — its rate applies
        to every age from there up until the next breakpoint (the Age Range
        column). Click any rate to edit. Rates are stored as decimals (e.g.,
        enter 7 for 7%).
      </p>
    </div>
  );
}
