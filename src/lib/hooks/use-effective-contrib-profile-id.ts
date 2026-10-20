"use client";

import { trpc } from "@/lib/trpc";
import { useEffectiveProfileId } from "./use-effective-profile-id";
import { useActiveContribProfile } from "./use-active-contrib-profile";

/**
 * The Contribution Profile axis, resolved once: the active setting.
 * Mirrors useEffectiveSalaryProfileId exactly — every page that shows
 * contribution-dependent data calls this rather than reading the setting
 * directly (see docs/RULES.md "Profile Resolution").
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
