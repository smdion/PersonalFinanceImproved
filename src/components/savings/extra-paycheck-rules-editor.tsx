"use client";

/**
 * ExtraPaycheckRulesEditor
 *
 * Per-person panel for authoring extra-paycheck routing rules.
 * Shows upcoming extra-paycheck months, the current rule list, and
 * an inline add/edit form. Saves via savings.extraPaycheckRouting.save.
 */

import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { getExtraPaycheckMonthKeys } from "@/lib/calculators/paycheck";
import type { ExtraPaycheckRule } from "@/lib/db/schema-pg";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function fmt(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_LABELS[parseInt(m!) - 1]} ${y}`;
}

type Goal = { id: number; name: string };

type JobEntry = {
  id: number;
  personId: number;
  personName: string;
  employerName: string;
  payPeriod: string;
  anchorPayDate: string | null;
  extraPaycheckRouting: ExtraPaycheckRule[] | null;
};

type RuleForm = {
  from: string;
  to: string; // empty = open-ended
  splits: { goalId: number; pct: string }[];
  netPaySnapshot: string;
};

function emptyForm(netPay: number): RuleForm {
  return {
    from: "",
    to: "",
    splits: [{ goalId: 0, pct: "100" }],
    netPaySnapshot: String(Math.round(netPay)),
  };
}

function PersonPanel({
  job,
  goals,
  netPayPerCheck,
  onSaved,
}: {
  job: JobEntry;
  goals: Goal[];
  netPayPerCheck: number;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const saveMutation = trpc.savings.extraPaycheckRouting.save.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      onSaved();
    },
  });

  const now = new Date();
  const upcomingMonths = useMemo(() => {
    if (!job.anchorPayDate || job.payPeriod !== "biweekly") return [];
    return getExtraPaycheckMonthKeys(
      new Date(job.anchorPayDate + "T00:00:00Z"),
      job.payPeriod,
      now,
      24,
    ).map((d) => d.slice(0, 7)); // "YYYY-MM-01" → "YYYY-MM"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.anchorPayDate, job.payPeriod]);

  const rules: ExtraPaycheckRule[] = job.extraPaycheckRouting ?? [];

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<RuleForm | null>(null);

  function openAdd() {
    setAddForm(emptyForm(netPayPerCheck));
    setEditingIdx(null);
  }

  function cancelAdd() {
    setAddForm(null);
  }

  function openEdit(idx: number) {
    const r = rules[idx]!;
    setEditingIdx(idx);
    setAddForm({
      from: r.from,
      to: r.to ?? "",
      splits: r.splits.map((s) => ({ goalId: s.goalId, pct: String(s.pct) })),
      netPaySnapshot: String(r.netPaySnapshot),
    });
  }

  function cancelEdit() {
    setEditingIdx(null);
    setAddForm(null);
  }

  function saveForm() {
    if (!addForm) return;
    const splits = addForm.splits
      .filter((s) => s.goalId > 0 && Number(s.pct) > 0)
      .map((s) => ({ goalId: s.goalId, pct: Number(s.pct) }));
    const newRule: ExtraPaycheckRule = {
      from: addForm.from,
      to: addForm.to.trim() || null,
      splits,
      netPaySnapshot: Number(addForm.netPaySnapshot),
    };

    let updated: ExtraPaycheckRule[];
    if (editingIdx !== null) {
      updated = rules.map((r, i) => (i === editingIdx ? newRule : r));
    } else {
      updated = [...rules, newRule].sort((a, b) =>
        a.from.localeCompare(b.from),
      );
    }

    saveMutation.mutate({ jobId: job.id, rules: updated });
    setAddForm(null);
    setEditingIdx(null);
  }

  function deleteRule(idx: number) {
    const updated = rules.filter((_, i) => i !== idx);
    saveMutation.mutate({ jobId: job.id, rules: updated });
  }

  function setFormField<K extends keyof RuleForm>(key: K, val: RuleForm[K]) {
    setAddForm((f) => (f ? { ...f, [key]: val } : f));
  }

  function setSplitGoal(si: number, goalId: number) {
    if (!addForm) return;
    const splits = addForm.splits.map((s, i) =>
      i === si ? { ...s, goalId } : s,
    );
    setAddForm({ ...addForm, splits });
  }

  function setSplitPct(si: number, pct: string) {
    if (!addForm) return;
    const splits = addForm.splits.map((s, i) => (i === si ? { ...s, pct } : s));
    setAddForm({ ...addForm, splits });
  }

  function addSplit() {
    if (!addForm) return;
    setAddForm({
      ...addForm,
      splits: [...addForm.splits, { goalId: 0, pct: "0" }],
    });
  }

  function removeSplit(si: number) {
    if (!addForm) return;
    setAddForm({
      ...addForm,
      splits: addForm.splits.filter((_, i) => i !== si),
    });
  }

  const splitTotal = addForm
    ? addForm.splits.reduce((s, sp) => s + Number(sp.pct), 0)
    : 0;
  const formValid =
    addForm &&
    addForm.from.match(/^\d{4}-\d{2}$/) &&
    addForm.splits.every((s) => s.goalId > 0) &&
    Math.abs(splitTotal - 100) < 0.01 &&
    Number(addForm.netPaySnapshot) > 0;

  // Which upcoming months have no rule
  const uncoveredMonths = upcomingMonths.filter((mk) => {
    const rule = rules.find(
      (r) => mk >= r.from && (r.to === null || mk <= r.to),
    );
    return !rule;
  });

  if (job.payPeriod !== "biweekly") {
    return (
      <div className="text-xs text-muted py-2">
        Extra paycheck routing only applies to biweekly pay schedules.
      </div>
    );
  }
  if (!job.anchorPayDate) {
    return (
      <div className="text-xs text-amber-600 py-2">
        Set an anchor pay date on this job to enable extra paycheck routing.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Upcoming extra paycheck months */}
      {upcomingMonths.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-muted font-medium">
            Next 2 yr extra checks:
          </span>
          {upcomingMonths.map((mk) => {
            const covered = rules.some(
              (r) => mk >= r.from && (r.to === null || mk <= r.to),
            );
            return (
              <span
                key={mk}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  covered
                    ? "bg-green-50 border-green-200 text-green-700"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                }`}
              >
                {fmt(mk)}
                {!covered && " ⚠"}
              </span>
            );
          })}
        </div>
      )}

      {uncoveredMonths.length > 0 && (
        <p className="text-[10px] text-amber-600">
          {uncoveredMonths.length} upcoming extra check month
          {uncoveredMonths.length !== 1 ? "s" : ""}{" "}
          {uncoveredMonths.length !== 1 ? "have" : "has"} no rule — the funds
          will be unassigned.
        </p>
      )}

      {/* Rule list */}
      {rules.length > 0 && (
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-subtle text-faint">
              <th className="text-left py-1 pr-2 font-medium">From</th>
              <th className="text-left py-1 pr-2 font-medium">To</th>
              <th className="text-left py-1 pr-2 font-medium">Routing</th>
              <th className="text-left py-1 pr-2 font-medium">Net / check</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, idx) => (
              <tr
                key={`${rule.from}-${rule.to ?? "open"}`}
                className="border-b border-subtle/50"
              >
                <td className="py-1 pr-2 tabular-nums">{fmt(rule.from)}</td>
                <td className="py-1 pr-2 tabular-nums text-muted">
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
                <td className="py-1 pr-2 tabular-nums text-muted">
                  {formatCurrency(rule.netPaySnapshot)}
                </td>
                <td className="py-1 text-right">
                  <button
                    onClick={() => openEdit(idx)}
                    className="text-blue-600 hover:text-blue-800 mr-2 text-[10px]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteRule(idx)}
                    className="text-red-400 hover:text-red-600 text-[10px]"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rules.length === 0 && !addForm && (
        <p className="text-xs text-muted">No routing rules yet.</p>
      )}

      {/* Add/edit form */}
      {addForm && (
        <div className="border border-subtle rounded-md p-3 space-y-3 bg-surface-sunken/50">
          <p className="text-xs font-medium text-primary">
            {editingIdx !== null ? "Edit rule" : "New rule"}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted">From (YYYY-MM)</span>
              <input
                type="text"
                placeholder="2026-06"
                value={addForm.from}
                onChange={(e) => setFormField("from", e.target.value)}
                className="w-full border rounded px-2 py-1 text-xs bg-surface-primary"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted">
                To (YYYY-MM, blank = open)
              </span>
              <input
                type="text"
                placeholder="open-ended"
                value={addForm.to}
                onChange={(e) => setFormField("to", e.target.value)}
                className="w-full border rounded px-2 py-1 text-xs bg-surface-primary"
              />
            </label>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] text-muted">
              Fund splits (must total 100%)
            </span>
            {addForm.splits.map((sp, si) => (
              // eslint-disable-next-line react/no-array-index-key -- splits are order-dependent form state with no stable ID
              <div key={si} className="flex gap-2 items-center">
                <select
                  value={sp.goalId}
                  onChange={(e) => setSplitGoal(si, Number(e.target.value))}
                  className="flex-1 border rounded px-2 py-1 text-xs bg-surface-primary"
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
                  onChange={(e) => setSplitPct(si, e.target.value)}
                  className="w-16 border rounded px-2 py-1 text-xs bg-surface-primary tabular-nums"
                />
                <span className="text-[10px] text-muted">%</span>
                {addForm.splits.length > 1 && (
                  <button
                    onClick={() => removeSplit(si)}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button
                onClick={addSplit}
                className="text-[10px] text-blue-600 hover:text-blue-800"
              >
                + add fund
              </button>
              <span
                className={`text-[10px] tabular-nums ${
                  Math.abs(splitTotal - 100) < 0.01
                    ? "text-green-600"
                    : "text-red-500"
                }`}
              >
                Total: {splitTotal.toFixed(0)}%
              </span>
            </div>
          </div>

          <label className="space-y-0.5 block">
            <span className="text-[10px] text-muted">
              Net pay / check ($) — your current take-home is{" "}
              <span className="font-medium">
                {formatCurrency(netPayPerCheck)}
              </span>
            </span>
            <input
              type="number"
              min={0}
              value={addForm.netPaySnapshot}
              onChange={(e) => setFormField("netPaySnapshot", e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs bg-surface-primary tabular-nums"
            />
          </label>

          <div className="flex gap-2 pt-1">
            <button
              onClick={saveForm}
              disabled={!formValid || saveMutation.isPending}
              className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? "Saving…" : "Save rule"}
            </button>
            <button
              onClick={editingIdx !== null ? cancelEdit : cancelAdd}
              className="px-3 py-1 text-xs rounded border text-muted hover:text-primary"
            >
              Cancel
            </button>
          </div>

          {saveMutation.error && (
            <p className="text-xs text-red-600">{saveMutation.error.message}</p>
          )}
        </div>
      )}

      {!addForm && (
        <button
          onClick={openAdd}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          + Add rule
        </button>
      )}
    </div>
  );
}

export function ExtraPaycheckRulesEditor({
  goals,
  netPayByPersonId,
}: {
  goals: Goal[];
  netPayByPersonId: Map<number, number>;
}) {
  const { data: jobs, isLoading } =
    trpc.savings.extraPaycheckRouting.list.useQuery();

  if (isLoading) return <p className="text-xs text-muted">Loading…</p>;
  if (!jobs?.length)
    return <p className="text-xs text-muted">No jobs found.</p>;

  // Group by person
  const byPerson = new Map<number, { name: string; jobs: JobEntry[] }>();
  for (const job of jobs) {
    if (!byPerson.has(job.personId)) {
      byPerson.set(job.personId, { name: job.personName, jobs: [] });
    }
    byPerson.get(job.personId)!.jobs.push(job);
  }

  return (
    <div className="space-y-6">
      {Array.from(byPerson.entries()).map(
        ([personId, { name, jobs: personJobs }]) => (
          <div key={personId}>
            <h3 className="text-sm font-semibold text-primary mb-3">{name}</h3>
            {personJobs.map((job) => (
              <div key={job.id} className="mb-4">
                {personJobs.length > 1 && (
                  <p className="text-[10px] text-muted mb-1.5">
                    {job.employerName}
                  </p>
                )}
                <PersonPanel
                  job={job}
                  goals={goals}
                  netPayPerCheck={netPayByPersonId.get(personId) ?? 0}
                  onSaved={() => {}}
                />
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
