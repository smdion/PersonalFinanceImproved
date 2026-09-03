"use client";

/**
 * ExtraPaycheckJobPanel / ExtraPaycheckRulesEditor / ExtraPaycheckDestinationToggle
 *
 * ExtraPaycheckJobPanel is the full per-job routing editor — rules, splits
 * across savings goals, growth rates, month overrides. ExtraPaycheckRulesEditor
 * wraps it in a multi-person grid and renders on the Savings page, where
 * this detail belongs (it's Savings-domain mechanics, not a Salary Profile
 * concern). Salary Profile Manager instead renders only
 * ExtraPaycheckDestinationToggle, next to a job's payPeriod/anchorPayDate —
 * just the comp-layer decision of whether the extra check is diverted at
 * all (see RULES.md's extraPaycheckRouting section), not the mechanics of
 * where. Saves via savings.extraPaycheckRouting.save/saveGrowth/
 * saveOverride/setEnabled.
 */

import React, { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, MONTH_NAMES_SHORT } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { Button } from "@/components/ui/button";
import {
  getExtraPaycheckMonthKeys,
  isExtraPaycheckBudgetMode,
} from "@/lib/calculators/paycheck";
import type {
  ExtraPaycheckRule,
  ExtraPaycheckOverride,
  ExtraPaycheckRoutingData,
} from "@/lib/db/schema-pg";

type YearlyGrowthEntry = { type: "pct" | "dollar"; value: number };
type YearlyGrowth = Record<number, YearlyGrowthEntry>;

/**
 * extraPaycheckRouting now lives inside the Salary Profile entry, not a
 * savings-only table — invalidating only `savings.*` leaves Salary Profile
 * Manager (`salaryProfile.getById`) and the Paycheck page
 * (`paycheck.computeSummary`) showing stale routing after a save, since
 * neither query lives under the `savings` router. Every mutation in this
 * file that touches routing must invalidate all three.
 */
