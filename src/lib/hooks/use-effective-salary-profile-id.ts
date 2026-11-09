"use client";

import { trpc } from "@/lib/trpc";
import { useEffectiveProfileId } from "./use-effective-profile-id";
import { useActiveSalaryProfile } from "./use-active-salary-profile";

/**
 * The Salary Profile axis, resolved once; independent of contribution. Returns
 * the id (null only before the list loads) plus a query-input fragment to spread.
 */
export function useEffectiveSalaryProfileId(): {
  salaryProfileId: number | null;
  /** `{ salaryProfileId }` when set, `{}` otherwise — spread into query input. */
  queryInput: { salaryProfileId?: number };
} {
  const [activeSalaryProfileId] = useActiveSalaryProfile();
  const { data: salaryProfiles } = trpc.salaryProfile.list.useQuery();
  const { profileId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles?.map((p) => p.id),
    localSelection: null,
    activeProfileId: activeSalaryProfileId,
  });
  const salaryProfileId = profileId;
  return {
    salaryProfileId,
    queryInput: salaryProfileId != null ? { salaryProfileId } : {},
  };
}
