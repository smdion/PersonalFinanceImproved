import type { Dispatch, SetStateAction } from "react";
import type { trpc } from "@/lib/trpc";
import {
  entryMatchFigure,
  matchFigureForForm,
} from "@/lib/pure/contributions/match-display";
import { resolveContribFieldDisplayState } from "@/lib/pure/household/profiles";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  DeductionForm,
  type DeductionFormValues,
} from "@/components/paycheck/deduction-form";
import { groupSharedMatchAccounts } from "./match-groups";
import type { DeductionRow } from "./profile-types";
import type { ProfileDetail } from "./account-row-types";
import {
  InlineEnabledCell,
  InlineMethodCell,
  InlineNameCell,
  InlineValueCell,
} from "./inline-account-cells";
import {
  InlineCapCell,
  InlineMatchCell,
  InlineMatchTypeCell,
} from "./inline-match-cells";
import {
  InlineDeductionAmountCell,
  InlineDeductionNameCell,
  InlineDeductionPretaxCell,
  InlineDeductionRemoveCell,
} from "./inline-deduction-cells";

export function renderInlineAccountRows(
  profile: ProfileDetail,
  accountActiveFields: (id: number) => Record<string, unknown>,
  drafts: Record<string, string>,
  setAccountFields: ReturnType<
    typeof trpc.contributionProfile.setAccountActiveFields.useMutation
  >,
  setAccountActive: ReturnType<
    typeof trpc.settings.contributionAccounts.setActive.useMutation
  >,
  setDraft: (key: string, value: string) => void,
  commitText: (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
  ) => void,
  patchAccount: (accountId: number, changes: Record<string, unknown>) => void,
  commitNumeric: (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
    toValue: (num: number) => unknown,
  ) => void,
  clearDraft: (key: string) => void,
) {
  const { sharedMatchSource: editSharedMatchSource } = groupSharedMatchAccounts(
    profile.accountDetails,
  );
  return profile.accountDetails.map((ad, rowIdx) => {
    const sharedFrom = editSharedMatchSource.get(ad.id);
    const af = accountActiveFields(ad.id);
    const storedMethod =
      af.contributionMethod !== undefined ? String(af.contributionMethod) : "";
    // The <select> has no blank option: unset shows "% of Salary".
    const effectiveMethod =
      drafts[`a${ad.id}:method`] ?? (storedMethod || "percent_of_salary");
    const isPercent = effectiveMethod === "percent_of_salary";
    // Profile-owned: resolved as applyContribActiveFields does.
    const storedMatchType =
      af.employerMatchType !== undefined ? String(af.employerMatchType) : "";
    const effectiveMatchType = storedMatchType || ad.liveMatchType || "none";
    const hasMatch = effectiveMatchType !== "none";
    const isPercentMatch = effectiveMatchType === "percent_of_contribution";
    const isDisabled = af.isActive === false;
    const isSaving =
      setAccountFields.isPending &&
      setAccountFields.variables.accountId === ad.id;
    const storedValue =
      af.contributionValue !== undefined ? String(af.contributionValue) : "";
    const storedName =
      af.displayNameCustom !== undefined ? String(af.displayNameCustom) : "";
    // No resolved value: the live match isn't in effect, so isn't shown.
    const { hasValue: contribHasValue } = resolveContribFieldDisplayState(af);
    const ownMatch = entryMatchFigure(effectiveMatchType, af);
    const storedMatch =
      ownMatch ??
      (contribHasValue
        ? matchFigureForForm(
            ad.liveMatchType,
            ad.liveMatchValue,
            ad.liveMatchRate,
          )
        : "");
    const storedCap =
      af.employerMaxMatchPct !== undefined
        ? String(Number(af.employerMaxMatchPct) * 100)
        : contribHasValue && ad.liveMaxMatchPct != null
          ? String(Number(ad.liveMaxMatchPct) * 100)
          : "";
    return (
      <tr
        key={ad.id}
        aria-busy={isSaving}
        className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
          rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
        } ${isDisabled ? "opacity-40" : ""} ${isSaving ? "pointer-events-none opacity-60" : ""}`}
      >
        <InlineEnabledCell
          isDisabled={isDisabled}
          ad={ad}
          patchAccount={patchAccount}
        />
        <InlineNameCell
          isDisabled={isDisabled}
          ad={ad}
          setAccountActive={setAccountActive}
          drafts={drafts}
          storedName={storedName}
          setDraft={setDraft}
          commitText={commitText}
          patchAccount={patchAccount}
          af={af}
        />
        <InlineMethodCell
          effectiveMethod={effectiveMethod}
          storedValue={storedValue}
          patchAccount={patchAccount}
          ad={ad}
          setDraft={setDraft}
        />
        <InlineValueCell
          isPercent={isPercent}
          drafts={drafts}
          ad={ad}
          storedValue={storedValue}
          setDraft={setDraft}
          commitNumeric={commitNumeric}
          patchAccount={patchAccount}
          effectiveMethod={effectiveMethod}
          clearDraft={clearDraft}
        />
        <InlineMatchTypeCell
          effectiveMatchType={effectiveMatchType}
          patchAccount={patchAccount}
          ad={ad}
        />
        <InlineMatchCell
          hasMatch={hasMatch}
          effectiveMatchType={effectiveMatchType}
          drafts={drafts}
          ad={ad}
          storedMatch={storedMatch}
          setDraft={setDraft}
          commitNumeric={commitNumeric}
          patchAccount={patchAccount}
          ownMatch={ownMatch}
          sharedFrom={sharedFrom}
        />
        <InlineCapCell
          hasMatch={hasMatch}
          isPercentMatch={isPercentMatch}
          drafts={drafts}
          ad={ad}
          storedCap={storedCap}
          setDraft={setDraft}
          commitNumeric={commitNumeric}
          patchAccount={patchAccount}
          af={af}
        />
      </tr>
    );
  });
}
export function InlineDeductions({
  setAddingDeduction,
  addingDeduction,
  createDeduction,
  deductionRows,
  deductionActiveFields,
  profile,
  setDeductionFields,
  drafts,
  setDraft,
  clearDraft,
  patchDeductionRecord,
  commitNumeric,
  patchDeduction,
}: {
  setAddingDeduction: Dispatch<SetStateAction<boolean>>;
  addingDeduction: boolean;
  createDeduction: ReturnType<
    typeof trpc.settings.deductions.create.useMutation
  >;
  deductionRows: DeductionRow[] | undefined;
  deductionActiveFields: (id: number) => Record<string, unknown>;
  profile: ProfileDetail;
  setDeductionFields: ReturnType<
    typeof trpc.contributionProfile.setDeductionActiveFields.useMutation
  >;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  patchDeductionRecord: (
    d: DeductionRow,
    changes: Partial<
      Pick<DeductionRow, "deductionName" | "isPretax" | "ficaExempt">
    >,
  ) => void;
  commitNumeric: (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
    toValue: (num: number) => unknown,
  ) => void;
  patchDeduction: (
    deductionId: number,
    changes: Record<string, unknown>,
  ) => void;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-label text-muted font-semibold tracking-wide uppercase">
          Deductions
        </h4>
        <button
          type="button"
          onClick={() => setAddingDeduction(true)}
          className="text-caption font-medium text-blue-600 hover:text-blue-700"
        >
          + Add Deduction
        </button>
      </div>

      <SlidePanel
        isOpen={addingDeduction}
        onClose={() => setAddingDeduction(false)}
        title="Add Deduction"
      >
        <DeductionForm
          onSave={(data: DeductionFormValues) => createDeduction.mutate(data)}
          onCancel={() => setAddingDeduction(false)}
          isPending={createDeduction.isPending}
        />
      </SlidePanel>

      {deductionRows && deductionRows.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-strong border-b-2">
              <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                Deduction
              </th>
              <th className="text-muted w-24 px-3 py-2 text-left font-medium">
                Pretax
              </th>
              <th className="text-muted w-28 px-3 py-2 text-right font-medium">
                Amount / Period
              </th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {deductionRows.map((d: DeductionRow, rowIdx: number) => {
              const df = deductionActiveFields(d.id);
              const storedAmount =
                df.amountPerPeriod !== undefined
                  ? String(df.amountPerPeriod)
                  : "";
              const personName =
                profile.deductionDetails.find((dd) => dd.id === d.id)
                  ?.employerName ?? `Job ${d.jobId}`;
              const storedName = d.deductionName;
              const isSaving =
                setDeductionFields.isPending &&
                setDeductionFields.variables.deductionId === d.id;
              return (
                <tr
                  key={d.id}
                  aria-busy={isSaving}
                  className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                    rowIdx % 2 === 1
                      ? "bg-surface-sunken/60"
                      : "bg-surface-primary"
                  } ${isSaving ? "pointer-events-none opacity-60" : ""}`}
                >
                  <InlineDeductionNameCell
                    drafts={drafts}
                    d={d}
                    storedName={storedName}
                    setDraft={setDraft}
                    clearDraft={clearDraft}
                    patchDeductionRecord={patchDeductionRecord}
                    personName={personName}
                  />
                  <InlineDeductionPretaxCell
                    d={d}
                    patchDeductionRecord={patchDeductionRecord}
                  />
                  <InlineDeductionAmountCell
                    drafts={drafts}
                    d={d}
                    storedAmount={storedAmount}
                    setDraft={setDraft}
                    commitNumeric={commitNumeric}
                    patchDeduction={patchDeduction}
                  />
                  <InlineDeductionRemoveCell
                    storedAmount={storedAmount}
                    clearDraft={clearDraft}
                    d={d}
                    patchDeduction={patchDeduction}
                  />
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
