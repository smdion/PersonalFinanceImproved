import type { Dispatch, SetStateAction } from "react";
import type { RouterOutputs } from "@/lib/trpc";
import { FormField, FormInput } from "@/components/forms";
import type {
  ContributionDraft,
  DeductionRow,
  MatchDraft,
  ProfileDetail,
} from "./account-row-types";
import { NEW_PROFILE_CELLS } from "./new-profile-cells";
import { ACCOUNT_FIELDS, AccountFieldHeaders } from "./account-fields";
export function NewProfileHeader({
  name,
  setName,
  description,
  setDescription,
  onCancel,
  handleSave,
  isPending,
}: {
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  onCancel: () => void;
  handleSave: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      {/* Name & Description */}
      <div className="grid flex-1 grid-cols-2 gap-3">
        <FormField label="Name">
          <FormInput
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Austin Relocation"
          />
        </FormField>
        <FormField label="Description">
          <FormInput
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </FormField>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-secondary px-2 py-1.5 text-xs font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!name.trim() || isPending}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Create"}
        </button>
      </div>
    </div>
  );
}
export function NewProfileAccounts({
  baseData,
  matchValues,
  disabledAccounts,
  contributionValues,
  setDisabledAccounts,
  nameValues,
  setNameValues,
  setContributionValues,
  setMatchValues,
}: {
  baseData: ProfileDetail | null | undefined;
  matchValues: Record<string, MatchDraft>;
  disabledAccounts: Record<string, boolean>;
  contributionValues: Record<string, ContributionDraft>;
  setDisabledAccounts: Dispatch<SetStateAction<Record<string, boolean>>>;
  nameValues: Record<string, string>;
  setNameValues: Dispatch<SetStateAction<Record<string, string>>>;
  setContributionValues: Dispatch<
    SetStateAction<Record<string, ContributionDraft>>
  >;
  setMatchValues: Dispatch<SetStateAction<Record<string, MatchDraft>>>;
}) {
  return (
    <>
      {baseData?.accountDetails && baseData.accountDetails.length > 0 && (
        <div>
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Contributions
          </h4>
          <p className="text-caption text-faint mb-2">
            Leave Value blank to start this account with no value, same as every
            account&apos;s own value — set it afterward once the profile is
            created, or fill it in now.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b">
                <AccountFieldHeaders view="create" />
              </tr>
            </thead>
            <tbody>
              {baseData.accountDetails.map((ad) => {
                const mVal = matchValues[String(ad.id)] ?? {};
                const effectiveMatchType = mVal.matchType ?? ad.liveMatchType;
                const hasMatch = effectiveMatchType !== "none";
                const isPercentMatch =
                  effectiveMatchType === "percent_of_contribution";
                const isDisabled = disabledAccounts[String(ad.id)] ?? false;
                const contributionVal = contributionValues[String(ad.id)] ?? {};
                const effectiveMethod =
                  contributionVal.method ?? "percent_of_salary";
                const isPercent = effectiveMethod === "percent_of_salary";
                const row = {
                  isDisabled,
                  ad,
                  setDisabledAccounts,
                  nameValues,
                  setNameValues,
                  effectiveMethod,
                  setContributionValues,
                  isPercent,
                  contributionVal,
                  effectiveMatchType,
                  setMatchValues,
                  hasMatch,
                  mVal,
                  isPercentMatch,
                };
                return (
                  <tr
                    key={ad.id}
                    className={`border-subtle border-b ${isDisabled ? "opacity-40" : ""}`}
                  >
                    {ACCOUNT_FIELDS.map(({ key }) => {
                      const Cell = NEW_PROFILE_CELLS[key];
                      return <Cell key={key} {...row} />;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
export function NewProfileDeductions({
  deductionRows,
  jobsList,
  deductionValues,
  setDeductionValues,
}: {
  deductionRows: DeductionRow[] | undefined;
  jobsList: RouterOutputs["settings"]["jobs"]["list"] | undefined;
  deductionValues: Record<string, string>;
  setDeductionValues: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <>
      {deductionRows && deductionRows.length > 0 && (
        <div>
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Deductions
          </h4>
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
              </tr>
            </thead>
            <tbody>
              {deductionRows.map((d: DeductionRow, rowIndex: number) => {
                const personName =
                  jobsList?.find((j) => j.id === d.jobId)?.employerName ??
                  `Job ${d.jobId}`;
                return (
                  <tr
                    key={d.id}
                    className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                      rowIndex % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    }`}
                  >
                    <td className="text-secondary py-1.5 pr-3 pl-4">
                      {d.deductionName}
                      <span className="text-faint"> — {personName}</span>
                    </td>
                    <td className="text-muted px-3 py-1.5">
                      {d.isPretax ? "Pretax" : "Post-tax"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <span className="text-caption text-faint w-3 shrink-0 text-right">
                          $
                        </span>
                        <input
                          aria-label={`Amount / Period, ${d.deductionName}`}
                          type="number"
                          value={deductionValues[String(d.id)] ?? ""}
                          onChange={(e) =>
                            setDeductionValues((prev) => ({
                              ...prev,
                              [String(d.id)]: e.target.value,
                            }))
                          }
                          placeholder="Not set"
                          className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
