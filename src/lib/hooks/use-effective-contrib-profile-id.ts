"use client";

import { trpc } from "@/lib/trpc";
import { useEffectiveProfileId } from "./use-effective-profile-id";
import { useActiveContributionProfile } from "./use-active-contrib-profile";

/**
 * The Contribution Profile axis, resolved once (see docs/DESIGN.md "Profile
 * Resolution"). Returns the id plus a query-input fragment to spread.
 */
export function useEffectiveContributionProfileId(): {
  contributionProfileId: number | null;
  /** `{ contributionProfileId }` when set, `{}` otherwise — spread into query input. */
  queryInput: { contributionProfileId?: number };
} {
  const [activeContributionProfileId] = useActiveContributionProfile();
  const { data: contributionProfiles } =
    trpc.contributionProfile.list.useQuery();
  const { profileId } = useEffectiveProfileId("contribution", {
    validIds: contributionProfiles?.map((p) => p.id),
    localSelection: null,
    activeProfileId: activeContributionProfileId,
  });
  const contributionProfileId = profileId;
  return {
    contributionProfileId,
    queryInput: contributionProfileId != null ? { contributionProfileId } : {},
  };
}
