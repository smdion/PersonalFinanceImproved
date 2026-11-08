import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { matchValueToStore } from "@/lib/pure/contributions/match-display";
import { FormError } from "@/components/ui/form-error";
import type { ContribDraft, MatchDraft } from "./account-row-types";
import {
  NewProfileAccounts,
  NewProfileDeductions,
  NewProfileHeader,
} from "./new-profile-sections";

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
