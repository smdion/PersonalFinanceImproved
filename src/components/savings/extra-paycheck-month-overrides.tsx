import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import type { ExtraPaycheckOverride } from "@/lib/db/schema-pg";
import { fmt } from "./extra-paycheck-growth";

export function MonthOverrideActions({
  saveOverride,
  overrideMonth,
  overrideSplitTotal,
  saveOverrideMutation,
  overrideForm,
  setOverrideMonth,
  setOverrideForm,
  setIsNewOverride,
}: {
  saveOverride: () => void;
  overrideMonth: string;
  overrideSplitTotal: number;
  saveOverrideMutation: {
    isPending: boolean;
    error: { message: string } | null;
  };
  overrideForm: { goalId: number; pct: string }[];
  setOverrideMonth: Dispatch<SetStateAction<string | null>>;
  setOverrideForm: Dispatch<
    SetStateAction<{ goalId: number; pct: string }[] | null>
  >;
  setIsNewOverride: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <>
      <div className="flex gap-2 pt-1">
        <Button
          variant="primary"
          size="sm"
          onClick={saveOverride}
          disabled={
            !overrideMonth.match(/^\d{4}-\d{2}$/) ||
            Math.abs(overrideSplitTotal - 100) >= 0.01 ||
            saveOverrideMutation.isPending ||
            !overrideForm.every((s) => s.goalId > 0)
          }
        >
          {saveOverrideMutation.isPending ? "Saving…" : "Save month"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOverrideMonth(null);
            setOverrideForm(null);
            setIsNewOverride(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {saveOverrideMutation.error && (
        <p className="text-xs text-red-600">
          {saveOverrideMutation.error.message}
        </p>
      )}
    </>
  );
}

export function MonthOverrideFields({
  isNewOverride,
  overrideMonth,
  setOverrideMonth,
  extraPaycheckMonthOptions,
  overrides,
  overrideForm,
  goals,
  setOverrideForm,
  overrideSplitTotal,
}: {
  isNewOverride: boolean;
  overrideMonth: string;
  setOverrideMonth: Dispatch<SetStateAction<string | null>>;
  extraPaycheckMonthOptions: string[];
  overrides: ExtraPaycheckOverride[];
  overrideForm: { goalId: number; pct: string }[];
  goals: { id: number; name: string }[];
  setOverrideForm: Dispatch<
    SetStateAction<{ goalId: number; pct: string }[] | null>
  >;
  overrideSplitTotal: number;
}) {
  return (
    <>
      {isNewOverride ? (
        <label className="block space-y-0.5">
          <span className="text-caption text-muted">Month</span>
          <select
            value={overrideMonth}
            onChange={(e) => setOverrideMonth(e.target.value)}
            className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">— pick a month —</option>
            {extraPaycheckMonthOptions.map((mk) => {
              const hasOverride = overrides.some((o) => o.month === mk);
              return (
                <option key={mk} value={mk}>
                  {fmt(mk)}
                  {hasOverride ? " ↺" : ""}
                </option>
              );
            })}
          </select>
        </label>
      ) : (
        <p className="text-primary font-medium">
          Override — {fmt(overrideMonth!)}
        </p>
      )}
      <div className="space-y-1">
        <span className="text-caption text-muted">
          Fund splits (must total 100%)
        </span>
        {overrideForm.map((sp, si) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={si} className="flex items-center gap-2">
            <select
              value={sp.goalId}
              onChange={(e) => {
                const next = overrideForm.map((s, i) =>
                  i === si ? { ...s, goalId: Number(e.target.value) } : s,
                );
                setOverrideForm(next);
              }}
              className="border-default bg-surface-primary text-primary flex-1 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            >
              <option value={0}>— choose fund —</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={sp.pct}
              onChange={(e) => {
                const next = overrideForm.map((s, i) =>
                  i === si ? { ...s, pct: e.target.value } : s,
                );
                setOverrideForm(next);
              }}
              className="border-default bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <span className="text-caption text-muted">%</span>
            {overrideForm.length > 1 && (
              <button
                onClick={() =>
                  setOverrideForm(overrideForm.filter((_, i) => i !== si))
                }
                className="text-faint text-xs transition-colors hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            onClick={() =>
              setOverrideForm([...overrideForm, { goalId: 0, pct: "0" }])
            }
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            + add fund
          </button>
          <span
            className={`text-caption tabular-nums ${
              Math.abs(overrideSplitTotal - 100) < 0.01
                ? "text-green-600"
                : "text-red-500"
            }`}
          >
            Total: {overrideSplitTotal.toFixed(0)}%
          </span>
        </div>
      </div>
    </>
  );
}

export function MonthOverrideList({
  overrideMonth,
  extraPaycheckMonthOptions,
  openAddOverride,
  overrides,
  goals,
  openOverride,
  deleteOverride,
  saveOverrideMutation,
}: {
  overrideMonth: string | null;
  extraPaycheckMonthOptions: string[];
  openAddOverride: () => void;
  overrides: ExtraPaycheckOverride[];
  goals: { id: number; name: string }[];
  openOverride: (mk: string) => void;
  deleteOverride: (mk: string) => void;
  saveOverrideMutation: { isPending: boolean };
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-caption text-faint font-medium tracking-wide uppercase">
          Specific months
        </span>
        {overrideMonth === null && extraPaycheckMonthOptions.length > 0 && (
          <button
            onClick={openAddOverride}
            className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 transition-colors"
          >
            + Add a month
          </button>
        )}
      </div>
      {overrides.length > 0 && overrideMonth === null && (
        <div className="space-y-1.5">
          {overrides.map((o) => (
            <div key={o.month} className="flex items-center gap-2 text-xs">
              <span className="text-faint w-16 shrink-0 tabular-nums">
                {fmt(o.month)}
              </span>
              <span className="text-muted flex-1">
                {o.splits
                  .map((s) => {
                    const g = goals.find((g) => g.id === s.goalId);
                    return `${g?.name ?? `#${s.goalId}`} ${s.pct}%`;
                  })
                  .join(", ")}
              </span>
              <button
                onClick={() => openOverride(o.month)}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                Edit
              </button>
              <button
                onClick={() => deleteOverride(o.month)}
                disabled={saveOverrideMutation.isPending}
                className="text-faint text-xs transition-colors hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {overrides.length === 0 && overrideMonth === null && (
        <p className="text-caption text-faint/50">None set.</p>
      )}
    </>
  );
}
