import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormError } from "@/components/ui/form-error";
import type { ContributionDraft, MatchDraft } from "./account-row-types";
import {
  NewProfileAccounts,
  NewProfileDeductions,
  NewProfileHeader,
} from "./new-profile-sections";
import { useNewProfileSave } from "./use-new-profile-save";

/**
 * Create-new form, the only batched Save: a profile row must exist before
 * per-field edits can write. Existing profiles use ProfileInlineEditor.
 */
export function ProfileEditor({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (newId?: number) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [matchValues, setMatchValues] = useState<Record<string, MatchDraft>>(
    {},
  );
  const [contributionValues, setContributionValues] = useState<
    Record<string, ContributionDraft>
  >({});
  const [nameValues, setNameValues] = useState<Record<string, string>>({});
  const [disabledAccounts, setDisabledAccounts] = useState<
    Record<string, boolean>
  >({});
  const [deductionValues, setDeductionValues] = useState<
    Record<string, string>
  >({});

  const { data: deductionRows } = trpc.settings.deductions.list.useQuery();
  const { data: jobsList } = trpc.settings.jobs.list.useQuery();

  const createMutation = trpc.contributionProfile.create.useMutation({
    onSuccess: (created) => onSaved(created.id),
  });

  const { handleSave, isPending, baseData } = useNewProfileSave({
    contributionValues,
    nameValues,
    disabledAccounts,
    matchValues,
    deductionValues,
    createMutation,
    name,
    description,
  });

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      <FormError
        error={createMutation.error}
        prefix="Failed to save profile"
        className="mb-3"
      />

      <div className="space-y-5">
        <NewProfileHeader
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          onCancel={onCancel}
          handleSave={handleSave}
          isPending={isPending}
        />

        {/* Contribution accounts */}
        <NewProfileAccounts
          baseData={baseData}
          matchValues={matchValues}
          disabledAccounts={disabledAccounts}
          contributionValues={contributionValues}
          setDisabledAccounts={setDisabledAccounts}
          nameValues={nameValues}
          setNameValues={setNameValues}
          setContributionValues={setContributionValues}
          setMatchValues={setMatchValues}
        />
        {/* Deductions — same "leave blank = not set" rule as contribution
            accounts above; a new profile starts with no deduction amounts
            unless entered here. */}
        <NewProfileDeductions
          deductionRows={deductionRows}
          jobsList={jobsList}
          deductionValues={deductionValues}
          setDeductionValues={setDeductionValues}
        />
        {/* Bonus-check contributions are each account's own `fromBonus`
            (the row checkbox above); employerName has no profile override. */}
      </div>
    </div>
  );
}
