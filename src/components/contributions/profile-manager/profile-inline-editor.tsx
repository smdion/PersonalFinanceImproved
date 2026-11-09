import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import { InlineDeductions, renderInlineAccountRows } from "./inline-sections";
import { inlineEditorCommits, useInlineEditorState } from "./use-inline-editor";
import { AccountFieldHeaders } from "./account-fields";

/**
 * ProfileDetailPanel's fields as inputs, no Save: each field commits its own patch on blur
 * (checkboxes on change). Drafts keep multi-digit typing from firing a mutation per keystroke.
 */
export function ProfileInlineEditor({
  profileId,
  onSaved,
}: {
  profileId: number;
  onSaved: () => void;
}) {
  const {
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
  } = useInlineEditorState(profileId, onSaved);
  if (!profile) return null;

  const {
    accountActiveFields,
    deductionActiveFields,
    patchAccount,
    patchDeduction,
    commitNumeric,
    commitText,
    commitProfileDescription,
  } = inlineEditorCommits({
    profile,
    profileId,
    drafts,
    clearDraft,
    setAccountFields,
    setDeductionFields,
    updateMutation,
  });

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
                <AccountFieldHeaders view="inline" />
              </tr>
            </thead>
            <tbody>
              {renderInlineAccountRows({
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
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Deductions: an amountPerPeriod comes only from this profile; absent
          means "not set", with no live fallback. */}
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
