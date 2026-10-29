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
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { defaultDecumulationConfig } from "@/lib/config/account-types";
import {
  SK_RETIREMENT_DEC_BUDGET_COL,
  SK_RETIREMENT_DEC_BUDGET_PROFILE_ID,
  SK_RETIREMENT_DEC_EXPENSE_OVERRIDE,
} from "@/lib/constants/settings-keys";

type PlanEngineInput = {
  contributionProfileId?: number;
  salaryProfileId?: number;
  retirementProfileId?: number;
  decumulationBudgetProfileId?: number;
  decumulationBudgetColumn?: number;
  decumulationExpenseOverride?: number;
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
  /** The resolved ids, for surfaces that show or pass them on. */
  ids: {
    contributionProfileId: number | null;
    salaryProfileId: number | null;
    retirementProfileId: number | null;
    snapshotId: number | null;
  };
} {
  const [activeContribId] = useActiveContribProfile();
  const [activeSalaryId] = useActiveSalaryProfile();
  const [activeRetirementId] = useActiveRetirementProfile();
  const contribProfiles = trpc.contributionProfile.list.useQuery();
  const salaryProfiles = trpc.salaryProfile.list.useQuery();
  const retirementProfiles = trpc.retirement.retirementProfiles.list.useQuery();
  const { profileId: contributionProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfiles.data?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeContribId,
    },
  );
  const { profileId: salaryProfileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles.data?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: activeSalaryId,
  });
  const { profileId: retirementProfileId } = useEffectiveProfileId(
    "retirement",
    {
      validIds: retirementProfiles.data?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeRetirementId,
    },
  );
  const [decBudgetProfileId, , l1] = usePersistedSetting<number | null>(
    SK_RETIREMENT_DEC_BUDGET_PROFILE_ID,
    null,
  );
  const [decBudgetCol, , l2] = usePersistedSetting<number | null>(
    SK_RETIREMENT_DEC_BUDGET_COL,
    null,
  );
  const [decExpenseOverride, , l3] = usePersistedSetting<string | null>(
    SK_RETIREMENT_DEC_EXPENSE_OVERRIDE,
    null,
  );
  const [snapshotId, , l4] = usePersistedSetting<number | null>(
    "retirement_snapshot_id",
    null,
  );

  const ready =
    l1 &&
    l2 &&
    l3 &&
    l4 &&
    contribProfiles.data !== undefined &&
    salaryProfiles.data !== undefined &&
    retirementProfiles.data !== undefined;

  const input = useMemo(
    (): PlanEngineInput => ({
      ...(contributionProfileId != null ? { contributionProfileId } : {}),
      ...(salaryProfileId != null ? { salaryProfileId } : {}),
      ...(retirementProfileId != null ? { retirementProfileId } : {}),
      ...(decBudgetProfileId != null
        ? { decumulationBudgetProfileId: decBudgetProfileId }
        : {}),
      ...(decBudgetCol != null
        ? { decumulationBudgetColumn: decBudgetCol }
        : {}),
      ...(decExpenseOverride
        ? { decumulationExpenseOverride: parseFloat(decExpenseOverride) }
        : {}),
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
      decBudgetProfileId,
      decBudgetCol,
      decExpenseOverride,
      snapshotId,
    ],
  );

  return {
    input,
    ready,
    ids: {
      contributionProfileId,
      salaryProfileId,
      retirementProfileId,
      snapshotId,
    },
  };
}