function invalidateExtraPaycheckConsumers(
  utils: ReturnType<typeof trpc.useUtils>,
) {
  utils.savings.invalidate();
  utils.salaryProfile.invalidate();
  utils.paycheck.invalidate();
}

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
    <div className="bg-surface-elevated/40 space-y-1.5 rounded border p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-caption text-faint font-medium tracking-wide uppercase">
          Net Pay Annual Growth
        </span>
        {Object.keys(yearlyGrowth).length === 0 && (
          <button
            onClick={() => applyToAll({ type: "pct", value: 3 })}
            className="text-caption text-blue-600 hover:text-blue-700"
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
            <div className="bg-surface-elevated flex rounded p-0.5">
              <button
                onClick={() => updateEntry(yr, { type: "pct" })}
                className={`text-caption rounded px-1.5 py-0.5 ${!entry || entry.type === "pct" ? "bg-surface-strong text-primary" : "text-faint hover:text-primary"}`}
              >
                %
              </button>
              <button
                onClick={() => updateEntry(yr, { type: "dollar" })}
                className={`text-caption rounded px-1.5 py-0.5 ${entry?.type === "dollar" ? "bg-surface-strong text-primary" : "text-faint hover:text-primary"}`}
              >
                $
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              {entry?.type === "dollar" && (
                <span className="text-caption text-muted">+$</span>
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
                className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums"
              />
              {(!entry || entry.type === "pct") && (
                <span className="text-caption text-muted">%</span>
              )}
              {entry?.type === "dollar" && (
                <span className="text-caption text-muted">/check</span>
              )}
            </div>
            <span className="text-caption text-muted tabular-nums">
              &rarr; {formatCurrency(projected)}/check
            </span>
            {hasEntry && (
              <button
                onClick={() => removeEntry(yr)}
                className="text-caption text-muted hover:text-faint"
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
            className="text-caption text-muted hover:text-faint"
          >
            Apply first to all
          </button>
          <button
            onClick={() => setYearlyGrowth({})}
            className="text-caption text-muted hover:text-red-600"
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
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-faint text-xs">Annual raise</span>
        {!isUniform ? (
          <span className="text-caption text-muted italic">custom by year</span>
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
              className="bg-surface-primary text-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums"
            />
            <span className="text-caption text-muted">% / yr</span>
          </div>
        )}
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="text-caption text-blue-600 hover:text-blue-700"
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

function fmt(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_NAMES_SHORT[parseInt(m!) - 1]} ${y}`;
}

type Goal = { id: number; name: string };

type JobEntry = {
  id: number;
  personId: number;
  personName: string;
  employerName: string;
  /** `null` is a genuine "incomplete" state — no snapshot AND no entry for
   *  this job in the active Salary Profile. */
  payPeriod: string | null;
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

export function ExtraPaycheckJobPanel({
  job,
  goals,
  netPayPerCheck,
  projectionMonthKeys,
  monthDates,
  onSaved,
}: {
  job: JobEntry;
  goals: Goal[];
  netPayPerCheck: number;
  projectionMonthKeys: Set<string>;
  monthDates: Date[];
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const saveMutation = trpc.savings.extraPaycheckRouting.save.useMutation({
    onSuccess: () => {
      invalidateExtraPaycheckConsumers(utils);
      onSaved();
    },
  });
  const saveGrowthMutation =
    trpc.savings.extraPaycheckRouting.saveGrowth.useMutation({
      onSuccess: () => invalidateExtraPaycheckConsumers(utils),
    });
  const saveOverrideMutation =
    trpc.savings.extraPaycheckRouting.saveOverride.useMutation({
      onSuccess: () => {
        invalidateExtraPaycheckConsumers(utils);
        setOverrideMonth(null);
        setOverrideForm(null);
        setIsNewOverride(false);
      },
    });
  const setEnabledMutation =
    trpc.savings.extraPaycheckRouting.setEnabled.useMutation({
      onSuccess: () => invalidateExtraPaycheckConsumers(utils),
    });

  const routing = job.extraPaycheckRouting;
  const rules: ExtraPaycheckRule[] = routing?.rules ?? [];
  const overrides: ExtraPaycheckOverride[] = routing?.overrides ?? [];
  const budgetMode = isExtraPaycheckBudgetMode(routing);

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
  // trigger saveGrowth so the server recomputes net pay and the materializer
  // switches from the stale per-rule netPaySnapshot to the dynamic projection path.
  const autoUpgradeFiredRef = useRef(false);
  useEffect(() => {
    if (
      autoUpgradeFiredRef.current ||
      rules.length === 0 ||
      routing?.baseNetPayPerCheck !== undefined
    )
      return;
    autoUpgradeFiredRef.current = true;
    saveGrowthMutation.mutate({
      jobId: job.id,
      yearlyGrowth,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id, routing?.baseNetPayPerCheck]);

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

  // Valid extra-paycheck months for the override selector
  const extraPaycheckMonthOptions = useMemo(() => {
    if (
      job.payPeriod !== "biweekly" ||
      !job.anchorPayDate ||
      monthDates.length === 0
    )
      return [];
    const anchor = new Date(job.anchorPayDate + "T00:00:00Z");
    // monthDates are local-midnight first-of-month dates; getExtraPaycheckMonthKeys
    // reads asOfDate with UTC getters, so pass a UTC-midnight date built from the
    // local year/month or it can be read as the prior month east of UTC.
    const asOf = new Date(
      Date.UTC(monthDates[0]!.getFullYear(), monthDates[0]!.getMonth(), 1),
    );
    const keys = getExtraPaycheckMonthKeys(
      anchor,
      job.payPeriod,
      asOf,
      monthDates.length,
    );
    return keys.map((k) => k.slice(0, 7)); // "YYYY-MM-01" → "YYYY-MM"
  }, [job.anchorPayDate, job.payPeriod, monthDates]);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addForm, setAddForm] = useState<RuleForm | null>(null);

  // Override state: which month is open for override editing
  const [overrideMonth, setOverrideMonth] = useState<string | null>(null);
  const [isNewOverride, setIsNewOverride] = useState(false);
  const [overrideForm, setOverrideForm] = useState<
    { goalId: number; pct: string }[] | null
  >(null);

  function openAddOverride() {
    setOverrideForm([{ goalId: 0, pct: "100" }]);
    setOverrideMonth(extraPaycheckMonthOptions[0] ?? "");
    setIsNewOverride(true);
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
    setIsNewOverride(false);
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
    ? sumBy(overrideForm, (sp) => Number(sp.pct))
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
    ? sumBy(addForm.splits, (sp) => Number(sp.pct))
    : 0;
  const formValid =
    addForm &&
    addForm.from.match(/^\d{4}-\d{2}$/) &&
    addForm.splits.every((s) => s.goalId > 0) &&
    Math.abs(splitTotal - 100) < 0.01 &&
    netPayPerCheck > 0;

  if (job.payPeriod !== "biweekly") {
    return (
      <div className="text-muted py-2 text-xs">
        Extra paycheck routing only applies to biweekly pay schedules.
      </div>
    );
  }
  if (!job.anchorPayDate) {
    return (
      <div className="py-2 text-xs text-amber-600">
        Set an anchor pay date on this job to enable extra paycheck routing.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
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
      </div>

      {budgetMode && rules.length > 0 ? (
        <p className="text-muted text-xs">
          Routing is paused — the extra paycheck stays as regular income instead
          of going to a savings goal. Your configured rules are kept; switch
          back to Savings to resume them. See the Budget page for which months
          to expect it.
        </p>
      ) : (
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

          {/* Rule list */}
          {rules.length > 0 && (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-subtle text-faint border-b">
                  <th className="py-1 pr-2 text-left font-medium">From</th>
                  <th className="py-1 pr-2 text-left font-medium">To</th>
                  <th className="py-1 pr-2 text-left font-medium">Routing</th>
                  <th className="py-1 pr-2 text-left font-medium">
                    Net / check
                  </th>
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
                      className="border-subtle/50 border-b"
                    >
                      <td className="py-1 pr-2 tabular-nums">
                        {fmt(rule.from)}
                      </td>
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
                          onClick={() => openEdit(idx)}
                          className="mr-2 text-xs text-blue-600 hover:text-blue-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRule(idx)}
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

          {rules.length === 0 && !addForm && (
            <p className="text-muted text-xs">No routing rules yet.</p>
          )}

          {/* Month overrides */}
          <div className="border-subtle/50 space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-caption text-faint font-medium tracking-wide uppercase">
                Month overrides
              </span>
              {overrideMonth === null &&
                extraPaycheckMonthOptions.length > 0 && (
                  <button
                    onClick={openAddOverride}
                    className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 transition-colors"
                  >
                    + Add override
                  </button>
                )}
            </div>
            {overrides.length > 0 && overrideMonth === null && (
              <div className="space-y-1.5">
                {overrides.map((o) => (
                  <div
                    key={o.month}
                    className="flex items-center gap-2 text-xs"
                  >
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
            {overrideMonth !== null && overrideForm && (
              <div className="border-subtle bg-surface-sunken/50 space-y-2 rounded-md border p-3 text-xs">
                {isNewOverride ? (
                  <label className="block space-y-0.5">
                    <span className="text-caption text-muted">Month</span>
                    <select
                      value={overrideMonth ?? ""}
                      onChange={(e) => setOverrideMonth(e.target.value)}
                      className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                    >
                      <option value="">— pick a month —</option>
                      {extraPaycheckMonthOptions.map((mk) => {
                        const hasOverride = overrides.some(
                          (o) => o.month === mk,
                        );
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
                            i === si
                              ? { ...s, goalId: Number(e.target.value) }
                              : s,
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
                            setOverrideForm(
                              overrideForm.filter((_, i) => i !== si),
                            )
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
                        setOverrideForm([
                          ...overrideForm,
                          { goalId: 0, pct: "0" },
                        ])
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
                    {saveOverrideMutation.isPending
                      ? "Saving…"
                      : "Save override"}
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
              </div>
            )}
          </div>

          {/* Add/edit form */}
          {addForm && (
            <div className="border-subtle bg-surface-sunken/50 space-y-3 rounded-md border p-3">
              <p className="text-primary text-xs font-medium">
                {editingIdx !== null ? "Edit rule" : "New rule"}
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
                      onChange={(e) => setSplitPct(si, e.target.value)}
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

              <p className="text-caption text-muted">
                Net pay per check is calculated from the paycheck page and
                projected using the growth rates above.
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
                <p className="text-xs text-red-600">
                  {saveMutation.error.message}
                </p>
              )}
            </div>
          )}

          {!addForm && (
            <button
              onClick={openAdd}
              className="text-label border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1 transition-colors"
            >
              + Add rule
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Full multi-person routing editor — one ExtraPaycheckJobPanel per job,
 * grouped by person. Lives on the Savings page: rules/splits/goals/growth
 * are Savings-domain complexity (percentage splits across savings GOALS,
 * a concept this component owns), not a Salary Profile concern. Salary
 * Profile Manager shows only ExtraPaycheckDestinationToggle below — the
 * simple comp-layer decision of whether the extra check is diverted at
 * all, without the detailed mechanics of where.
 */
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

  if (isLoading) return <p className="text-muted text-xs">Loading…</p>;
  if (!jobs?.length)
    return <p className="text-muted text-xs">No jobs found.</p>;

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
                ? "border-subtle/40 space-y-3 rounded-lg border p-4"
                : undefined
            }
          >
            <h3 className="text-primary text-sm font-semibold">{name}</h3>
            {personJobs.map((job) => (
              <div key={job.id}>
                {personJobs.length > 1 && (
                  <p className="text-caption text-muted mb-1.5">
                    {job.employerName}
                  </p>
                )}
                <ExtraPaycheckJobPanel
                  job={job}
                  goals={goals}
                  netPayPerCheck={netPayByPersonId.get(personId) ?? 0}
                  projectionMonthKeys={projectionMonthKeys}
                  monthDates={monthDates}
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

/**
 * Minimal Savings-vs-Budget control for Salary Profile Manager — just the
 * pill toggle, no rules/splits/growth/overrides. Those are Savings-domain
 * mechanics (see ExtraPaycheckRulesEditor above); this only surfaces the
 * comp-layer decision itself: is the job's extra biweekly paycheck diverted
 * anywhere at all. Reuses `routing` already fetched by the caller (Salary
 * Profile Manager already has each job's entry in scope) rather than
 * re-querying savings.extraPaycheckRouting.list for a job Manager already
 * has data for.
 */
export function ExtraPaycheckDestinationToggle({
  jobId,
  routing,
  disabled = false,
}: {
  jobId: number;
  routing: ExtraPaycheckRoutingData | null;
  /** Set while a what-if Scenario is being previewed — this toggle has no
   *  scenario-override path of its own (unlike salary/contribution edits,
   *  which redirect into the Scenario's overlay), so a real write here
   *  would silently persist outside the sandboxed preview the user believes
   *  they're in. Deliberately NOT tied to the page's read-only/edit-lock
   *  state — this is a toggle, not an editable value, so it stays
   *  actionable even while the rest of the profile is locked. */
  disabled?: boolean;
}) {
  const utils = trpc.useUtils();
  const setEnabledMutation =
    trpc.savings.extraPaycheckRouting.setEnabled.useMutation({
      onSuccess: () => invalidateExtraPaycheckConsumers(utils),
    });

  const rules = routing?.rules ?? [];
  const budgetMode = isExtraPaycheckBudgetMode(routing);
  const setMode = (toSavings: boolean) =>
    !disabled &&
    rules.length > 0 &&
    setEnabledMutation.mutate({ jobId, enabled: toSavings });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption text-muted">Extra paycheck goes to:</span>
      <div className="border-default text-caption inline-flex overflow-hidden rounded border">
        <button
          onClick={() => setMode(true)}
          disabled={disabled}
          className={`px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50 ${
            !budgetMode
              ? "bg-blue-600 text-white"
              : "bg-surface-primary text-muted hover:text-primary"
          }`}
        >
          Savings
        </button>
        <button
          onClick={() => setMode(false)}
          disabled={disabled}
          className={`px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50 ${
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
      {disabled && (
        <span className="text-caption text-faint">
          (unavailable in scenario preview)
        </span>
      )}
    </div>
  );
}
