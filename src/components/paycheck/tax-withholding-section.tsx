"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { Toggle } from "@/components/ui/toggle";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { SectionHeader } from "./section-header";

/**
 * W-4 tax-input controls. Deliberately a separate section from
 * BonusSection — that component early-returns when there's no bonus, which
 * would make these fields permanently uneditable for anyone without one.
 *
 * These fields now live on the resolved Salary Profile entry (see
 * SalaryProfileEntry in server/helpers/salary.ts), the same axis salary and
 * bonus terms are on — so, like BonusSection's bonus-formula fields, they
 * gate on `salaryReadOnly` (requires a Salary Profile in view and its
 * padlock unlocked) in addition to `readOnly`.
 */
export function TaxWithholdingSection({
  job,
  onUpdateJob,
  readOnly,
  salaryReadOnly,
}: {
  job: {
    w4FilingStatus: string;
    w4Box2cChecked: boolean;
    additionalFedWithholding: string;
  };
  onUpdateJob: (field: string, value: string) => void;
  readOnly?: boolean;
  /** Mirrors PersonPaycheck's salary padlock — see the docblock above. */
  salaryReadOnly?: boolean;
}) {
  const editable = !readOnly && !salaryReadOnly;
  return (
    <div className="space-y-2">
      <SectionHeader>Tax Withholding</SectionHeader>
      <div className="bg-surface-sunken border border-subtle rounded-lg p-4 space-y-1.5 text-sm">
        <div className="flex justify-between items-center">
          <span>Filing Status</span>
          <select
            value={job.w4FilingStatus}
            onChange={(e) => onUpdateJob("w4FilingStatus", e.target.value)}
            disabled={!editable}
            className="text-sm border rounded px-2 py-0.5 bg-surface-primary font-medium disabled:opacity-60"
          >
            <option value="MFJ">MFJ</option>
            <option value="Single">Single</option>
            <option value="HOH">HOH</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <Toggle
            isChecked={job.w4Box2cChecked}
            onChange={(v) => onUpdateJob("w4Box2cChecked", String(v))}
            label="Multiple jobs / spouse works (W-4 Step 2c)"
            size="xs"
            disabled={!editable}
          />
          <HelpTip text="Matches the W-4 filing status/checkbox combination used to look up federal withholding brackets." />
        </div>
        <div className="flex justify-between items-center">
          <span>
            Extra withholding
            <HelpTip text="W-4 Line 4c — a flat extra amount added to federal withholding each paycheck, on top of the bracket calculation." />
          </span>
          <InlineEdit
            value={job.additionalFedWithholding}
            onSave={(v) => onUpdateJob("additionalFedWithholding", v)}
            formatDisplay={(v) =>
              v && Number(v) > 0 ? formatCurrency(Number(v)) : "—"
            }
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="font-medium"
            isEditable={editable}
          />
        </div>
      </div>
    </div>
  );
}
