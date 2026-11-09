import { trpc } from "@/lib/trpc";
import { matchValueToStore } from "@/lib/pure/contributions/match-display";
import type { ContributionDraft, MatchDraft } from "./account-row-types";

export function useNewProfileSave(form: {
  contributionValues: Record<string, ContributionDraft>;
  nameValues: Record<string, string>;
  disabledAccounts: Record<string, boolean>;
  matchValues: Record<string, MatchDraft>;
  deductionValues: Record<string, string>;
  createMutation: ReturnType<
    typeof trpc.contributionProfile.create.useMutation
  >;
  name: string;
  description: string;
}) {
  const handleSave = () => {
    // A new profile starts with no value for an account unless one is
    // entered here: a blank Value leaves it unset, editable afterward.
    const contributionAccounts: Record<string, Record<string, unknown>> = {};
    for (const [accountId, cVal] of Object.entries(form.contributionValues)) {
      if (cVal.value && cVal.value.trim()) {
        const num = parseFloat(cVal.value);
        if (!isNaN(num)) {
          contributionAccounts[accountId] = {
            ...(contributionAccounts[accountId] ?? {}),
            contributionValue: String(num),
            contributionMethod: cVal.method ?? "percent_of_salary",
          };
        }
      }
    }
    for (const [accountId, nameVal] of Object.entries(form.nameValues)) {
      if (nameVal.trim()) {
        contributionAccounts[accountId] = {
          ...(contributionAccounts[accountId] ?? {}),
          displayNameCustom: nameVal.trim(),
        };
      }
    }
    for (const [accountId, disabled] of Object.entries(form.disabledAccounts)) {
      if (disabled) {
        contributionAccounts[accountId] = {
          ...(contributionAccounts[accountId] ?? {}),
          isActive: false,
        };
      }
    }
    for (const [accountId, mVal] of Object.entries(form.matchValues)) {
      if (mVal.matchType) {
        contributionAccounts[accountId] = {
          ...(contributionAccounts[accountId] ?? {}),
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
          contributionAccounts[accountId] = {
            ...(contributionAccounts[accountId] ?? {}),
            employerMatchValue: matchValueToStore(typedUnder, String(num)),
          };
        }
      }
      if (mVal.maxMatchPercent) {
        const num = parseFloat(mVal.maxMatchPercent);
        if (!isNaN(num)) {
          // Convert display percentage back to decimal (5 → 0.05)
          contributionAccounts[accountId] = {
            ...(contributionAccounts[accountId] ?? {}),
            employerMaxMatchPct: String(num / 100),
          };
        }
      }
    }

    // Per-deduction amounts: blank = not set, as for contribution accounts.
    const deductions: Record<string, Record<string, unknown>> = {};
    for (const [deductionId, amount] of Object.entries(form.deductionValues)) {
      if (amount && amount.trim()) {
        const num = parseFloat(amount);
        if (!isNaN(num)) {
          deductions[deductionId] = { amountPerPeriod: String(num) };
        }
      }
    }

    const contributionActiveFields: Record<
      string,
      Record<string, Record<string, unknown>>
    > = {
      ...(Object.keys(contributionAccounts).length > 0
        ? { contributionAccounts: contributionAccounts }
        : {}),
      ...(Object.keys(deductions).length > 0 ? { deductions } : {}),
    };

    form.createMutation.mutate({
      name: form.name,
      description: form.description || undefined,
      contributionActiveFields,
    });
  };

  const isPending = form.createMutation.isPending;

  // An existing profile supplies the rows (and their current values) to start
  // from — every account/job is listed with its live value either way.
  const { data: profilesList } = trpc.contributionProfile.list.useQuery();
  const baseId = profilesList?.[0]?.id;
  const { data: baseData } = trpc.contributionProfile.getById.useQuery(
    { id: baseId! },
    { enabled: baseId !== undefined },
  );

  return { handleSave, isPending, baseData };
}
