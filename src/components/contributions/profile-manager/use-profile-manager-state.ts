import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePlanNamesUsing } from "@/lib/hooks/use-plans";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useCloneProfile } from "@/components/budget/use-clone-profile";

export function useProfileManagerState() {
  const utils = trpc.useUtils();
  const planNamesUsing = usePlanNamesUsing();
  const [activeContributionId, setActiveContributionId] =
    useActiveContribProfile();
  const { data: profiles, isLoading } =
    trpc.contributionProfile.list.useQuery();
  const { data: compareData } = trpc.contributionProfile.compareData.useQuery();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [creatingNew, setCreatingNew] = useState(false);
  const [viewMode, setViewMode] = useState<"profiles" | "compare">("profiles");
  const [addingAccount, setAddingAccount] = useState(false);

  const invalidateProfileDeps = () => {
    utils.contributionProfile.invalidate();
    utils.contribution.invalidate();
    utils.paycheck.invalidate();
    utils.projection.invalidate();
    utils.settings.invalidate();
  };

  const createContributionAccount =
    trpc.settings.contributionAccounts.create.useMutation({
      onSuccess: () => {
        invalidateProfileDeps();
        setAddingAccount(false);
      },
    });
  const updateContributionAccount =
    trpc.settings.contributionAccounts.update.useMutation({
      onSuccess: () => {
        invalidateProfileDeps();
        setAddingAccount(false);
      },
    });

  const deleteMutation = trpc.contributionProfile.delete.useMutation({
    onSuccess: () => {
      invalidateProfileDeps();
      if (selectedProfileId) setSelectedProfileId(null);
    },
  });
  const renameMutation = trpc.contributionProfile.update.useMutation({
    onSuccess: invalidateProfileDeps,
  });
  const duplicateMutation = trpc.contributionProfile.duplicate.useMutation({
    onSuccess: (created) => {
      invalidateProfileDeps();
      setSelectedProfileId(created.id);
    },
  });
  const { clone: cloneProfile } = useCloneProfile(duplicateMutation);

  // Local selection, else the active profile (a real row: useActiveContributionProfile
  // repairs the setting if that row ever goes missing).
  const { profileId: effectiveSelectedId, source: effectiveSelectedSource } =
    useEffectiveProfileId("contribution", {
      validIds: profiles?.map((p) => p.id),
      localSelection: selectedProfileId,
      activeProfileId: activeContributionId,
    });
  const activeProfileName = profiles?.find(
    (p) => p.id === activeContributionId,
  )?.name;
  const isViewingNonActive =
    effectiveSelectedSource === "user-selection" &&
    effectiveSelectedId !== activeContributionId;

  return {
    planNamesUsing,
    activeContributionId,
    setActiveContributionId,
    profiles,
    isLoading,
    compareData,
    setSelectedProfileId,
    creatingNew,
    setCreatingNew,
    viewMode,
    setViewMode,
    addingAccount,
    setAddingAccount,
    invalidateProfileDeps,
    createContributionAccount,
    updateContributionAccount,
    deleteMutation,
    renameMutation,
    cloneProfile,
    effectiveSelectedId,
    activeProfileName,
    isViewingNonActive,
  };
}
