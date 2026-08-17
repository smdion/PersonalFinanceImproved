"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "./use-persisted-setting";
import { useEffectiveProfileId } from "./use-effective-profile-id";
import { useSalaryOverrides } from "./use-salary-overrides";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";

/**
 * `budget.listProfiles`, called the one way the whole app calls it.
 *
 * The procedure now computes each profile's own "Unspent" figure server-side,
 * which needs the tiers that only exist in the browser: the active Plan's
 * Contribution/Salary pins and any Plan-level salary override. Those go into
 * the query input, so every caller must send the same input or React Query
 * would keep several differently-parameterised copies of the profile list
 * (and the Savings Profiles rail would disagree with the Budget tab about the
 * same profile's numbers). Routing every caller through this hook keeps it to
 * one query key.
 */
export function useBudgetProfilesList() {
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    SK_ACTIVE_CONTRIB_PROFILE_ID,
    null,
  );
  const [activeSalaryProfileId] = usePersistedSetting<number | null>(
    SK_ACTIVE_SALARY_PROFILE_ID,
    null,
  );
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();
  const { planPinId: planContribProfileId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfiles?.map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeContribProfileId,
    },
  );
  const { planPinId: planSalaryProfileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: activeSalaryProfileId,
  });
  const salaryOverrides = useSalaryOverrides();

  const input = useMemo(
    () => ({
      planContribProfileId,
      planSalaryProfileId,
      ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
    }),
    [planContribProfileId, planSalaryProfileId, salaryOverrides],
  );

  return trpc.budget.listProfiles.useQuery(input);
}
