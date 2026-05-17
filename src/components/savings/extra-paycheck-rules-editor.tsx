"use client";

/**
 * ExtraPaycheckRulesEditor
 *
 * Per-person panel for authoring extra-paycheck routing rules.
 * Shows upcoming extra-paycheck months, the current rule list, and
 * an inline add/edit form. Saves via savings.extraPaycheckRouting.save.
 */

import React, { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import type {
  ExtraPaycheckRule,
  ExtraPaycheckOverride,
  ExtraPaycheckRoutingData,
} from "@/lib/db/schema-pg";

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
  baseYear,
  yearlyGrowth,
  setYearlyGrowth,
}: {
  projectionYears: number;
  baseNetPay: number;
  baseYear: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
}) {
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

function SimpleGrowthEditor({
  projectionYears,
  baseNetPay,
  baseYear,
  yearlyGrowth,
  setYearlyGrowth,
}: {
  projectionYears: number;
  baseNetPay: number;
  baseYear: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const years: number[] = [];
  for (let i = 1; i <= projectionYears; i++) years.push(baseYear + i);

  const nonZeroEntries = years
    .map((y) => yearlyGrowth[y])
    .filter((e): e is YearlyGrowthEntry => e !== undefined && e.value !== 0);
  const isUniform =
    nonZeroEntries.length === 0 ||
    nonZeroEntries.every(
      (e) =>
        e.type === nonZeroEntries[0]!.type &&
        e.value === nonZeroEntries[0]!.value,
    );
  const uniformEntry: YearlyGrowthEntry = nonZeroEntries[0] ?? {
    type: "pct",
    value: 0,
  };

  const applyUniform = (entry: YearlyGrowthEntry) => {
    const next: YearlyGrowth = {};
    for (const yr of years) {
      if (entry.value !== 0) next[yr] = { ...entry };
    }
    setYearlyGrowth(next);
  };

  if (years.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-xs text-faint">Annual raise</span>
        {!isUniform ? (
          <span className="text-[10px] text-muted italic">custom by year</span>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={0.5}
              value={uniformEntry.value || ""}
              placeholder="0"
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : Number(e.target.value);
                applyUniform({ type: "pct", value: val });
              }}
              className="w-14 border bg-surface-primary text-primary rounded px-1.5 py-0.5 text-xs text-right tabular-nums"
            />
            <span className="text-[10px] text-muted">% / yr</span>
          </div>
        )}
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="text-[10px] text-blue-600 hover:text-blue-700"
        >
          {showDetail
            ? "hide detail"
            : isUniform
              ? "customize by year"
              : "edit"}
        </button>
      </div>
      {showDetail && (
        <PaycheckGrowthEditor
          projectionYears={projectionYears}
          baseNetPay={baseNetPay}
          baseYear={baseYear}
          yearlyGrowth={yearlyGrowth}
          setYearlyGrowth={setYearlyGrowth}
        />
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
  extraPaycheckRouting: ExtraPaycheckRoutingData | null;
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
  onSaved,
}: {
  job: JobEntry;
  goals: Goal[];
  netPayPerCheck: number;
  projectionMonthKeys: Set<string>;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const saveMutation = trpc.savings.extraPaycheckRouting.save.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      onSaved();
    },
  });
  const saveGrowthMutation =
    trpc.savings.extraPaycheckRouting.saveGrowth.useMutation({
      onSuccess: () => utils.savings.invalidate(),
    });
  const saveOverrideMutation =
    trpc.savings.extraPaycheckRouting.saveOverride.useMutation({
      onSuccess: () => {
        utils.savings.invalidate();
        setOverrideMonth(null);
        setOverrideForm(null);
      },
    });

  const routing = job.extraPaycheckRouting;
  const rules: ExtraPaycheckRule[] = routing?.rules ?? [];
  const overrides: ExtraPaycheckOverride[] = routing?.overrides ?? [];

  // Growth state is per-person, initialized from persisted routing data.
  const [yearlyGrowth, setYearlyGrowth] = useState<YearlyGrowth>(
    () => (routing?.yearlyGrowth as YearlyGrowth | undefined) ?? {},
  );

  // Base net pay: use stored value if available, else fall back to live calculator value.
  const baseNetPayDisplay =
    routing?.baseNetPayPerCheck !== undefined
      ? routing.baseNetPayPerCheck
      : netPayPerCheck;
  const baseYearDisplay = routing?.baseYear ?? new Date().getFullYear();

  // Auto-upgrade: if rules exist but baseNetPayPerCheck hasn't been set yet,
  // silently persist the current live value so the materializer switches from
  // the stale per-rule netPaySnapshot to the dynamic projection path.
  const autoUpgradeFiredRef = useRef(false);
  useEffect(() => {
    if (
      autoUpgradeFiredRef.current ||
      rules.length === 0 ||
      routing?.baseNetPayPerCheck !== undefined ||
      netPayPerCheck <= 0
    )
      return;
    autoUpgradeFiredRef.current = true;
    saveGrowthMutation.mutate({
      jobId: job.id,
      baseNetPayPerCheck: Math.round(netPayPerCheck),
      yearlyGrowth: {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, routing?.baseNetPayPerCheck, netPayPerCheck]);

  // Number of future years visible in the projection (for growth editor rows).
  const projectionYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    let maxYear = currentYear;
    for (const mk of projectionMonthKeys) {
      const y = parseInt(mk.slice(0, 4));
      if (y > maxYear) maxYear = y;
    }
    return maxYear - currentYear;
  }, [projectionMonthKeys]);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<RuleForm | null>(null);

  // Override state: which month is open for override editing
  const [overrideMonth, setOverrideMonth] = useState<string | null>(null);
  const [overrideForm, setOverrideForm] = useState<
    { goalId: number; pct: string }[] | null
  >(null);

  function openAddOverride() {
    setOverrideForm([{ goalId: 0, pct: "100" }]);
    setOverrideMonth("");
  }

  function openOverride(mk: string) {
    const existing = overrides.find((o) => o.month === mk);
    if (existing) {
      setOverrideForm(
        existing.splits.map((s) => ({ goalId: s.goalId, pct: String(s.pct) })),
      );
    } else {
      const rule = rules.find(
        (r) => mk >= r.from && (r.to === null || mk <= r.to),
      );
      setOverrideForm(
        rule
          ? rule.splits.map((s) => ({ goalId: s.goalId, pct: String(s.pct) }))
          : [{ goalId: 0, pct: "100" }],
      );
    }
    setOverrideMonth(mk);
  }

  function saveOverride() {
    if (
      overrideMonth === null ||
      !overrideMonth.match(/^\d{4}-\d{2}$/) ||
      !overrideForm
    )
      return;
    const splits = overrideForm
      .filter((s) => s.goalId > 0 && Number(s.pct) > 0)
      .map((s) => ({ goalId: s.goalId, pct: Number(s.pct) }));
    saveOverrideMutation.mutate({
      jobId: job.id,
      month: overrideMonth,
      splits,
    });
  }

  function deleteOverride(mk: string) {
    saveOverrideMutation.mutate({ jobId: job.id, month: mk, splits: null });
  }

  const overrideSplitTotal = overrideForm
    ? overrideForm.reduce((s, sp) => s + Number(sp.pct), 0)
    : 0;

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
    };

    let updated: ExtraPaycheckRule[];
    if (editingIdx !== null) {
      updated = rules.map((r, i) => (i === editingIdx ? newRule : r));
    } else {
      updated = [...rules, newRule].sort((a, b) =>
        a.from.localeCompare(b.from),
      );
    }

    saveMutation.mutate({
      jobId: job.id,
      rules: updated,
      baseNetPayPerCheck: Math.round(netPayPerCheck),
      yearlyGrowth,
    });
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
    <div className="space-y-4">
      {/* Growth editor — per-person, persisted */}
      {projectionYears > 0 && netPayPerCheck > 0 && (
        <div className="rounded border border-subtle bg-surface-sunken/30 p-3 space-y-2.5">
          <SimpleGrowthEditor
            projectionYears={projectionYears}
            baseNetPay={baseNetPayDisplay}
            baseYear={baseYearDisplay}
            yearlyGrowth={yearlyGrowth}
            setYearlyGrowth={setYearlyGrowth}
          />
          <div className="flex items-center gap-3 flex-wrap border-t border-subtle/50 pt-2">
            <span className="text-[10px] text-faint">
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
                  baseNetPayPerCheck: Math.round(netPayPerCheck),
                  yearlyGrowth,
                })
              }
              disabled={saveGrowthMutation.isPending}
            >
              {saveGrowthMutation.isPending
                ? "Applying…"
                : "Apply growth rates"}
            </Button>
            <span className="text-[10px] text-faint/60">
              Re-apply after salary changes
            </span>
          </div>
        </div>
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
            {rules.map((rule, idx) => {
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
                    {formatCurrency(netPerCheck)}
                  </td>
                  <td className="py-1 text-right">
                    <button
                      onClick={() => openEdit(idx)}
                      className="text-xs text-blue-600 hover:text-blue-700 mr-2"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteRule(idx)}
                      className="text-xs text-faint hover:text-red-600 transition-colors"
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

      {rules.length === 0 && !addForm && (
        <p className="text-xs text-muted">No routing rules yet.</p>
      )}

      {/* Month overrides */}
      <div className="border-t border-subtle/50 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-faint font-medium uppercase tracking-wide">
            Month overrides
          </span>
          {overrideMonth === null && (
            <button
              onClick={openAddOverride}
              className="px-2.5 py-1 text-[11px] rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors"
            >
              + Add override
            </button>
          )}
        </div>
        {overrides.length > 0 && overrideMonth === null && (
          <div className="space-y-1.5">
            {overrides.map((o) => (
              <div key={o.month} className="flex items-center gap-2 text-xs">
                <span className="text-faint tabular-nums w-16 shrink-0">
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
                  className="text-xs text-faint hover:text-red-600 transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {overrides.length === 0 && overrideMonth === null && (
          <p className="text-[10px] text-faint/50">None set.</p>
        )}
        {overrideMonth !== null && overrideForm && (
          <div className="border border-subtle rounded-md p-3 space-y-2 bg-surface-sunken/50 text-xs">
            {overrideMonth === "" ? (
              <label className="space-y-0.5 block">
                <span className="text-[10px] text-muted">Month</span>
                <input
                  type="month"
                  value={overrideMonth}
                  onChange={(e) => setOverrideMonth(e.target.value)}
                  className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </label>
            ) : (
              <p className="font-medium text-primary">
                Override — {fmt(overrideMonth)}
              </p>
            )}
            <div className="space-y-1">
              <span className="text-[10px] text-muted">
                Fund splits (must total 100%)
              </span>
              {overrideForm.map((sp, si) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={si} className="flex gap-2 items-center">
                  <select
                    value={sp.goalId}
                    onChange={(e) => {
                      const next = overrideForm.map((s, i) =>
                        i === si ? { ...s, goalId: Number(e.target.value) } : s,
                      );
                      setOverrideForm(next);
                    }}
                    className="flex-1 border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="w-16 border border-default rounded px-1.5 py-0.5 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500 text-right tabular-nums"
                  />
                  <span className="text-[10px] text-muted">%</span>
                  {overrideForm.length > 1 && (
                    <button
                      onClick={() =>
                        setOverrideForm(overrideForm.filter((_, i) => i !== si))
                      }
                      className="text-xs text-faint hover:text-red-600 transition-colors"
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
                  className={`text-[10px] tabular-nums ${
                    Math.abs(overrideSplitTotal - 100) < 0.01
                      ? "text-green-600"
                      : "text-red-500"
                  }`}
                >
                  Total: {overrideSplitTotal.toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="primary"
                size="sm"
                onClick={saveOverride}
                disabled={
                  !overrideMonth.match(/^\d{4}-\d{2}$/) ||
                  Math.abs(overrideSplitTotal - 100) >= 0.01 ||
                  saveOverrideMutation.isPending
                }
              >
                {saveOverrideMutation.isPending ? "Saving…" : "Save override"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOverrideMonth(null);
                  setOverrideForm(null);
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
          </div>
        )}
      </div>

      {/* Add/edit form */}
      {addForm && (
        <div className="border border-subtle rounded-md p-3 space-y-3 bg-surface-sunken/50">
          <p className="text-xs font-medium text-primary">
            {editingIdx !== null ? "Edit rule" : "New rule"}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted">From</span>
              <input
                type="month"
                value={addForm.from}
                onChange={(e) => setFormField("from", e.target.value)}
                className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-muted">
                To (blank = open-ended)
              </span>
              <input
                type="month"
                value={addForm.to}
                onChange={(e) => setFormField("to", e.target.value)}
                className="w-full border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  className="flex-1 border border-default rounded px-2 py-1 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  className="w-16 border border-default rounded px-1.5 py-0.5 text-xs bg-surface-primary text-primary focus:outline-none focus:ring-1 focus:ring-blue-500 text-right tabular-nums"
                />
                <span className="text-[10px] text-muted">%</span>
                {addForm.splits.length > 1 && (
                  <button
                    onClick={() => removeSplit(si)}
                    className="text-xs text-faint hover:text-red-600 transition-colors"
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
              onClick={editingIdx !== null ? cancelEdit : cancelAdd}
            >
              Cancel
            </Button>
          </div>

          {saveMutation.error && (
            <p className="text-xs text-red-600">{saveMutation.error.message}</p>
          )}
        </div>
      )}

      {!addForm && (
        <button
          onClick={openAdd}
          className="px-2.5 py-1 text-[11px] rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors"
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
  layout = "stacked",
}: {
  goals: Goal[];
  netPayByPersonId: Map<number, number>;
  monthDates: Date[];
  layout?: "stacked" | "columns";
}) {
  const { data: jobs, isLoading } =
    trpc.savings.extraPaycheckRouting.list.useQuery();

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

  const wrapperCls =
    layout === "columns" ? "grid grid-cols-2 gap-4 items-start" : "space-y-6";

  return (
    <div className={wrapperCls}>
      {Array.from(byPerson.entries()).map(
        ([personId, { name, jobs: personJobs }]) => (
          <div
            key={personId}
            className={
              layout === "columns"
                ? "rounded-lg border border-subtle/40 p-4 space-y-3"
                : undefined
            }
          >
            <h3 className="text-sm font-semibold text-primary">{name}</h3>
            {personJobs.map((job) => (
              <div key={job.id}>
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
