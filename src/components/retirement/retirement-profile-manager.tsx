"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useScenario } from "@/lib/context/scenario-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { FormError } from "@/components/ui/form-error";
import { confirm } from "@/components/ui/confirm-dialog";
import { HelpTip } from "@/components/ui/help-tip";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";

/**
 * Retirement Profiles list — the left column of the Budget page's
 * Retirement tab, matching the master-detail shell Budget/Contribution/
 * Salary Profiles already use (`grid-cols-[240px_1fr]`, `ProfileListRow`/
 * `ProfileSidebarHeader` from `@/components/ui/profile-sidebar`). Was a
 * one-off flat pill row above the settings editor until 2026-08-30, found
 * inconsistent with the other three's layout and unified here.
 *
 * Deliberately thin, matching SalaryProfileManager's philosophy: no bare
 * "create" (retirement_settings has ~40 NOT NULL columns with no sensible
 * blank default — Duplicate is the one creation path, same as the router;
 * `ProfileSidebarHeader` renders no "+ New" button since `onCreate` is
 * never passed). Each profile is a COMPLETE WORLD, same contract as Salary
 * Profiles: no baseline, no default, no merge. "Active" is the correct
 * word here, not "pin" — see the profile-terminology memory.
 *
 * Clicking a row now VIEWS that profile (reported via
 * `onViewingProfileChange`) without activating it — the same "view
 * without activating" contract Contribution/Salary's sidebars already
 * have, newly extended to Retirement alongside `RetirementProfileTab`'s
 * new `profileId` prop. Renaming/duplicating/deleting/activating a
 * profile still lives entirely here; editing its assumptions (age,
 * inflation, strategy, ...) happens in RetirementProfileTab to the right,
 * scoped to whichever profile is being VIEWED (not necessarily active).
 */
