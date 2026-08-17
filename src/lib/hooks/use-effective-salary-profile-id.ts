"use client";

import { trpc } from "@/lib/trpc";
import { useEffectiveProfileId } from "./use-effective-profile-id";
import { useActiveSalaryProfile } from "./use-active-salary-profile";

/**
 * The Salary Profile axis, resolved once: Plan pin → globally-active setting.
 *
 * Every page that previews "what would this look like under a different
 * salary" calls this rather than re-deriving the chain, exactly as it calls
 * useEffectiveProfileId("contribution", …) for the contribution axis. The two
 * are independent — a page can end up pinned on one and not the other.
 *
 * Returns the id plus a ready-made query-input fragment, since every consumer
 * spreads it into a tRPC input the same way. It is null only before the
 * profile list has loaded — there is no "no profile" state to represent once
 * it has.
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
    globalDefaultId: activeSalaryProfileId,
  });
  const salaryProfileId = profileId;
  return {
    salaryProfileId,
    queryInput: salaryProfileId != null ? { salaryProfileId } : {},
  };
}
