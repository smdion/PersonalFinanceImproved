import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/format";
import type {
  ExtraPaycheckRoutingData,
  ExtraPaycheckRule,
} from "@/lib/db/schema-pg";
import {
  fmt,
  projectedNetPay,
  SimpleGrowthEditor,
  type YearlyGrowth,
} from "./extra-paycheck-growth";

export function RuleFormActions({
  saveForm,
  formValid,
  saveMutation,
  editingIndex,
  cancelEdit,
  cancelAdd,
}: {
  saveForm: () => void;
  formValid: unknown;
  saveMutation: { isPending: boolean; error: { message: string } | null };
  editingIndex: number | null;
  cancelEdit: () => void;
  cancelAdd: () => void;
}) {
  return (
    <>
      <p className="text-caption text-muted">
        Net pay per check is calculated from the paycheck page and projected
        using the growth rates above.
      </p>

      <div className="flex gap-2 pt-1">
        <Button
          variant="primary"
          size="sm"
          onClick={saveForm}
          disabled={!formValid || saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : "Save rule"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={editingIndex !== null ? cancelEdit : cancelAdd}
        >
          Cancel
        </Button>
      </div>

      {saveMutation.error && (
        <p className="text-xs text-red-600">{saveMutation.error.message}</p>
      )}
    </>
  );
}

export function RuleFormFields({
  editingIndex,
  addForm,
  setFormField,
  setSplitGoal,
  goals,
  setSplitPercent,
  removeSplit,
  addSplit,
  splitTotal,
}: {
  editingIndex: number | null;
  addForm: {
    from: string;
    to: string;
    splits: { goalId: number; pct: string }[];
  };
  setFormField: (key: "from" | "to", val: string) => void;
  setSplitGoal: (si: number, goalId: number) => void;
  goals: { id: number; name: string }[];
  setSplitPercent: (si: number, pct: string) => void;
  removeSplit: (si: number) => void;
  addSplit: () => void;
  splitTotal: number;
}) {
  return (
    <>
      <p className="text-primary text-xs font-medium">
        {editingIndex !== null ? "Edit rule" : "New rule"}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-0.5">
          <span className="text-caption text-muted">From</span>
          <input
            type="month"
            value={addForm.from}
            onChange={(e) => setFormField("from", e.target.value)}
            className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-caption text-muted">
            To (blank = open-ended)
          </span>
          <input
            type="month"
            value={addForm.to}
            onChange={(e) => setFormField("to", e.target.value)}
            className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-caption text-muted">
          Fund splits (must total 100%)
        </span>
        {addForm.splits.map((sp, si) => (
          // eslint-disable-next-line react/no-array-index-key -- splits are order-dependent form state with no stable ID
          <div key={si} className="flex items-center gap-2">
            <select
              value={sp.goalId}
              onChange={(e) => setSplitGoal(si, Number(e.target.value))}
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
              onChange={(e) => setSplitPercent(si, e.target.value)}
              className="border-default bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <span className="text-caption text-muted">%</span>
            {addForm.splits.length > 1 && (
              <button
                onClick={() => removeSplit(si)}
                className="text-faint text-xs transition-colors hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button
            onClick={addSplit}
            className="text-xs text-blue-600 hover:text-blue-700"
          >
            + add fund
          </button>
          <span
            className={`text-caption tabular-nums ${
              Math.abs(splitTotal - 100) < 0.01
                ? "text-green-600"
                : "text-red-500"
            }`}
          >
            Total: {splitTotal.toFixed(0)}%
          </span>
        </div>
      </div>
    </>
  );
}

export function RuleTable({
  rules,
  baseNetPayDisplay,
  baseYearDisplay,
  yearlyGrowth,
  goals,
  openEdit,
  deleteRule,
}: {
  rules: ExtraPaycheckRule[];
  baseNetPayDisplay: number;
  baseYearDisplay: number;
  yearlyGrowth: YearlyGrowth;
  goals: { id: number; name: string }[];
  openEdit: (index: number) => void;
  deleteRule: (index: number) => void;
}) {
  return (
    <>
      {/* Rule list */}
      {rules.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-subtle text-faint border-b">
              <th className="py-1 pr-2 text-left font-medium">From</th>
              <th className="py-1 pr-2 text-left font-medium">To</th>
              <th className="py-1 pr-2 text-left font-medium">Routing</th>
              <th className="py-1 pr-2 text-left font-medium">Net / check</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, index) => {
              const ruleYear = parseInt(rule.from.slice(0, 4));
              const netPerCheck = projectedNetPay(
                baseNetPayDisplay,
                ruleYear,
                baseYearDisplay,
                yearlyGrowth,
              );
              return (
                <tr
                  key={`${rule.from}-${rule.to ?? "open"}`}
                  className="border-subtle/50 border-b"
                >
                  <td className="py-1 pr-2 tabular-nums">{fmt(rule.from)}</td>
                  <td className="text-muted py-1 pr-2 tabular-nums">
                    {rule.to ? fmt(rule.to) : "∞"}
                  </td>
                  <td className="py-1 pr-2">
                    {rule.splits.map((s) => {
                      const g = goals.find((g) => g.id === s.goalId);
                      return (
                        <span key={s.goalId} className="mr-1.5">
                          {g?.name ?? `#${s.goalId}`}{" "}
                          <span className="text-faint">{s.pct}%</span>
                        </span>
                      );
                    })}
                  </td>
                  <td className="text-muted py-1 pr-2 tabular-nums">
                    {formatCurrency(netPerCheck)}
                  </td>
                  <td className="py-1 text-right">
                    <button
                      onClick={() => openEdit(index)}
                      className="mr-2 text-xs text-blue-600 hover:text-blue-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteRule(index)}
                      className="text-faint text-xs transition-colors hover:text-red-600"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

export function GrowthSettings({
  projectionYears,
  netPayPerCheck,
  baseNetPayDisplay,
  baseYearDisplay,
  yearlyGrowth,
  setYearlyGrowth,
  routing,
  saveGrowthMutation,
  job,
}: {
  projectionYears: number;
  netPayPerCheck: number;
  baseNetPayDisplay: number;
  baseYearDisplay: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: Dispatch<SetStateAction<YearlyGrowth>>;
  routing: ExtraPaycheckRoutingData | null;
  saveGrowthMutation: {
    mutate: (input: { jobId: number; yearlyGrowth: YearlyGrowth }) => void;
    isPending: boolean;
  };
  job: { id: number };
}) {
  return (
    <>
      {/* Growth editor — per-person, persisted */}
      {projectionYears > 0 && netPayPerCheck > 0 && (
        <div className="border-subtle bg-surface-sunken/30 space-y-2.5 rounded border p-3">
          <SimpleGrowthEditor
            projectionYears={projectionYears}
            baseNetPay={baseNetPayDisplay}
            baseYear={baseYearDisplay}
            yearlyGrowth={yearlyGrowth}
            setYearlyGrowth={setYearlyGrowth}
          />
          <div className="border-subtle/50 flex flex-wrap items-center gap-3 border-t pt-2">
            <span className="text-caption text-faint">
              Base {formatCurrency(baseNetPayDisplay)}/check
              {routing?.baseYear
                ? ` · saved ${routing.baseYear}`
                : " · not yet saved"}
            </span>
            <Button
              variant="secondary"
              size="xs"
              onClick={() =>
                saveGrowthMutation.mutate({
                  jobId: job.id,
                  yearlyGrowth,
                })
              }
              disabled={saveGrowthMutation.isPending}
            >
              {saveGrowthMutation.isPending
                ? "Applying…"
                : "Apply growth rates"}
            </Button>
            <span className="text-caption text-faint/60">
              Re-apply after salary changes
            </span>
          </div>
        </div>
      )}
    </>
  );
}

export function RoutingDestination({
  rules,
  setEnabledMutation,
  job,
  openAdd,
  budgetMode,
}: {
  rules: ExtraPaycheckRule[];
  setEnabledMutation: {
    mutate: (input: { jobId: number; enabled: boolean }) => void;
    isPending: boolean;
  };
  job: { id: number };
  openAdd: () => void;
  budgetMode: boolean;
}) {
  return (
    <>
      <span className="text-caption text-muted">Extra paycheck goes to:</span>
      <div className="border-default text-caption inline-flex overflow-hidden rounded border">
        <button
          onClick={() =>
            rules.length > 0
              ? setEnabledMutation.mutate({ jobId: job.id, enabled: true })
              : openAdd()
          }
          className={`px-2 py-1 ${
            !budgetMode
              ? "bg-blue-600 text-white"
              : "bg-surface-primary text-muted hover:text-primary"
          }`}
        >
          Savings
        </button>
        <button
          onClick={() =>
            rules.length > 0 &&
            setEnabledMutation.mutate({ jobId: job.id, enabled: false })
          }
          className={`px-2 py-1 ${
            budgetMode
              ? "bg-blue-600 text-white"
              : "bg-surface-primary text-muted hover:text-primary"
          }`}
        >
          Budget
        </button>
      </div>
      {setEnabledMutation.isPending && (
        <span className="text-caption text-faint">Saving…</span>
      )}
    </>
  );
}
