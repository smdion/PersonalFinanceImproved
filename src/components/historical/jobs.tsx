"use client";

import { useMemo, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { DataTable } from "@/components/settings/data-table";
import { formatDate } from "@/lib/utils/format";
import { PAY_PERIOD_CONFIG } from "@/lib/config/pay-periods";
import { PERSON_COLORS } from "@/lib/utils/colors";

type Job = {
  id: number;
  personId: number;
  employerName: string;
  title: string | null;
  payPeriod: string;
  payWeek: string;
  startDate: string;
  endDate: string | null;
  anchorPayDate: string | null;
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
  include401kInBonus: boolean;
  includeBonusInContributions: boolean;
  w4FilingStatus: string;
  w4Box2cChecked: boolean;
  additionalFedWithholding: string;
  budgetPeriodsPerMonth: string | null;
  isSpeculative: boolean;
};

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

/**
 * Jobs settings — pure employment structure (employer, dates, payroll
 * config). A job carries no salary or bonus terms of its own: what someone
 * earned in the past lives on the Historical page (`historical_salaries`),
 * and what they earn now lives in the active Salary Profile. This
 * component never shows a dollar figure.
 */
export function JobsSettings() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { data: people } = trpc.settings.people.list.useQuery();
  const { data: rawData, isLoading } = trpc.settings.jobs.list.useQuery();
  // The auto-provisioned speculative job (a permanent peg for Salary
  // Profile what-if scenarios, see settings/paycheck.ts's
  // speculativeJobValues) isn't real employment history — it never
  // appears in the Employment Timeline or Jobs table, only in the Salary
  // Profile editor's job picker where it's actually used.
  const data = useMemo(
    () => rawData?.filter((j: Job) => !j.isSpeculative),
    [rawData],
  );
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
                            <div className="text-micro text-blue-600 font-semibold mt-0.5">
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
                              {formatDate(job.startDate, "short")} —{" "}
                              {isCurrent
                                ? "Present"
                                : formatDate(job.endDate!, "short")}
                            </span>
                            <span className="text-faint">·</span>
                            <span>{duration(job.startDate, job.endDate)}</span>
                          </div>
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
          { key: "payPeriod", label: "Pay Period" },
          {
            key: "startDate",
            label: "Start",
            render: (r) => formatDate(r.startDate, "short"),
          },
          {
            key: "endDate",
            label: "End",
            render: (r) =>
              r.endDate ? formatDate(r.endDate, "short") : "Current",
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
