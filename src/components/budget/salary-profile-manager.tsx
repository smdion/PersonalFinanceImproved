"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";
import { confirm } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/components/budget/use-clone-profile";
import { ProfileDetail } from "./salary-profile-detail";
import { ProfileCreatePanel } from "./salary-profile-create-panel";
import { ProfileEditPanel } from "./salary-profile-edit-panel";

/**
 * Salary Profiles tab — the "what if I earned X" axis.
 *
 * Deliberately much thinner than ContributionProfileManager: a Salary
 * Profile's whole content is a jobId → entry map, so there's no
 * contribution math to resolve or aggregate. Every profile is an ordinary row
 * — renamable, editable, and deletable so long as it isn't the last one, the
 * active one, or used by a Plan.
 *
 * THERE IS NO LIVE FALLBACK. A job either has a complete entry in a profile
 * or it has none, in which case the profile says nothing about that job and
 * it contributes $0. Adding a job to a profile is an explicit action; every
 * edit after that is a plain edit. If you want a different number, use a
 * different profile.
 *
 * Each job's entry is shown with the Paycheck page's own sections — Pay
 * schedule, Withholding, Bonus, Other pay, Extra paycheck — and saves the
 * same way (salaryEntryEdit → salaryProfile.patchEntry): one salary editor.
 * Selecting a profile shows it read-only; unlocking the padlock makes the
 * same sections editable in place. There is no Save button: the only batch
 * form left is "create new", which has to collect a name before a row
 * exists to write to.
 */
export function SalaryProfileManager({
  canEdit,
  locked,
}: {
  canEdit: boolean;
  /** Owned by budget-content.tsx's single tab-bar padlock — see its
   *  useEditLock(EDIT_LOCK_KEYS.profileEditLocked) call. */
  locked: boolean;
}) {
  const utils = trpc.useUtils();
  const [activeSalaryId, setActiveSalaryId] = useActiveSalaryProfile();
  const { data: profiles, isLoading } = trpc.salaryProfile.list.useQuery();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [creatingNew, setCreatingNew] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const invalidateProfileDeps = () => {
    utils.salaryProfile.invalidate();
    utils.budget.invalidate();
    utils.contribution.invalidate();
    utils.paycheck.invalidate();
    utils.projection.invalidate();
  };

  const deleteMutation = trpc.salaryProfile.delete.useMutation({
    onSuccess: () => {
      invalidateProfileDeps();
      setSelectedProfileId(null);
      setDeleteError(null);
    },
    onError: (e) => setDeleteError(e.message),
  });

  const duplicateMutation = trpc.salaryProfile.duplicate.useMutation({
    onSuccess: (created) => {
      invalidateProfileDeps();
      setSelectedProfileId(created.id);
    },
  });
  const { clone: cloneProfile } = useCloneProfile(duplicateMutation);

  // Rename lives on the profile list row (click-to-edit) — the single
  // rename gesture every profile manager now shares.
  const renameMutation = trpc.salaryProfile.update.useMutation({
    onSuccess: () => invalidateProfileDeps(),
  });

  // Post-migration the active-profile setting always points at a real row;
  // useActiveSalaryProfile repairs it if the row ever goes missing. There is
  // no sentinel id to fall back to.
  const globalActiveSalaryId = activeSalaryId;
  const { profileId: effectiveSelectedId, source: effectiveSelectedSource } =
    useEffectiveProfileId("salary", {
      validIds: profiles?.map((p) => p.id),
      localSelection: selectedProfileId,
      activeProfileId: globalActiveSalaryId,
    });
  const activeProfileName = profiles?.find(
    (p) => p.id === globalActiveSalaryId,
  )?.name;
  const isViewingNonActive =
    effectiveSelectedSource === "user-selection" &&
    effectiveSelectedId !== globalActiveSalaryId;

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

  const handleActivate = (id: number) => {
    setActiveSalaryId(id);
  };

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm(
      `Delete "${name}"? Pages previewing under it will fall back to the active Salary Profile.`,
    );
    if (ok) deleteMutation.mutate({ id });
  };

  return (
    <div>
      {displayedProfile && !creatingNew && (
        <div className="bg-surface-sunken mb-4 flex items-center justify-between rounded-lg px-4 py-3">
          <div className="flex items-center gap-6">
            <ProfileViewingBadge
              profileName={displayedProfile.name}
              activeProfileName={activeProfileName}
              isViewingNonActive={isViewingNonActive}
              onActivate={
                canEdit ? () => handleActivate(displayedProfile.id) : undefined
              }
            />
            <div className="flex items-center gap-5 text-xs">
              {displayedProfile.pinnedSalaryTotal > 0 && (
                <div>
                  <span className="text-faint">Salary total </span>
                  <span className="text-secondary font-semibold">
                    {formatCurrency(displayedProfile.pinnedSalaryTotal)}
                    <span className="text-faint font-normal">/yr</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          <HelpTip text="A Salary Profile sets each person's pay for what-if analysis. Each job either has a complete entry in this profile — salary, bonus %, and multiplier — or it isn't in the profile at all and contributes $0. There's no fallback to a job record: if you want a different number, use a different profile. It is independent of the Contribution Profile — set either, both, or neither. The Paycheck page edits the active Salary Profile." />
        </div>
      )}

      {deleteError && <FormError message={deleteError} />}

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
              isActive={globalActiveSalaryId === p.id}
              onSelect={() => {
                setCreatingNew(false);
                setSelectedProfileId(p.id);
              }}
              onRename={
                canEdit
                  ? (name) => renameMutation.mutate({ id: p.id, name })
                  : undefined
              }
              onDelete={
                canEdit && canDeleteAny
                  ? () => handleDelete(p.id, p.name)
                  : undefined
              }
              onClone={canEdit ? () => cloneProfile(p.id, p.name) : undefined}
              meta={
                p.description ??
                (p.pinnedCount === 0
                  ? "Empty"
                  : `${p.pinnedCount} ${p.pinnedCount === 1 ? "job" : "jobs"} set`)
              }
            />
          ))}
        </div>

        {/* Right: detail / inline editor */}
        <div>
          {creatingNew ? (
            <ProfileCreatePanel
              onCancel={() => setCreatingNew(false)}
              onSaved={(newId) => {
                setCreatingNew(false);
                invalidateProfileDeps();
                if (newId !== undefined) setSelectedProfileId(newId);
              }}
            />
          ) : effectiveSelectedId != null ? (
            !canEdit || locked ? (
              <ProfileDetail
                profileId={effectiveSelectedId}
                isActiveProfile={effectiveSelectedId === globalActiveSalaryId}
              />
            ) : (
              <ProfileEditPanel
                profileId={effectiveSelectedId}
                isActiveProfile={effectiveSelectedId === globalActiveSalaryId}
                onSaved={() => invalidateProfileDeps()}
              />
            )
          ) : (
            <div className="text-faint text-xs">Select a profile.</div>
          )}
        </div>
      </div>
    </div>
  );
}
