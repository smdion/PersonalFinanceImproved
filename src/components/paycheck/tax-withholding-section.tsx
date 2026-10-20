"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { Toggle } from "@/components/ui/toggle";
import { FieldRow } from "@/components/ui/field-row";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { SectionHeader } from "./section-header";

/**
 * W-4 tax-input controls. Deliberately a separate section from
 * BonusSection, so they're always reachable.
 *
 * These fields live on the Salary Profile entry (see SalaryProfileEntry in
 * server/helpers/salary.ts), the same axis salary and bonus terms are on —
 * so, like BonusSection, they gate on `salaryReadOnly` as well as
 * `readOnly`.
 */
export function TaxWithholdingSection({
  job,
  onUpdateJob,
  readOnly,
  salaryReadOnly,
  note,
}: {
  job: {
    w4FilingStatus: string;
    w4Box2cChecked: boolean;
    additionalFedWithholding: number;
  };
  onUpdateJob: (field: string, value: string) => void;
  readOnly?: boolean;
  /** See resolvePaycheckEditTarget — salary-profile fields. */
  salaryReadOnly?: boolean;
  /** Where this section's edits save. */
  note?: string;
}) {
  const editable = !readOnly && !salaryReadOnly;
  return (
    <div className="space-y-2">
      <SectionHeader note={note}>Withholding (W-4)</SectionHeader>
      <div className="bg-surface-sunken border-subtle space-y-1.5 rounded-lg border p-4 text-sm">
        <FieldRow label="Filing status">
          <select
            aria-label="W-4 filing status"
            value={job.w4FilingStatus}
            onChange={(e) => onUpdateJob("w4FilingStatus", e.target.value)}
            disabled={!editable}
            className="bg-surface-primary w-36 rounded border px-2 py-0.5 text-sm disabled:opacity-60"
          >
            <option value="MFJ">Married jointly</option>
            <option value="Single">Single</option>
            <option value="HOH">Head of household</option>
          </select>
        </FieldRow>
        <FieldRow
          label={
            <>
              Extra withholding
              <HelpTip text="W-4 Step 4(c) — a flat extra amount added to federal withholding each paycheck, on top of the bracket calculation." />
            </>
          }
        >
          <InlineEdit
            value={String(job.additionalFedWithholding)}
            onSave={(v) => onUpdateJob("additionalFedWithholding", v)}
            formatDisplay={(v) =>
              v && Number(v) > 0 ? formatCurrency(Number(v)) : "—"
            }
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="font-medium"
            isEditable={editable}
            hideEditIcon
          />
        </FieldRow>
        <div className="pt-1">
          <Toggle
            isChecked={job.w4Box2cChecked}
            onChange={(v) => onUpdateJob("w4Box2cChecked", String(v))}
            label="Multiple jobs or spouse works (Step 2c)"
            title="Matches the W-4 filing status/checkbox combination used to look up federal withholding brackets."
            size="xs"
            disabled={!editable}
          />
        </div>
      </div>
    </div>
  );
}
