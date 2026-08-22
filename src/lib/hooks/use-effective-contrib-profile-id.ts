"use client";

import { trpc } from "@/lib/trpc";
import { useEffectiveProfileId } from "./use-effective-profile-id";
import { useActiveContribProfile } from "./use-active-contrib-profile";

/**
 * The Contribution Profile axis, resolved once: Plan pin → globally-active
 * setting. Mirrors useEffectiveSalaryProfileId exactly — every page that
 * shows contribution-dependent data should call this rather than reading
 * the globally-active setting directly, which silently ignores a Plan's
 * pin (see docs/RULES.md "Profile Pins").
 *
 * Returns the id plus a ready-made query-input fragment, since every
 * consumer spreads it into a tRPC input the same way.
 */
export function useEffectiveContribProfileId(): {
  contributionProfileId: number | null;
  /** `{ contributionProfileId }` when set, `{}` otherwise — spread into query input. */
  queryInput: { contributionProfileId?: number };
} {
  const [activeContribProfileId] = useActiveContribProfile();
  const { data: contribProfiles } = trpc.contributionProfile.list.useQuery();
  const { profileId } = useEffectiveProfileId("contribution", {
    validIds: contribProfiles?.map((p) => p.id),
    localSelection: null,
    globalDefaultId: activeContribProfileId,
  });
  const contributionProfileId = profileId;
  return {
    contributionProfileId,
    queryInput: contributionProfileId != null ? { contributionProfileId } : {},
  };
}
