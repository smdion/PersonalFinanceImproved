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

/**
 * Retirement Profiles list — Budget tab, sits above RetirementProfileTab's
 * settings editor (which always edits/shows the ACTIVE profile; this is
 * where you change which one that is).
 *
 * Deliberately thin, matching SalaryProfileManager's philosophy: no bare
 * "create" (retirement_settings has ~40 NOT NULL columns with no sensible
 * blank default — Duplicate is the one creation path, same as the router).
 * Each profile is a COMPLETE WORLD, same contract as Salary Profiles: no
 * baseline, no default, no merge. "Active" is the correct word here, not
 * "pin" — see the profile-terminology memory.
 *
 * Renaming a profile's assumptions themselves (age, inflation, strategy,
 * ...) happens in RetirementProfileTab below, scoped to whichever profile is
 * active — this component only manages the LIST of profiles and which one
 * is active, never their contents.
 */
export function RetirementProfileManager() {
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const { isInScenario, setScenarioRetirementProfile } = useScenario();
  const [activeRetirementId, setActiveRetirementId] =
    useActiveRetirementProfile();
  const { data: profiles, isLoading } =
    trpc.retirement.retirementProfiles.list.useQuery();

  const { profileId: effectiveId, source: effectiveSource } =
    useEffectiveProfileId("retirement", {
      validIds: (profiles ?? []).map((p) => p.id),
      localSelection: null,
      globalDefaultId: activeRetirementId,
    });

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
        // active immediately rather than leaving the household to hunt for
        // an "activate" affordance on a row that isn't even visible yet as
        // anything but a name.
        if (created) setActiveRetirementId(created.id);
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
      <div className="space-y-3">
        <div className="animate-pulse h-16 bg-surface-elevated rounded-lg" />
      </div>
    );
  }
  // No profiles yet — a real, expected state (there's no in-app bootstrap
  // for the very first one; it comes from the migration backfill or a data
  // import). RetirementProfileTab below already shows its own EmptyState
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

  const handleStartRename = (id: number, currentName: string) => {
    setError(null);
    setRenamingId(id);
    setRenameValue(currentName);
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
    <div className="space-y-3 mb-4">
      <div className="flex items-center gap-2">
        <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
          Retirement Profiles
        </h4>
        <HelpTip
          maxWidth={340}
          text="Each Retirement Profile is a complete, self-contained retirement plan — its own retirement age, inflation, withdrawal strategy, everything. There's no shared baseline: changing one profile never affects another. Duplicate a profile to explore a variant (retire two years earlier, a different strategy) without touching the original."
        />
        <div className="flex-1 border-t" />
      </div>

      {error && <FormError message={error} className="mb-1" />}

      <div className="space-y-1.5">
        {profiles.map((profile) => {
          const isActive = profile.id === effectiveId;
          const isRenaming = renamingId === profile.id;
          return (
            <div
              key={profile.id}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                isActive
                  ? "border-blue-300 bg-blue-50"
                  : "border-subtle bg-surface-primary"
              }`}
            >
              {isRenaming ? (
                <>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmRename(profile.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="flex-1 border rounded px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleConfirmRename(profile.id)}
                    className="text-caption text-blue-600 hover:underline"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenamingId(null)}
                    className="text-caption text-muted hover:underline"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium">
                    {profile.name}
                    {isActive && (
                      <span className="ml-2 text-micro text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-medium">
                        {effectiveSource === "plan-pin"
                          ? "Active in this Plan"
                          : "Active"}
                      </span>
                    )}
                  </span>
                  {admin && (
                    <>
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => handleActivate(profile.id)}
                          className="text-caption text-blue-600 hover:underline"
                        >
                          Make active
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          handleStartRename(profile.id, profile.name)
                        }
                        className="text-caption text-muted hover:underline"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartDuplicate(profile.id)}
                        className="text-caption text-muted hover:underline"
                      >
                        Duplicate
                      </button>
                      {canDeleteAny && (
                        <button
                          type="button"
                          onClick={() => handleDelete(profile.id, profile.name)}
                          className="text-caption text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {admin && duplicating && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-subtle px-3 py-2">
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
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={handleConfirmDuplicate}
            disabled={!duplicateName.trim() || duplicateMut.isPending}
            className="text-caption text-blue-600 hover:underline disabled:opacity-50"
          >
            {duplicateMut.isPending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => setDuplicating(false)}
            className="text-caption text-muted hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
