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

type YearlyGrowthEntry = { type: "pct" | "dollar"; value: number };
type YearlyGrowth = Record<number, YearlyGrowthEntry>;

function projectedNetPay(
  baseNetPay: number,
  year: number,
  baseYear: number,
  yearlyGrowth: YearlyGrowth,
): number {
  let pay = baseNetPay;
  for (let y = baseYear + 1; y <= year; y++) {
    const e = yearlyGrowth[y];
    if (!e || e.value === 0) continue;
    pay = e.type === "pct" ? pay * (1 + e.value / 100) : pay + e.value;
  }
  return pay;
}

function PaycheckGrowthEditor({
  projectionYears,
  baseNetPay,
  yearlyGrowth,
  setYearlyGrowth,
}: {
  projectionYears: number;
  baseNetPay: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
}) {
  const baseYear = new Date().getFullYear();
  const years: number[] = [];
  for (let i = 1; i <= projectionYears; i++) years.push(baseYear + i);
  if (years.length === 0) return null;

  const updateEntry = (yr: number, patch: Partial<YearlyGrowthEntry>) => {
    const current = yearlyGrowth[yr] ?? { type: "pct", value: 0 };
    setYearlyGrowth({ ...yearlyGrowth, [yr]: { ...current, ...patch } });
  };
  const removeEntry = (yr: number) => {
    const next = { ...yearlyGrowth };
    delete next[yr];
    setYearlyGrowth(next);
  };
  const applyToAll = (entry: YearlyGrowthEntry) => {
    const next: YearlyGrowth = {};
    for (const yr of years) next[yr] = { ...entry };
    setYearlyGrowth(next);
  };

  return (
    <div className="rounded border bg-surface-elevated/40 p-3 space-y-1.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-faint font-medium uppercase tracking-wide">
          Net Pay Annual Growth
        </span>
        {Object.keys(yearlyGrowth).length === 0 && (
          <button
            onClick={() => applyToAll({ type: "pct", value: 3 })}
            className="text-[10px] text-blue-600 hover:text-blue-700"
          >
            Set 3% for all
          </button>
        )}
      </div>
      {years.map((yr) => {
        const entry = yearlyGrowth[yr];
        const hasEntry = entry !== undefined && entry.value !== 0;
        const projected = projectedNetPay(
          baseNetPay,
          yr,
          baseYear,
          yearlyGrowth,
        );
        return (
          <div key={yr} className="flex items-center gap-2">
            <span className="text-faint w-10 shrink-0">{yr}</span>
            <div className="flex bg-surface-elevated rounded p-0.5">
              <button
                onClick={() => updateEntry(yr, { type: "pct" })}
                className={`px-1.5 py-0.5 rounded text-[10px] ${!entry || entry.type === "pct" ? "bg-surface-strong text-primary" : "text-faint hover:text-primary"}`}
              >
                %
              </button>
              <button
                onClick={() => updateEntry(yr, { type: "dollar" })}
                className={`px-1.5 py-0.5 rounded text-[10px] ${entry?.type === "dollar" ? "bg-surface-strong text-primary" : "text-faint hover:text-primary"}`}
              >
                $
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              {entry?.type === "dollar" && (
                <span className="text-[10px] text-muted">+$</span>
              )}
              <input
                type="number"
                min="0"
                step={entry?.type === "dollar" ? "50" : "0.5"}
                value={entry?.value ?? ""}
                placeholder="0"
                onChange={(e) => {
                  const val =
                    e.target.value === "" ? 0 : Number(e.target.value);
                  updateEntry(yr, { value: val });
                }}
                className="w-16 border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs text-right tabular-nums"
              />
              {(!entry || entry.type === "pct") && (
                <span className="text-[10px] text-muted">%</span>
              )}
              {entry?.type === "dollar" && (
                <span className="text-[10px] text-muted">/check</span>
              )}
            </div>
            <span className="text-[10px] text-muted tabular-nums">
              &rarr; {formatCurrency(projected)}/check
            </span>
            {hasEntry && (
              <button
                onClick={() => removeEntry(yr)}
                className="text-[10px] text-muted hover:text-faint"
                title="Remove growth for this year"
              >
                &times;
              </button>
            )}
          </div>
        );
      })}
      {years.length > 1 && Object.keys(yearlyGrowth).length > 0 && (
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={() => {
              const first = yearlyGrowth[years[0]!];
              if (first) applyToAll(first);
            }}
            className="text-[10px] text-muted hover:text-faint"
          >
            Apply first to all
          </button>
          <button
            onClick={() => setYearlyGrowth({})}
            className="text-[10px] text-muted hover:text-red-600"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

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
};

function emptyForm(): RuleForm {
  return { from: "", to: "", splits: [{ goalId: 0, pct: "100" }] };
}

function PersonPanel({
  job,
  goals,
  netPayPerCheck,
  projectionMonthKeys,
  yearlyGrowth,
  onSaved,
}: {
  job: JobEntry;
  goals: Goal[];
  netPayPerCheck: number;
  projectionMonthKeys: Set<string>;
  yearlyGrowth: YearlyGrowth;
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
      projectionMonthKeys.size,
    )
      .map((d) => d.slice(0, 7)) // "YYYY-MM-01" → "YYYY-MM"
      .filter((mk) => projectionMonthKeys.has(mk));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.anchorPayDate, job.payPeriod, projectionMonthKeys]);

  const rules: ExtraPaycheckRule[] = job.extraPaycheckRouting ?? [];

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<RuleForm | null>(null);

  function openAdd() {
    setAddForm(emptyForm());
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
      netPaySnapshot: Math.round(netPayPerCheck),
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
    netPayPerCheck > 0;

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
            Extra paychecks in projection:
          </span>
          {upcomingMonths.map((mk) => {
            const covered = rules.some(
              (r) => mk >= r.from && (r.to === null || mk <= r.to),
            );
            const year = parseInt(mk.slice(0, 4));
            const baseYear = new Date().getFullYear();
            const projected = projectedNetPay(
              netPayPerCheck,
              year,
              baseYear,
              yearlyGrowth,
            );
            const hasGrowth = Object.values(yearlyGrowth).some(
              (e) => e.value !== 0,
            );
            return (
              <span
                key={mk}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  covered
                    ? "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800"
                    : "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800"
                }`}
                title={`Projected net pay: ${formatCurrency(projected)}`}
              >
                {fmt(mk)}
                {hasGrowth && year > baseYear && (
                  <span className="ml-1 opacity-70">
                    {formatCurrency(projected)}
                  </span>
                )}
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

          <p className="text-[10px] text-muted">
            Net pay per check will be snapshotted from paycheck:{" "}
            <span className="font-medium tabular-nums">
              {formatCurrency(netPayPerCheck)}
            </span>
          </p>

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
  monthDates,
}: {
  goals: Goal[];
  netPayByPersonId: Map<number, number>;
  monthDates: Date[];
}) {
  const { data: jobs, isLoading } =
    trpc.savings.extraPaycheckRouting.list.useQuery();
  const [yearlyGrowth, setYearlyGrowth] = useState<YearlyGrowth>({});

  const projectionMonthKeys = useMemo(
    () =>
      new Set(
        monthDates.map(
          (d) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        ),
      ),
    [monthDates],
  );

  // Distinct future years in the projection (for growth editor)
  const projectionYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const maxYear = monthDates.reduce(
      (max, d) => Math.max(max, d.getFullYear()),
      currentYear,
    );
    return maxYear - currentYear;
  }, [monthDates]);

  // Representative base net pay (first person with a value, for the growth editor)
  const baseNetPay = useMemo(() => {
    for (const v of netPayByPersonId.values()) {
      if (v > 0) return v;
    }
    return 0;
  }, [netPayByPersonId]);

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
    <div className="space-y-4">
      {projectionYears > 0 && baseNetPay > 0 && (
        <PaycheckGrowthEditor
          projectionYears={projectionYears}
          baseNetPay={baseNetPay}
          yearlyGrowth={yearlyGrowth}
          setYearlyGrowth={setYearlyGrowth}
        />
      )}
      <div className="space-y-6">
        {Array.from(byPerson.entries()).map(
          ([personId, { name, jobs: personJobs }]) => (
            <div key={personId}>
              <h3 className="text-sm font-semibold text-primary mb-3">
                {name}
              </h3>
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
                    projectionMonthKeys={projectionMonthKeys}
                    yearlyGrowth={yearlyGrowth}
                    onSaved={() => {}}
                  />
                </div>
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
