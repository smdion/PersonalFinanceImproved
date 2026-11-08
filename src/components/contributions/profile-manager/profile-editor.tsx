import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormError } from "@/components/ui/form-error";
import type { ContribDraft, MatchDraft } from "./account-row-types";
import {
  NewProfileAccounts,
  NewProfileDeductions,
  NewProfileHeader,
} from "./new-profile-sections";
import { useNewProfileSave } from "./use-new-profile-save";

/**
 * Create-new form. The one place a batched Save survives: a profile row has
 * to exist before per-field edits have anywhere to write. Once created, the
 * profile is edited in place by ProfileInlineEditor (padlock-gated,
 * commit-on-blur) — there is no Save/Cancel/Reset for an existing profile.
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
  const [contribValues, setContribValues] = useState<
    Record<string, ContribDraft>
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

  const { handleSave, isPending, baseData } = useNewProfileSave(
    contribValues,
    nameValues,
    disabledAccounts,
    matchValues,
    deductionValues,
    createMutation,
    name,
    description,
  );

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
          contribValues={contribValues}
          setDisabledAccounts={setDisabledAccounts}
          nameValues={nameValues}
          setNameValues={setNameValues}
          setContribValues={setContribValues}
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
        {/* The old "Employer & Bonus Handling" jobs active-fields section
            was removed in the Stage B migration — that bucket
            (contributionActiveFields.jobs) is retired entirely. Whether a
            contribution is taken from bonus checks is each account's own
            `fromBonus` (the row's checkbox above); employerName has no
            profile-override mechanism at all any more. */}
      </div>
    </div>
  );
}
