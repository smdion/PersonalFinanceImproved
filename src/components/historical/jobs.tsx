"use client";

import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { DataTable } from "@/components/settings/data-table";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PAY_PERIOD_CONFIG } from "@/lib/config/pay-periods";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

type Job = {
  id: number;
  personId: number;
  employerName: string;
  title: string | null;
  annualSalary: string;
  payPeriod: string;
  payWeek: string;
  startDate: string;
  endDate: string | null;
  anchorPayDate: string | null;
  bonusPercent: string;
  bonusMultiplier: string;
  bonusOverride: string | null;
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
  monthsInBonusYear: number;
  include401kInBonus: boolean;
  includeBonusInContributions: boolean;
  w4FilingStatus: string;
  w4Box2cChecked: boolean;
  additionalFedWithholding: string;
  budgetPeriodsPerMonth: string | null;
};

type SalaryChange = {
  id: number;
  jobId: number;
  effectiveDate: string;
  newSalary: string;
  raisePercent: string | null;
  notes: string | null;
};

const PERSON_COLORS = ["#3b82f6", "#a855f7", "#22c55e", "#f59e0b"];

function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function duration(start: string, end: string | null): string {
  const s = new Date(start + "T00:00:00");
  const e = end ? new Date(end + "T00:00:00") : new Date();
  const months =
    (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  if (yrs === 0) return `${mos}mo`;
  if (mos === 0) return `${yrs}yr`;
  return `${yrs}yr ${mos}mo`;
}

export function JobsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data: people } = trpc.settings.people.list.useQuery();
  const { data, isLoading } = trpc.settings.jobs.list.useQuery();
  const { data: salaryChanges } = trpc.settings.salaryChanges.list.useQuery();
  const deleteMut = trpc.settings.jobs.delete.useMutation({
    onSuccess: () => utils.settings.jobs.list.invalidate(),
  });
  const createMut = trpc.settings.jobs.create.useMutation({
    onSuccess: () => utils.settings.jobs.list.invalidate(),
  });
  const updateMut = trpc.settings.jobs.update.useMutation({
    onSuccess: () => utils.settings.jobs.list.invalidate(),
  });

  const personName = useCallback(
    (id: number) => people?.find((p) => p.id === id)?.name ?? String(id),
    [people],
  );

  // Build salary timeline for chart
  const salaryTimeline = useMemo(() => {
    if (!data || !people) return [];

    const personIds = Array.from(
      new Set(data.map((j: Job) => j.personId as number)),
    );
    const events: { date: string; [key: string]: number | string }[] = [];

    // Build salary map: person → array of { date, salary }
    for (const pid of personIds) {
      const pName = personName(pid);
      const jobs = data
        .filter((j: Job) => j.personId === pid)
        .sort((a: Job, b: Job) => a.startDate.localeCompare(b.startDate));

      for (const job of jobs) {
        // Starting salary
        events.push({ date: job.startDate, [pName]: Number(job.annualSalary) });

        // Salary changes for this job
        const changes = (salaryChanges ?? [])
          .filter((sc: SalaryChange) => sc.jobId === job.id)
          .sort((a: SalaryChange, b: SalaryChange) =>
            a.effectiveDate.localeCompare(b.effectiveDate),
          );

        for (const sc of changes) {
          events.push({
            date: sc.effectiveDate,
            [pName]: Number(sc.newSalary),
          });
        }

        // Job end — keep last salary until end, then drop
        if (job.endDate) {
          events.push({
            date: job.endDate,
            [pName]: Number(
              changes.length > 0
                ? changes[changes.length - 1]!.newSalary
                : job.annualSalary,
            ),
          });
        }
      }
    }

    // Sort and forward-fill so each point has all persons
    events.sort((a, b) => a.date.localeCompare(b.date));

    const current: Record<string, number> = {};
    const filled = events.map((e) => {
      const point: Record<string, number | string> = { date: e.date };
      for (const pid of personIds) {
        const pName = personName(pid);
        if (typeof e[pName] === "number") current[pName] = e[pName] as number;
        if (current[pName] !== undefined) point[pName] = current[pName];
      }
      return point;
    });

    // Add current date point with latest salaries
    if (filled.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const last = filled[filled.length - 1];
      if (last && last.date !== today) {
        const todayPoint: Record<string, number | string> = { date: today };
        for (const pid of personIds) {
          const pName = personName(pid);
          if (current[pName] !== undefined) todayPoint[pName] = current[pName];
        }
        filled.push(todayPoint);
      }
    }

    return filled;
  }, [data, salaryChanges, people, personName]);

  const personNames = useMemo(() => {
    if (!data || !people) return [];
    return Array.from(
      new Set(data.map((j: Job) => personName(j.personId as number))),
    );
  }, [data, people, personName]);

  // Group jobs by person for timeline display
  const jobsByPerson = useMemo(() => {
    if (!data || !people) return [];
    const grouped = new Map<number, Job[]>();
    for (const job of data) {
      const list = grouped.get(job.personId) ?? [];
      list.push(job);
      grouped.set(job.personId, list);
    }
    return Array.from(grouped.entries()).map(([pid, jobs]) => ({
      personId: pid,
      name: personName(pid),
      jobs: jobs.sort((a: Job, b: Job) =>
        a.startDate.localeCompare(b.startDate),
      ),
    }));
  }, [data, people, personName]);

  return (
    <div className="space-y-6">
      {/* Salary Progression Chart */}
      {salaryTimeline.length > 1 && (
        <div>
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
            Salary Progression
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={salaryTimeline}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                fontSize={10}
                tickFormatter={(d: string) => formatDate(d)}
              />
              <YAxis
                fontSize={10}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              />
              <RechartsTooltip
                labelFormatter={(d: unknown) => formatDate(String(d))}
                formatter={(value: unknown, name: unknown) => [
                  formatCurrency(Number(value)),
                  String(name),
                ]}
                contentStyle={{ fontSize: 11 }}
              />
              {personNames.map((name, i) => (
                <Area
                  key={name}
                  type="stepAfter"
                  dataKey={name}
                  stroke={PERSON_COLORS[i % PERSON_COLORS.length]}
                  fill={PERSON_COLORS[i % PERSON_COLORS.length]}
                  fillOpacity={0.1}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Job Timeline by Person */}
      {jobsByPerson.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
            Employment Timeline
          </h3>
          <div className="space-y-4">
            {jobsByPerson.map(({ personId, name, jobs }, pi) => (
              <div key={personId}>
                <div className="text-xs font-semibold text-secondary mb-2 flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{
                      backgroundColor: PERSON_COLORS[pi % PERSON_COLORS.length],
                    }}
                  />
                  {name}
                </div>
                <div className="space-y-1.5">
                  {jobs.map((job: Job) => {
                    const isCurrent = !job.endDate;
                    const jobChanges = (salaryChanges ?? [])
                      .filter((sc: SalaryChange) => sc.jobId === job.id)
                      .sort((a: SalaryChange, b: SalaryChange) =>
                        a.effectiveDate.localeCompare(b.effectiveDate),
                      );
                    const currentSalary =
                      jobChanges.length > 0
                        ? Number(jobChanges[jobChanges.length - 1]!.newSalary)
                        : Number(job.annualSalary);
                    const startingSalary = Number(job.annualSalary);
                    const totalRaise = currentSalary - startingSalary;

                    return (
                      <div
                        key={job.id}
                        className={`flex items-start gap-3 p-2.5 rounded-lg border text-xs ${
                          isCurrent
                            ? "border-blue-200 bg-blue-50/50"
                            : "bg-surface-sunken/50"
                        }`}
                      >
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center pt-0.5">
                          <div
                            className={`w-2 h-2 rounded-full${isCurrent ? "bg-blue-500 ring-2 ring-blue-200" : "bg-surface-strong"}`}
                          />
                          {isCurrent && (
                            <div className="text-[9px] text-blue-600 font-semibold mt-0.5">
                              NOW
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-primary">
                              {job.employerName}
                            </span>
                            <span className="text-faint">·</span>
                            <span className="text-muted">{job.payPeriod}</span>
                            <span className="text-faint">·</span>
                            <span className="text-muted">
                              {job.w4FilingStatus}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-muted">
                            <span>
                              {formatDate(job.startDate)} —{" "}
                              {isCurrent ? "Present" : formatDate(job.endDate)}
                            </span>
                            <span className="text-faint">·</span>
                            <span>{duration(job.startDate, job.endDate)}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="font-medium text-primary tabular-nums">
                              {formatCurrency(currentSalary)}
                            </span>
                            {totalRaise > 0 && (
                              <span className="text-green-600 text-[10px]">
                                +{formatCurrency(totalRaise)} (
                                {formatPercent(totalRaise / startingSalary, 1)})
                                over {jobChanges.length} raise
                                {jobChanges.length !== 1 ? "s" : ""}
                              </span>
                            )}
                            {startingSalary !== currentSalary && (
                              <span className="text-faint text-[10px]">
                                started at {formatCurrency(startingSalary)}
                              </span>
                            )}
                          </div>
                          {/* Salary change milestones */}
                          {jobChanges.length > 0 && (
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                              {jobChanges.map((sc: SalaryChange) => (
                                <span
                                  key={sc.id}
                                  className="text-[10px] text-faint"
                                >
                                  {formatDate(sc.effectiveDate)}:{" "}
                                  {formatCurrency(Number(sc.newSalary))}
                                  {sc.raisePercent
                                    ? ` (+${formatPercent(Number(sc.raisePercent), 1)})`
                                    : ""}
                                  {sc.notes ? ` — ${sc.notes}` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw Data Table (for editing) */}
      <DataTable
        title="Jobs"
        columns={[
          {
            key: "personId",
            label: "Person",
            render: (r) => personName(r.personId),
          },
          { key: "employerName", label: "Employer" },
          {
            key: "annualSalary",
            label: "Starting Salary",
            render: (r) => formatCurrency(Number(r.annualSalary)),
          },
          { key: "payPeriod", label: "Pay Period" },
          {
            key: "startDate",
            label: "Start",
            render: (r) => formatDate(r.startDate),
          },
          {
            key: "endDate",
            label: "End",
            render: (r) => (r.endDate ? formatDate(r.endDate) : "Current"),
          },
          { key: "w4FilingStatus", label: "W4 Status" },
        ]}
        data={data}
        isLoading={isLoading}
        onDelete={admin ? (id) => deleteMut.mutate({ id }) : undefined}
        isDeleting={deleteMut.isPending}
        renderForm={
          admin
            ? (editing, onClose) => (
                <JobForm
                  initial={editing}
                  people={people ?? []}
                  onSubmit={(vals) => {
                    if (editing) {
                      updateMut.mutate(
                        { id: editing.id, ...vals },
                        { onSuccess: onClose },
                      );
                    } else {
                      createMut.mutate(vals, { onSuccess: onClose });
                    }
                  }}
                  onCancel={onClose}
                  isPending={createMut.isPending || updateMut.isPending}
                />
              )
            : undefined
        }
      />

      {salaryChanges && salaryChanges.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
            Salary Changes
          </h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-strong">
                <th className="text-left px-3 py-2 text-muted font-medium">
                  Person / Employer
                </th>
                <th className="text-left px-3 py-2 text-muted font-medium">
                  Effective
                </th>
                <th className="text-right px-3 py-2 text-muted font-medium">
                  New Salary
                </th>
                <th className="text-right px-3 py-2 text-muted font-medium">
                  Raise
                </th>
                <th className="text-left px-3 py-2 text-muted font-medium">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {salaryChanges.map((sc: SalaryChange) => {
                const job = data?.find((j: Job) => j.id === sc.jobId);
                return (
                  <tr
                    key={sc.id}
                    className="border-b border-subtle hover:bg-blue-50/60"
                  >
                    <td className="px-3 py-1.5 text-secondary">
                      {job
                        ? `${personName(job.personId)} @ ${job.employerName}`
                        : `Job #${sc.jobId}`}
                    </td>
                    <td className="px-3 py-1.5 text-muted">
                      {formatDate(sc.effectiveDate)}
                    </td>
                    <td className="text-right px-3 py-1.5 tabular-nums font-medium">
                      {formatCurrency(Number(sc.newSalary))}
                    </td>
                    <td className="text-right px-3 py-1.5 tabular-nums text-green-600">
                      {sc.raisePercent
                        ? `+${formatPercent(Number(sc.raisePercent), 1)}`
                        : ""}
                    </td>
                    <td className="px-3 py-1.5 text-muted">{sc.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function JobForm({
  initial,
  people,
  onSubmit,
  onCancel,
  isPending,
}: {
  initial: Job | null;
  people: { id: number; name: string }[];
  onSubmit: (v: {
    personId: number;
    employerName: string;
    annualSalary: string;
    payPeriod: "weekly" | "biweekly" | "semimonthly" | "monthly";
    payWeek: "even" | "odd" | "na";
    startDate: string;
    endDate: string | null;
    w4FilingStatus: "MFJ" | "Single" | "HOH";
    budgetPeriodsPerMonth: string | null;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [personId, setPersonId] = useState(
    initial?.personId ?? people[0]?.id ?? 0,
  );
  const [employer, setEmployer] = useState(initial?.employerName ?? "");
  const [salary, setSalary] = useState(initial?.annualSalary ?? "");
  const [payPeriod, setPayPeriod] = useState(initial?.payPeriod ?? "biweekly");
  const [payWeek, setPayWeek] = useState(initial?.payWeek ?? "na");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [filing, setFiling] = useState(initial?.w4FilingStatus ?? "MFJ");
  const [budgetPeriods, setBudgetPeriods] = useState(
    initial?.budgetPeriodsPerMonth ?? "",
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          personId,
          employerName: employer,
          annualSalary: salary,
          payPeriod: payPeriod as "biweekly",
          payWeek: payWeek as "even",
          startDate,
          endDate: endDate || null,
          w4FilingStatus: filing as "MFJ",
          budgetPeriodsPerMonth: budgetPeriods || null,
        });
      }}
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
    >
      <label className="flex flex-col text-sm">
        Person
        <select
          value={personId}
          onChange={(e) => setPersonId(Number(e.target.value))}
          className="mt-1 px-2 py-1 border rounded"
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-sm">
        Employer
        <input
          value={employer}
          onChange={(e) => setEmployer(e.target.value)}
          required
          className="mt-1 px-2 py-1 border rounded"
        />
      </label>
      <label className="flex flex-col text-sm">
        Annual Salary
        <input
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
          required
          className="mt-1 px-2 py-1 border rounded"
        />
      </label>
      <label className="flex flex-col text-sm">
        Pay Period
        <select
          value={payPeriod}
          onChange={(e) => setPayPeriod(e.target.value)}
          className="mt-1 px-2 py-1 border rounded"
        >
          <option value="weekly">Weekly</option>
          <option value="biweekly">Biweekly</option>
          <option value="semimonthly">Semimonthly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <label className="flex flex-col text-sm">
        Budget paychecks/mo
        <input
          type="number"
          step="any"
          min="0"
          value={budgetPeriods}
          onChange={(e) => setBudgetPeriods(e.target.value)}
          placeholder={String(
            PAY_PERIOD_CONFIG[payPeriod]?.defaultBudgetPerMonth ?? "",
          )}
          title={`Paychecks included in monthly budget. Leave blank for default (${PAY_PERIOD_CONFIG[payPeriod]?.defaultBudgetPerMonth ?? ""}). Set to ${((PAY_PERIOD_CONFIG[payPeriod]?.periodsPerYear ?? 12) / 12).toFixed(2)} to include all paychecks.`}
          className="mt-1 px-2 py-1 border rounded"
        />
      </label>
      <label className="flex flex-col text-sm">
        Pay Week
        <select
          value={payWeek}
          onChange={(e) => setPayWeek(e.target.value)}
          className="mt-1 px-2 py-1 border rounded"
        >
          <option value="even">Even</option>
          <option value="odd">Odd</option>
          <option value="na">N/A</option>
        </select>
      </label>
      <label className="flex flex-col text-sm">
        Start Date
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
          className="mt-1 px-2 py-1 border rounded"
        />
      </label>
      <label className="flex flex-col text-sm">
        End Date
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="mt-1 px-2 py-1 border rounded"
        />
      </label>
      <label className="flex flex-col text-sm">
        W4 Filing Status
        <select
          value={filing}
          onChange={(e) => setFiling(e.target.value)}
          className="mt-1 px-2 py-1 border rounded"
        >
          <option value="MFJ">MFJ</option>
          <option value="Single">Single</option>
          <option value="HOH">HOH</option>
        </select>
      </label>
      <div className="col-span-full flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {initial ? "Update" : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm border rounded hover:bg-surface-elevated"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
