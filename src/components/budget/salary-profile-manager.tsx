"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { FormError } from "@/components/ui/form-error";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { confirm } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/components/budget/use-clone-profile";
import { SalaryProfilePane } from "./salary-profile-list";
import { SalaryProfileList } from "./salary-profile-list";
import { SalaryProfileBar } from "./salary-profile-list";

/**
 * Salary Profiles tab: each profile is a jobId → complete entry map; a job with
 * no entry contributes $0 (no live fallback). Entries use the Paycheck page's
 * sections, editable in place when unlocked; only "create new" is a batch form.
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
      <SalaryProfileBar
        activeProfileName={activeProfileName}
        canEdit={canEdit}
        creatingNew={creatingNew}
        displayedProfile={displayedProfile}
        handleActivate={handleActivate}
        isViewingNonActive={isViewingNonActive}
      />

      {deleteError && <FormError message={deleteError} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        {/* Left: profile list */}
        <SalaryProfileList
          canDeleteAny={canDeleteAny}
          canEdit={canEdit}
          cloneProfile={cloneProfile}
          creatingNew={creatingNew}
          effectiveSelectedId={effectiveSelectedId}
          globalActiveSalaryId={globalActiveSalaryId}
          handleDelete={handleDelete}
          profiles={profiles}
          renameMutation={renameMutation}
          setCreatingNew={setCreatingNew}
          setSelectedProfileId={setSelectedProfileId}
        />

        {/* Right: detail / inline editor */}
        <SalaryProfilePane
          canEdit={canEdit}
          creatingNew={creatingNew}
          effectiveSelectedId={effectiveSelectedId}
          globalActiveSalaryId={globalActiveSalaryId}
          invalidateProfileDeps={invalidateProfileDeps}
          locked={locked}
          setCreatingNew={setCreatingNew}
          setSelectedProfileId={setSelectedProfileId}
        />
      </div>
    </div>
  );
}
