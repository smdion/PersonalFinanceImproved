"use client";

import React from "react";
import { confirmWithDiff } from "@/components/ui/confirm-dialog";
import { diffContribProfileSwap } from "@/lib/pure/contributions/contrib-profile-diff";
import { ContributionProfileCompare } from "@/components/budget/contribution-profile-compare";
import {
  AddContributionAccountPanel,
  ProfileDetailSlot,
  ProfileList,
  ProfileManagerTabs,
  ProfileSummaryBar,
} from "./profile-manager-parts";
import { useProfileManagerState } from "./use-profile-manager-state";

export function ContributionProfileManager({
  canEdit,
  locked,
}: {
  canEdit: boolean;
  /** Owned by budget-content.tsx's single tab-bar padlock — see its
   *  useEditLock(EDIT_LOCK_KEYS.profileEditLocked) call. */
  locked: boolean;
}) {
  const {
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
  } = useProfileManagerState();

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
    setActiveContributionId(id);
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

      <AddContributionAccountPanel
        addingAccount={addingAccount}
        setAddingAccount={setAddingAccount}
        updateContributionAccount={updateContributionAccount}
        createContributionAccount={createContributionAccount}
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
              activeContributionId={activeContributionId}
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
