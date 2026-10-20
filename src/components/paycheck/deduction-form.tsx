"use client";

/**
 * Minimal create form for a paycheck deduction — jobId/deductionName/
 * isPretax/ficaExempt are the entire structural row (settings.deductions'
 * deductionInput). No amountPerPeriod field here: that value is always a
 * Contribution Profile's deductions active-field entry, set afterward in
 * the Contribution Profile editor (same no-base-value rule contribution
 * accounts follow — see contrib-account-form.tsx's header comment).
 *
 * Used by the Contribution Profiles tab's "+ Add Deduction".
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import { DEDUCTION_PRESETS } from "@/lib/config/paycheck-presets";

export type DeductionFormValues = {
  jobId: number;
  deductionName: string;
  isPretax: boolean;
  ficaExempt: boolean;
};

export function DeductionForm({
  onSave,
  onCancel,
  isPending,
}: {
  onSave: (data: DeductionFormValues) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { data: jobs } = trpc.settings.jobs.list.useQuery();
  const [jobId, setJobId] = useState<number | null>(null);
  const [deductionName, setDeductionName] = useState("");
  const [presetKey, setPresetKey] = useState(DEDUCTION_PRESETS[0]!.key);
  const preset =
    DEDUCTION_PRESETS.find((p) => p.key === presetKey) ?? DEDUCTION_PRESETS[0]!;

  const canSubmit = jobId != null && deductionName.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit || jobId == null) return;
    onSave({
      jobId,
      deductionName: deductionName.trim(),
      isPretax: preset.isPretax,
      ficaExempt: preset.ficaExempt,
    });
  };

  return (
    <div className="space-y-3">
      <FormField label="Job">
        <FormSelect
          value={jobId ?? ""}
          onChange={(e) =>
            setJobId(e.target.value ? parseInt(e.target.value, 10) : null)
          }
        >
          <option value="">Select a job…</option>
          {(jobs ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.employerName}
            </option>
          ))}
        </FormSelect>
      </FormField>

      <FormField label="Deduction Name">
        <FormInput
          type="text"
          value={deductionName}
          onChange={(e) => setDeductionName(e.target.value)}
          placeholder="e.g. Dental, HSA, 401k Loan"
        />
      </FormField>

      <FormField label="How your pay stub lists it">
        <FormSelect
          value={presetKey}
          onChange={(e) => setPresetKey(e.target.value)}
        >
          {DEDUCTION_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </FormSelect>
      </FormField>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Create Deduction"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-primary px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
