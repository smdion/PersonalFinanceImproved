"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { useScenario } from "@/lib/context/scenario-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { confirm } from "@/components/ui/confirm-dialog";
import {
  EditLockToggle,
  EDIT_LOCK_KEYS,
  useEditLock,
} from "@/components/ui/edit-lock-toggle";

type ProfileSummary = {
  id: number;
  name: string;
  description: string | null;
  overrideCount: number;
  summary: {
    annualContributions: number;
    annualEmployerMatch: number;
  };
};

export function ContributionProfileManager({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { persistedScenarios, isInScenario, setScenarioContributionProfile } =
    useScenario();
  const [activeContribId, setActiveContribId] = useActiveContribProfile();
  const { data: profiles, isLoading } =
    trpc.contributionProfile.list.useQuery();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [creatingNew, setCreatingNew] = useState(false);
  const [renamingProfileId, setRenamingProfileId] = useState<number | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
  const [locked, toggleLocked] = useEditLock(EDIT_LOCK_KEYS.budgetContrib);

  const invalidateProfileDeps = () => {
    utils.contributionProfile.invalidate();
    utils.contribution.invalidate();
    utils.paycheck.invalidate();
    utils.projection.invalidate();
  };

  const deleteMutation = trpc.contributionProfile.delete.useMutation({
    onSuccess: () => {
      invalidateProfileDeps();
      if (selectedProfileId) setSelectedProfileId(null);
    },
  });
  const renameMutation = trpc.contributionProfile.update.useMutation({
    onSuccess: invalidateProfileDeps,
  });

  // Post-migration the active-profile setting always points at a real row;
  // useActiveContribProfile repairs it if that row ever goes missing.
  const globalActiveContribId = activeContribId;
  // Plan pin -> local selection -> globally-active profile (single computation path)
  const {
    profileId: effectiveSelectedId,
    source: effectiveSelectedSource,
    isPinned: isPinnedProfile,
  } = useEffectiveProfileId("contribution", {
    validIds: profiles?.map((p) => p.id),
    localSelection: selectedProfileId,
    globalDefaultId: globalActiveContribId,
  });
  const activeProfileName = profiles?.find(
    (p) => p.id === globalActiveContribId,
  )?.name;
  const isViewingNonActive =
    effectiveSelectedSource === "user-selection" &&
    effectiveSelectedId !== globalActiveContribId;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="animate-pulse h-16 bg-surface-elevated rounded-lg" />
        <div className="animate-pulse h-40 bg-surface-elevated rounded-lg" />
      </div>
    );
  }

  if (!profiles || profiles.length === 0) return null;

  const displayedProfile = profiles.find((p) => p.id === effectiveSelectedId);
  const canDeleteAny = profiles.length > 1;

  const handleActivate = (id: number) => {
    if (isInScenario) {
      setScenarioContributionProfile(id);
    } else {
      setActiveContribId(id);
    }
  };

  return (
    <div>
      {/* Viewing/Active/Pinned summary bar — same visual language as Budget/Savings Profiles */}
      {displayedProfile && (
        <div className="flex items-center justify-between bg-surface-sunken rounded-lg px-4 py-3 mb-4">
          <div className="flex items-center gap-6">
            <ProfileViewingBadge
              profileName={displayedProfile.name}
              activeProfileName={activeProfileName}
              isViewingNonActive={isViewingNonActive}
              isPinned={isPinnedProfile}
              onActivate={
                canEdit ? () => handleActivate(displayedProfile.id) : undefined
              }
            />
            {/* Contribution-scoped figures only. Salary is the Salary
                Profile's axis — showing a number here invited reading it as
                something this profile sets, which it never did. */}
            <div className="flex items-center gap-5 text-xs">
              <div>
                <span className="text-faint">Contributions </span>
                <span className="font-semibold text-secondary">
                  {formatCurrency(displayedProfile.summary.annualContributions)}
                  <span className="text-faint font-normal">/yr</span>
                </span>
              </div>
              <div>
                <span className="text-faint">Employer Match </span>
                <span className="font-semibold text-secondary">
                  {formatCurrency(displayedProfile.summary.annualEmployerMatch)}
                  <span className="text-faint font-normal">/yr</span>
                </span>
              </div>
            </div>
          </div>
          <HelpTip text="Contributions and employer match for the profile shown below. Every profile is an ordinary, editable set of contribution settings — create more to model different contribution strategies, then use them in the Relocation tool. Salary and bonus are the Salary Profile's axis, not this one. Selected independently from the budget profile above — linked per budget column instead (see each column's settings)." />
        </div>
      )}

      {/* Master-detail layout */}
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        {/* Left: profile list */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-label font-semibold text-muted uppercase tracking-wide">
              Profiles
            </h3>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setSelectedProfileId(null);
                  setCreatingNew(true);
                }}
                className="text-caption font-medium text-blue-600 hover:text-blue-700"
              >
                + New
              </button>
            )}
          </div>

          {profiles.map((p) => (
            <ProfileListItem
              key={p.id}
              profile={p}
              isSelected={!creatingNew && effectiveSelectedId === p.id}
              isActive={globalActiveContribId === p.id}
              onSelect={() => {
                setCreatingNew(false);
                setSelectedProfileId(p.id);
              }}
              onRename={
                canEdit
                  ? () => {
                      setRenamingProfileId(p.id);
                      setRenameValue(p.name);
                    }
                  : undefined
              }
              isRenaming={renamingProfileId === p.id}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onRenameComplete={() => {
                if (renameValue.trim() && renameValue.trim() !== p.name) {
                  renameMutation.mutate({ id: p.id, name: renameValue.trim() });
                }
                setRenamingProfileId(null);
              }}
              onRenameCancel={() => setRenamingProfileId(null)}
              onActivate={canEdit ? () => handleActivate(p.id) : undefined}
              onDelete={
                canEdit && canDeleteAny
                  ? async () => {
                      const pinnedBy = persistedScenarios
                        .filter((s) => s.contributionProfileId === p.id)
                        .map((s) => s.name);
                      const pinnedByClause =
                        pinnedBy.length > 0
                          ? ` The Plan${pinnedBy.length > 1 ? "s" : ""} "${pinnedBy.join('", "')}" pin${pinnedBy.length > 1 ? "" : "s"} this profile, so deleting is blocked until you unpin it there.`
                          : "";
                      if (
                        await confirm(
                          `Delete profile "${p.name}"?${pinnedByClause}`,
                        )
                      ) {
                        deleteMutation.mutate({ id: p.id });
                      }
                    }
                  : undefined
              }
            />
          ))}

          {profiles.length <= 1 && (
            <p className="text-caption text-faint italic px-2 py-3">
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
            (() => {
              const lockToggle = (
                <EditLockToggle
                  locked={locked}
                  onToggle={toggleLocked}
                  disabled={!canEdit}
                />
              );
              return !canEdit || locked ? (
                <ProfileDetailPanel
                  profileId={effectiveSelectedId}
                  lockToggle={lockToggle}
                />
              ) : (
                <ProfileInlineEditor
                  profileId={effectiveSelectedId}
                  lockToggle={lockToggle}
                  onSaved={() => invalidateProfileDeps()}
                />
              );
            })()
          ) : (
            <div className="flex items-center justify-center h-40 text-xs text-faint">
              Select a profile to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile List Item (sidebar)
// ---------------------------------------------------------------------------

function ProfileListItem({
  profile,
  isSelected,
  isActive,
  onSelect,
  onActivate,
  onDelete,
  onRename,
  isRenaming,
  renameValue,
  onRenameValueChange,
  onRenameComplete,
  onRenameCancel,
}: {
  profile: ProfileSummary;
  isSelected: boolean;
  /** Whether this profile is the currently (globally-)active one. */
  isActive: boolean;
  onSelect: () => void;
  onActivate?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameValueChange?: (value: string) => void;
  onRenameComplete?: () => void;
  onRenameCancel?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`w-full text-left px-3 py-2 rounded-md transition-colors group cursor-pointer ${
        isSelected
          ? "bg-blue-50 border border-blue-300"
          : "hover:bg-surface-sunken border border-transparent"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {isRenaming ? (
            <input
              type="text"
              value={renameValue ?? ""}
              onChange={(e) => onRenameValueChange?.(e.target.value)}
              onBlur={() => onRenameComplete?.()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") onRenameCancel?.();
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium text-primary bg-surface-primary border border-strong rounded px-1 py-0.5 w-full"
            />
          ) : (
            <span className="text-xs font-medium text-primary truncate">
              {profile.name}
            </span>
          )}
          {isActive && (
            <span className="text-micro px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold shrink-0">
              ACTIVE
            </span>
          )}
        </div>
        {(onActivate || onDelete || onRename) && !isRenaming && (
          <div
            className="flex gap-1 shrink-0 md:max-w-0 md:overflow-hidden md:opacity-0 md:group-hover:max-w-[9rem] md:group-hover:opacity-100 transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            {onActivate && !isActive && (
              <button
                type="button"
                onClick={onActivate}
                className="text-caption text-faint hover:text-green-600"
              >
                activate
              </button>
            )}
            {onRename && (
              <button
                type="button"
                onClick={onRename}
                className="text-caption text-faint hover:text-blue-600"
              >
                rename
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-caption text-faint hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-caption text-muted">
        <span>{formatCurrency(profile.summary.annualContributions)}/yr</span>
        {profile.summary.annualEmployerMatch > 0 && (
          <span className="text-green-600">
            +{formatCurrency(profile.summary.annualEmployerMatch)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Detail Panel (right side)
// ---------------------------------------------------------------------------

function ProfileDetailPanel({
  profileId,
  lockToggle,
}: {
  profileId: number;
  lockToggle?: React.ReactNode;
}) {
  const { data: profile, isLoading } =
    trpc.contributionProfile.getById.useQuery({ id: profileId });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="animate-pulse h-6 bg-surface-elevated rounded w-48" />
        <div className="animate-pulse h-32 bg-surface-elevated rounded" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div>
      {/* Profile header — Viewing/Active/Pinned state is already shown in the
          summary bar above; this just names which profile's detail this is. */}
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold text-primary">{profile.name}</h3>
        {profile.description && (
          <span className="text-caption text-faint">
            — {profile.description}
          </span>
        )}
        {lockToggle}
      </div>

      {/* Contributions section — salary is entirely the Salary Profiles
          tab's domain now, so it is deliberately not shown here. */}
      <div>
        <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
          Contribution Accounts
        </h4>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-strong">
              <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
                Account
              </th>
              <th className="text-left py-2 px-3 text-muted font-medium w-20 whitespace-nowrap">
                Method
              </th>
              <th className="text-right py-2 px-3 text-muted font-medium w-24">
                Value
              </th>
              <th className="text-right py-2 px-3 text-muted font-medium w-28">
                Match
              </th>
            </tr>
          </thead>
          <tbody>
            {profile.accountDetails.map((ad, rowIdx) => {
              const ov = ad.overrides as Record<string, unknown> | null;
              const hasOverride = ov !== null;
              const isProfileDisabled = ov?.isActive === false;
              const overrideValue = hasOverride
                ? String(ov?.contributionValue ?? "")
                : null;
              const resolvedValue = (overrideValue || ad.liveValue) ?? "";
              const methodSuffix =
                ad.liveMethod === "percent_of_salary" ? "%" : "";
              const hasNameOverride =
                ad.liveAccountName && ad.accountName !== ad.liveAccountName;
              return (
                <tr
                  key={ad.id}
                  className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                    rowIdx % 2 === 1
                      ? "bg-surface-sunken/60"
                      : "bg-surface-primary"
                  } ${isProfileDisabled ? "opacity-40" : ""}`}
                >
                  <td className="py-1.5 pl-4 pr-3 text-secondary">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`${isProfileDisabled ? "line-through" : ""} ${hasNameOverride ? "text-amber-600" : ""}`}
                      >
                        {ad.accountName}
                      </span>
                      {isProfileDisabled && (
                        <span className="text-micro px-1 py-0.5 rounded bg-surface-strong text-muted font-semibold shrink-0">
                          DISABLED
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-muted whitespace-nowrap">
                    {ad.liveMethod === "percent_of_salary"
                      ? "% salary"
                      : "fixed"}
                  </td>
                  <td
                    className={`py-1.5 px-3 text-right font-mono ${
                      hasOverride && !isProfileDisabled
                        ? "text-amber-600 font-medium"
                        : "text-secondary"
                    }`}
                  >
                    {resolvedValue}
                    {methodSuffix}
                  </td>
                  <td className="py-1.5 px-3 text-right text-faint">
                    {ad.liveMatchType && ad.liveMatchType !== "none" ? (
                      <span>
                        {parseFloat(ad.liveMatchValue ?? "0")}%
                        {ad.liveMaxMatchPct &&
                        parseFloat(ad.liveMaxMatchPct) > 0
                          ? ` to ${formatPercent(parseFloat(ad.liveMaxMatchPct), 2)}`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Creator — inline in the right-hand panel
// ---------------------------------------------------------------------------

/**
 * Create-new form. The one place a batched Save survives: a profile row has
 * to exist before per-field edits have anywhere to write. Once created, the
 * profile is edited in place by ProfileInlineEditor (padlock-gated,
 * commit-on-blur) — there is no Save/Cancel/Reset for an existing profile.
 */
function ProfileEditor({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (newId?: number) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contribValues, setContribValues] = useState<Record<string, string>>(
    {},
  );
  const [matchValues, setMatchValues] = useState<
    Record<string, { matchValue?: string; maxMatchPct?: string }>
  >({});
  const [jobValues, setJobValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [nameValues, setNameValues] = useState<Record<string, string>>({});
  const [disabledAccounts, setDisabledAccounts] = useState<
    Record<string, boolean>
  >({});
  const [employerNameValues, setEmployerNameValues] = useState<
    Record<string, string>
  >({});

  const createMutation = trpc.contributionProfile.create.useMutation({
    onSuccess: (created) => onSaved(created.id),
  });

  const handleSave = () => {
    const contribAccounts: Record<string, Record<string, unknown>> = {};
    for (const [accountId, val] of Object.entries(contribValues)) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          contributionValue: String(num),
        };
      }
    }
    // Merge custom names into contrib accounts
    for (const [accountId, nameVal] of Object.entries(nameValues)) {
      if (nameVal.trim()) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          displayNameOverride: nameVal.trim(),
        };
      }
    }
    // Merge disabled accounts into contrib accounts
    for (const [accountId, isDisabled] of Object.entries(disabledAccounts)) {
      if (isDisabled) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          isActive: false,
        };
      }
    }
    // Merge employer-match values into contrib accounts
    for (const [accountId, mVal] of Object.entries(matchValues)) {
      if (mVal.matchValue) {
        const num = parseFloat(mVal.matchValue);
        if (!isNaN(num)) {
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            employerMatchValue: String(num),
          };
        }
      }
      if (mVal.maxMatchPct) {
        const num = parseFloat(mVal.maxMatchPct);
        if (!isNaN(num)) {
          // Convert display percentage back to decimal (5 → 0.05)
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            employerMaxMatchPct: String(num / 100),
          };
        }
      }
    }

    // Build per-job values for bonus fields
    const jobs: Record<string, Record<string, unknown>> = {};
    for (const [jobId, fields] of Object.entries(jobValues)) {
      const parsed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(fields)) {
        if (
          key === "include401kInBonus" ||
          key === "includeBonusInContributions"
        ) {
          parsed[key] = val === "true";
        } else {
          const num = parseFloat(val);
          if (!isNaN(num)) parsed[key] = num;
        }
      }
      if (Object.keys(parsed).length > 0) jobs[jobId] = parsed;
    }
    // Merge custom employer names into jobs
    for (const [jobId, nameVal] of Object.entries(employerNameValues)) {
      if (nameVal.trim()) {
        jobs[jobId] = { ...(jobs[jobId] ?? {}), employerName: nameVal.trim() };
      }
    }

    const contributionOverrides: Record<
      string,
      Record<string, Record<string, unknown>>
    > = {
      ...(Object.keys(contribAccounts).length > 0
        ? { contributionAccounts: contribAccounts }
        : {}),
      ...(Object.keys(jobs).length > 0 ? { jobs } : {}),
    };

    createMutation.mutate({
      name,
      description: description || undefined,
      contributionOverrides,
    });
  };

  const isPending = createMutation.isPending;

  // An existing profile supplies the rows (and their current values) to start
  // from — every account/job is listed with its live value either way.
  const { data: profilesList } = trpc.contributionProfile.list.useQuery();
  const baseId = profilesList?.[0]?.id;
  const { data: baseData } = trpc.contributionProfile.getById.useQuery(
    { id: baseId! },
    { enabled: baseId !== undefined },
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      <FormError
        error={createMutation.error}
        prefix="Failed to save profile"
        className="mb-3"
      />

      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          {/* Name & Description */}
          <div className="grid grid-cols-2 gap-3 flex-1">
            <div>
              <label className="text-label font-medium text-muted">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Austin Relocation"
                className="mt-0.5 w-full px-2 py-1.5 text-xs border rounded bg-surface-primary text-primary"
              />
            </div>
            <div>
              <label className="text-label font-medium text-muted">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="mt-0.5 w-full px-2 py-1.5 text-xs border rounded bg-surface-primary text-primary"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-2 py-1.5 text-xs font-medium text-muted hover:text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || isPending}
              className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Create"}
            </button>
          </div>
        </div>

        {/* Contribution accounts */}
        {baseData?.accountDetails && baseData.accountDetails.length > 0 && (
          <div>
            <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
              Contributions
            </h4>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b">
                  <th className="w-6 py-1.5"></th>
                  <th className="text-left py-1.5 font-medium">Account</th>
                  <th className="text-right py-1.5 font-medium w-24">
                    Current
                  </th>
                  <th className="text-right py-1.5 font-medium w-24">Value</th>
                  <th className="text-right py-1.5 font-medium w-24">
                    Employer Match
                  </th>
                  <th className="text-right py-1.5 font-medium w-24">
                    Match Cap
                  </th>
                </tr>
              </thead>
              <tbody>
                {baseData.accountDetails.map((ad) => {
                  const isPercent = ad.liveMethod === "percent_of_salary";
                  const fmtValue = (v: string | null | undefined) => {
                    if (!v) return "—";
                    const n = parseFloat(v);
                    if (isNaN(n)) return v;
                    return n % 1 === 0 ? String(n) : n.toFixed(2);
                  };
                  const hasMatch =
                    ad.liveMatchType !== "none" && ad.liveMatchType !== null;
                  const liveMaxMatchDisplay = ad.liveMaxMatchPct
                    ? String(parseFloat(ad.liveMaxMatchPct) * 100)
                    : "";
                  const isDisabled = disabledAccounts[String(ad.id)] ?? false;
                  return (
                    <tr
                      key={ad.id}
                      className={`border-b border-subtle ${isDisabled ? "opacity-40" : ""}`}
                    >
                      <td className="py-1.5 align-top">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          onChange={(e) =>
                            setDisabledAccounts((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) delete next[String(ad.id)];
                              else next[String(ad.id)] = true;
                              return next;
                            })
                          }
                          className="rounded border-strong mt-0.5"
                          title={
                            isDisabled
                              ? "Account disabled in this profile"
                              : "Account active"
                          }
                        />
                      </td>
                      <td className="py-1.5 text-secondary">
                        <div className={isDisabled ? "line-through" : ""}>
                          {ad.liveAccountName ?? ad.accountName}
                        </div>
                        {!isDisabled && (
                          <input
                            type="text"
                            value={nameValues[String(ad.id)] ?? ""}
                            onChange={(e) =>
                              setNameValues((prev) => {
                                const next = { ...prev };
                                if (e.target.value)
                                  next[String(ad.id)] = e.target.value;
                                else delete next[String(ad.id)];
                                return next;
                              })
                            }
                            placeholder="Custom name..."
                            className="w-full mt-0.5 px-1.5 py-0.5 text-caption border rounded bg-surface-primary text-primary"
                          />
                        )}
                      </td>
                      <td className="py-1.5 text-right text-muted font-mono">
                        {isPercent ? "" : "$"}
                        {fmtValue(ad.liveValue)}
                        {isPercent ? "%" : ""}
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {!isPercent && (
                            <span className="text-caption text-faint">$</span>
                          )}
                          <input
                            type="number"
                            value={contribValues[String(ad.id)] ?? ""}
                            onChange={(e) =>
                              setContribValues((prev) => ({
                                ...prev,
                                [String(ad.id)]: e.target.value,
                              }))
                            }
                            placeholder="same"
                            className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                          />
                          {isPercent && (
                            <span className="text-caption text-faint">%</span>
                          )}
                          {contribValues[String(ad.id)] && (
                            <button
                              type="button"
                              onClick={() =>
                                setContribValues((prev) => {
                                  const next = { ...prev };
                                  delete next[String(ad.id)];
                                  return next;
                                })
                              }
                              className="text-caption text-faint hover:text-red-500"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 text-right">
                        {hasMatch ? (
                          <div className="flex items-center justify-end gap-0.5">
                            <input
                              type="number"
                              value={
                                matchValues[String(ad.id)]?.matchValue ?? ""
                              }
                              onChange={(e) =>
                                setMatchValues((prev) => ({
                                  ...prev,
                                  [String(ad.id)]: {
                                    ...prev[String(ad.id)],
                                    matchValue: e.target.value,
                                  },
                                }))
                              }
                              placeholder={fmtValue(ad.liveMatchValue)}
                              className="w-14 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                            />
                            <span className="text-caption text-faint">%</span>
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {hasMatch ? (
                          <div className="flex items-center justify-end gap-0.5">
                            <input
                              type="number"
                              value={
                                matchValues[String(ad.id)]?.maxMatchPct ?? ""
                              }
                              onChange={(e) =>
                                setMatchValues((prev) => ({
                                  ...prev,
                                  [String(ad.id)]: {
                                    ...prev[String(ad.id)],
                                    maxMatchPct: e.target.value,
                                  },
                                }))
                              }
                              placeholder={liveMaxMatchDisplay || "—"}
                              className="w-14 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                            />
                            <span className="text-caption text-faint">%</span>
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* Employer & bonus handling — bonus AMOUNT terms live on the Salary Profile */}
        {baseData?.salaryDetails && baseData.salaryDetails.length > 0 && (
          <div>
            <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
              Employer & Bonus Handling
            </h4>
            <div className="space-y-3">
              {baseData.salaryDetails.map((sd) => {
                const jo = jobValues[String(sd.jobId)] ?? {};
                const setField = (field: string, value: string) =>
                  setJobValues((prev) => ({
                    ...prev,
                    [String(sd.jobId)]: {
                      ...(prev[String(sd.jobId)] ?? {}),
                      [field]: value,
                    },
                  }));
                return (
                  <div key={sd.jobId} className="border rounded-lg p-3">
                    <div className="text-xs font-medium text-secondary mb-2 flex items-center gap-2">
                      <span>{sd.personName} —</span>
                      <input
                        type="text"
                        value={employerNameValues[String(sd.jobId)] ?? ""}
                        onChange={(e) =>
                          setEmployerNameValues((prev) => {
                            const next = { ...prev };
                            if (e.target.value)
                              next[String(sd.jobId)] = e.target.value;
                            else delete next[String(sd.jobId)];
                            return next;
                          })
                        }
                        placeholder={sd.employerName}
                        className="flex-1 px-1.5 py-0.5 text-xs border rounded bg-surface-primary text-primary"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-1.5 text-caption text-muted">
                        <input
                          type="checkbox"
                          checked={
                            jo.include401kInBonus === "true" ||
                            (jo.include401kInBonus === undefined &&
                              sd.liveInclude401kInBonus)
                          }
                          onChange={(e) =>
                            setField(
                              "include401kInBonus",
                              String(e.target.checked),
                            )
                          }
                          className="rounded border-strong"
                        />
                        Deduct 401k from bonus
                      </label>
                      <label className="flex items-center gap-1.5 text-caption text-muted">
                        <input
                          type="checkbox"
                          checked={
                            jo.includeBonusInContributions === "true" ||
                            (jo.includeBonusInContributions === undefined &&
                              sd.liveIncludeBonusInContributions)
                          }
                          onChange={(e) =>
                            setField(
                              "includeBonusInContributions",
                              String(e.target.checked),
                            )
                          }
                          className="rounded border-strong"
                        />
                        Contributions on salary + bonus
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Inline Editor — unlocked, in-place editing of an existing profile
// ---------------------------------------------------------------------------

/** The stored shape of contribution_profiles.contribution_overrides. */
type OverridesRoot = {
  contributionAccounts?: Record<string, Record<string, unknown>>;
  jobs?: Record<string, Record<string, unknown>>;
};

/**
 * Same fields as ProfileDetailPanel, rendered as inputs. There is no Save
 * button: each field commits on blur (checkboxes on change, since they have
 * no natural blur moment), sending only that field's patch — the same
 * commit-on-blur model as SavingsAllocationTable. Draft strings exist purely
 * so typing a multi-digit number doesn't fire a mutation per keystroke.
 */
function ProfileInlineEditor({
  profileId,
  lockToggle,
  onSaved,
}: {
  profileId: number;
  lockToggle?: React.ReactNode;
  onSaved: () => void;
}) {
  const { data: profile } = trpc.contributionProfile.getById.useQuery({
    id: profileId,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const updateMutation = trpc.contributionProfile.update.useMutation({
    onSuccess: () => onSaved(),
  });

  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [key]: value }));
  const clearDraft = (key: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

  if (!profile) return null;

  const root = (profile.contributionOverrides ?? {}) as OverridesRoot;
  const accountOverrides = (id: number) =>
    root.contributionAccounts?.[String(id)] ?? {};
  const jobOverrides = (id: number) => root.jobs?.[String(id)] ?? {};

  /** Send a patch for one account. `undefined` removes that key. */
  const patchAccount = (
    accountId: number,
    changes: Record<string, unknown>,
  ) => {
    const accounts = { ...(root.contributionAccounts ?? {}) };
    const entry = { ...(accounts[String(accountId)] ?? {}) };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete entry[key];
      else entry[key] = value;
    }
    if (Object.keys(entry).length === 0) delete accounts[String(accountId)];
    else accounts[String(accountId)] = entry;
    updateMutation.mutate({
      id: profileId,
      contributionOverrides: { ...root, contributionAccounts: accounts },
    });
  };

  /** Send a patch for one job. `undefined` removes that key. */
  const patchJob = (jobId: number, changes: Record<string, unknown>) => {
    const jobs = { ...(root.jobs ?? {}) };
    const entry = { ...(jobs[String(jobId)] ?? {}) };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete entry[key];
      else entry[key] = value;
    }
    if (Object.keys(entry).length === 0) delete jobs[String(jobId)];
    else jobs[String(jobId)] = entry;
    updateMutation.mutate({
      id: profileId,
      contributionOverrides: { ...root, jobs },
    });
  };

  /**
   * Shared blur handler for a numeric field: no-ops when nothing was typed or
   * the typed value matches what's already stored, clears the value when the
   * field was emptied, otherwise sends `toValue(parsed)`.
   */
  const commitNumeric = (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
    toValue: (num: number) => unknown,
  ) => {
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    clearDraft(draftKey);
    const trimmed = draft.trim();
    if (trimmed === stored.trim()) return;
    if (trimmed === "") {
      apply(undefined);
      return;
    }
    const num = parseFloat(trimmed);
    if (isNaN(num)) return;
    apply(toValue(num));
  };

  const commitText = (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
  ) => {
    const draft = drafts[draftKey];
    if (draft === undefined) return;
    clearDraft(draftKey);
    const trimmed = draft.trim();
    if (trimmed === stored.trim()) return;
    apply(trimmed === "" ? undefined : trimmed);
  };

  const commitProfileName = () => {
    const draft = drafts["profile:name"];
    if (draft === undefined) return;
    clearDraft("profile:name");
    const trimmed = draft.trim();
    if (!trimmed || trimmed === profile.name) return;
    updateMutation.mutate({ id: profileId, name: trimmed });
  };

  const commitProfileDescription = () => {
    const draft = drafts["profile:description"];
    if (draft === undefined) return;
    clearDraft("profile:description");
    const trimmed = draft.trim();
    if (trimmed === (profile.description ?? "")) return;
    updateMutation.mutate({ id: profileId, description: trimmed || null });
  };

  return (
    <div>
      <FormError
        error={updateMutation.error}
        prefix="Failed to save profile"
        className="mb-3"
      />

      <div className="grid grid-cols-2 gap-3 mb-5">
        <div>
          <label className="text-label font-medium text-muted">Name</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={drafts["profile:name"] ?? profile.name}
              onChange={(e) => setDraft("profile:name", e.target.value)}
              onBlur={commitProfileName}
              className="mt-0.5 w-full px-2 py-1.5 text-xs border rounded bg-surface-primary text-primary"
            />
            {lockToggle}
          </div>
        </div>
        <div>
          <label className="text-label font-medium text-muted">
            Description
          </label>
          <input
            type="text"
            value={drafts["profile:description"] ?? profile.description ?? ""}
            onChange={(e) => setDraft("profile:description", e.target.value)}
            onBlur={commitProfileDescription}
            placeholder="Optional description"
            className="mt-0.5 w-full px-2 py-1.5 text-xs border rounded bg-surface-primary text-primary"
          />
        </div>
      </div>

      {profile.accountDetails.length > 0 && (
        <div className="mb-5">
          <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
            Contribution Accounts
          </h4>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-strong">
                <th className="w-6 py-2 pl-4"></th>
                <th className="text-left py-2 px-3 text-muted font-medium">
                  Account
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-24">
                  Current
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-24">
                  Value
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-24">
                  Employer Match
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-24">
                  Match Cap
                </th>
              </tr>
            </thead>
            <tbody>
              {profile.accountDetails.map((ad, rowIdx) => {
                const ov = accountOverrides(ad.id);
                const isPercent = ad.liveMethod === "percent_of_salary";
                const fmtValue = (v: string | null | undefined) => {
                  if (!v) return "—";
                  const n = parseFloat(v);
                  if (isNaN(n)) return v;
                  return n % 1 === 0 ? String(n) : n.toFixed(2);
                };
                const hasMatch =
                  ad.liveMatchType !== "none" && ad.liveMatchType !== null;
                const liveMaxMatchDisplay = ad.liveMaxMatchPct
                  ? String(parseFloat(ad.liveMaxMatchPct) * 100)
                  : "";
                const isDisabled = ov.isActive === false;
                const storedValue =
                  ov.contributionValue !== undefined
                    ? String(ov.contributionValue)
                    : "";
                const storedName =
                  ov.displayNameOverride !== undefined
                    ? String(ov.displayNameOverride)
                    : "";
                const storedMatch =
                  ov.employerMatchValue !== undefined
                    ? String(ov.employerMatchValue)
                    : "";
                const storedCap =
                  ov.employerMaxMatchPct !== undefined
                    ? String(Number(ov.employerMaxMatchPct) * 100)
                    : "";
                return (
                  <tr
                    key={ad.id}
                    className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    } ${isDisabled ? "opacity-40" : ""}`}
                  >
                    <td className="py-1.5 pl-4 align-top">
                      <input
                        type="checkbox"
                        checked={!isDisabled}
                        onChange={(e) =>
                          patchAccount(ad.id, {
                            isActive: e.target.checked ? undefined : false,
                          })
                        }
                        className="rounded border-strong mt-0.5"
                        title={
                          isDisabled
                            ? "Account disabled in this profile"
                            : "Account active"
                        }
                      />
                    </td>
                    <td className="py-1.5 px-3 text-secondary">
                      <div className={isDisabled ? "line-through" : ""}>
                        {ad.liveAccountName ?? ad.accountName}
                      </div>
                      {!isDisabled && (
                        <input
                          type="text"
                          value={drafts[`a${ad.id}:name`] ?? storedName}
                          onChange={(e) =>
                            setDraft(`a${ad.id}:name`, e.target.value)
                          }
                          onBlur={() =>
                            commitText(`a${ad.id}:name`, storedName, (value) =>
                              patchAccount(ad.id, {
                                displayNameOverride: value,
                              }),
                            )
                          }
                          placeholder="Custom name..."
                          className="w-full mt-0.5 px-1.5 py-0.5 text-caption border rounded bg-surface-primary text-primary"
                        />
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right text-muted font-mono">
                      {isPercent ? "" : "$"}
                      {fmtValue(ad.liveValue)}
                      {isPercent ? "%" : ""}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {!isPercent && (
                          <span className="text-caption text-faint">$</span>
                        )}
                        <input
                          type="number"
                          value={drafts[`a${ad.id}:value`] ?? storedValue}
                          onChange={(e) =>
                            setDraft(`a${ad.id}:value`, e.target.value)
                          }
                          onBlur={() =>
                            commitNumeric(
                              `a${ad.id}:value`,
                              storedValue,
                              (value) =>
                                patchAccount(ad.id, {
                                  contributionValue: value,
                                }),
                              (num) => String(num),
                            )
                          }
                          placeholder="same"
                          className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                        />
                        {isPercent && (
                          <span className="text-caption text-faint">%</span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {hasMatch ? (
                        <div className="flex items-center justify-end gap-0.5">
                          <input
                            type="number"
                            value={drafts[`a${ad.id}:match`] ?? storedMatch}
                            onChange={(e) =>
                              setDraft(`a${ad.id}:match`, e.target.value)
                            }
                            onBlur={() =>
                              commitNumeric(
                                `a${ad.id}:match`,
                                storedMatch,
                                (value) =>
                                  patchAccount(ad.id, {
                                    employerMatchValue: value,
                                  }),
                                (num) => String(num),
                              )
                            }
                            placeholder={fmtValue(ad.liveMatchValue)}
                            className="w-14 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                          />
                          <span className="text-caption text-faint">%</span>
                        </div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      {hasMatch ? (
                        <div className="flex items-center justify-end gap-0.5">
                          <input
                            type="number"
                            value={drafts[`a${ad.id}:cap`] ?? storedCap}
                            onChange={(e) =>
                              setDraft(`a${ad.id}:cap`, e.target.value)
                            }
                            onBlur={() =>
                              commitNumeric(
                                `a${ad.id}:cap`,
                                storedCap,
                                (value) =>
                                  patchAccount(ad.id, {
                                    employerMaxMatchPct: value,
                                  }),
                                // Display percentage back to decimal (5 → 0.05)
                                (num) => String(num / 100),
                              )
                            }
                            placeholder={liveMaxMatchDisplay || "—"}
                            className="w-14 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                          />
                          <span className="text-caption text-faint">%</span>
                        </div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {profile.salaryDetails.length > 0 && (
        <div>
          <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
            Employer & Bonus Handling
          </h4>
          <div className="space-y-3">
            {profile.salaryDetails.map((sd) => {
              const jo = jobOverrides(sd.jobId);
              const storedEmployer =
                jo.employerName !== undefined ? String(jo.employerName) : "";
              const include401k =
                jo.include401kInBonus !== undefined
                  ? jo.include401kInBonus === true
                  : sd.liveInclude401kInBonus;
              const bonusInContribs =
                jo.includeBonusInContributions !== undefined
                  ? jo.includeBonusInContributions === true
                  : sd.liveIncludeBonusInContributions;
              return (
                <div key={sd.jobId} className="border rounded-lg p-3">
                  <div className="text-xs font-medium text-secondary mb-2 flex items-center gap-2">
                    <span>{sd.personName} —</span>
                    <input
                      type="text"
                      value={drafts[`j${sd.jobId}:employer`] ?? storedEmployer}
                      onChange={(e) =>
                        setDraft(`j${sd.jobId}:employer`, e.target.value)
                      }
                      onBlur={() =>
                        commitText(
                          `j${sd.jobId}:employer`,
                          storedEmployer,
                          (value) =>
                            patchJob(sd.jobId, { employerName: value }),
                        )
                      }
                      placeholder={sd.employerName}
                      className="flex-1 px-1.5 py-0.5 text-xs border rounded bg-surface-primary text-primary"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-1.5 text-caption text-muted">
                      <input
                        type="checkbox"
                        checked={include401k}
                        onChange={(e) =>
                          patchJob(sd.jobId, {
                            include401kInBonus:
                              e.target.checked === sd.liveInclude401kInBonus
                                ? undefined
                                : e.target.checked,
                          })
                        }
                        className="rounded border-strong"
                      />
                      Deduct 401k from bonus
                    </label>
                    <label className="flex items-center gap-1.5 text-caption text-muted">
                      <input
                        type="checkbox"
                        checked={bonusInContribs}
                        onChange={(e) =>
                          patchJob(sd.jobId, {
                            includeBonusInContributions:
                              e.target.checked ===
                              sd.liveIncludeBonusInContributions
                                ? undefined
                                : e.target.checked,
                          })
                        }
                        className="rounded border-strong"
                      />
                      Contributions on salary + bonus
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
