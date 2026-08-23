"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { CONTRIBUTION_METHOD_LABELS } from "@/lib/config/display-labels";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import { useScenario } from "@/lib/context/scenario-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { confirm, confirmWithDiff } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/lib/hooks/use-clone-profile";
import { diffContribProfileSwap } from "@/lib/pure/contrib-profile-diff";
import { ContributionProfileCompare } from "./contribution-profile-compare";
import { SlidePanel } from "@/components/ui/slide-panel";
import {
  ContribAccountForm,
  type ContribAccountFormValues,
} from "@/components/paycheck/contrib-account-form";
import {
  DeductionForm,
  type DeductionFormValues,
} from "@/components/paycheck/deduction-form";

type ProfileSummary = {
  id: number;
  name: string;
  description: string | null;
  activeFieldCount: number;
  summary: {
    annualContributions: number;
    annualEmployerMatch: number;
  };
};

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
  const { persistedScenarios, isInScenario, setScenarioContributionProfile } =
    useScenario();
  const [activeContribId, setActiveContribId] = useActiveContribProfile();
  const { data: profiles, isLoading } =
    trpc.contributionProfile.list.useQuery();
  const { data: compareData } = trpc.contributionProfile.compareData.useQuery();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [creatingNew, setCreatingNew] = useState(false);
  const [viewMode, setViewMode] = useState<"profiles" | "compare">("profiles");
  const [renamingProfileId, setRenamingProfileId] = useState<number | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");
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

  // R20: warn before a swap silently drops an account's active value —
  // compare against whichever profile is CURRENTLY in effect for this
  // viewing context (Plan pin, if any, else the global active one), same
  // resolution useEffectiveProfileId already does for display.
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
    if (isInScenario) {
      setScenarioContributionProfile(id);
    } else {
      setActiveContribId(id);
    }
  };

  return (
    <div>
      {/* R20: a standing audit view — accounts × profiles, not just this one
          profile's editor — kept as an internal toggle rather than a new
          top-level Budget-page tab (see contribution-profile-compare.tsx). */}
      <div className="flex items-center justify-between mb-4 border-b">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setViewMode("profiles")}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              viewMode === "profiles"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted hover:text-secondary"
            }`}
          >
            Profiles
          </button>
          <button
            type="button"
            onClick={() => setViewMode("compare")}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              viewMode === "compare"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-muted hover:text-secondary"
            }`}
          >
            Compare
          </button>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddingAccount(true)}
            className="text-caption font-medium text-blue-600 hover:text-blue-700 mb-1.5"
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
                    <span className="font-semibold text-secondary">
                      {formatCurrency(
                        displayedProfile.summary.annualContributions,
                      )}
                      <span className="text-faint font-normal">/yr</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-faint">Employer Match </span>
                    <span className="font-semibold text-secondary">
                      {formatCurrency(
                        displayedProfile.summary.annualEmployerMatch,
                      )}
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
                      renameMutation.mutate({
                        id: p.id,
                        name: renameValue.trim(),
                      });
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
                  onClone={
                    canEdit ? () => cloneProfile(p.id, p.name) : undefined
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
                !canEdit || locked ? (
                  <ProfileDetailPanel profileId={effectiveSelectedId} />
                ) : (
                  <ProfileInlineEditor
                    profileId={effectiveSelectedId}
                    onSaved={() => invalidateProfileDeps()}
                  />
                )
              ) : (
                <div className="flex items-center justify-center h-40 text-xs text-faint">
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
  onClone,
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
  onClone?: () => void;
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
        {(onActivate || onDelete || onRename || onClone) && !isRenaming && (
          <div
            className="flex gap-1 shrink-0 md:max-w-0 md:overflow-hidden md:opacity-0 md:group-hover:max-w-[13rem] md:group-hover:opacity-100 transition-all"
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
            {onClone && (
              <button
                type="button"
                onClick={onClone}
                className="text-caption text-faint hover:text-blue-600"
              >
                clone
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

/**
 * At most one active contribution per (person, accountType) group holds
 * real employer match config (computeGroupedEmployerMatch enforces this) —
 * its match applies to the whole group, combining every active split's
 * contribution before capping. A sibling split with no config of its own
 * still earns a real, proportional share of that match — this groups
 * `accountDetails` so callers can say so instead of showing nothing.
 * Shared by the read-only summary table and the editable account table
 * (both render the same profile's accounts, previously duplicated this
 * grouping independently).
 */
function groupSharedMatchAccounts<
  T extends {
    id: number;
    personId: number | null;
    accountType: string;
    liveMatchType: string | null;
  },
>(
  accountDetails: T[],
): {
  sharedMatchSource: Map<number, T>;
  combinedGroupIds: Set<number>;
} {
  const groups = new Map<string, T[]>();
  for (const ad of accountDetails) {
    const key = `${ad.personId}:${ad.accountType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ad);
  }
  const sharedMatchSource = new Map<number, T>();
  // ids of every row (both the config-holding row and its sibling) in a
  // group whose match is combined across a split — used to show the same
  // "combined" note on both rows.
  const combinedGroupIds = new Set<number>();
  groups.forEach((group) => {
    if (group.length <= 1) return;
    const withMatch = group.filter(
      (ad) => ad.liveMatchType && ad.liveMatchType !== "none",
    );
    const matchSource = withMatch[0];
    if (withMatch.length !== 1 || !matchSource) return;
    for (const ad of group) combinedGroupIds.add(ad.id);
    for (const ad of group) {
      if (ad.id !== matchSource.id) {
        sharedMatchSource.set(ad.id, matchSource);
      }
    }
  });
  return { sharedMatchSource, combinedGroupIds };
}

// ---------------------------------------------------------------------------
// Profile Detail Panel (right side)
// ---------------------------------------------------------------------------

function ProfileDetailPanel({ profileId }: { profileId: number }) {
  const { data: profile, isLoading } =
    trpc.contributionProfile.getById.useQuery({ id: profileId });
  const { data: deductionRows } = trpc.settings.deductions.list.useQuery();

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
            {(() => {
              // Roth/Traditional splits of the same physical account (same
              // person + account type) share one employer match — it's
              // entered on only one of the split rows but applies against
              // their COMBINED contributions, not each row's own. Show the
              // SAME match text on every row in the group (rather than
              // merging the cell via rowSpan) so it's unambiguous per-row
              // which account it describes — a merged cell visually reads as
              // belonging to whichever row it starts on, which is
              // misleading when that happens to be the row WITHOUT the
              // config. Only do this when exactly one row in the group
              // actually has match data — if multiple rows carry (possibly
              // conflicting) match config, that's outside this assumption,
              // so leave them per-row rather than guess which is authoritative.
              const { sharedMatchSource, combinedGroupIds } =
                groupSharedMatchAccounts(profile.accountDetails);

              return profile.accountDetails.map((ad, rowIdx) => {
                const af = ad.activeFields as Record<string, unknown> | null;
                const hasActiveFields = af !== null;
                const isProfileDisabled = af?.isActive === false;
                const activeMethod = af?.contributionMethod as
                  string | undefined;
                const activeValue = af?.contributionValue as
                  string | number | undefined;
                const methodSuffix =
                  activeMethod === "percent_of_salary" ? "%" : "";
                const hasActiveName =
                  ad.liveAccountName && ad.accountName !== ad.liveAccountName;
                const sharedFrom = sharedMatchSource.get(ad.id);
                const matchSource = sharedFrom ?? ad;
                const isCombined = combinedGroupIds.has(ad.id);
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
                          className={`${isProfileDisabled ? "line-through" : ""} ${hasActiveName ? "text-amber-600" : ""}`}
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
                      {activeMethod
                        ? activeMethod === "percent_of_salary"
                          ? "% salary"
                          : "fixed"
                        : "—"}
                    </td>
                    <td
                      className={`py-1.5 px-3 text-right font-mono ${
                        hasActiveFields && !isProfileDisabled
                          ? "text-amber-600 font-medium"
                          : "text-secondary"
                      }`}
                    >
                      {hasActiveFields ? (
                        <>
                          {activeValue}
                          {methodSuffix}
                        </>
                      ) : (
                        <span className="italic text-faint">Not set</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right text-faint whitespace-nowrap">
                      {matchSource.liveMatchType &&
                      matchSource.liveMatchType !== "none" ? (
                        <span
                          title={
                            isCombined ? "Combined with other split" : undefined
                          }
                        >
                          {matchSource.liveMatchType ===
                          "percent_of_contribution" ? (
                            <>
                              {parseFloat(matchSource.liveMatchValue ?? "0")}%
                              {matchSource.liveMaxMatchPct &&
                              parseFloat(matchSource.liveMaxMatchPct) > 0
                                ? ` of ${formatPercent(parseFloat(matchSource.liveMaxMatchPct), 2)}`
                                : ""}
                            </>
                          ) : (
                            // dollar_match / fixed_annual — a flat dollar
                            // amount, not a rate, so no "%" suffix.
                            `${formatCurrency(parseFloat(matchSource.liveMatchValue ?? "0"))}/yr`
                          )}
                          {isCombined && (
                            <span className="italic"> (combined)</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {/* Deductions section — paycheck_deductions carries no amount of its
          own any more (Stage B): amountPerPeriod resolves entirely through
          this profile's deductions active-fields, the same "no base value,
          absent = incomplete" rule contributionAccounts already uses (see
          deductionActiveFieldsSchema / applyDeductionActiveFields). */}
      {deductionRows && deductionRows.length > 0 && (
        <div className="mt-5">
          <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
            Deductions
          </h4>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-strong">
                <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
                  Deduction
                </th>
                <th className="text-left py-2 px-3 text-muted font-medium w-24">
                  Pretax
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-28">
                  Amount / Period
                </th>
              </tr>
            </thead>
            <tbody>
              {deductionRows.map((d: DeductionRow, rowIdx: number) => {
                const activeFieldsRoot = (profile.contributionActiveFields ??
                  {}) as ActiveFieldsRoot;
                const af = activeFieldsRoot.deductions?.[String(d.id)] as
                  Record<string, unknown> | undefined;
                const activeAmount = af?.amountPerPeriod as
                  string | number | undefined;
                const personName =
                  profile.deductionDetails.find((dd) => dd.id === d.id)
                    ?.employerName ?? `Job ${d.jobId}`;
                return (
                  <tr
                    key={d.id}
                    className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    }`}
                  >
                    <td className="py-1.5 pl-4 pr-3 text-secondary">
                      {d.deductionName}
                      <span className="text-faint"> — {personName}</span>
                    </td>
                    <td className="py-1.5 px-3 text-muted">
                      {d.isPretax ? "Pretax" : "Post-tax"}
                    </td>
                    <td
                      className={`py-1.5 px-3 text-right font-mono ${
                        activeAmount !== undefined
                          ? "text-amber-600 font-medium"
                          : "text-secondary"
                      }`}
                    >
                      {activeAmount !== undefined ? (
                        formatCurrency(parseFloat(String(activeAmount)))
                      ) : (
                        <span className="italic text-faint">Not set</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
  const [matchValues, setMatchValues] = useState<
    Record<string, { matchValue?: string; maxMatchPct?: string }>
  >({});
  const [contribValues, setContribValues] = useState<
    Record<string, { method?: string; value?: string }>
  >({});
  const [nameValues, setNameValues] = useState<Record<string, string>>({});
  const [disabledAccounts, setDisabledAccounts] = useState<
    Record<string, boolean>
  >({});
  const [deductionValues, setDeductionValues] = useState<
    Record<string, string>
  >({});

  const { data: deductionRows } = trpc.settings.deductions.list.useQuery();
  const { data: jobsList } = trpc.settings.jobs.list.useQuery();

  const createMutation = trpc.contributionProfile.create.useMutation({
    onSuccess: (created) => onSaved(created.id),
  });

  const handleSave = () => {
    // A new profile starts with no value for an account unless a value is
    // entered here (same "never silently inherit" principle already applied
    // to salary pins) — leaving Value blank leaves that account unset, same
    // as every account's own value, editable afterward via the standing
    // editor.
    const contribAccounts: Record<string, Record<string, unknown>> = {};
    // Merge contribution method/value into contrib accounts
    for (const [accountId, cVal] of Object.entries(contribValues)) {
      if (cVal.value && cVal.value.trim()) {
        const num = parseFloat(cVal.value);
        if (!isNaN(num)) {
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            contributionValue: String(num),
            contributionMethod: cVal.method ?? "percent_of_salary",
          };
        }
      }
    }
    // Merge custom names into contrib accounts
    for (const [accountId, nameVal] of Object.entries(nameValues)) {
      if (nameVal.trim()) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          displayNameActive: nameVal.trim(),
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

    // Build per-deduction amount overrides — same "leave blank = not set"
    // rule as contribution accounts (no base value to fall back to).
    const deductions: Record<string, Record<string, unknown>> = {};
    for (const [deductionId, amountStr] of Object.entries(deductionValues)) {
      if (amountStr && amountStr.trim()) {
        const num = parseFloat(amountStr);
        if (!isNaN(num)) {
          deductions[deductionId] = { amountPerPeriod: String(num) };
        }
      }
    }

    const contributionActiveFields: Record<
      string,
      Record<string, Record<string, unknown>>
    > = {
      ...(Object.keys(contribAccounts).length > 0
        ? { contributionAccounts: contribAccounts }
        : {}),
      ...(Object.keys(deductions).length > 0 ? { deductions } : {}),
    };

    createMutation.mutate({
      name,
      description: description || undefined,
      contributionActiveFields,
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
            <FormField label="Name">
              <FormInput
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Austin Relocation"
              />
            </FormField>
            <FormField label="Description">
              <FormInput
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </FormField>
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
            <p className="text-caption text-faint mb-2">
              Leave Value blank to start this account with no value, same as
              every account&apos;s own value — set it afterward once the profile
              is created, or fill it in now.
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b">
                  <th className="w-6 py-1.5"></th>
                  <th className="text-left py-1.5 font-medium">Account</th>
                  <th className="text-left py-1.5 font-medium w-28">Method</th>
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
                  const hasMatch =
                    ad.liveMatchType !== "none" && ad.liveMatchType !== null;
                  const isDisabled = disabledAccounts[String(ad.id)] ?? false;
                  const contribVal = contribValues[String(ad.id)] ?? {};
                  const effectiveMethod =
                    contribVal.method ?? "percent_of_salary";
                  const isPercent = effectiveMethod === "percent_of_salary";
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
                      <td className="py-1.5 px-1.5">
                        {!isDisabled && (
                          <select
                            value={effectiveMethod}
                            onChange={(e) =>
                              setContribValues((prev) => ({
                                ...prev,
                                [String(ad.id)]: {
                                  ...prev[String(ad.id)],
                                  method: e.target.value,
                                },
                              }))
                            }
                            className="w-full px-1.5 py-0.5 text-xs border rounded bg-surface-primary text-primary"
                          >
                            {Object.entries(CONTRIBUTION_METHOD_LABELS).map(
                              ([k, label]) => (
                                <option key={k} value={k}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {!isDisabled && (
                          <div className="flex items-center justify-end gap-0.5">
                            <span className="text-caption text-faint w-3 text-right shrink-0">
                              {isPercent ? "" : "$"}
                            </span>
                            <input
                              type="number"
                              value={contribVal.value ?? ""}
                              onChange={(e) =>
                                setContribValues((prev) => ({
                                  ...prev,
                                  [String(ad.id)]: {
                                    ...prev[String(ad.id)],
                                    value: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Not set"
                              className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                            />
                            <span className="text-caption text-faint w-3 text-left shrink-0">
                              {isPercent ? "%" : ""}
                            </span>
                          </div>
                        )}
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
                              placeholder="—"
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
                              placeholder="—"
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
        {/* Deductions — same "leave blank = not set" rule as contribution
            accounts above; a new profile starts with no deduction amounts
            unless entered here. */}
        {deductionRows && deductionRows.length > 0 && (
          <div>
            <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
              Deductions
            </h4>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-strong">
                  <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
                    Deduction
                  </th>
                  <th className="text-left py-2 px-3 text-muted font-medium w-24">
                    Pretax
                  </th>
                  <th className="text-right py-2 px-3 text-muted font-medium w-28">
                    Amount / Period
                  </th>
                </tr>
              </thead>
              <tbody>
                {deductionRows.map((d: DeductionRow, rowIdx: number) => {
                  const personName =
                    jobsList?.find((j) => j.id === d.jobId)?.employerName ??
                    `Job ${d.jobId}`;
                  return (
                    <tr
                      key={d.id}
                      className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                        rowIdx % 2 === 1
                          ? "bg-surface-sunken/60"
                          : "bg-surface-primary"
                      }`}
                    >
                      <td className="py-1.5 pl-4 pr-3 text-secondary">
                        {d.deductionName}
                        <span className="text-faint"> — {personName}</span>
                      </td>
                      <td className="py-1.5 px-3 text-muted">
                        {d.isPretax ? "Pretax" : "Post-tax"}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-caption text-faint w-3 text-right shrink-0">
                            $
                          </span>
                          <input
                            type="number"
                            value={deductionValues[String(d.id)] ?? ""}
                            onChange={(e) =>
                              setDeductionValues((prev) => ({
                                ...prev,
                                [String(d.id)]: e.target.value,
                              }))
                            }
                            placeholder="Not set"
                            className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* The old "Employer & Bonus Handling" jobs active-fields section
            was removed in the Stage B migration — that bucket
            (contributionActiveFields.jobs) is retired entirely.
            include401kInBonus/includeBonusInContributions/employerName now
            live on the Salary Profile entry (employerName has no
            profile-override mechanism at all any more), edited on the
            Salary Profile tab instead. */}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Inline Editor — unlocked, in-place editing of an existing profile
// ---------------------------------------------------------------------------

/** The stored shape of contribution_profiles.contribution_active_fields.
 *  No more "jobs" bucket — retired entirely in the Stage B migration. */
type ActiveFieldsRoot = {
  contributionAccounts?: Record<string, Record<string, unknown>>;
  deductions?: Record<string, Record<string, unknown>>;
};

/** A raw paycheck_deductions row, as returned by settings.deductions.list. */
type DeductionRow = {
  id: number;
  jobId: number;
  deductionName: string;
  isPretax: boolean;
  ficaExempt: boolean;
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
  onSaved,
}: {
  profileId: number;
  onSaved: () => void;
}) {
  const { data: profile } = trpc.contributionProfile.getById.useQuery({
    id: profileId,
  });
  const { data: deductionRows } = trpc.settings.deductions.list.useQuery();
  const { drafts, setDraft, clearDraft } = useDraftCommit();
  const utils = trpc.useUtils();
  const [addingDeduction, setAddingDeduction] = useState(false);
  const createDeduction = trpc.settings.deductions.create.useMutation({
    onSuccess: () => {
      utils.settings.invalidate();
      setAddingDeduction(false);
    },
  });
  const updateDeduction = trpc.settings.deductions.update.useMutation({
    onSuccess: () => utils.settings.invalidate(),
  });
  /** Same generic-field-patch pattern as paycheck/page.tsx's onUpdateDeduction
   *  — one call site builds the full record from the current row plus the
   *  one field being changed, instead of each editable cell hand-writing
   *  its own copy of the other four fields. */
  const patchDeductionRecord = (
    d: DeductionRow,
    changes: Partial<
      Pick<DeductionRow, "deductionName" | "isPretax" | "ficaExempt">
    >,
  ) =>
    updateDeduction.mutate({
      id: d.id,
      jobId: d.jobId,
      deductionName: d.deductionName,
      isPretax: d.isPretax,
      ficaExempt: d.ficaExempt,
      ...changes,
    });
  const updateMutation = trpc.contributionProfile.update.useMutation({
    onSuccess: () => onSaved(),
  });

  // patchAccount/patchDeduction used to read-merge-write the whole
  // contributionActiveFields blob client-side (from a query snapshot that
  // goes stale the instant a prior commit resolves) and PUT it back through
  // `update` — a client-side reimplementation of what
  // setAccountActiveFields/setDeductionActiveFields already do server-side,
  // in one transaction, off the freshest row. Two fields committed in quick
  // succession could silently clobber each other under the old path. These
  // call the server-side patch procedures directly instead.
  const [patchError, setPatchError] = useState<{ message: string } | null>(
    null,
  );
  const setAccountFields =
    trpc.contributionProfile.setAccountActiveFields.useMutation({
      onSuccess: () => {
        setPatchError(null);
        onSaved();
      },
      onError: setPatchError,
    });
  const setDeductionFields =
    trpc.contributionProfile.setDeductionActiveFields.useMutation({
      onSuccess: () => {
        setPatchError(null);
        onSaved();
      },
      onError: setPatchError,
    });

  if (!profile) return null;

  const root = (profile.contributionActiveFields ?? {}) as ActiveFieldsRoot;
  const accountActiveFields = (id: number) =>
    root.contributionAccounts?.[String(id)] ?? {};
  const deductionActiveFields = (id: number) =>
    root.deductions?.[String(id)] ?? {};

  /** Split a {key: value | undefined} changes record into a patch (fields
   *  actually being set) and an unset list (fields being cleared) — the
   *  wire format the server-side patch procedures expect, since a JSON
   *  body can't carry `undefined` as a distinguishable value from "field
   *  omitted". */
  const splitChanges = (changes: Record<string, unknown>) => {
    const fields: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) unset.push(key);
      else fields[key] = value;
    }
    return { fields, unset };
  };

  /** Send a patch for one account. `undefined` removes that key. */
  const patchAccount = (
    accountId: number,
    changes: Record<string, unknown>,
  ) => {
    const { fields, unset } = splitChanges(changes);
    setAccountFields.mutate({ profileId, accountId, fields, unset });
  };

  /** Send a patch for one deduction. `undefined` removes that key. */
  const patchDeduction = (
    deductionId: number,
    changes: Record<string, unknown>,
  ) => {
    const { fields, unset } = splitChanges(changes);
    setDeductionFields.mutate({ profileId, deductionId, fields, unset });
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
        error={updateMutation.error ?? patchError}
        prefix="Failed to save profile"
        className="mb-3"
      />

      <div className="grid grid-cols-2 gap-3 mb-5">
        <FormField label="Name">
          <FormInput
            type="text"
            value={drafts["profile:name"] ?? profile.name}
            onChange={(e) => setDraft("profile:name", e.target.value)}
            onBlur={commitProfileName}
          />
        </FormField>
        <FormField label="Description">
          <FormInput
            type="text"
            value={drafts["profile:description"] ?? profile.description ?? ""}
            onChange={(e) => setDraft("profile:description", e.target.value)}
            onBlur={commitProfileDescription}
            placeholder="Optional description"
          />
        </FormField>
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
                <th className="text-left py-2 px-3 text-muted font-medium w-28">
                  Method
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
              {(() => {
                // Same "combined across Roth/Trad splits" detection as the
                // read-only Profiles summary table above — shared via
                // groupSharedMatchAccounts so both render paths stay in sync.
                const { sharedMatchSource: editSharedMatchSource } =
                  groupSharedMatchAccounts(profile.accountDetails);
                return profile.accountDetails.map((ad, rowIdx) => {
                  const sharedFrom = editSharedMatchSource.get(ad.id);
                  const af = accountActiveFields(ad.id);
                  const storedMethod =
                    af.contributionMethod !== undefined
                      ? String(af.contributionMethod)
                      : "";
                  // The <select> below has no blank option, so an unset
                  // storedMethod renders as the first CONTRIBUTION_METHOD_LABELS
                  // entry ("% of Salary") regardless of what this variable says.
                  // Fall back the same way here (and to any in-progress draft
                  // pick) so the $/% prefix-suffix always matches what the
                  // dropdown is actually showing.
                  const effectiveMethod =
                    drafts[`a${ad.id}:method`] ??
                    (storedMethod || "percent_of_salary");
                  const isPercent = effectiveMethod === "percent_of_salary";
                  const hasMatch =
                    ad.liveMatchType !== "none" && ad.liveMatchType !== null;
                  const isDisabled = af.isActive === false;
                  const isSaving =
                    setAccountFields.isPending &&
                    setAccountFields.variables?.accountId === ad.id;
                  const storedValue =
                    af.contributionValue !== undefined
                      ? String(af.contributionValue)
                      : "";
                  const storedName =
                    af.displayNameActive !== undefined
                      ? String(af.displayNameActive)
                      : "";
                  const storedMatch =
                    af.employerMatchValue !== undefined
                      ? String(af.employerMatchValue)
                      : "";
                  const storedCap =
                    af.employerMaxMatchPct !== undefined
                      ? String(Number(af.employerMaxMatchPct) * 100)
                      : "";
                  return (
                    <tr
                      key={ad.id}
                      aria-busy={isSaving}
                      className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                        rowIdx % 2 === 1
                          ? "bg-surface-sunken/60"
                          : "bg-surface-primary"
                      } ${isDisabled ? "opacity-40" : ""} ${isSaving ? "opacity-60 pointer-events-none" : ""}`}
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
                              commitText(
                                `a${ad.id}:name`,
                                storedName,
                                (value) =>
                                  patchAccount(ad.id, {
                                    displayNameActive: value,
                                  }),
                              )
                            }
                            placeholder="Custom name..."
                            className="w-full mt-0.5 px-1.5 py-0.5 text-caption border rounded bg-surface-primary text-primary"
                          />
                        )}
                      </td>
                      <td className="py-1.5 px-3">
                        <select
                          value={effectiveMethod}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (storedValue.trim() !== "") {
                              // A value already exists — method is already
                              // required-and-present, safe to patch alone.
                              patchAccount(ad.id, { contributionMethod: val });
                            } else {
                              // No value yet — contributionMethod can't be set
                              // alone (required together). Track the pick
                              // locally; the Value field's commit below picks
                              // it up when a real value is finally entered.
                              setDraft(`a${ad.id}:method`, val);
                            }
                          }}
                          className="w-full px-1.5 py-0.5 text-xs border rounded bg-surface-primary text-primary"
                        >
                          {Object.entries(CONTRIBUTION_METHOD_LABELS).map(
                            ([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-caption text-faint w-3 text-right shrink-0">
                            {isPercent ? "" : "$"}
                          </span>
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
                                (value) => {
                                  if (value === undefined) {
                                    // Cleared — both-or-neither, drop the
                                    // method along with the value.
                                    patchAccount(ad.id, {
                                      contributionValue: undefined,
                                      contributionMethod: undefined,
                                    });
                                  } else if (storedValue.trim() === "") {
                                    // First time this account gets a value —
                                    // carry the (possibly just-picked) method
                                    // along with it in the same patch.
                                    patchAccount(ad.id, {
                                      contributionValue: value,
                                      contributionMethod: effectiveMethod,
                                    });
                                    clearDraft(`a${ad.id}:method`);
                                  } else {
                                    patchAccount(ad.id, {
                                      contributionValue: value,
                                    });
                                  }
                                },
                                (num) => String(num),
                              )
                            }
                            placeholder="Not set"
                            className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                          />
                          <span className="text-caption text-faint w-3 text-left shrink-0">
                            {isPercent ? "%" : ""}
                          </span>
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
                              placeholder="—"
                              className="w-14 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                            />
                            <span className="text-caption text-faint">%</span>
                          </div>
                        ) : sharedFrom ? (
                          <span
                            className="text-faint italic"
                            title={`Combined with this account's other tax-treatment split — match config is on the ${sharedFrom.accountName} row`}
                          >
                            (combined)
                          </span>
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
                              placeholder="—"
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
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Deductions — no base value on the row any more (Stage B): each
          deduction is either given an amountPerPeriod by this profile, or
          it has none at all (same "not set" state as an unset contribution
          value, no live fallback). */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-label font-semibold text-muted uppercase tracking-wide">
            Deductions
          </h4>
          <button
            type="button"
            onClick={() => setAddingDeduction(true)}
            className="text-caption font-medium text-blue-600 hover:text-blue-700"
          >
            + Add Deduction
          </button>
        </div>

        <SlidePanel
          isOpen={addingDeduction}
          onClose={() => setAddingDeduction(false)}
          title="Add Deduction"
        >
          <DeductionForm
            onSave={(data: DeductionFormValues) => createDeduction.mutate(data)}
            onCancel={() => setAddingDeduction(false)}
            isPending={createDeduction.isPending}
          />
        </SlidePanel>

        {deductionRows && deductionRows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-strong">
                <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
                  Deduction
                </th>
                <th className="text-left py-2 px-3 text-muted font-medium w-24">
                  Pretax
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-28">
                  Amount / Period
                </th>
              </tr>
            </thead>
            <tbody>
              {deductionRows.map((d: DeductionRow, rowIdx: number) => {
                const df = deductionActiveFields(d.id);
                const storedAmount =
                  df.amountPerPeriod !== undefined
                    ? String(df.amountPerPeriod)
                    : "";
                const personName =
                  profile.deductionDetails.find((dd) => dd.id === d.id)
                    ?.employerName ?? `Job ${d.jobId}`;
                const storedName = d.deductionName;
                const isSaving =
                  setDeductionFields.isPending &&
                  setDeductionFields.variables?.deductionId === d.id;
                return (
                  <tr
                    key={d.id}
                    aria-busy={isSaving}
                    className={`border-b border-subtle hover:bg-blue-50/60 transition-colors ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    } ${isSaving ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    <td className="py-1.5 pl-4 pr-3 text-secondary">
                      <input
                        type="text"
                        value={drafts[`d${d.id}:name`] ?? storedName}
                        onChange={(e) =>
                          setDraft(`d${d.id}:name`, e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            clearDraft(`d${d.id}:name`);
                            e.currentTarget.blur();
                          } else if (e.key === "Enter") {
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={() => {
                          const draft = drafts[`d${d.id}:name`];
                          if (draft === undefined) return;
                          clearDraft(`d${d.id}:name`);
                          const trimmed = draft.trim();
                          if (!trimmed || trimmed === storedName) return;
                          patchDeductionRecord(d, { deductionName: trimmed });
                        }}
                        className="w-full px-1 py-0.5 border rounded bg-surface-primary text-primary"
                      />
                      <span className="text-faint"> — {personName}</span>
                    </td>
                    <td className="py-1.5 px-3 text-muted">
                      <select
                        value={d.isPretax ? "pretax" : "posttax"}
                        onChange={(e) =>
                          patchDeductionRecord(d, {
                            isPretax: e.target.value === "pretax",
                          })
                        }
                        className="px-1 py-0.5 border rounded bg-surface-primary text-primary"
                      >
                        <option value="pretax">Pretax</option>
                        <option value="posttax">Post-tax</option>
                      </select>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <span className="text-caption text-faint w-3 text-right shrink-0">
                          $
                        </span>
                        <input
                          type="number"
                          value={drafts[`d${d.id}:amount`] ?? storedAmount}
                          onChange={(e) =>
                            setDraft(`d${d.id}:amount`, e.target.value)
                          }
                          onBlur={() =>
                            commitNumeric(
                              `d${d.id}:amount`,
                              storedAmount,
                              (value) =>
                                patchDeduction(d.id, {
                                  amountPerPeriod: value,
                                }),
                              (num) => String(num),
                            )
                          }
                          placeholder="Not set"
                          className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* The old "Employer & Bonus Handling" jobs active-fields section was
          removed in the Stage B migration — see the matching comment in
          ProfileEditor above. */}
    </div>
  );
}
