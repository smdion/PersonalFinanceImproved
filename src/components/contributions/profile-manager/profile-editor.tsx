import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { matchValueToStore } from "@/lib/pure/contributions/match-display";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import type { DeductionRow } from "./profile-types";
import type { ContribDraft, MatchDraft } from "./account-row-types";
import {
  NewProfileCapCell,
  NewProfileEnabledCell,
  NewProfileMatchCell,
  NewProfileMatchTypeCell,
  NewProfileMethodCell,
  NewProfileNameCell,
  NewProfileValueCell,
} from "./new-profile-cells";

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

  const handleSave = () => {
    // A new profile starts with no value for an account unless a value is
    // entered here (same "never silently inherit" principle already applied
    // to salary pins) — leaving Value blank leaves that account unset, same
    // as every account's own value, editable afterward via the standing
    // editor.
    const contribAccounts: Record<string, Record<string, unknown>> = {};
    for (const [accountId, cVal] of Object.entries(contribValues)) {
      if (cVal.value && cVal.value.trim()) {
        const num = parseFloat(cVal.value);
        if (!isNaN(num)) {
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            contributionValue: String(num),
            contributionMethod: cVal.method ?? "percent_of_salary",
          };
        }
      }
    }
    for (const [accountId, nameVal] of Object.entries(nameValues)) {
      if (nameVal.trim()) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          displayNameCustom: nameVal.trim(),
        };
      }
    }
    for (const [accountId, isDisabled] of Object.entries(disabledAccounts)) {
      if (isDisabled) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          isActive: false,
        };
      }
    }
    for (const [accountId, mVal] of Object.entries(matchValues)) {
      if (mVal.matchType) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          employerMatchType: mVal.matchType,
        };
      }
      if (mVal.matchValue) {
        const num = parseFloat(mVal.matchValue);
        if (!isNaN(num)) {
          const typedUnder =
            mVal.matchType ??
            baseData?.accountDetails.find((a) => String(a.id) === accountId)
              ?.liveMatchType;
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            employerMatchValue: matchValueToStore(typedUnder, String(num)),
          };
        }
      }
      if (mVal.maxMatchPct) {
        const num = parseFloat(mVal.maxMatchPct);
        if (!isNaN(num)) {
          // Convert display percentage back to decimal (5 → 0.05)
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            employerMaxMatchPct: String(num / 100),
          };
        }
      }
    }

    // Build per-deduction amount overrides — same "leave blank = not set"
    // rule as contribution accounts (no base value to fall back to).
    const deductions: Record<string, Record<string, unknown>> = {};
    for (const [deductionId, amountStr] of Object.entries(deductionValues)) {
      if (amountStr && amountStr.trim()) {
        const num = parseFloat(amountStr);
        if (!isNaN(num)) {
          deductions[deductionId] = { amountPerPeriod: String(num) };
        }
      }
    }

    const contributionActiveFields: Record<
      string,
      Record<string, Record<string, unknown>>
    > = {
      ...(Object.keys(contribAccounts).length > 0
        ? { contributionAccounts: contribAccounts }
        : {}),
      ...(Object.keys(deductions).length > 0 ? { deductions } : {}),
    };

    createMutation.mutate({
      name,
      description: description || undefined,
      contributionActiveFields,
    });
  };

  const isPending = createMutation.isPending;

  // An existing profile supplies the rows (and their current values) to start
  // from — every account/job is listed with its live value either way.
  const { data: profilesList } = trpc.contributionProfile.list.useQuery();
  const baseId = profilesList?.[0]?.id;
  const { data: baseData } = trpc.contributionProfile.getById.useQuery(
    { id: baseId! },
    { enabled: baseId !== undefined },
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      <FormError
        error={createMutation.error}
        prefix="Failed to save profile"
        className="mb-3"
      />

      <div className="space-y-5">
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

        {/* Contribution accounts */}
        {baseData?.accountDetails && baseData.accountDetails.length > 0 && (
          <div>
            <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
              Contributions
            </h4>
            <p className="text-caption text-faint mb-2">
              Leave Value blank to start this account with no value, same as
              every account&apos;s own value — set it afterward once the profile
              is created, or fill it in now.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b">
                  <th
                    className="w-6 py-1.5 text-left font-medium"
                    title="Enabled in this profile"
                  >
                    On
                  </th>
                  <th className="py-1.5 text-left font-medium">Account</th>
                  <th className="w-28 py-1.5 text-left font-medium">Method</th>
                  <th className="w-24 py-1.5 text-right font-medium">Value</th>
                  <th className="w-28 py-1.5 text-left font-medium">
                    Match Type
                  </th>
                  <th className="w-24 py-1.5 text-right font-medium">
                    Employer Match
                  </th>
                  <th className="w-24 py-1.5 text-right font-medium">
                    Match Cap
                  </th>
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
                  const contribVal = contribValues[String(ad.id)] ?? {};
                  const effectiveMethod =
                    contribVal.method ?? "percent_of_salary";
                  const isPercent = effectiveMethod === "percent_of_salary";
                  return (
                    <tr
                      key={ad.id}
                      className={`border-subtle border-b ${isDisabled ? "opacity-40" : ""}`}
                    >
                      <NewProfileEnabledCell
                        isDisabled={isDisabled}
                        ad={ad}
                        setDisabledAccounts={setDisabledAccounts}
                      />
                      <NewProfileNameCell
                        isDisabled={isDisabled}
                        ad={ad}
                        nameValues={nameValues}
                        setNameValues={setNameValues}
                      />
                      <NewProfileMethodCell
                        isDisabled={isDisabled}
                        effectiveMethod={effectiveMethod}
                        setContribValues={setContribValues}
                        ad={ad}
                      />
                      <NewProfileValueCell
                        isDisabled={isDisabled}
                        isPercent={isPercent}
                        contribVal={contribVal}
                        setContribValues={setContribValues}
                        ad={ad}
                      />
                      <NewProfileMatchTypeCell
                        effectiveMatchType={effectiveMatchType}
                        setMatchValues={setMatchValues}
                        ad={ad}
                      />
                      <NewProfileMatchCell
                        hasMatch={hasMatch}
                        effectiveMatchType={effectiveMatchType}
                        mVal={mVal}
                        setMatchValues={setMatchValues}
                        ad={ad}
                      />
                      <NewProfileCapCell
                        hasMatch={hasMatch}
                        isPercentMatch={isPercentMatch}
                        mVal={mVal}
                        setMatchValues={setMatchValues}
                        ad={ad}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* Deductions — same "leave blank = not set" rule as contribution
            accounts above; a new profile starts with no deduction amounts
            unless entered here. */}
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
                {deductionRows.map((d: DeductionRow, rowIdx: number) => {
                  const personName =
                    jobsList?.find((j) => j.id === d.jobId)?.employerName ??
                    `Job ${d.jobId}`;
                  return (
                    <tr
                      key={d.id}
                      className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                        rowIdx % 2 === 1
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
