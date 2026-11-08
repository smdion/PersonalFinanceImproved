import { trpc } from "@/lib/trpc";
import { matchValueToStore } from "@/lib/pure/contributions/match-display";
import type { ContribDraft, MatchDraft } from "./account-row-types";

export function useNewProfileSave(form: {
  contribValues: Record<string, ContribDraft>;
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
    const contribAccounts: Record<string, Record<string, unknown>> = {};
    for (const [accountId, cVal] of Object.entries(form.contribValues)) {
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
    for (const [accountId, nameVal] of Object.entries(form.nameValues)) {
      if (nameVal.trim()) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          displayNameCustom: nameVal.trim(),
        };
      }
    }
    for (const [accountId, disabled] of Object.entries(form.disabledAccounts)) {
      if (disabled) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          isActive: false,
        };
      }
    }
    for (const [accountId, mVal] of Object.entries(form.matchValues)) {
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
      ...(Object.keys(contribAccounts).length > 0
        ? { contributionAccounts: contribAccounts }
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
