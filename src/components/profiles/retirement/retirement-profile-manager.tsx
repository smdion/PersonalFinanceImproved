"use client";

import { useId, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveRetirementProfile } from "@/lib/hooks/use-active-retirement-profile";
import { FormError } from "@/components/ui/form-error";
import { confirm } from "@/components/ui/confirm-dialog";
import { HelpTip } from "@/components/ui/help-tip";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/profiles/profile-sidebar";

/**
 * Retirement Profiles list (left column of the Budget page's Retirement tab). No bare create:
 * Duplicate is the only creation path. Clicking a row VIEWS a profile without activating it;
 * rename/duplicate/delete/activate live here, assumption edits in RetirementProfileTab.
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
  const [activeRetirementId, setActiveRetirementId] =
    useActiveRetirementProfile();
  const { data: profiles, isLoading } =
    trpc.retirement.retirementProfiles.list.useQuery();
  // Tax-law years for the "Tax law year" select, read from tax_brackets (the broadest-coverage
  // reference table) rather than a separate endpoint.
  const { data: taxBracketRows } = trpc.settings.taxBrackets.list.useQuery();
  const availableTaxYears = Array.from(
    new Set((taxBracketRows ?? []).map((r) => r.taxYear)),
  ).sort((a, b) => b - a);

  const validIds = (profiles ?? []).map((p) => p.id);
  // "Active" — drives the ACTIVE badge + "Make
  // active" affordance, same computation the projection page's
  // assumptions band uses for its own activeProfileId/effectiveSource.
  const { profileId: activeEffectiveId } = useEffectiveProfileId("retirement", {
    validIds,
    localSelection: null,
    activeProfileId: activeRetirementId,
  });
  // "Viewing" — which row is selected/highlighted, independent of
  // activation. Falls back to the active profile when nothing's been
  // clicked yet, exactly like Contribution/Salary's sidebars.
  const { profileId: viewingEffectiveId } = useEffectiveProfileId(
    "retirement",
    {
      validIds,
      localSelection: viewingProfileId,
      activeProfileId: activeRetirementId,
    },
  );

  const [duplicating, setDuplicating] = useState(false);
  const [duplicateSourceId, setDuplicateSourceId] = useState<number | null>(
    null,
  );
  const [duplicateName, setDuplicateName] = useState("");
  const id = useId();
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
        setActiveRetirementId(created.id);
        onViewingProfileChange(created.id);
      },
      onError: (e) => setError(e.message),
    },
  );
  const renameMut = trpc.retirement.retirementProfiles.update.useMutation({
    onSuccess: () => {
      invalidate();
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  // taxParamsYear is profile identity (which tax law prices the plan), like name, so it is
  // written with retirementProfiles.update here, not in TaxesSection (a presentational leaf).
  const updateTaxYearMut =
    trpc.retirement.retirementProfiles.update.useMutation({
      onSuccess: () => {
        invalidate();
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
        <div className="bg-surface-elevated h-16 animate-pulse rounded-lg" />
      </div>
    );
  }
  // No profiles until the first retirement settings are saved;
  // RetirementProfileTab shows its own EmptyState until then.
  if (!profiles || profiles.length === 0) return null;

  const canDeleteAny = profiles.length > 1;

  const handleActivate = (id: number) => {
    setActiveRetirementId(id);
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
          text="Each Retirement Profile is a complete, self-contained set of retirement assumptions — its own retirement age, inflation, withdrawal strategy, everything. There's no shared baseline: changing one profile never affects another. Duplicate a profile to explore a variant (retire two years earlier, a different strategy) without touching the original."
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
            onSelect={() => onViewingProfileChange(profile.id)}
            onRename={
              admin
                ? (name) => {
                    setError(null);
                    renameMut.mutate({ id: profile.id, name });
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
            meta={
              <span
                role="presentation"
                className="flex items-center gap-1"
                // A control in the row's meta slot: its click mustn't also
                // select the row (as with the row actions).
                onClick={(e) => e.stopPropagation()}
              >
                Tax law:{" "}
                <HelpTip
                  maxWidth={280}
                  text="Which tax year's figures (brackets, limits, LTCG, IRMAA, FPL) this profile's projections are priced under. Latest (auto) tracks the newest data as it's added each year. Choosing a year keeps this profile's numbers reproducible even after a newer year is seeded."
                />{" "}
                {admin ? (
                  <select
                    aria-label={`Tax law year for ${profile.name}`}
                    value={profile.taxParamsYear ?? ""}
                    onChange={(e) =>
                      updateTaxYearMut.mutate({
                        id: profile.id,
                        taxParamsYear: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                    className="text-caption hover:border-border focus:border-accent cursor-pointer rounded border border-transparent bg-transparent px-0.5 focus:outline-none"
                  >
                    <option value="">Latest (auto)</option>
                    {availableTaxYears.map((yearRow) => (
                      <option key={yearRow} value={yearRow}>
                        {yearRow}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{profile.taxParamsYear ?? "Latest (auto)"}</span>
                )}
              </span>
            }
          />
        );
      })}

      {admin && duplicating && (
        <div className="border-subtle mt-1.5 flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
          <label
            htmlFor={`${id}-duplicate-name`}
            className="text-caption text-muted whitespace-nowrap"
          >
            New profile name
          </label>
          <input
            id={`${id}-duplicate-name`}
            autoFocus
            value={duplicateName}
            onChange={(e) => setDuplicateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmDuplicate();
              if (e.key === "Escape") setDuplicating(false);
            }}
            placeholder="e.g. Retire at 60"
            className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={handleConfirmDuplicate}
            disabled={!duplicateName.trim() || duplicateMut.isPending}
            className="text-caption shrink-0 text-blue-600 hover:underline disabled:opacity-50"
          >
            {duplicateMut.isPending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={() => setDuplicating(false)}
            className="text-caption text-muted shrink-0 hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
