import type { trpc, RouterOutputs } from "@/lib/trpc";
import { salaryEntryEdit } from "@/lib/db/shapes/salary-entry-edit";
import { BLANK_SALARY_ENTRY } from "@/lib/db/shapes/salary-entry-defaults";
import { toast } from "@/lib/hooks/use-toast";
import { Detail } from "./salary-profile-entry";

/** The edit panel's saves: description, add and remove a job, a field, the salary. */
export function salaryEntryActions(
  drafts: Record<string, string>,
  clearDraft: (key: string) => void,
  profile: NonNullable<RouterOutputs["salaryProfile"]["getById"]>,
  updateMutation: ReturnType<typeof trpc.salaryProfile.update.useMutation>,
  profileId: number,
  patchEntryMutation: ReturnType<
    typeof trpc.salaryProfile.patchEntry.useMutation
  >,
  removeEntryMutation: ReturnType<
    typeof trpc.salaryProfile.removeEntry.useMutation
  >,
) {
  const commitDescription = () => {
    const draft = drafts.description;
    if (draft === undefined) return;
    clearDraft("description");
    const trimmed = draft.trim();
    if (trimmed === (profile.description ?? "")) return;
    updateMutation.mutate({ id: profileId, description: trimmed || null });
  };

  /** Add this job to the profile with a blank entry — the explicit action
   *  that turns a "—" row into an editable one. */
  const addEntry = (jobId: number | null) => {
    if (jobId === null) return;
    patchEntryMutation.mutate({
      id: profileId,
      jobId,
      fields: BLANK_SALARY_ENTRY,
    });
  };

  /** Remove this job's entry entirely — it goes back to contributing $0,
   *  the same as a job that was never added. */
  const removeEntry = (jobId: number | null) => {
    if (jobId === null) return;
    removeEntryMutation.mutate({ id: profileId, jobId });
  };

  /** Save one field edit to a job's entry — the same parse and save path
   *  as the Paycheck page (salaryEntryEdit → patchEntry). Entries are always
   *  complete, so this only runs for a job that already has one. */
  const updateEntry = (sd: Detail) => (field: string, value: string) => {
    if (sd.jobId === null || !profile.salaries[String(sd.jobId)]) return;
    const edit = salaryEntryEdit(field, value, {
      otherEarnings: Object.fromEntries(
        sd.earningRows.map((r) => [String(r.id), r.amount]),
      ),
    });
    if (edit === null) toast.error("That value isn't valid here.");
    else if (edit)
      patchEntryMutation.mutate({
        id: profileId,
        jobId: sd.jobId,
        fields: edit,
      });
  };

  const commitSalary = (sd: Detail) => {
    const key = `${sd.personId}:salary`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    if (Number(draft) === sd.salary) return;
    updateEntry(sd)("annualSalary", draft);
  };

  return {
    commitDescription,
    addEntry,
    removeEntry,
    updateEntry,
    commitSalary,
  };
}
