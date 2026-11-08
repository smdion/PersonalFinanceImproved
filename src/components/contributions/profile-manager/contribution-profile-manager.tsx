"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { usePlanNamesUsing } from "@/lib/hooks/use-plans";
import { planInUseMessage } from "@/lib/pure/household/plans";
import { toast } from "@/lib/hooks/use-toast";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { ProfileViewingBadge } from "@/components/budget/profile-viewing-badge";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";
import { confirm, confirmWithDiff } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/components/budget/use-clone-profile";
import { diffContribProfileSwap } from "@/lib/pure/contributions/contrib-profile-diff";
import { ContributionProfileCompare } from "@/components/budget/contribution-profile-compare";
import { SlidePanel } from "@/components/ui/slide-panel";
import { Tabs } from "@/components/ui/tabs";
import {
  ContribAccountForm,
  type ContribAccountFormValues,
} from "@/components/paycheck/contrib-account-form";
import { ProfileDetailPanel } from "./profile-detail-panel";
import { ProfileEditor } from "./profile-editor";
import { ProfileInlineEditor } from "./profile-inline-editor";

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
      <div className="mb-4 flex items-center justify-between border-b">
        <Tabs
          look="underline-compact"
          value={viewMode}
          onChange={setViewMode}
          tabs={[
            { value: "profiles", label: "Profiles" },
            { value: "compare", label: "Compare" },
          ]}
        />
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddingAccount(true)}
            className="text-caption mb-1.5 font-medium text-blue-600 hover:text-blue-700"
          >
            + Add Account
          </button>
        )}
      </div>

      <SlidePanel
        isOpen={addingAccount}
        onClose={() => setAddingAccount(false)}
        title="Add Contribution Account"
      >
        <ContribAccountForm
          onSave={(data: ContribAccountFormValues) => {
            const { id, ...rest } = data;
            if (id != null) {
              updateContribAccount.mutate({ id, ...rest });
            } else {
              createContribAccount.mutate(rest);
            }
          }}
          onCancel={() => setAddingAccount(false)}
          isPending={
            createContribAccount.isPending || updateContribAccount.isPending
          }
        />
      </SlidePanel>

      {viewMode === "compare" && <ContributionProfileCompare />}

      {viewMode === "profiles" && (
        <>
          {/* Viewing/active summary bar — same visual language as Budget/Savings Profiles */}
          {displayedProfile && (
            <div className="bg-surface-sunken mb-4 flex items-center justify-between rounded-lg px-4 py-3">
              <div className="flex items-center gap-6">
                <ProfileViewingBadge
                  profileName={displayedProfile.name}
                  activeProfileName={activeProfileName}
                  isViewingNonActive={isViewingNonActive}
                  onActivate={
                    canEdit
                      ? () => handleActivate(displayedProfile.id)
                      : undefined
                  }
                />
                {/* Contribution-scoped figures only. Salary is the Salary
                Profile's axis — showing a number here invited reading it as
                something this profile sets, which it never did. */}
                <div className="flex items-center gap-5 text-xs">
                  <div>
                    <span className="text-faint">Contributions </span>
                    <span className="text-secondary font-semibold">
                      {formatCurrency(
                        displayedProfile.summary.annualContributions,
                      )}
                      <span className="text-faint font-normal">/yr</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-faint">Employer Match </span>
                    <span className="text-secondary font-semibold">
                      {formatCurrency(
                        displayedProfile.summary.annualEmployerMatch,
                      )}
                      <span className="text-faint font-normal">/yr</span>
                    </span>
                  </div>
                  {/* Held to this year's IRS limits at this year's ages; a
                      profile used as a switch is capped at each year's
                      ages in the projection (its save warning names them). */}
                  {isViewingNonActive && (
                    <span className="text-faint">
                      at {new Date().getFullYear()}&apos;s IRS limits and ages
                    </span>
                  )}
                </div>
              </div>
              <HelpTip text="Contributions and employer match for the profile shown below. Every profile is an ordinary, editable set of contribution settings — create more to model different contribution strategies, then use them in the Relocation tool. Salary and bonus are the Salary Profile's axis, not this one. Selected independently from the budget profile above — linked per budget column instead (see each column's settings)." />
            </div>
          )}

          {/* Master-detail layout */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
            {/* Left: profile list */}
            <div className="space-y-1.5">
              <ProfileSidebarHeader
                onCreate={
                  canEdit
                    ? () => {
                        setSelectedProfileId(null);
                        setCreatingNew(true);
                      }
                    : undefined
                }
              />

              {profiles.map((p) => (
                <ProfileListRow
                  key={p.id}
                  name={p.name}
                  isSelected={!creatingNew && effectiveSelectedId === p.id}
                  isActive={activeContribId === p.id}
                  onSelect={() => {
                    setCreatingNew(false);
                    setSelectedProfileId(p.id);
                  }}
                  onRename={
                    canEdit
                      ? (name) => renameMutation.mutate({ id: p.id, name })
                      : undefined
                  }
                  onActivate={canEdit ? () => handleActivate(p.id) : undefined}
                  onDelete={
                    canEdit && canDeleteAny
                      ? async () => {
                          const usedBy = planNamesUsing("contribution", p.id);
                          if (usedBy.length > 0) {
                            toast.error(
                              planInUseMessage("contribution", usedBy),
                            );
                            return;
                          }
                          if (await confirm(`Delete profile "${p.name}"?`)) {
                            deleteMutation.mutate({ id: p.id });
                          }
                        }
                      : undefined
                  }
                  onClone={
                    canEdit ? () => cloneProfile(p.id, p.name) : undefined
                  }
                  meta={
                    <>
                      <span>
                        {formatCurrency(p.summary.annualContributions)}/yr
                      </span>
                      {p.summary.annualEmployerMatch > 0 && (
                        <span className="text-green-600">
                          +{formatCurrency(p.summary.annualEmployerMatch)}
                        </span>
                      )}
                    </>
                  }
                />
              ))}

              {profiles.length <= 1 && (
                <p className="text-caption text-faint px-2 py-3 italic">
                  Only one profile so far. Create another to model a different
                  contribution strategy.
                </p>
              )}
              <FormError
                error={deleteMutation.error}
                prefix="Failed to delete profile"
                className="mt-2 px-2"
              />
              <FormError
                error={renameMutation.error}
                prefix="Failed to rename profile"
                className="mt-2 px-2"
              />
            </div>

            {/* Right: detail panel / inline editor */}
            <div className="border-l pl-4">
              {creatingNew ? (
                <ProfileEditor
                  onCancel={() => setCreatingNew(false)}
                  onSaved={(newId) => {
                    setCreatingNew(false);
                    invalidateProfileDeps();
                    if (newId !== undefined) setSelectedProfileId(newId);
                  }}
                />
              ) : effectiveSelectedId != null ? (
                !canEdit || locked ? (
                  <ProfileDetailPanel profileId={effectiveSelectedId} />
                ) : (
                  <ProfileInlineEditor
                    profileId={effectiveSelectedId}
                    onSaved={() => invalidateProfileDeps()}
                  />
                )
              ) : (
                <div className="text-faint flex h-40 items-center justify-center text-xs">
                  Select a profile to view details
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
