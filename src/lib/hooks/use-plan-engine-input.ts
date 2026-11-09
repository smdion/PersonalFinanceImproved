"use client";

/**
 * The household's plan as a projection input — the one builder every
 * surface uses (dashboard cards, Milestones, Compare Plans, the Retirement
 * page). The projection caches hash the full built input, so two
 * hand-maintained copies always missed each other's runs; one builder
 * means the dashboard reads exactly what the Retirement page computed.
 *
 * `ready` is false until every setting and profile list it reads has
 * loaded — queries built from it wait (`enabled: ready`) instead of
 * firing once with defaults ($0 contributions, the wrong profile).
 *
 * "Changes by year" are deliberately omitted: the server applies the
 * household's saved rows (resolveProjectionOverrides). Withdrawal routing,
 * order and splits are omitted too, so the household's saved settings
 * apply; only the tax-preference default the Retirement page's editor
 * starts from is sent, so its untouched query is byte-identical.
 */
import { useMemo } from "react";
import type { BoundaryQuery } from "@/components/ui/query-boundary";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContributionProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { defaultDecumulationConfig } from "@/lib/config/account-types";
import { profileSelectionFrom } from "@/lib/pure/household/profile-selection";
import type { ProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import {
  SK_RETIREMENT_DECUMULATION_BUDGET_COL,
  SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID,
  SK_RETIREMENT_DECUMULATION_EXPENSE_OVERRIDE,
} from "@/lib/constants/settings-keys";

type PlanEngineInput = {
  selection: ProfileSelection;
  snapshotId?: number;
  decumulationDefaults: {
    withdrawalTaxPreference: ReturnType<
      typeof defaultDecumulationConfig
    >["withdrawalTaxPreference"];
  };
};

export function usePlanEngineInput(): {
  input: PlanEngineInput;
  ready: boolean;
  /** The queries `ready` waits on, so a failed one shows (QueryBoundary). */
  gate: readonly BoundaryQuery[];
  /** The resolved ids, for surfaces that show or pass them on. */
  ids: {
    contributionProfileId: number | null;
    salaryProfileId: number | null;
    retirementProfileId: number | null;
    snapshotId: number | null;
  };
} {
  const [activeContributionId] = useActiveContributionProfile();
  const [activeSalaryId] = useActiveSalaryProfile();
  const [activeRetirementId] = useActiveRetirementProfile();
  const contributionProfiles = trpc.contributionProfile.list.useQuery();
  const salaryProfiles = trpc.salaryProfile.list.useQuery();
  const retirementProfiles = trpc.retirement.retirementProfiles.list.useQuery();
  // The query usePersistedSetting reads, for its failure.
  const settings = trpc.settings.appSettings.list.useQuery(undefined, {
    staleTime: 60_000,
  });
  const { profileId: contributionProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contributionProfiles.data?.map((p) => p.id),
      localSelection: null,
      activeProfileId: activeContributionId,
    },
  );
  const { profileId: salaryProfileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles.data?.map((p) => p.id),
    localSelection: null,
    activeProfileId: activeSalaryId,
  });
  const { profileId: retirementProfileId } = useEffectiveProfileId(
    "retirement",
    {
      validIds: retirementProfiles.data?.map((p) => p.id),
      localSelection: null,
      activeProfileId: activeRetirementId,
    },
  );
  const [decumulationBudgetProfileId, , budgetProfileLoaded] =
    usePersistedSetting<number | null>(
      SK_RETIREMENT_DECUMULATION_BUDGET_PROFILE_ID,
      null,
    );
  const [decumulationBudgetColumn, , budgetColumnLoaded] = usePersistedSetting<
    number | null
  >(SK_RETIREMENT_DECUMULATION_BUDGET_COL, null);
  const [decumulationExpenseOverride, , expenseOverrideLoaded] =
    usePersistedSetting<string | null>(
      SK_RETIREMENT_DECUMULATION_EXPENSE_OVERRIDE,
      null,
    );
  const [snapshotId, , snapshotLoaded] = usePersistedSetting<number | null>(
    "retirement_snapshot_id",
    null,
  );

  const ready =
    budgetProfileLoaded &&
    budgetColumnLoaded &&
    expenseOverrideLoaded &&
    snapshotLoaded &&
    contributionProfiles.data !== undefined &&
    salaryProfiles.data !== undefined &&
    retirementProfiles.data !== undefined;

  const input = useMemo(
    (): PlanEngineInput => ({
      selection: profileSelectionFrom({
        contributionProfileId,
        salaryProfileId,
        retirementProfileId,
        decumulationBudgetProfileId: decumulationBudgetProfileId,
        decumulationBudgetColumn: decumulationBudgetColumn,
        decumulationExpenseOverride: decumulationExpenseOverride
          ? parseFloat(decumulationExpenseOverride)
          : null,
      }),
      ...(snapshotId != null ? { snapshotId } : {}),
      decumulationDefaults: {
        withdrawalTaxPreference:
          defaultDecumulationConfig().withdrawalTaxPreference,
      },
    }),
    [
      contributionProfileId,
      salaryProfileId,
      retirementProfileId,
      decumulationBudgetProfileId,
      decumulationBudgetColumn,
      decumulationExpenseOverride,
      snapshotId,
    ],
  );

  return {
    input,
    ready,
    gate: [contributionProfiles, salaryProfiles, retirementProfiles, settings],
    ids: {
      contributionProfileId,
      salaryProfileId,
      retirementProfileId,
      snapshotId,
    },
  };
}
