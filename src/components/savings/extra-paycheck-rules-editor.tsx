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
 * all (see DESIGN.md's extraPaycheckRouting section), not the mechanics of
 * where. Saves via savings.extraPaycheckRouting.save/saveGrowth/
 * saveOverride/setEnabled.
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
import type {
  ExtraPaycheckRule,
  ExtraPaycheckOverride,
  ExtraPaycheckRoutingData,
} from "@/lib/db/schema-pg";

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
                editingIdx={editingIdx}
                addForm={addForm}
                setFormField={setFormField}
                setSplitGoal={setSplitGoal}
                goals={goals}
                setSplitPct={setSplitPct}
                removeSplit={removeSplit}
                addSplit={addSplit}
                splitTotal={splitTotal}
              />

              <RuleFormActions
                saveForm={saveForm}
                formValid={formValid}
                saveMutation={saveMutation}
                editingIdx={editingIdx}
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
