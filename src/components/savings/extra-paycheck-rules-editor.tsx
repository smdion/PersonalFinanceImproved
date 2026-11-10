"use client";

/**
 * Extra-paycheck routing: the per-job editor (rules, goal splits, growth, month overrides) and its
 * multi-person grid for the Savings page, plus the Savings-vs-Budget toggle Salary Profile Manager
 * shows (see DESIGN.md's extraPaycheckRouting section).
 */

import React, { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { sumBy } from "@/lib/utils/math";
import Link from "next/link";
import { FieldRow } from "@/components/ui/field-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { focusHref } from "@/lib/config/focus-topics";
import type { YearlyGrowth } from "./extra-paycheck-growth";
import {
  GrowthSettings,
  RoutingDestination,
  RuleFormActions,
  RuleFormFields,
  RuleTable,
} from "./extra-paycheck-rules";
import {
  MonthOverrideActions,
  MonthOverrideFields,
  MonthOverrideList,
} from "./extra-paycheck-month-overrides";
import {
  getExtraPaycheckMonthKeys,
  isExtraPaycheckBudgetMode,
} from "@/lib/pure/paycheck/extra-paycheck-months";
import { monthKey } from "@/lib/utils/date-keys";
import type {
  ExtraPaycheckRule,
  ExtraPaycheckOverride,
  ExtraPaycheckRoutingData,
} from "@/lib/db/schema-pg";

/**
 * Routing lives on the Salary Profile entry, so every routing mutation here invalidates
 * `savings.*`, `salaryProfile.getById` and `paycheck.computeSummary`.
 */
function invalidateExtraPaycheckConsumers(
  utils: ReturnType<typeof trpc.useUtils>,
) {
  utils.savings.invalidate();
  utils.salaryProfile.invalidate();
  utils.paycheck.invalidate();
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

function ExtraPaycheckJobPanel({
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
  // trigger saveGrowth so the server saves the current net pay as the base
  // the materializer projects from.
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
    const keys = getExtraPaycheckMonthKeys(
      anchor,
      job.payPeriod,
      monthKey(monthDates[0]!),
      monthDates.length,
    );
    return keys.map((k) => k.slice(0, 7)); // "YYYY-MM-01" → "YYYY-MM"
  }, [job.anchorPayDate, job.payPeriod, monthDates]);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
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
    setEditingIndex(null);
  }

  function cancelAdd() {
    setAddForm(null);
  }

  function openEdit(index: number) {
    const r = rules[index]!;
    setEditingIndex(index);
    setAddForm({
      from: r.from,
      to: r.to ?? "",
      splits: r.splits.map((s) => ({ goalId: s.goalId, pct: String(s.pct) })),
    });
  }

  function cancelEdit() {
    setEditingIndex(null);
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
    if (editingIndex !== null) {
      updated = rules.map((r, i) => (i === editingIndex ? newRule : r));
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
    setEditingIndex(null);
  }

  function deleteRule(index: number) {
    const updated = rules.filter((_, i) => i !== index);
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

  function setSplitPercent(si: number, pct: string) {
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
        <RoutingDestination
          rules={rules}
          setEnabledMutation={setEnabledMutation}
          job={job}
          openAdd={openAdd}
          budgetMode={budgetMode}
        />
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
          <GrowthSettings
            projectionYears={projectionYears}
            netPayPerCheck={netPayPerCheck}
            baseNetPayDisplay={baseNetPayDisplay}
            baseYearDisplay={baseYearDisplay}
            yearlyGrowth={yearlyGrowth}
            setYearlyGrowth={setYearlyGrowth}
            routing={routing}
            saveGrowthMutation={saveGrowthMutation}
            job={job}
          />

          <RuleTable
            rules={rules}
            baseNetPayDisplay={baseNetPayDisplay}
            baseYearDisplay={baseYearDisplay}
            yearlyGrowth={yearlyGrowth}
            goals={goals}
            openEdit={openEdit}
            deleteRule={deleteRule}
          />

          {rules.length === 0 && !addForm && (
            <p className="text-muted text-xs">No routing rules yet.</p>
          )}

          {/* Month overrides */}
          <div className="border-subtle/50 space-y-2 border-t pt-3">
            <MonthOverrideList
              overrideMonth={overrideMonth}
              extraPaycheckMonthOptions={extraPaycheckMonthOptions}
              openAddOverride={openAddOverride}
              overrides={overrides}
              goals={goals}
              openOverride={openOverride}
              deleteOverride={deleteOverride}
              saveOverrideMutation={saveOverrideMutation}
            />
            {overrideMonth !== null && overrideForm && (
              <div className="border-subtle bg-surface-sunken/50 space-y-2 rounded-md border p-3 text-xs">
                <MonthOverrideFields
                  isNewOverride={isNewOverride}
                  overrideMonth={overrideMonth}
                  setOverrideMonth={setOverrideMonth}
                  extraPaycheckMonthOptions={extraPaycheckMonthOptions}
                  overrides={overrides}
                  overrideForm={overrideForm}
                  goals={goals}
                  setOverrideForm={setOverrideForm}
                  overrideSplitTotal={overrideSplitTotal}
                />
                <MonthOverrideActions
                  saveOverride={saveOverride}
                  overrideMonth={overrideMonth}
                  overrideSplitTotal={overrideSplitTotal}
                  saveOverrideMutation={saveOverrideMutation}
                  overrideForm={overrideForm}
                  setOverrideMonth={setOverrideMonth}
                  setOverrideForm={setOverrideForm}
                  setIsNewOverride={setIsNewOverride}
                />
              </div>
            )}
          </div>

          {/* Add/edit form */}
          {addForm && (
            <div className="border-subtle bg-surface-sunken/50 space-y-3 rounded-md border p-3">
              <RuleFormFields
                editingIndex={editingIndex}
                addForm={addForm}
                setFormField={setFormField}
                setSplitGoal={setSplitGoal}
                goals={goals}
                setSplitPercent={setSplitPercent}
                removeSplit={removeSplit}
                addSplit={addSplit}
                splitTotal={splitTotal}
              />

              <RuleFormActions
                saveForm={saveForm}
                formValid={formValid}
                saveMutation={saveMutation}
                editingIndex={editingIndex}
                cancelEdit={cancelEdit}
                cancelAdd={cancelAdd}
              />
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

/** Savings page's multi-person routing editor: one ExtraPaycheckJobPanel per job, grouped by person. */
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
 * Savings-vs-Budget pill toggle for Salary Profile Manager: whether a job's extra paycheck is
 * diverted at all. Uses the caller's `routing` rather than re-querying.
 */
const EXTRA_PAYCHECK_OPTIONS = [
  { value: "savings", label: "Savings" },
  { value: "budget", label: "Budget" },
] as const;

export function ExtraPaycheckDestinationToggle({
  jobId,
  routing,
  disabled = false,
}: {
  jobId: number;
  routing: ExtraPaycheckRoutingData | null;
  /** Read-only (no permission / locked) — the choice is shown, not changed. */
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
    <FieldRow
      label={
        <>
          Goes to
          {setEnabledMutation.isPending && (
            <span className="text-caption text-faint">Saving…</span>
          )}
        </>
      }
      hint={
        rules.length === 0 ? (
          // Savings needs a split set up first — say where, instead of a
          // button that does nothing.
          <Link
            href={focusHref({ topic: "extraPaychecks" })}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Set up where it goes in Savings
          </Link>
        ) : (
          <Link
            href={focusHref({ topic: "extraPaychecks" })}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Change the split in Savings
          </Link>
        )
      }
    >
      <SegmentedControl
        ariaLabel="Extra paycheck goes to"
        value={budgetMode ? "budget" : "savings"}
        options={EXTRA_PAYCHECK_OPTIONS}
        onChange={(v) => setMode(v === "savings")}
        disabled={disabled || rules.length === 0}
      />
    </FieldRow>
  );
}
