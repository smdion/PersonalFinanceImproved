import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import type { ActiveFieldsRoot, DeductionRow } from "./profile-types";
import type { ProfileDetail } from "./account-row-types";

export function useInlineEditorState(profileId: number, onSaved: () => void) {
  const { data: profile } = trpc.contributionProfile.getById.useQuery({
    id: profileId,
  });
  const { data: deductionRows } = trpc.settings.deductions.list.useQuery();
  const { drafts, setDraft, clearDraft } = useDraftCommit();
  const utils = trpc.useUtils();
  const [addingDeduction, setAddingDeduction] = useState(false);
  const createDeduction = trpc.settings.deductions.create.useMutation({
    onSuccess: () => {
      utils.settings.invalidate();
      setAddingDeduction(false);
    },
  });
  const updateDeduction = trpc.settings.deductions.update.useMutation({
    onSuccess: () => utils.settings.invalidate(),
  });
  const setAccountActive =
    trpc.settings.contributionAccounts.setActive.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.contributionProfile.invalidate();
      },
    });
  /** Same generic-field-patch pattern as paycheck/paycheck-content.tsx's onUpdateDeduction
   *  — one call site builds the full record from the current row plus the
   *  one field being changed, instead of each editable cell hand-writing
   *  its own copy of the other four fields. */
  const patchDeductionRecord = (
    d: DeductionRow,
    changes: Partial<
      Pick<DeductionRow, "deductionName" | "isPretax" | "ficaExempt">
    >,
  ) =>
    updateDeduction.mutate({
      id: d.id,
      jobId: d.jobId,
      deductionName: d.deductionName,
      isPretax: d.isPretax,
      ficaExempt: d.ficaExempt,
      ...changes,
    });
  // Over this year's limits on a profile used as a future switch: saved,
  // with the server's warning (switchProfileLimitWarning).
  const [limitWarning, setLimitWarning] = useState<string | null>(null);
  const updateMutation = trpc.contributionProfile.update.useMutation({
    onSuccess: (row) => {
      setLimitWarning(row.limitWarning);
      onSaved();
    },
  });

  // Each patch goes through the server-side procedures, which merge one
  // field into the freshest row in one transaction, so two quick commits
  // can't overwrite each other.
  const [patchError, setPatchError] = useState<{ message: string } | null>(
    null,
  );
  const setAccountFields =
    trpc.contributionProfile.setAccountActiveFields.useMutation({
      onSuccess: (row) => {
        setPatchError(null);
        setLimitWarning(row.limitWarning);
        onSaved();
      },
      onError: setPatchError,
    });
  const setDeductionFields =
    trpc.contributionProfile.setDeductionActiveFields.useMutation({
      onSuccess: () => {
        setPatchError(null);
        onSaved();
      },
      onError: setPatchError,
    });

  return {
    profile,
    deductionRows,
    drafts,
    setDraft,
    clearDraft,
    addingDeduction,
    setAddingDeduction,
    createDeduction,
    setAccountActive,
    patchDeductionRecord,
    limitWarning,
    updateMutation,
    patchError,
    setAccountFields,
    setDeductionFields,
  };
}

export function inlineEditorCommits(
  profile: ProfileDetail,
  profileId: number,
  drafts: Record<string, string>,
  clearDraft: (key: string) => void,
  setAccountFields: ReturnType<
    typeof trpc.contributionProfile.setAccountActiveFields.useMutation
  >,
  setDeductionFields: ReturnType<
    typeof trpc.contributionProfile.setDeductionActiveFields.useMutation
  >,
  updateMutation: ReturnType<
    typeof trpc.contributionProfile.update.useMutation
  >,
) {
  const root = (profile.contributionActiveFields ?? {}) as ActiveFieldsRoot; // Stored jsonb, typed by $type only: kept guarded.
  const accountActiveFields = (id: number) =>
    root.contributionAccounts?.[String(id)] ?? {};
  const deductionActiveFields = (id: number) =>
    root.deductions?.[String(id)] ?? {};

  /** Split a {key: value | undefined} changes record into a patch (fields
   *  actually being set) and an unset list (fields being cleared) — the
   *  wire format the server-side patch procedures expect, since a JSON
   *  body can't carry `undefined` as a distinguishable value from "field
   *  omitted". */
  const splitChanges = (changes: Record<string, unknown>) => {
    const fields: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) unset.push(key);
      else fields[key] = value;
    }
    return { fields, unset };
  };

  /** Send a patch for one account. `undefined` removes that key. */
  const patchAccount = (
    accountId: number,
    changes: Record<string, unknown>,
  ) => {
    const { fields, unset } = splitChanges(changes);
    setAccountFields.mutate({ profileId, accountId, fields, unset });
  };

  /** Send a patch for one deduction. `undefined` removes that key. */
  const patchDeduction = (
    deductionId: number,
    changes: Record<string, unknown>,
  ) => {
    const { fields, unset } = splitChanges(changes);
    setDeductionFields.mutate({ profileId, deductionId, fields, unset });
  };

  /**
   * Shared blur handler for a numeric field: no-ops when nothing was typed or
   * the typed value matches what's already stored, clears the value when the
   * field was emptied, otherwise sends `toValue(parsed)`.
   */
  const commitNumeric = (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
    toValue: (num: number) => unknown,
  ) => {
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    clearDraft(draftKey);
    const trimmed = draft.trim();
    if (trimmed === stored.trim()) return;
    if (trimmed === "") {
      apply(undefined);
      return;
    }
    const num = parseFloat(trimmed);
    if (isNaN(num)) return;
    apply(toValue(num));
  };

  const commitText = (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
  ) => {
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    clearDraft(draftKey);
    const trimmed = draft.trim();
    if (trimmed === stored.trim()) return;
    apply(trimmed === "" ? undefined : trimmed);
  };

  // Name is renamed from the profile list (click-to-edit on the row) — the
  // one rename gesture shared by every profile manager. This editor pane
  // owns only the fields that have nowhere else to live.
  const commitProfileDescription = () => {
    const draft = drafts["profile:description"];
    if (draft === undefined) return;
    clearDraft("profile:description");
    const trimmed = draft.trim();
    if (trimmed === (profile.description ?? "")) return;
    updateMutation.mutate({ id: profileId, description: trimmed || null });
  };

  return {
    accountActiveFields,
    deductionActiveFields,
    patchAccount,
    patchDeduction,
    commitNumeric,
    commitText,
    commitProfileDescription,
  };
}
