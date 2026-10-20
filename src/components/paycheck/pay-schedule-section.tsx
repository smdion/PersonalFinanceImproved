"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { FieldRow } from "@/components/ui/field-row";
import { HelpTip } from "@/components/ui/help-tip";
import {
  PAY_PERIOD_LABELS,
  PAY_WEEK_LABELS,
} from "@/lib/config/display-labels";
import { PAY_PERIOD_VALUES, PAY_WEEK_VALUES } from "@/lib/config/enum-values";
import { PAY_PERIOD_CONFIG } from "@/lib/config/pay-periods";
import { DateInput } from "@/components/ui/date-input";
import { SectionHeader } from "./section-header";

const numeric = (v: string) => v.replace(/[^0-9.]/g, "");

/**
 * How often a job pays — the Salary Profile entry's pay schedule. Same look
 * and save path as the other salary sections (each edit goes through
 * salaryEntryEdit → patchEntry).
 */
export function PayScheduleSection({
  job,
  onUpdateJob,
  readOnly,
  note,
}: {
  job: {
    payPeriod: string;
    payWeek: string;
    anchorPayDate: string | null;
    budgetPeriodsPerMonth: number | null;
  };
  onUpdateJob: (field: string, value: string) => void;
  readOnly?: boolean;
  /** Where this section's edits save. */
  note?: string;
}) {
  const editable = !readOnly;
  const selectClass =
    "bg-surface-primary w-36 rounded border px-2 py-0.5 text-sm disabled:opacity-60";
  const defaultPerMonth =
    PAY_PERIOD_CONFIG[job.payPeriod as keyof typeof PAY_PERIOD_CONFIG]
      ?.defaultBudgetPerMonth;
  return (
    <div className="space-y-2">
      <SectionHeader note={note}>Pay schedule</SectionHeader>
      <div className="bg-surface-sunken border-subtle space-y-1.5 rounded-lg border p-4 text-sm">
        <FieldRow label="Paid">
          <select
            aria-label="Pay period"
            value={job.payPeriod}
            onChange={(e) => onUpdateJob("payPeriod", e.target.value)}
            disabled={!editable}
            className={selectClass}
          >
            {PAY_PERIOD_VALUES.map((v) => (
              <option key={v} value={v}>
                {PAY_PERIOD_LABELS[v]}
              </option>
            ))}
          </select>
        </FieldRow>
        {job.payPeriod === "biweekly" && (
          <FieldRow label="Payday weeks">
            <select
              aria-label="Pay week"
              value={job.payWeek}
              onChange={(e) => onUpdateJob("payWeek", e.target.value)}
              disabled={!editable}
              className={selectClass}
            >
              {PAY_WEEK_VALUES.map((v) => (
                <option key={v} value={v}>
                  {PAY_WEEK_LABELS[v]}
                </option>
              ))}
            </select>
          </FieldRow>
        )}
        <FieldRow
          label={
            <>
              A known payday
              <HelpTip text="Any real payday. It sets which months get a third biweekly paycheck. Blank uses the job's start date." />
            </>
          }
        >
          <DateInput
            ariaLabel="A known payday"
            value={job.anchorPayDate ?? ""}
            onCommit={(v) => onUpdateJob("anchorPayDate", v)}
            disabled={!editable}
            className={selectClass}
          />
        </FieldRow>
        <FieldRow
          label={
            <>
              Paychecks per month in the budget
              <HelpTip text="How many paychecks a month the budget counts on. Blank uses the usual number for the pay schedule." />
            </>
          }
          hint={
            job.budgetPeriodsPerMonth === null && defaultPerMonth !== undefined
              ? `Usual: ${defaultPerMonth}`
              : undefined
          }
        >
          <InlineEdit
            value={
              job.budgetPeriodsPerMonth !== null
                ? String(job.budgetPeriodsPerMonth)
                : ""
            }
            onSave={(v) => onUpdateJob("budgetPeriodsPerMonth", numeric(v))}
            formatDisplay={(v) => (v === "" ? "—" : v)}
            parseInput={numeric}
            type="number"
            className="font-medium"
            isEditable={editable}
            hideEditIcon
            ariaLabel="Paychecks per month in the budget"
          />
        </FieldRow>
      </div>
    </div>
  );
}
