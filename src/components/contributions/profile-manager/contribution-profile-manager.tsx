"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePlanNamesUsing } from "@/lib/hooks/use-plans";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { confirmWithDiff } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/components/budget/use-clone-profile";
import { diffContribProfileSwap } from "@/lib/pure/contributions/contrib-profile-diff";
import { ContributionProfileCompare } from "@/components/budget/contribution-profile-compare";
import {
  AddContribAccountPanel,
  ProfileDetailSlot,
  ProfileList,
  ProfileManagerTabs,
  ProfileSummaryBar,
} from "./profile-manager-parts";

export function ContributionProfileManager({
  canEdit,
  locked,
}: {
  canEdit: boolean;
  /** Owned by budget-content.tsx's single tab-bar padlock — see its
   *  useEditLock(EDIT_LOCK_KEYS.profileEditLocked) call. */
  locked: boolean;
}) {
  const utils = trpc.useUtils();
  const planNamesUsing = usePlanNamesUsing();
  const [activeContribId, setActiveContribId] = useActiveContribProfile();
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

  const createContribAccount =
    trpc.settings.contributionAccounts.create.useMutation({
      onSuccess: () => {
        invalidateProfileDeps();
        setAddingAccount(false);
      },
    });
  const updateContribAccount =
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

  // Post-migration the active-profile setting always points at a real row;
  // useActiveContribProfile repairs it if that row ever goes missing.
  // local selection -> active profile (single computation path)
  const { profileId: effectiveSelectedId, source: effectiveSelectedSource } =
    useEffectiveProfileId("contribution", {
      validIds: profiles?.map((p) => p.id),
      localSelection: selectedProfileId,
      activeProfileId: activeContribId,
    });
  const activeProfileName = profiles?.find(
    (p) => p.id === activeContribId,
  )?.name;
  const isViewingNonActive =
    effectiveSelectedSource === "user-selection" &&
    effectiveSelectedId !== activeContribId;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="bg-surface-elevated h-16 animate-pulse rounded-lg" />
        <div className="bg-surface-elevated h-40 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!profiles || profiles.length === 0) return null;

  const displayedProfile = profiles.find((p) => p.id === effectiveSelectedId);
  const canDeleteAny = profiles.length > 1;

  // Warn before a swap silently drops an account's active value —
  // compare against the active profile.
  const handleActivate = async (id: number) => {
    const outgoing = compareData?.profiles.find(
      (p) => p.id === effectiveSelectedId,
    );
    const incoming = compareData?.profiles.find((p) => p.id === id);
    if (compareData && outgoing) {
      const lines = diffContribProfileSwap(
        outgoing.accountActiveFields,
        incoming?.accountActiveFields ?? {},
        compareData.accounts,
      );
      if (lines.length > 0) {
        const ok = await confirmWithDiff(
          `Switching to "${incoming?.name ?? "this profile"}" will change:`,
          lines,
        );
        if (!ok) return;
      }
    }
    setActiveContribId(id);
  };

  return (
    <div>
      {/* A standing audit view — accounts × profiles, not just this one
          profile's editor — kept as an internal toggle rather than a new
          top-level Budget-page tab (see contribution-profile-compare.tsx). */}
      <ProfileManagerTabs
        viewMode={viewMode}
        setViewMode={setViewMode}
        canEdit={canEdit}
        setAddingAccount={setAddingAccount}
      />

      <AddContribAccountPanel
        addingAccount={addingAccount}
        setAddingAccount={setAddingAccount}
        updateContribAccount={updateContribAccount}
        createContribAccount={createContribAccount}
      />

      {viewMode === "compare" && <ContributionProfileCompare />}

      {viewMode === "profiles" && (
        <>
          {/* Viewing/active summary bar — same visual language as Budget/Savings Profiles */}
          <ProfileSummaryBar
            displayedProfile={displayedProfile}
            activeProfileName={activeProfileName}
            isViewingNonActive={isViewingNonActive}
            canEdit={canEdit}
            handleActivate={handleActivate}
          />

          {/* Master-detail layout */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
            {/* Left: profile list */}
            <ProfileList
              canEdit={canEdit}
              setSelectedProfileId={setSelectedProfileId}
              setCreatingNew={setCreatingNew}
              profiles={profiles}
              creatingNew={creatingNew}
              effectiveSelectedId={effectiveSelectedId}
              activeContribId={activeContribId}
              renameMutation={renameMutation}
              handleActivate={handleActivate}
              canDeleteAny={canDeleteAny}
              planNamesUsing={planNamesUsing}
              deleteMutation={deleteMutation}
              cloneProfile={cloneProfile}
            />

            {/* Right: detail panel / inline editor */}
            <ProfileDetailSlot
              creatingNew={creatingNew}
              setCreatingNew={setCreatingNew}
              invalidateProfileDeps={invalidateProfileDeps}
              setSelectedProfileId={setSelectedProfileId}
              effectiveSelectedId={effectiveSelectedId}
              canEdit={canEdit}
              locked={locked}
            />
          </div>
        </>
      )}
    </div>
  );
}
