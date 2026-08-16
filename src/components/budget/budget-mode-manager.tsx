"use client";

import { useState } from "react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { HelpTip } from "@/components/ui/help-tip";
import { confirm } from "@/components/ui/confirm-dialog";

type ContributionProfile = { id: number; name: string; isDefault: boolean };

type BudgetModeManagerProps = {
  cols: string[];
  onRenameColumn: (colIndex: number, label: string) => void;
  onRemoveColumn: (colIndex: number) => void;
  onAddColumn: (label: string) => void;
  addColumnPending: boolean;
  contributionProfiles?: ContributionProfile[];
  columnContributionProfileIds?: (number | null)[] | null;
  onUpdateContributionProfiles?: (ids: (number | null)[]) => void;
  columnMonths?: number[] | null;
  onUpdateColumnMonths?: (months: number[] | null) => void;
};

export function BudgetModeManager({
  cols,
  onRenameColumn,
  onRemoveColumn,
  onAddColumn,
  addColumnPending,
  contributionProfiles,
  columnContributionProfileIds,
  onUpdateContributionProfiles,
  columnMonths,
  onUpdateColumnMonths,
}: BudgetModeManagerProps) {
  const [newModeName, setNewModeName] = useState("");
  const [monthDrafts, setMonthDrafts] = useState<Record<number, string>>({});

  const hasContribProfiles =
    contributionProfiles && contributionProfiles.length > 0;
  const isWeighted = !!columnMonths && columnMonths.length > 0;
  const canWeight = cols.length > 1 && onUpdateColumnMonths;

  const monthValueFor = (idx: number) =>
    monthDrafts[idx] ?? String(columnMonths?.[idx] ?? 0);

  const commitMonths = (idx: number, value: string) => {
    const parsed = Number(value);
    const base =
      columnMonths && columnMonths.length === cols.length
        ? [...columnMonths]
        : cols.map(() => 0);
    base[idx] = isNaN(parsed) ? 0 : Math.max(0, parsed);
    onUpdateColumnMonths?.(base);
    setMonthDrafts((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const monthsSum =
    columnMonths?.reduce((s, m, i) => {
      const draft = monthDrafts[i];
      return s + (draft !== undefined ? Number(draft) || 0 : m);
    }, 0) ?? 0;

  return (
    <div className="mb-4 p-3 bg-surface-sunken border rounded-lg">
      <h3 className="text-sm font-semibold text-secondary mb-2">
        Budget Modes
        <HelpTip text="Each mode is a separate set of budget amounts. Use modes to compare scenarios like 'Lean' vs 'Comfortable' spending." />
      </h3>
      <div className="space-y-2">
        {cols.map((label, idx) => {
          const currentProfileId = columnContributionProfileIds?.[idx] ?? null;
          return (
            <div key={label} className="flex items-center gap-2">
              <InlineEdit
                value={label}
                onSave={(newLabel) => {
                  if (newLabel !== label) onRenameColumn(idx, newLabel);
                }}
                formatDisplay={(v) => v}
                parseInput={(v) => v.trim()}
                type="text"
                className="text-sm font-medium"
              />
              {hasContribProfiles && onUpdateContributionProfiles && (
                <select
                  value={currentProfileId ?? ""}
                  onChange={(e) => {
                    const next = [
                      ...(columnContributionProfileIds ?? cols.map(() => null)),
                    ];
                    next[idx] = e.target.value ? Number(e.target.value) : null;
                    onUpdateContributionProfiles(next);
                  }}
                  className="text-caption border rounded px-1.5 py-0.5 bg-surface-primary text-muted focus:border-blue-400 focus:outline-none"
                  title="Contribution profile for this mode's income calculations"
                >
                  <option value="">
                    {contributionProfiles.find((p) => p.isDefault)?.name ??
                      "Default"}
                  </option>
                  {contributionProfiles
                    .filter((p) => !p.isDefault)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              )}
              {isWeighted && canWeight && (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={monthValueFor(idx)}
                    onChange={(e) =>
                      setMonthDrafts((prev) => ({
                        ...prev,
                        [idx]: e.target.value,
                      }))
                    }
                    onBlur={(e) => commitMonths(idx, e.target.value)}
                    className="w-14 text-caption border rounded px-1.5 py-0.5 bg-surface-primary text-muted focus:border-blue-400 focus:outline-none"
                    title="Months per year this mode applies — must sum to 12 across all modes"
                  />
                  <span className="text-caption text-faint">mo</span>
                </div>
              )}
              {cols.length > 1 && (
                <button
                  onClick={async () => {
                    if (
                      await confirm(
                        `Remove "${label}" mode? All amounts in this column will be deleted.`,
                      )
                    ) {
                      onRemoveColumn(idx);
                    }
                  }}
                  className="text-red-400 hover:text-red-600 text-xs"
                  title="Remove mode"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      {canWeight && (
        <div className="flex items-center gap-2 mt-3 text-caption">
          <label className="flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              checked={isWeighted}
              onChange={(e) => {
                if (e.target.checked) {
                  // Start from an even split across modes, rounded so the
                  // sum is exactly 12 (last mode absorbs the remainder).
                  const even = Math.floor(12 / cols.length);
                  const months = cols.map((_, i) =>
                    i === cols.length - 1
                      ? 12 - even * (cols.length - 1)
                      : even,
                  );
                  onUpdateColumnMonths?.(months);
                } else {
                  onUpdateColumnMonths?.(null);
                }
              }}
            />
            Weight modes by months/year (e.g. 1mo Traveling + 11mo At Home)
            <HelpTip text="When on, the annual total blends each mode's monthly amount by how many months of the year it applies — instead of just annualizing whichever mode you're viewing (×12)." />
          </label>
          {isWeighted && (
            <span
              className={
                monthsSum === 12
                  ? "text-emerald-600"
                  : "text-red-600 font-medium"
              }
            >
              {monthsSum}/12 months
              {monthsSum !== 12 && " — must sum to 12"}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <input
          type="text"
          value={newModeName}
          onChange={(e) => setNewModeName(e.target.value)}
          placeholder="New mode name..."
          className="border rounded px-2 py-1 text-sm flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newModeName.trim()) {
              onAddColumn(newModeName.trim());
              setNewModeName("");
            }
          }}
        />
        <button
          onClick={() => {
            if (newModeName.trim()) {
              onAddColumn(newModeName.trim());
              setNewModeName("");
            }
          }}
          disabled={!newModeName.trim() || addColumnPending}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <p className="text-caption text-faint mt-2">
        Click a mode name to rename it. Each mode is a column of budget amounts.
        {hasContribProfiles &&
          " Use the dropdown to assign a contribution profile for income calculations per mode."}
      </p>
    </div>
  );
}
