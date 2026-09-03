"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import {
  CONTRIBUTION_METHOD_LABELS,
  EMPLOYER_MATCH_LABELS,
  EMPLOYER_MATCH_VALUE_UNIT,
} from "@/lib/config/display-labels";
import { formatEmployerMatch } from "@/lib/pure/contributions";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import { useScenario } from "@/lib/context/scenario-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";
import { confirm, confirmWithDiff } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/lib/hooks/use-clone-profile";
import { diffContribProfileSwap } from "@/lib/pure/contrib-profile-diff";
import {
  resolveContribFieldDisplayState,
  type ContribAccountActiveFields,
} from "@/lib/pure/profiles";
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
  const { profileId: effectiveSelectedId, source: effectiveSelectedSource } =
    useEffectiveProfileId("contribution", {
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
        <div className="bg-surface-elevated h-16 animate-pulse rounded-lg" />
        <div className="bg-surface-elevated h-40 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!profiles || profiles.length === 0) return null;

  const displayedProfile = profiles.find((p) => p.id === effectiveSelectedId);
  const canDeleteAny = profiles.length > 1;

  // Warn before a swap silently drops an account's active value —
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
      {/* A standing audit view — accounts × profiles, not just this one
          profile's editor — kept as an internal toggle rather than a new
          top-level Budget-page tab (see contribution-profile-compare.tsx). */}
      <div className="mb-4 flex items-center justify-between border-b">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setViewMode("profiles")}
            className={`border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === "profiles"
                ? "border-blue-600 text-blue-600"
                : "text-muted hover:text-secondary border-transparent"
            }`}
          >
            Profiles
          </button>
          <button
            type="button"
            onClick={() => setViewMode("compare")}
            className={`border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === "compare"
                ? "border-blue-600 text-blue-600"
                : "text-muted hover:text-secondary border-transparent"
            }`}
          >
            Compare
          </button>
        </div>
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
          {/* Viewing/Active/Pinned summary bar — same visual language as Budget/Savings Profiles */}
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
                  isActive={globalActiveContribId === p.id}
                  onSelect={() => {
                    setCreatingNew(false);
                    setSelectedProfileId(p.id);
                  }}
                  onStartRename={
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
                              ? ` The Plan${pinnedBy.length > 1 ? "s" : ""} "${pinnedBy.join('", "')}" ${pinnedBy.length > 1 ? "have" : "has"} this profile active, so deleting is blocked until you clear it there.`
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
        <div className="bg-surface-elevated h-6 w-48 animate-pulse rounded" />
        <div className="bg-surface-elevated h-32 animate-pulse rounded" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div>
      {/* Profile header — Viewing/Active/Pinned state is already shown in the
          summary bar above; this just names which profile's detail this is. */}
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-primary text-sm font-semibold">{profile.name}</h3>
        {profile.description && (
          <span className="text-caption text-faint">
            — {profile.description}
          </span>
        )}
      </div>

      {/* Contributions section — salary is entirely the Salary Profiles
          tab's domain now, so it is deliberately not shown here. */}
      <div>
        <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
          Contribution Accounts
        </h4>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-strong border-b-2">
              <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                Account
              </th>
              <th className="text-muted w-20 px-3 py-2 text-left font-medium whitespace-nowrap">
                Method
              </th>
              <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                Value
              </th>
              <th className="text-muted w-28 px-3 py-2 text-right font-medium">
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
                const af = ad.activeFields as ContribAccountActiveFields;
                const {
                  hasValue,
                  isDisabled: isProfileDisabled,
                  value: activeValue,
                  methodSuffix,
                } = resolveContribFieldDisplayState(af);
                const activeMethod = af?.contributionMethod;
                const hasActiveName =
                  ad.liveAccountName && ad.accountName !== ad.liveAccountName;
                const sharedFrom = sharedMatchSource.get(ad.id);
                const matchSource = sharedFrom ?? ad;
                const isCombined = combinedGroupIds.has(ad.id);
                return (
                  <tr
                    key={ad.id}
                    className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    } ${isProfileDisabled ? "opacity-40" : ""}`}
                  >
                    <td className="text-secondary py-1.5 pr-3 pl-4">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`${isProfileDisabled ? "line-through" : ""} ${hasActiveName ? "text-amber-600" : ""}`}
                        >
                          {ad.accountName}
                        </span>
                        {isProfileDisabled && (
                          <span className="text-micro border-strong text-muted shrink-0 rounded border px-1 py-0.5 font-semibold">
                            OFF HERE
                          </span>
                        )}
                        {!ad.liveIsActive && (
                          <span
                            className="text-micro shrink-0 font-medium text-amber-500"
                            title="This account isn't a funding target — any value set for it here has no effect. Restore it from the profile editor."
                          >
                            not a funding target
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="text-muted px-3 py-1.5 whitespace-nowrap">
                      {activeMethod
                        ? activeMethod === "percent_of_salary"
                          ? "% salary"
                          : "fixed"
                        : "—"}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${
                        hasValue && !isProfileDisabled
                          ? "font-medium text-amber-600"
                          : "text-secondary"
                      }`}
                    >
                      {hasValue ? (
                        methodSuffix === "%" ? (
                          `${activeValue}%`
                        ) : (
                          formatCurrency(parseFloat(String(activeValue)))
                        )
                      ) : (
                        <span className="text-faint italic">Not set</span>
                      )}
                    </td>
                    <td className="text-faint px-3 py-1.5 text-right whitespace-nowrap">
                      {(() => {
                        const matchText = formatEmployerMatch(
                          matchSource.liveMatchType,
                          matchSource.liveMatchValue,
                          matchSource.liveMaxMatchPct,
                        );
                        return matchText ? (
                          <span
                            title={
                              isCombined
                                ? "Combined with other split"
                                : undefined
                            }
                          >
                            {matchText}
                            {isCombined && (
                              <span className="italic"> (combined)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        );
                      })()}
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
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Deductions
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-strong border-b-2">
                <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                  Deduction
                </th>
                <th className="text-muted w-24 px-3 py-2 text-left font-medium">
                  Pretax
                </th>
                <th className="text-muted w-28 px-3 py-2 text-right font-medium">
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
                    className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    }`}
                  >
                    <td className="text-secondary py-1.5 pr-3 pl-4">
                      {d.deductionName}
                      <span className="text-faint"> — {personName}</span>
                    </td>
                    <td className="text-muted px-3 py-1.5">
                      {d.isPretax ? "Pretax" : "Post-tax"}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${
                        activeAmount !== undefined
                          ? "font-medium text-amber-600"
                          : "text-secondary"
                      }`}
                    >
                      {activeAmount !== undefined ? (
                        formatCurrency(parseFloat(String(activeAmount)))
                      ) : (
                        <span className="text-faint italic">Not set</span>
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
    Record<
      string,
      { matchType?: string; matchValue?: string; maxMatchPct?: string }
    >
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
          displayNameCustom: nameVal.trim(),
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
    // Merge employer-match type/values into contrib accounts
    for (const [accountId, mVal] of Object.entries(matchValues)) {
      if (mVal.matchType) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          employerMatchType: mVal.matchType,
        };
      }
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
          <div className="grid flex-1 grid-cols-2 gap-3">
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
          <div className="flex shrink-0 items-center gap-2 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="text-muted hover:text-secondary px-2 py-1.5 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Create"}
            </button>
          </div>
        </div>

        {/* Contribution accounts */}
        {baseData?.accountDetails && baseData.accountDetails.length > 0 && (
          <div>
            <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
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
                  <th
                    className="w-6 py-1.5 text-left font-medium"
                    title="Enabled in this profile"
                  >
                    On
                  </th>
                  <th className="py-1.5 text-left font-medium">Account</th>
                  <th className="w-28 py-1.5 text-left font-medium">Method</th>
                  <th className="w-24 py-1.5 text-right font-medium">Value</th>
                  <th className="w-28 py-1.5 text-left font-medium">
                    Match Type
                  </th>
                  <th className="w-24 py-1.5 text-right font-medium">
                    Employer Match
                  </th>
                  <th className="w-24 py-1.5 text-right font-medium">
                    Match Cap
                  </th>
                </tr>
              </thead>
              <tbody>
                {baseData.accountDetails.map((ad) => {
                  const mVal = matchValues[String(ad.id)] ?? {};
                  const effectiveMatchType =
                    mVal.matchType ?? ad.liveMatchType ?? "none";
                  const hasMatch = effectiveMatchType !== "none";
                  const isPercentMatch =
                    effectiveMatchType === "percent_of_contribution";
                  const isDisabled = disabledAccounts[String(ad.id)] ?? false;
                  const contribVal = contribValues[String(ad.id)] ?? {};
                  const effectiveMethod =
                    contribVal.method ?? "percent_of_salary";
                  const isPercent = effectiveMethod === "percent_of_salary";
                  return (
                    <tr
                      key={ad.id}
                      className={`border-subtle border-b ${isDisabled ? "opacity-40" : ""}`}
                    >
                      <td className="py-1.5 align-top">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          disabled={!ad.liveIsActive}
                          onChange={(e) =>
                            setDisabledAccounts((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) delete next[String(ad.id)];
                              else next[String(ad.id)] = true;
                              return next;
                            })
                          }
                          className="border-strong mt-0.5 rounded disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            !ad.liveIsActive
                              ? "This account isn't a funding target — this checkbox has no effect until it's restored"
                              : isDisabled
                                ? "Disabled in this profile"
                                : "Enabled in this profile"
                          }
                          aria-label={
                            !ad.liveIsActive
                              ? "This account isn't a funding target — this checkbox has no effect until it's restored"
                              : isDisabled
                                ? "Disabled in this profile"
                                : "Enabled in this profile"
                          }
                        />
                      </td>
                      <td className="text-secondary py-1.5">
                        <div className={isDisabled ? "line-through" : ""}>
                          {ad.liveAccountName ?? ad.accountName}
                        </div>
                        {!ad.liveIsActive && (
                          <div
                            className="text-micro font-medium text-amber-500"
                            title="This account isn't a funding target — any value set for it here has no effect. Restore it from the profile editor once this profile is created."
                          >
                            Not a funding target
                          </div>
                        )}
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
                            className="text-caption bg-surface-primary text-primary mt-0.5 w-full rounded border px-1.5 py-0.5"
                          />
                        )}
                      </td>
                      <td className="px-1.5 py-1.5">
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
                            className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
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
                            <span className="text-caption text-faint w-3 shrink-0 text-right">
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
                              className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
                            />
                            <span className="text-caption text-faint w-3 shrink-0 text-left">
                              {isPercent ? "%" : ""}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-1.5 py-1.5">
                        <select
                          value={effectiveMatchType}
                          onChange={(e) =>
                            setMatchValues((prev) => ({
                              ...prev,
                              [String(ad.id)]: {
                                ...prev[String(ad.id)],
                                matchType: e.target.value,
                              },
                            }))
                          }
                          className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
                        >
                          {Object.entries(EMPLOYER_MATCH_LABELS).map(
                            ([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="py-1.5 text-right">
                        {hasMatch ? (
                          <div className="flex items-center justify-end gap-0.5">
                            {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] ===
                              "$" && (
                              <span className="text-caption text-faint w-3 shrink-0 text-right">
                                $
                              </span>
                            )}
                            <input
                              type="number"
                              value={mVal.matchValue ?? ""}
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
                              className="bg-surface-primary text-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs"
                            />
                            {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] ===
                              "%" && (
                              <span className="text-caption text-faint">%</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        {hasMatch && isPercentMatch ? (
                          <div className="flex items-center justify-end gap-0.5">
                            <input
                              type="number"
                              value={mVal.maxMatchPct ?? ""}
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
                              className="bg-surface-primary text-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs"
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
            <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
              Deductions
            </h4>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-strong border-b-2">
                  <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                    Deduction
                  </th>
                  <th className="text-muted w-24 px-3 py-2 text-left font-medium">
                    Pretax
                  </th>
                  <th className="text-muted w-28 px-3 py-2 text-right font-medium">
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
                      className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                        rowIdx % 2 === 1
                          ? "bg-surface-sunken/60"
                          : "bg-surface-primary"
                      }`}
                    >
                      <td className="text-secondary py-1.5 pr-3 pl-4">
                        {d.deductionName}
                        <span className="text-faint"> — {personName}</span>
                      </td>
                      <td className="text-muted px-3 py-1.5">
                        {d.isPretax ? "Pretax" : "Post-tax"}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-caption text-faint w-3 shrink-0 text-right">
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
                            className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
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
  const setAccountActive =
    trpc.settings.contributionAccounts.setActive.useMutation({
      onSuccess: () => {
        utils.settings.contributionAccounts.invalidate();
        utils.contributionProfile.invalidate();
      },
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

      <div className="mb-5 grid grid-cols-2 gap-3">
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
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Contribution Accounts
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-strong border-b-2">
                <th
                  className="text-muted w-6 py-2 pl-4 text-left font-medium"
                  title="Enabled in this profile"
                >
                  On
                </th>
                <th className="text-muted px-3 py-2 text-left font-medium">
                  Account
                </th>
                <th className="text-muted w-28 px-3 py-2 text-left font-medium">
                  Method
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Value
                </th>
                <th className="text-muted w-28 px-3 py-2 text-left font-medium">
                  Match Type
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                  Employer Match
                </th>
                <th className="text-muted w-24 px-3 py-2 text-right font-medium">
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
                  // employerMatchType is itself profile-overridable (it's a
                  // PROFILE_OWNED_CONTRIB_FIELDS member) — must resolve the
                  // same way the server's applyContribActiveFields merge
                  // does, or a profile that overrides type away from the
                  // live account's own type shows no editor for it at all.
                  const storedMatchType =
                    af.employerMatchType !== undefined
                      ? String(af.employerMatchType)
                      : "";
                  // The <select> below commits immediately on change (same
                  // pattern as the "On" checkbox), not draft-then-blur, so
                  // no drafts[] lookup here — patchAccount below is the
                  // single source of truth the instant it fires.
                  const effectiveMatchType =
                    storedMatchType || ad.liveMatchType || "none";
                  const hasMatch = effectiveMatchType !== "none";
                  const isPercentMatch =
                    effectiveMatchType === "percent_of_contribution";
                  const isDisabled = af.isActive === false;
                  const isSaving =
                    setAccountFields.isPending &&
                    setAccountFields.variables?.accountId === ad.id;
                  const storedValue =
                    af.contributionValue !== undefined
                      ? String(af.contributionValue)
                      : "";
                  const storedName =
                    (af.displayNameCustom ?? af.displayNameActive) !== undefined
                      ? String(af.displayNameCustom ?? af.displayNameActive)
                      : "";
                  // A profile that resolves no value for this account
                  // (hasValue false) contributes nothing to the engine —
                  // its live match is never actually "in effect" here, so
                  // it must not be shown as if it were a real, applying
                  // value. Same resolver used everywhere else this session
                  // for this exact distinction (RULES.md Rule 6).
                  const { hasValue: contribHasValue } =
                    resolveContribFieldDisplayState(af);
                  const storedMatch =
                    af.employerMatchValue !== undefined
                      ? String(af.employerMatchValue)
                      : contribHasValue && ad.liveMatchValue != null
                        ? String(ad.liveMatchValue)
                        : "";
                  const storedCap =
                    af.employerMaxMatchPct !== undefined
                      ? String(Number(af.employerMaxMatchPct) * 100)
                      : contribHasValue && ad.liveMaxMatchPct != null
                        ? String(Number(ad.liveMaxMatchPct) * 100)
                        : "";
                  return (
                    <tr
                      key={ad.id}
                      aria-busy={isSaving}
                      className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                        rowIdx % 2 === 1
                          ? "bg-surface-sunken/60"
                          : "bg-surface-primary"
                      } ${isDisabled ? "opacity-40" : ""} ${isSaving ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <td className="py-1.5 pl-4 align-top">
                        <input
                          type="checkbox"
                          checked={!isDisabled}
                          disabled={!ad.liveIsActive}
                          onChange={(e) =>
                            patchAccount(ad.id, {
                              isActive: e.target.checked ? undefined : false,
                            })
                          }
                          className="border-strong mt-0.5 rounded disabled:cursor-not-allowed disabled:opacity-40"
                          title={
                            !ad.liveIsActive
                              ? "This account isn't a funding target — this checkbox has no effect until it's restored"
                              : isDisabled
                                ? "Disabled in this profile"
                                : "Enabled in this profile"
                          }
                          aria-label={
                            !ad.liveIsActive
                              ? "This account isn't a funding target — this checkbox has no effect until it's restored"
                              : isDisabled
                                ? "Disabled in this profile"
                                : "Enabled in this profile"
                          }
                        />
                      </td>
                      <td className="text-secondary px-3 py-1.5">
                        <div className={isDisabled ? "line-through" : ""}>
                          {ad.liveAccountName ?? ad.accountName}
                        </div>
                        {!ad.liveIsActive && (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="text-micro font-medium text-amber-500"
                              title="This account isn't a funding target — any value set for it here has no effect."
                            >
                              Not a funding target
                            </span>
                            <button
                              onClick={() =>
                                setAccountActive.mutate({
                                  id: ad.id,
                                  isActive: true,
                                })
                              }
                              disabled={setAccountActive.isPending}
                              className="text-micro text-green-500 hover:text-green-700 disabled:opacity-50"
                            >
                              Restore as funding target
                            </button>
                          </div>
                        )}
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
                                    displayNameCustom: value,
                                  }),
                              )
                            }
                            placeholder="Custom name..."
                            className="text-caption bg-surface-primary text-primary mt-0.5 w-full rounded border px-1.5 py-0.5"
                          />
                        )}
                      </td>
                      <td className="px-3 py-1.5">
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
                          className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
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
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-caption text-faint w-3 shrink-0 text-right">
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
                            className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
                          />
                          <span className="text-caption text-faint w-3 shrink-0 text-left">
                            {isPercent ? "%" : ""}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={effectiveMatchType}
                          onChange={(e) =>
                            patchAccount(ad.id, {
                              employerMatchType: e.target.value,
                            })
                          }
                          className="bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs"
                        >
                          {Object.entries(EMPLOYER_MATCH_LABELS).map(
                            ([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {hasMatch ? (
                          <div className="flex items-center justify-end gap-0.5">
                            {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] ===
                              "$" && (
                              <span className="text-caption text-faint w-3 shrink-0 text-right">
                                $
                              </span>
                            )}
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
                              title={
                                af.employerMatchValue === undefined &&
                                storedMatch !== ""
                                  ? "Inherited from the account's own settings — editing this sets a customization for this profile only"
                                  : undefined
                              }
                              placeholder="—"
                              className={`bg-surface-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs ${
                                af.employerMatchValue === undefined &&
                                storedMatch !== ""
                                  ? "text-faint italic"
                                  : "text-primary"
                              }`}
                            />
                            {EMPLOYER_MATCH_VALUE_UNIT[effectiveMatchType] ===
                              "%" && (
                              <span className="text-caption text-faint">%</span>
                            )}
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
                      <td className="px-3 py-1.5 text-right">
                        {hasMatch && isPercentMatch ? (
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
                              title={
                                af.employerMaxMatchPct === undefined &&
                                storedCap !== ""
                                  ? "Inherited from the account's own settings — editing this sets a customization for this profile only"
                                  : undefined
                              }
                              placeholder="—"
                              className={`bg-surface-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs ${
                                af.employerMaxMatchPct === undefined &&
                                storedCap !== ""
                                  ? "text-faint italic"
                                  : "text-primary"
                              }`}
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
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-label text-muted font-semibold tracking-wide uppercase">
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
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-strong border-b-2">
                <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                  Deduction
                </th>
                <th className="text-muted w-24 px-3 py-2 text-left font-medium">
                  Pretax
                </th>
                <th className="text-muted w-28 px-3 py-2 text-right font-medium">
                  Amount / Period
                </th>
                <th className="w-16"></th>
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
                    className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    } ${isSaving ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <td className="text-secondary py-1.5 pr-3 pl-4">
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
                        className="bg-surface-primary text-primary w-full rounded border px-1 py-0.5"
                      />
                      <span className="text-faint"> — {personName}</span>
                    </td>
                    <td className="text-muted px-3 py-1.5">
                      <select
                        value={d.isPretax ? "pretax" : "posttax"}
                        onChange={(e) =>
                          patchDeductionRecord(d, {
                            isPretax: e.target.value === "pretax",
                          })
                        }
                        className="bg-surface-primary text-primary rounded border px-1 py-0.5"
                      >
                        <option value="pretax">Pretax</option>
                        <option value="posttax">Post-tax</option>
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <span className="text-caption text-faint w-3 shrink-0 text-right">
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
                          className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs"
                        />
                      </div>
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      {storedAmount !== "" && (
                        <button
                          onClick={() => {
                            clearDraft(`d${d.id}:amount`);
                            patchDeduction(d.id, {
                              amountPerPeriod: undefined,
                            });
                          }}
                          title="Remove this deduction from this profile — its dollar amount is cleared, not just hidden"
                          className="text-caption text-muted hover:text-secondary"
                        >
                          Remove
                        </button>
                      )}
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
