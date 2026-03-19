"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Toggle } from "@/components/ui/toggle";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";

export function SalaryTracker({
  jobId,
  activeSalaryOverride,
  onToggleSalary,
}: {
  jobId: number;
  futureSalaryChanges?: { salary: number; effectiveDate: string }[];
  activeSalaryOverride: number | null;
  onToggleSalary: (salary: number) => void;
}) {
  const utils = trpc.useUtils();
  const { data: salaryChanges } = trpc.settings.salaryChanges.list.useQuery();
  const createChange = trpc.settings.salaryChanges.create.useMutation({
    onSuccess: () => {
      utils.settings.salaryChanges.invalidate();
      utils.paycheck.invalidate();
      setAdding(false);
    },
  });
  const deleteChange = trpc.settings.salaryChanges.delete.useMutation({
    onSuccess: () => {
      utils.settings.salaryChanges.invalidate();
      utils.paycheck.invalidate();
    },
  });
  const [adding, setAdding] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newSalary, setNewSalary] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const changes = salaryChanges?.filter((sc) => sc.jobId === jobId) ?? [];
  if (changes.length === 0 && !adding) return null;

  const now = new Date();
  const pastChanges = changes.filter((sc) => new Date(sc.effectiveDate) <= now);
  const futureChanges = changes.filter(
    (sc) => new Date(sc.effectiveDate) > now,
  );

  const handleCreate = () => {
    if (!newDate || !newSalary) return;
    const prevSalary =
      changes.length > 0 ? Number(changes[changes.length - 1]!.newSalary) : 0;
    const raise =
      prevSalary > 0 ? (Number(newSalary) - prevSalary) / prevSalary : null;
    createChange.mutate({
      jobId,
      effectiveDate: newDate,
      newSalary,
      raisePercent: raise !== null ? String(raise) : null,
      notes: newNotes || null,
    });
  };

  return (
    <details className="mt-2">
      <summary className="text-xs text-faint uppercase tracking-wide cursor-pointer hover:text-secondary">
        Salary History ({changes.length})
      </summary>
      <div className="mt-1 space-y-0.5">
        {pastChanges.map((sc) => (
          <div
            key={sc.id}
            className="group flex justify-between text-xs text-muted"
          >
            <span>{formatDate(sc.effectiveDate)}</span>
            <span className="flex items-center gap-1">
              {formatCurrency(Number(sc.newSalary))}
              {sc.raisePercent && (
                <span className="text-green-600">
                  +{formatPercent(Number(sc.raisePercent), 1)}
                </span>
              )}
              <button
                onClick={() => deleteChange.mutate({ id: sc.id })}
                className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                title="Delete"
              >
                ×
              </button>
            </span>
          </div>
        ))}
        {futureChanges.length > 0 && (
          <div className="mt-1 pt-1 border-t">
            <p className="text-[10px] text-faint uppercase mb-0.5">Upcoming</p>
            {futureChanges.map((sc) => {
              const scSalary = Number(sc.newSalary);
              const isActive = activeSalaryOverride === scSalary;
              return (
                <div
                  key={sc.id}
                  className="group flex items-center gap-2 text-xs text-blue-600 py-0.5"
                >
                  <Toggle
                    checked={isActive}
                    onChange={() => onToggleSalary(scSalary)}
                    size="sm"
                    title={
                      isActive
                        ? "Stop previewing this salary"
                        : "Preview paycheck with this salary"
                    }
                  />
                  <span className="flex-1 flex justify-between">
                    <span>{formatDate(sc.effectiveDate)}</span>
                    <span className="flex items-center gap-1">
                      {formatCurrency(scSalary)}
                      {sc.raisePercent && (
                        <span className="ml-1">
                          +{formatPercent(Number(sc.raisePercent), 1)}
                        </span>
                      )}
                      <button
                        onClick={() => deleteChange.mutate({ id: sc.id })}
                        className="text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                        title="Delete"
                      >
                        ×
                      </button>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {/* Add future salary change */}
        {adding ? (
          <div className="mt-2 pt-2 border-t space-y-1">
            <div className="grid grid-cols-3 gap-1">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="border rounded px-1.5 py-0.5 text-xs"
              />
              <input
                type="number"
                value={newSalary}
                onChange={(e) => setNewSalary(e.target.value)}
                placeholder="Salary"
                className="border rounded px-1.5 py-0.5 text-xs"
              />
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Notes"
                className="border rounded px-1.5 py-0.5 text-xs"
              />
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleCreate}
                disabled={createChange.isPending || !newDate || !newSalary}
                className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
              >
                {createChange.isPending ? "..." : "Save"}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="px-2 py-0.5 border rounded text-xs hover:bg-surface-sunken"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-1 text-[10px] text-blue-500 hover:text-blue-700"
          >
            + Add salary change
          </button>
        )}
      </div>
    </details>
  );
}
