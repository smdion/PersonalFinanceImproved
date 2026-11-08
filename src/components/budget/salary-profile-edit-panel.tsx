import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import {
  detailForJob,
  SalaryTableHead,
  TotalsFooter,
} from "./salary-profile-entry";
import { SalaryEditRows } from "./salary-profile-edit-rows";
import { salaryEntryActions } from "./salary-profile-edit-actions";

/**
 * Unlocked, in-place editor for an existing profile. There is no Save button:
 * every field commits on blur (checkbox-free surface, so blur is the only
 * commit moment), mirroring SavingsAllocationTable's draft/commit pattern —
 * local draft strings only exist so multi-digit typing doesn't fire a
 * mutation per keystroke.
 */
export function ProfileEditPanel({
  profileId,
  isActiveProfile,
  onSaved,
}: {
  profileId: number;
  /** Extra-paycheck routing always reads/writes the globally-ACTIVE Salary
   *  Profile (see writeJobExtraPaycheckRouting's docblock, savings.ts) —
   *  never a profile a user is merely viewing. The routing editor below
   *  only renders for that profile; a non-active one shows a note instead,
   *  so edits here always land where this screen implies they do. */
  isActiveProfile: boolean;
  onSaved: () => void;
}) {
  const { data: profile } = trpc.salaryProfile.getById.useQuery({
    id: profileId,
  });
  const [error, setError] = useState<string | null>(null);
  /** In-progress text per field; cleared once its mutation is sent. */
  const { drafts, setDraft, clearDraft } = useDraftCommit();
  /** personId → jobId, when the user has picked a DIFFERENT job than the
   *  one the server selected by default (whichever job has an entry, else
   *  the active one) — the row's job picker. Client-only until a field is
   *  actually set under that job. */
  const [jobOverride, setJobOverride] = useState<Record<number, number>>({});

  const updateMutation = trpc.salaryProfile.update.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });
  // patchEntry/removeEntry replace what used to be a client-side
  // read-merge-write of the whole `salaries` blob (from a query snapshot
  // that goes stale the instant a prior commit resolves) posted through
  // `update`. Two fields committed in quick succession could silently
  // clobber each other under the old path — these call the server-side
  // patch procedures directly instead, which merge inside a transaction.
  const patchEntryMutation = trpc.salaryProfile.patchEntry.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });
  const removeEntryMutation = trpc.salaryProfile.removeEntry.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });

  if (!profile) return null;

  const details = profile.salaryDetails;

  // Name is renamed from the profile list (click-to-edit on the row) — the
  // one rename gesture shared by every profile manager.
  const {
    commitDescription,
    addEntry,
    removeEntry,
    updateEntry,
    commitSalary,
  } = salaryEntryActions(
    drafts,
    clearDraft,
    profile,
    updateMutation,
    profileId,
    patchEntryMutation,
    removeEntryMutation,
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      {error && <FormError message={error} className="mb-3" />}

      <div className="mb-4 max-w-sm">
        <FormField label="Description">
          <FormInput
            type="text"
            value={drafts.description ?? profile.description ?? ""}
            onChange={(e) => setDraft("description", e.target.value)}
            onBlur={commitDescription}
            placeholder="Optional description"
          />
        </FormField>
      </div>

      {details.length > 0 && (
        <div>
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Salary &amp; Bonus
          </h4>
          <p className="text-caption text-faint mb-2">
            A job is either in this profile (edit any field) or it isn&apos;t
            (shown as &ldquo;—&rdquo;, contributing $0) — use + Add to give it
            real numbers.
          </p>
          <table className="w-full border-collapse text-xs">
            <SalaryTableHead />
            <tbody>
              {details.map((rawSd, rowIdx) => {
                // Job picker lets a row target a DIFFERENT job than the one
                // the server picked by default (whichever job has an entry,
                // else the active one) — e.g. setting terms for a job that
                // already ended, or one that hasn't started yet.
                const override = jobOverride[rawSd.personId];
                const sd =
                  override !== undefined
                    ? detailForJob(rawSd, override)
                    : rawSd;
                const isSaving =
                  sd.jobId !== null &&
                  ((patchEntryMutation.isPending &&
                    patchEntryMutation.variables.jobId === sd.jobId) ||
                    (removeEntryMutation.isPending &&
                      removeEntryMutation.variables.jobId === sd.jobId));
                return (
                  <React.Fragment key={rawSd.personId}>
                    <SalaryEditRows
                      addEntry={addEntry}
                      commitSalary={commitSalary}
                      drafts={drafts}
                      isActiveProfile={isActiveProfile}
                      isSaving={isSaving}
                      rawSd={rawSd}
                      removeEntry={removeEntry}
                      rowIdx={rowIdx}
                      sd={sd}
                      setDraft={setDraft}
                      setJobOverride={setJobOverride}
                      updateEntry={updateEntry}
                    />
                  </React.Fragment>
                );
              })}
            </tbody>
            <TotalsFooter combinedIncome={profile.combinedIncome} />
          </table>
        </div>
      )}
    </div>
  );
}
