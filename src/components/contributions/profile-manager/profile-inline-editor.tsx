import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import type { ActiveFieldsRoot, DeductionRow } from "./profile-types";
import { InlineDeductions, renderInlineAccountRows } from "./inline-sections";

/**
 * Same fields as ProfileDetailPanel, rendered as inputs. There is no Save
 * button: each field commits on blur (checkboxes on change, since they have
 * no natural blur moment), sending only that field's patch — the same
 * commit-on-blur model as SavingsAllocationTable. Draft strings exist purely
 * so typing a multi-digit number doesn't fire a mutation per keystroke.
 */
export function ProfileInlineEditor({
  profileId,
  onSaved,
}: {
  profileId: number;
  onSaved: () => void;
}) {
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

  // patchAccount/patchDeduction used to read-merge-write the whole
  // contributionActiveFields blob client-side (from a query snapshot that
  // goes stale the instant a prior commit resolves) and PUT it back through
  // `update` — a client-side reimplementation of what
  // setAccountActiveFields/setDeductionActiveFields already do server-side,
  // in one transaction, off the freshest row. Two fields committed in quick
  // succession could silently clobber each other under the old path. These
  // call the server-side patch procedures directly instead.
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

  if (!profile) return null;

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

  return (
    <div>
      <FormError
        error={updateMutation.error ?? patchError}
        prefix="Failed to save profile"
        className="mb-3"
      />
      {limitWarning && (
        <p
          role="status"
          className="mb-3 text-xs text-amber-700 dark:text-amber-400"
        >
          {limitWarning}
        </p>
      )}

      <div className="mb-5 max-w-sm">
        <FormField label="Description">
          <FormInput
            type="text"
            value={drafts["profile:description"] ?? profile.description ?? ""}
            onChange={(e) => setDraft("profile:description", e.target.value)}
            onBlur={commitProfileDescription}
            placeholder="Optional description"
          />
        </FormField>
      </div>

      {profile.accountDetails.length > 0 && (
        <div className="mb-5">
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Contribution Accounts
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-strong border-b-2">
                <th
                  className="text-muted w-6 py-2 pl-4 text-left font-medium"
                  title="Enabled in this profile"
                >
                  On
                </th>
                <th className="text-muted px-3 py-2 text-left font-medium">
                  Account
                </th>
                <th className="text-muted w-28 px-3 py-2 text-left font-medium">
                  Method
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Value
                </th>
                <th className="text-muted w-28 px-3 py-2 text-left font-medium">
                  Match Type
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Employer Match
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Match Cap
                </th>
              </tr>
            </thead>
            <tbody>
              {renderInlineAccountRows(
                profile,
                accountActiveFields,
                drafts,
                setAccountFields,
                setAccountActive,
                setDraft,
                commitText,
                patchAccount,
                commitNumeric,
                clearDraft,
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Deductions — no base value on the row any more (Stage B): each
          deduction is either given an amountPerPeriod by this profile, or
          it has none at all (same "not set" state as an unset contribution
          value, no live fallback). */}
      <InlineDeductions
        setAddingDeduction={setAddingDeduction}
        addingDeduction={addingDeduction}
        createDeduction={createDeduction}
        deductionRows={deductionRows}
        deductionActiveFields={deductionActiveFields}
        profile={profile}
        setDeductionFields={setDeductionFields}
        drafts={drafts}
        setDraft={setDraft}
        clearDraft={clearDraft}
        patchDeductionRecord={patchDeductionRecord}
        commitNumeric={commitNumeric}
        patchDeduction={patchDeduction}
      />

      {/* The old "Employer & Bonus Handling" jobs active-fields section was
          removed in the Stage B migration — see the matching comment in
          ProfileEditor above. */}
    </div>
  );
}
