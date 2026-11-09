/** The salary profile tables' shared parts: row, picker, cells, totals, sections. */
import { type RouterOutputs } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { ExtraPaycheckDestinationToggle } from "@/components/savings/extra-paycheck-rules-editor";
import { PayScheduleSection } from "@/components/paycheck/pay-schedule-section";
import { TaxWithholdingSection } from "@/components/paycheck/tax-withholding-section";
import {
  BonusTerms,
  showsAllBonusTerms,
} from "@/components/paycheck/bonus-section";
import { OtherPaySection } from "@/components/paycheck/other-pay-section";
import { SectionHeader } from "@/components/paycheck/section-header";
import { useUser, isAdmin } from "@/lib/context/user-context";

/** One person's row as salaryProfile.getById returns it. */
export type Detail = NonNullable<
  RouterOutputs["salaryProfile"]["getById"]
>["salaryDetails"][number];

/**
 * Re-target a row at a different job from its jobOptions — used by the job
 * picker so switching jobs shows THAT job's real entry with no second round
 * trip. Falls back to the row unchanged if the id isn't one of this
 * person's jobs.
 */
export function detailForJob(sd: Detail, jobId: number): Detail {
  const opt = sd.jobOptions.find((jo) => jo.id === jobId);
  if (!opt) return sd;
  return {
    ...sd,
    jobId: opt.id,
    employerName: opt.employerName,
    hasEntry: opt.hasEntry,
    salary: opt.salary,
    bonusPercent: opt.bonusPercent,
    bonusMultiplier: opt.bonusMultiplier,
    monthsInBonusYear: opt.monthsInBonusYear,
    bonusOverride: opt.bonusOverride,
    effectiveSalary: opt.effectiveSalary,
    estimatedBonus: opt.estimatedBonus,
    payPeriod: opt.payPeriod,
    payWeek: opt.payWeek,
    anchorPayDate: opt.anchorPayDate,
    budgetPeriodsPerMonth: opt.budgetPeriodsPerMonth,
    w4FilingStatus: opt.w4FilingStatus,
    w4Box2cChecked: opt.w4Box2cChecked,
    additionalFedWithholding: opt.additionalFedWithholding,
    bonusMonth: opt.bonusMonth,
    bonusDayOfMonth: opt.bonusDayOfMonth,
    extraPaycheckRouting: opt.extraPaycheckRouting,
    bonusDestination: opt.bonusDestination,
    earningRows: opt.earningRows,
    formulaBonus: opt.formulaBonus,
  };
}

/** Format a display-unit number for an input without trailing float noise. */
export function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** The salary cell for a job that has an entry in this profile. */
export function SalaryCell({
  sd,
  draft,
  onDraft,
  onCommit,
}: {
  sd: Detail;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="text-faint text-xs">$</span>
      <input
        type="number"
        aria-label={`${sd.personName} salary`}
        value={draft ?? fmt(sd.salary)}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
        step="1000"
        className="bg-surface-primary text-primary w-28 rounded border px-2 py-1 text-right text-xs"
      />
    </div>
  );
}

/** Header row shared by the read-only and editable tables. Bonus terms
 *  are edited in each job's Bonus section below its row. */
export function SalaryTableHead() {
  return (
    <thead>
      <tr className="border-strong border-b-2">
        <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
          Person
        </th>
        <th className="text-muted px-3 py-2 text-left font-medium">Employer</th>
        <th className="text-muted w-32 px-3 py-2 text-right font-medium">
          Salary
        </th>
        <th className="text-muted w-28 px-3 py-2 text-right font-medium">
          Bonus
        </th>
        <th className="text-muted w-32 py-2 pr-4 pl-3 text-right font-medium">
          Total
        </th>
      </tr>
    </thead>
  );
}

/** Columns in the table — the detail row under each job spans them all. */
export const TABLE_COLUMNS = 5;

export function rowClass(rowIndex: number) {
  return `border-b border-subtle hover:bg-blue-50/60 transition-colors ${
    rowIndex % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
  }`;
}

