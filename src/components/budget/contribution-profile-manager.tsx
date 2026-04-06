"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";

type ProfileSummary = {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  overrideCount: number;
  summary: {
    combinedSalary: number;
    annualContributions: number;
    annualEmployerMatch: number;
  };
};

export function ContributionProfileManager({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: profiles, isLoading } =
    trpc.contributionProfile.list.useQuery();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [showEditor, setShowEditor] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [renamingProfileId, setRenamingProfileId] = useState<number | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");

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

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="animate-pulse h-16 bg-surface-elevated rounded-lg" />
        <div className="animate-pulse h-40 bg-surface-elevated rounded-lg" />
      </div>
    );
  }

  if (!profiles || profiles.length === 0) return null;

  const liveProfile = profiles.find((p) => p.isDefault);
  const customProfiles = profiles.filter((p) => !p.isDefault);
  // Auto-select live profile if nothing selected
  const effectiveSelectedId = selectedProfileId ?? liveProfile?.id ?? null;

  return (
    <div>
      {/* Active summary bar */}
      {liveProfile && (
        <div className="flex items-center justify-between bg-surface-sunken rounded-lg px-4 py-3 mb-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold uppercase">
                Active
              </span>
              <span className="text-xs text-muted">Current paycheck data</span>
            </div>
            <div className="flex items-center gap-5 text-xs">
              <div>
                <span className="text-faint">Salary </span>
                <span className="font-semibold text-secondary">
                  {formatCurrency(liveProfile.summary.combinedSalary)}
                </span>
              </div>
              <div>
                <span className="text-faint">Contributions </span>
                <span className="font-semibold text-secondary">
                  {formatCurrency(liveProfile.summary.annualContributions)}
                  <span className="text-faint font-normal">/yr</span>
                </span>
              </div>
              <div>
                <span className="text-faint">Employer Match </span>
                <span className="font-semibold text-secondary">
                  {formatCurrency(liveProfile.summary.annualEmployerMatch)}
                  <span className="text-faint font-normal">/yr</span>
                </span>
              </div>
            </div>
          </div>
          <HelpTip text="What-if scenarios for salary and contributions. The live profile reflects your current paycheck data. Create custom profiles to model different jobs, salaries, or contribution strategies — then use them in the Relocation tool." />
        </div>
      )}

      {/* Master-detail layout */}
      <div className="grid grid-cols-[240px_1fr] gap-4">
        {/* Left: profile list */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wide">
              Profiles
            </h3>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setEditingProfileId(null);
                  setShowEditor(true);
                }}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-700"
              >
                + New
              </button>
            )}
          </div>

          {/* Default profile entry */}
          {liveProfile && (
            <ProfileListItem
              profile={liveProfile}
              isSelected={effectiveSelectedId === liveProfile.id}
              onSelect={() => setSelectedProfileId(liveProfile.id)}
              onRename={
                canEdit
                  ? () => {
                      setRenamingProfileId(liveProfile.id);
                      setRenameValue(liveProfile.name);
                    }
                  : undefined
              }
              isRenaming={renamingProfileId === liveProfile.id}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              onRenameComplete={() => {
                if (
                  renameValue.trim() &&
                  renameValue.trim() !== liveProfile.name
                ) {
                  renameMutation.mutate({
                    id: liveProfile.id,
                    name: renameValue.trim(),
                  });
                }
                setRenamingProfileId(null);
              }}
              onRenameCancel={() => setRenamingProfileId(null)}
            />
          )}

          {/* Custom profiles */}
          {customProfiles.map((p) => (
            <ProfileListItem
              key={p.id}
              profile={p}
              isSelected={effectiveSelectedId === p.id}
              onSelect={() => setSelectedProfileId(p.id)}
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
              onEdit={
                canEdit
                  ? () => {
                      setEditingProfileId(p.id);
                      setShowEditor(true);
                    }
                  : undefined
              }
              onDelete={
                canEdit
                  ? () => {
                      if (confirm(`Delete profile "${p.name}"?`)) {
                        deleteMutation.mutate({ id: p.id });
                      }
                    }
                  : undefined
              }
            />
          ))}

          {customProfiles.length === 0 && (
            <p className="text-[10px] text-faint italic px-2 py-3">
              No custom profiles yet. Create one to model a different salary or
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

        {/* Right: detail panel */}
        <div className="border-l pl-4">
          {effectiveSelectedId != null ? (
            <ProfileDetailPanel profileId={effectiveSelectedId} />
          ) : (
            <div className="flex items-center justify-center h-40 text-xs text-faint">
              Select a profile to view details
            </div>
          )}
        </div>
      </div>

      {/* Editor modal */}
      {showEditor && (
        <ProfileEditor
          profileId={editingProfileId}
          onClose={() => setShowEditor(false)}
          onSaved={() => {
            setShowEditor(false);
            invalidateProfileDeps();
          }}
        />
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
  onSelect,
  onEdit,
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
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onRename?: () => void;
  isRenaming?: boolean;
  renameValue?: string;
  onRenameValueChange?: (value: string) => void;
  onRenameComplete?: () => void;
  onRenameCancel?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-md transition-colors group ${
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
          {profile.isDefault && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold shrink-0">
              ACTIVE
            </span>
          )}
        </div>
        {(onEdit || onDelete || onRename) && !isRenaming && (
          <div
            className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {onRename && (
              <button
                type="button"
                onClick={onRename}
                className="text-[10px] text-faint hover:text-blue-600"
              >
                edit
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="text-[10px] text-faint hover:text-blue-600"
              >
                configure
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="text-[10px] text-faint hover:text-red-600"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex gap-3 mt-1 text-[10px] text-muted">
        <span>{formatCurrency(profile.summary.combinedSalary)}</span>
        <span>{formatCurrency(profile.summary.annualContributions)}/yr</span>
        {profile.summary.annualEmployerMatch > 0 && (
          <span className="text-green-600">
            +{formatCurrency(profile.summary.annualEmployerMatch)}
          </span>
        )}
        {!profile.isDefault && profile.overrideCount > 0 && (
          <span className="text-amber-600">
            {profile.overrideCount} override
            {profile.overrideCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Profile Detail Panel (right side)
// ---------------------------------------------------------------------------

function ProfileDetailPanel({ profileId }: { profileId: number }) {
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
      {/* Profile header */}
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold text-primary">{profile.name}</h3>
        {profile.isDefault && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-semibold">
            ACTIVE
          </span>
        )}
        {profile.description && (
          <span className="text-[10px] text-faint">
            — {profile.description}
          </span>
        )}
      </div>

      {/* Salary section */}
      {profile.salaryDetails.length > 0 && (
        <div className="mb-5">
          <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Salary
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {profile.salaryDetails.map((sd) => {
              const resolvedSalary = sd.overrideSalary ?? sd.currentSalary;
              const isModified = sd.overrideSalary !== null;
              return (
                <div
                  key={sd.jobId}
                  className="bg-surface-sunken rounded-lg px-3 py-2"
                >
                  <div className="text-xs font-medium text-secondary">
                    {sd.personName}
                  </div>
                  <div className="text-[10px] text-faint">
                    {sd.employerNameOverride ? (
                      <span className="text-amber-600">
                        {sd.employerNameOverride}
                      </span>
                    ) : (
                      sd.employerName
                    )}
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span
                      className={`text-lg font-semibold ${isModified ? "text-amber-600" : "text-primary"}`}
                    >
                      {formatCurrency(resolvedSalary)}
                    </span>
                  </div>
                  {sd.estimatedBonus > 0 && (
                    <div className="text-[10px] text-faint mt-0.5">
                      +{formatCurrency(sd.estimatedBonus)} estimated bonus
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Contributions section */}
      <div>
        <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
          Contribution Accounts
        </h4>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted border-b">
              <th className="text-left py-1.5 font-medium">Account</th>
              <th className="text-left py-1.5 font-medium w-16">Method</th>
              <th className="text-right py-1.5 font-medium w-24">Value</th>
              <th className="text-right py-1.5 font-medium w-28">Match</th>
            </tr>
          </thead>
          <tbody>
            {profile.accountDetails.map((ad) => {
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
                  className={`border-b border-subtle ${isProfileDisabled ? "opacity-40" : ""}`}
                >
                  <td className="py-1.5 text-secondary">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`${isProfileDisabled ? "line-through" : ""} ${hasNameOverride ? "text-amber-600" : ""}`}
                      >
                        {ad.accountName}
                      </span>
                      {isProfileDisabled && (
                        <span className="text-[8px] px-1 py-0.5 rounded bg-surface-strong text-muted font-semibold shrink-0">
                          DISABLED
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 text-muted">
                    {ad.liveMethod === "percent_of_salary"
                      ? "% salary"
                      : "fixed"}
                  </td>
                  <td
                    className={`py-1.5 text-right font-mono ${
                      hasOverride && !isProfileDisabled
                        ? "text-amber-600 font-medium"
                        : "text-secondary"
                    }`}
                  >
                    {resolvedValue}
                    {methodSuffix}
                  </td>
                  <td className="py-1.5 text-right text-faint">
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
// Profile Editor (Create / Update) — Modal
// ---------------------------------------------------------------------------

function ProfileEditor({
  profileId,
  onClose,
  onSaved,
}: {
  profileId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: existingProfile } = trpc.contributionProfile.getById.useQuery(
    { id: profileId! },
    { enabled: profileId !== null },
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [salaryOverrides, setSalaryOverrides] = useState<
    Record<string, string>
  >({});
  const [contribOverrides, setContribOverrides] = useState<
    Record<string, string>
  >({});
  const [matchOverrides, setMatchOverrides] = useState<
    Record<string, { matchValue?: string; maxMatchPct?: string }>
  >({});
  const [jobOverrides, setJobOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>(
    {},
  );
  const [disabledAccounts, setDisabledAccounts] = useState<
    Record<string, boolean>
  >({});
  const [employerNameOverrides, setEmployerNameOverrides] = useState<
    Record<string, string>
  >({});

  // Populate form when editing an existing profile
  React.useEffect(() => {
    if (existingProfile && profileId !== null) {
      setName(existingProfile.name);
      setDescription(existingProfile.description ?? "");

      const sOvr: Record<string, string> = {};
      for (const sd of existingProfile.salaryDetails) {
        if (sd.overrideSalary !== null) {
          sOvr[String(sd.personId)] = String(sd.overrideSalary);
        }
      }
      setSalaryOverrides(sOvr);

      const cOvr: Record<string, string> = {};
      const mOvr: Record<
        string,
        { matchValue?: string; maxMatchPct?: string }
      > = {};
      const nOvr: Record<string, string> = {};
      const dOvr: Record<string, boolean> = {};
      for (const ad of existingProfile.accountDetails) {
        if (ad.overrides) {
          const ov = ad.overrides as Record<string, unknown>;
          if (ov.contributionValue !== undefined) {
            cOvr[String(ad.id)] = String(ov.contributionValue);
          }
          if (
            ov.employerMatchValue !== undefined ||
            ov.employerMaxMatchPct !== undefined
          ) {
            mOvr[String(ad.id)] = {
              ...(ov.employerMatchValue !== undefined
                ? { matchValue: String(ov.employerMatchValue) }
                : {}),
              ...(ov.employerMaxMatchPct !== undefined
                ? { maxMatchPct: String(Number(ov.employerMaxMatchPct) * 100) }
                : {}),
            };
          }
          if (ov.displayNameOverride)
            nOvr[String(ad.id)] = String(ov.displayNameOverride);
          if (ov.isActive === false) dOvr[String(ad.id)] = true;
        }
      }
      setContribOverrides(cOvr);
      setMatchOverrides(mOvr);
      setNameOverrides(nOvr);
      setDisabledAccounts(dOvr);

      const jOvr: Record<string, Record<string, string>> = {};
      const eOvr: Record<string, string> = {};
      for (const sd of existingProfile.salaryDetails) {
        if (sd.jobOverrides) {
          const ov = sd.jobOverrides as Record<string, unknown>;
          const fields: Record<string, string> = {};
          for (const key of [
            "bonusPercent",
            "bonusMultiplier",
            "bonusOverride",
            "monthsInBonusYear",
            "include401kInBonus",
            "includeBonusInContributions",
          ] as const) {
            if (ov[key] !== undefined) {
              // Convert decimal bonusPercent to display percentage (0.10 → 10)
              fields[key] =
                key === "bonusPercent"
                  ? String(Number(ov[key]) * 100)
                  : String(ov[key]);
            }
          }
          if (Object.keys(fields).length > 0) jOvr[String(sd.jobId)] = fields;
        }
        if (sd.employerNameOverride)
          eOvr[String(sd.jobId)] = sd.employerNameOverride;
      }
      setJobOverrides(jOvr);
      setEmployerNameOverrides(eOvr);
    }
  }, [existingProfile, profileId]);

  const createMutation = trpc.contributionProfile.create.useMutation({
    onSuccess: onSaved,
  });
  const updateMutation = trpc.contributionProfile.update.useMutation({
    onSuccess: onSaved,
  });

  const handleSave = () => {
    const salaryOvr: Record<string, number> = {};
    for (const [personId, val] of Object.entries(salaryOverrides)) {
      const num = parseFloat(val);
      if (!isNaN(num) && num > 0) salaryOvr[personId] = num;
    }

    const contribAccounts: Record<string, Record<string, unknown>> = {};
    for (const [accountId, val] of Object.entries(contribOverrides)) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        contribAccounts[accountId] = {
          ...(contribAccounts[accountId] ?? {}),
          contributionValue: String(num),
        };
      }
    }
    // Merge name overrides into contrib accounts
    for (const [accountId, nameVal] of Object.entries(nameOverrides)) {
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
    // Merge match overrides into contrib accounts
    for (const [accountId, mOvr] of Object.entries(matchOverrides)) {
      if (mOvr.matchValue) {
        const num = parseFloat(mOvr.matchValue);
        if (!isNaN(num)) {
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            employerMatchValue: String(num),
          };
        }
      }
      if (mOvr.maxMatchPct) {
        const num = parseFloat(mOvr.maxMatchPct);
        if (!isNaN(num)) {
          // Convert display percentage back to decimal (5 → 0.05)
          contribAccounts[accountId] = {
            ...(contribAccounts[accountId] ?? {}),
            employerMaxMatchPct: String(num / 100),
          };
        }
      }
    }

    // Build job overrides for bonus fields
    const jobs: Record<string, Record<string, unknown>> = {};
    for (const [jobId, fields] of Object.entries(jobOverrides)) {
      const parsed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(fields)) {
        if (
          key === "include401kInBonus" ||
          key === "includeBonusInContributions"
        ) {
          parsed[key] = val === "true";
        } else {
          const num = parseFloat(val);
          if (!isNaN(num)) {
            if (key === "bonusOverride") parsed[key] = String(num);
            // Convert display percentage back to decimal (10 → 0.10)
            else if (key === "bonusPercent") parsed[key] = num / 100;
            else parsed[key] = num;
          }
        }
      }
      if (Object.keys(parsed).length > 0) jobs[jobId] = parsed;
    }
    // Merge employer name overrides into jobs
    for (const [jobId, nameVal] of Object.entries(employerNameOverrides)) {
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

    if (profileId !== null) {
      updateMutation.mutate({
        id: profileId,
        name,
        description: description || null,
        salaryOverrides: salaryOvr,
        contributionOverrides,
      });
    } else {
      createMutation.mutate({
        name,
        description: description || undefined,
        salaryOverrides: salaryOvr,
        contributionOverrides,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // For new profiles, load live data as the base for showing fields
  const { data: profilesList } = trpc.contributionProfile.list.useQuery();
  const liveId = profilesList?.find((p) => p.isDefault)?.id;
  const { data: liveData } = trpc.contributionProfile.getById.useQuery(
    { id: liveId! },
    { enabled: liveId !== undefined },
  );

  const baseData = profileId !== null ? existingProfile : liveData;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-surface-primary rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold text-primary">
            {profileId !== null ? "Edit" : "New"} Contribution Profile
          </h3>
        </div>

        <div className="p-4 space-y-5">
          {/* Name & Description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Austin Relocation"
                className="mt-0.5 w-full px-2 py-1.5 text-xs border rounded bg-surface-primary text-primary"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted">
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

          {/* Salary Overrides */}
          {baseData?.salaryDetails && baseData.salaryDetails.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
                Salary
              </h4>
              <div className="space-y-2">
                {baseData.salaryDetails.map((sd) => (
                  <div
                    key={sd.jobId}
                    className="flex items-center gap-3 bg-surface-sunken rounded-lg px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-secondary">
                        {sd.personName}
                      </div>
                      <div className="text-[10px] text-faint">
                        {sd.employerName} · Current:{" "}
                        {formatCurrency(sd.currentSalary)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-faint">$</span>
                      <input
                        type="number"
                        value={salaryOverrides[String(sd.personId)] ?? ""}
                        onChange={(e) =>
                          setSalaryOverrides((prev) => ({
                            ...prev,
                            [String(sd.personId)]: e.target.value,
                          }))
                        }
                        placeholder="same"
                        className="w-28 px-2 py-1 text-xs text-right border rounded bg-surface-primary text-primary"
                      />
                      {salaryOverrides[String(sd.personId)] && (
                        <button
                          type="button"
                          onClick={() =>
                            setSalaryOverrides((prev) => {
                              const next = { ...prev };
                              delete next[String(sd.personId)];
                              return next;
                            })
                          }
                          className="text-[10px] text-faint hover:text-red-500"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contribution Overrides */}
          {baseData?.accountDetails && baseData.accountDetails.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
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
                    <th className="text-right py-1.5 font-medium w-24">
                      Override
                    </th>
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
                    const _unit = isPercent ? "%" : "$";
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
                                if (e.target.checked)
                                  delete next[String(ad.id)];
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
                              value={nameOverrides[String(ad.id)] ?? ""}
                              onChange={(e) =>
                                setNameOverrides((prev) => {
                                  const next = { ...prev };
                                  if (e.target.value)
                                    next[String(ad.id)] = e.target.value;
                                  else delete next[String(ad.id)];
                                  return next;
                                })
                              }
                              placeholder="Override name..."
                              className="w-full mt-0.5 px-1.5 py-0.5 text-[10px] border rounded bg-surface-primary text-primary"
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
                              <span className="text-[10px] text-faint">$</span>
                            )}
                            <input
                              type="number"
                              value={contribOverrides[String(ad.id)] ?? ""}
                              onChange={(e) =>
                                setContribOverrides((prev) => ({
                                  ...prev,
                                  [String(ad.id)]: e.target.value,
                                }))
                              }
                              placeholder="same"
                              className="w-16 px-1.5 py-0.5 text-xs text-right border rounded bg-surface-primary text-primary"
                            />
                            {isPercent && (
                              <span className="text-[10px] text-faint">%</span>
                            )}
                            {contribOverrides[String(ad.id)] && (
                              <button
                                type="button"
                                onClick={() =>
                                  setContribOverrides((prev) => {
                                    const next = { ...prev };
                                    delete next[String(ad.id)];
                                    return next;
                                  })
                                }
                                className="text-[10px] text-faint hover:text-red-500"
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
                                  matchOverrides[String(ad.id)]?.matchValue ??
                                  ""
                                }
                                onChange={(e) =>
                                  setMatchOverrides((prev) => ({
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
                              <span className="text-[10px] text-faint">%</span>
                              {matchOverrides[String(ad.id)]?.matchValue && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMatchOverrides((prev) => {
                                      const next = { ...prev };
                                      if (next[String(ad.id)]) {
                                        next[String(ad.id)] = {
                                          ...next[String(ad.id)],
                                          matchValue: "",
                                        };
                                      }
                                      return next;
                                    })
                                  }
                                  className="text-[10px] text-faint hover:text-red-500"
                                >
                                  ×
                                </button>
                              )}
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
                                  matchOverrides[String(ad.id)]?.maxMatchPct ??
                                  ""
                                }
                                onChange={(e) =>
                                  setMatchOverrides((prev) => ({
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
                              <span className="text-[10px] text-faint">%</span>
                              {matchOverrides[String(ad.id)]?.maxMatchPct && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMatchOverrides((prev) => {
                                      const next = { ...prev };
                                      if (next[String(ad.id)]) {
                                        next[String(ad.id)] = {
                                          ...next[String(ad.id)],
                                          maxMatchPct: "",
                                        };
                                      }
                                      return next;
                                    })
                                  }
                                  className="text-[10px] text-faint hover:text-red-500"
                                >
                                  ×
                                </button>
                              )}
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
          {/* Bonus Overrides */}
          {baseData?.salaryDetails && baseData.salaryDetails.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
                Bonus & Employer
              </h4>
              <div className="space-y-3">
                {baseData.salaryDetails.map((sd) => {
                  const jo = jobOverrides[String(sd.jobId)] ?? {};
                  const setField = (field: string, value: string) =>
                    setJobOverrides((prev) => ({
                      ...prev,
                      [String(sd.jobId)]: {
                        ...(prev[String(sd.jobId)] ?? {}),
                        [field]: value,
                      },
                    }));
                  const liveBonusPctDisplay = sd.liveBonusPercent
                    ? String(parseFloat(String(sd.liveBonusPercent)) * 100)
                    : "0";
                  const liveBonusMultDisplay = sd.liveBonusMultiplier
                    ? String(parseFloat(String(sd.liveBonusMultiplier)))
                    : "1";
                  return (
                    <div key={sd.jobId} className="border rounded-lg p-3">
                      <div className="text-xs font-medium text-secondary mb-2 flex items-center gap-2">
                        <span>{sd.personName} —</span>
                        <input
                          type="text"
                          value={employerNameOverrides[String(sd.jobId)] ?? ""}
                          onChange={(e) =>
                            setEmployerNameOverrides((prev) => {
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
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] text-muted">
                            Bonus
                          </label>
                          <div className="flex items-center gap-0.5 mt-0.5">
                            <input
                              type="number"
                              value={jo.bonusPercent ?? ""}
                              onChange={(e) =>
                                setField("bonusPercent", e.target.value)
                              }
                              placeholder={liveBonusPctDisplay}
                              step="1"
                              className="w-full px-1.5 py-0.5 text-xs border rounded bg-surface-primary text-primary"
                            />
                            <span className="text-[10px] text-faint shrink-0">
                              %
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted">
                            Multiplier
                          </label>
                          <div className="flex items-center gap-0.5 mt-0.5">
                            <input
                              type="number"
                              value={jo.bonusMultiplier ?? ""}
                              onChange={(e) =>
                                setField("bonusMultiplier", e.target.value)
                              }
                              placeholder={liveBonusMultDisplay}
                              step="0.1"
                              className="w-full px-1.5 py-0.5 text-xs border rounded bg-surface-primary text-primary"
                            />
                            <span className="text-[10px] text-faint shrink-0">
                              ×
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted">
                            Fixed override
                          </label>
                          <div className="flex items-center gap-0.5 mt-0.5">
                            <span className="text-[10px] text-faint shrink-0">
                              $
                            </span>
                            <input
                              type="number"
                              value={jo.bonusOverride ?? ""}
                              onChange={(e) =>
                                setField("bonusOverride", e.target.value)
                              }
                              placeholder="—"
                              className="w-full px-1.5 py-0.5 text-xs border rounded bg-surface-primary text-primary"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <label className="flex items-center gap-1.5 text-[10px] text-muted">
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
                        <label className="flex items-center gap-1.5 text-[10px] text-muted">
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

        {/* Footer */}
        <div className="p-4 border-t">
          <FormError
            error={createMutation.error ?? updateMutation.error}
            prefix="Failed to save profile"
            className="mb-2"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-surface-elevated text-secondary hover:bg-surface-strong"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || isPending}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Saving…" : profileId !== null ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