export function RetirementProfileManager({
  viewingProfileId,
  onViewingProfileChange,
}: {
  /** Local "view without activating" selection, owned by the parent so it
   *  can be threaded into RetirementProfileTab's `profileId` prop too —
   *  same lifting pattern retirement-content.tsx's assumptions band uses. */
  viewingProfileId: number | null;
  onViewingProfileChange: (id: number) => void;
}) {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { isInScenario, setScenarioRetirementProfile } = useScenario();
  const [activeRetirementId, setActiveRetirementId] =
    useActiveRetirementProfile();
  const { data: profiles, isLoading } =
    trpc.retirement.retirementProfiles.list.useQuery();

  const validIds = (profiles ?? []).map((p) => p.id);
  // "Active" (global/Plan-pinned) — drives the ACTIVE badge + "Make
  // active" affordance, same computation the projection page's
  // assumptions band uses for its own activeProfileId/effectiveSource.
  const { profileId: activeEffectiveId, source: activeSource } =
    useEffectiveProfileId("retirement", {
      validIds,
      localSelection: null,
      globalDefaultId: activeRetirementId,
    });
  // "Viewing" — which row is selected/highlighted, independent of
  // activation. Falls back to the active profile when nothing's been
  // clicked yet, exactly like Contribution/Salary's sidebars.
  const { profileId: viewingEffectiveId } = useEffectiveProfileId(
    "retirement",
    {
      validIds,
      localSelection: viewingProfileId,
      globalDefaultId: activeRetirementId,
    },
  );

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateSourceId, setDuplicateSourceId] = useState<number | null>(
    null,
  );
  const [duplicateName, setDuplicateName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    utils.retirement.retirementProfiles.invalidate();
    utils.retirement.retirementSettings.invalidate();
    utils.retirement.retirementProfilePeople.invalidate();
    utils.projection.invalidate();
  };

  const duplicateMut = trpc.retirement.retirementProfiles.duplicate.useMutation(
    {
      onSuccess: (created) => {
        invalidate();
        setDuplicating(false);
        setDuplicateName("");
        setError(null);
        // A brand-new profile is useless until it's reachable — make it
        // active AND the one being viewed immediately, rather than
        // leaving the household to hunt for it.
        if (created) {
          setActiveRetirementId(created.id);
          onViewingProfileChange(created.id);
        }
      },
      onError: (e) => setError(e.message),
    },
  );
  const renameMut = trpc.retirement.retirementProfiles.update.useMutation({
    onSuccess: () => {
      invalidate();
      setRenamingId(null);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const deleteMut = trpc.retirement.retirementProfiles.delete.useMutation({
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <div className="animate-pulse h-16 bg-surface-elevated rounded-lg" />
      </div>
    );
  }
  // No profiles yet — a real, expected state (there's no in-app bootstrap
  // for the very first one; it comes from the migration backfill or a data
  // import). RetirementProfileTab already shows its own EmptyState
  // explaining that, so stay silent here rather than duplicate the message.
  if (!profiles || profiles.length === 0) return null;

  const canDeleteAny = profiles.length > 1;

  const handleActivate = (id: number) => {
    if (isInScenario) {
      setScenarioRetirementProfile(id);
    } else {
      setActiveRetirementId(id);
    }
  };

  const handleStartDuplicate = (sourceId: number) => {
    setError(null);
    setDuplicateSourceId(sourceId);
    setDuplicateName("");
    setDuplicating(true);
  };

  const handleConfirmDuplicate = () => {
    if (duplicateSourceId == null || !duplicateName.trim()) return;
    duplicateMut.mutate({
      sourceProfileId: duplicateSourceId,
      name: duplicateName.trim(),
    });
  };

  const handleConfirmRename = (id: number) => {
    if (!renameValue.trim()) return;
    renameMut.mutate({ id, name: renameValue.trim() });
  };

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm(
      `Delete "${name}"? This removes its retirement assumptions for every household member. This cannot be undone.`,
    );
    if (ok) deleteMut.mutate({ id });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <ProfileSidebarHeader />
        <HelpTip
          maxWidth={340}
          text="Each Retirement Profile is a complete, self-contained retirement plan — its own retirement age, inflation, withdrawal strategy, everything. There's no shared baseline: changing one profile never affects another. Duplicate a profile to explore a variant (retire two years earlier, a different strategy) without touching the original."
        />
      </div>

      {error && <FormError message={error} className="mb-1" />}

      {profiles.map((profile) => {
        const isActive = profile.id === activeEffectiveId;
        return (
          <ProfileListRow
            key={profile.id}
            name={profile.name}
            isSelected={profile.id === viewingEffectiveId}
            isActive={isActive}
            activeLabel={
              isActive && activeSource === "plan-pin"
                ? "Active in this Plan"
                : "ACTIVE"
            }
            onSelect={() => onViewingProfileChange(profile.id)}
            isRenaming={renamingId === profile.id}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onRenameComplete={() => handleConfirmRename(profile.id)}
            onRenameCancel={() => setRenamingId(null)}
            onStartRename={
              admin
                ? () => {
                    setError(null);
                    setRenamingId(profile.id);
                    setRenameValue(profile.name);
                  }
                : undefined
            }
            onActivate={
              admin && !isActive ? () => handleActivate(profile.id) : undefined
            }
            onClone={admin ? () => handleStartDuplicate(profile.id) : undefined}
            onDelete={
              admin && canDeleteAny
                ? () => handleDelete(profile.id, profile.name)
                : undefined
            }
          />
        );
      })}

      {admin && duplicating && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-subtle px-3 py-2 mt-1.5">
          <span className="text-caption text-muted whitespace-nowrap">
            New profile name
          </span>
          <input
            autoFocus
            value={duplicateName}
            onChange={(e) => setDuplicateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmDuplicate();
              if (e.key === "Escape") setDuplicating(false);
            }}
            placeholder="e.g. Retire at 60"
            className="flex-1 border rounded px-2 py-1 text-sm min-w-0"
          />
          <button
            type="button"
            onClick={handleConfirmDuplicate}
            disabled={!duplicateName.trim() || duplicateMut.isPending}
            className="text-caption text-blue-600 hover:underline disabled:opacity-50 shrink-0"
          >
            {duplicateMut.isPending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => setDuplicating(false)}
            className="text-caption text-muted hover:underline shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