/** Household total this profile produces — matches the server's combinedIncome. */
export function TotalsFooter({ combinedIncome }: { combinedIncome: number }) {
  return (
    <tfoot>
      <tr className="border-strong border-t-2">
        <td
          colSpan={TABLE_COLUMNS - 1}
          className="text-muted py-2 pr-3 pl-4 text-right font-medium"
        >
          Household income under this profile
        </td>
        <td className="text-primary py-2 pr-4 pl-3 text-right font-semibold tabular-nums">
          {formatCurrency(combinedIncome)}
        </td>
      </tr>
    </tfoot>
  );
}

/** Job picker shared by the read-only and editable rows. */
export function JobPicker({
  sd,
  rawSd,
  onChange,
}: {
  sd: Detail;
  rawSd: Detail;
  onChange: (jobId: number) => void;
}) {
  if (rawSd.jobOptions.length <= 1) {
    return <>{sd.employerName ?? "No active job"}</>;
  }
  return (
    <select
      aria-label={`${sd.personName}'s job`}
      value={sd.jobId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-surface-primary text-primary max-w-[10rem] rounded border px-1 py-0.5 text-xs"
    >
      {rawSd.jobOptions.map((jo) => (
        <option key={jo.id} value={jo.id}>
          {jo.employerName}
          {jo.endDate ? ` (ended ${jo.endDate})` : ""}
        </option>
      ))}
    </select>
  );
}

/**
 * A job's entry in this profile with the Paycheck page's own Withholding,
 * Bonus, Other pay and Extra paycheck sections, saving the same way
 * (salaryEntryEdit → patchEntry), plus Pay schedule, which only this
 * editor shows (the Paycheck page shows the schedule, not its fields).
 */
export function EntrySections({
  sd,
  editable,
  onUpdate,
  isActiveProfile,
}: {
  sd: Detail;
  editable: boolean;
  onUpdate: (field: string, value: string) => void;
  isActiveProfile: boolean;
}) {
  const canRemoveLines = isAdmin(useUser());
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <PayScheduleSection
          job={sd}
          onUpdateJob={onUpdate}
          readOnly={!editable}
        />
        <TaxWithholdingSection
          job={sd}
          onUpdateJob={onUpdate}
          readOnly={!editable}
        />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <SectionHeader>Bonus</SectionHeader>
          <div className="bg-surface-sunken border-subtle space-y-1.5 rounded-lg border p-4 text-sm">
            <BonusTerms
              terms={sd}
              bonusMonth={sd.bonusMonth}
              bonusDayOfMonth={sd.bonusDayOfMonth}
              bonusDestination={sd.bonusDestination}
              onUpdateJob={onUpdate}
              editable={editable}
              showAll={showsAllBonusTerms(sd)}
              formulaBonus={sd.formulaBonus}
            />
          </div>
        </div>
        {sd.jobId !== null && (
          <OtherPaySection
            jobId={sd.jobId}
            rows={sd.earningRows}
            onSetAmount={(id, amount) =>
              onUpdate(`otherEarnings:${id}`, String(amount))
            }
            readOnly={!editable}
            lineReadOnly={!editable}
            canRemove={editable && canRemoveLines}
            note="Amounts: this profile · lines: every profile"
          />
        )}
        {sd.payPeriod === "biweekly" && (
          <div className="space-y-2">
            <SectionHeader>Extra paycheck</SectionHeader>
            <div className="bg-surface-sunken border-subtle rounded-lg border p-4 text-sm">
              {!isActiveProfile ? (
                <p className="text-muted text-xs">
                  Extra-paycheck routing always applies to the active Salary
                  Profile. Make this profile active to change it here.
                </p>
              ) : sd.jobId === null ? (
                <p className="text-muted text-xs">
                  No job selected for this row.
                </p>
              ) : (
                <ExtraPaycheckDestinationToggle
                  jobId={sd.jobId}
                  routing={sd.extraPaycheckRouting}
                  disabled={!editable}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
