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
  const [isPretax, setIsPretax] = useState(true);
  const [ficaExempt, setFicaExempt] = useState(false);

  const canSubmit = jobId != null && deductionName.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit || jobId == null) return;
    onSave({
      jobId,
      deductionName: deductionName.trim(),
      isPretax,
      ficaExempt,
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

      <FormField label="Tax Treatment">
        <FormSelect
          value={isPretax ? "pretax" : "posttax"}
          onChange={(e) => setIsPretax(e.target.value === "pretax")}
        >
          <option value="pretax">Pretax</option>
          <option value="posttax">Post-tax</option>
        </FormSelect>
      </FormField>

      <label className="flex items-center gap-2 text-sm text-secondary">
        <input
          type="checkbox"
          checked={ficaExempt}
          onChange={(e) => setFicaExempt(e.target.checked)}
        />
        FICA-exempt
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Create Deduction"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted hover:text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
