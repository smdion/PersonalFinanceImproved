"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput } from "@/components/forms";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import {
  ProfileListRow,
  ProfileSidebarHeader,
} from "@/components/ui/profile-sidebar";
import { confirm } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/lib/hooks/use-clone-profile";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import {
  type PayPeriod,
  type PayWeek,
  type W4FilingStatus,
} from "@/lib/config/enum-values";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import { ExtraPaycheckDestinationToggle } from "@/components/savings/extra-paycheck-rules-editor";
import { PayScheduleSection } from "@/components/paycheck/pay-schedule-section";
import { TaxWithholdingSection } from "@/components/paycheck/tax-withholding-section";
import {
  BonusTerms,
  showsAllBonusTerms,
} from "@/components/paycheck/bonus-section";
import { OtherPaySection } from "@/components/paycheck/other-pay-section";
import { SectionHeader } from "@/components/paycheck/section-header";
import type { EarningRow } from "@/components/paycheck/types";
import type { BonusDestination } from "@/lib/config/enum-values";
import { salaryEntryEdit } from "@/lib/db/salary-entry-edit";
import { BLANK_SALARY_ENTRY } from "@/lib/db/salary-entry-defaults";
import { toast } from "@/lib/hooks/use-toast";
import { useUser, isAdmin } from "@/lib/context/user-context";

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
      globalDefaultId: globalActiveSalaryId,
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

// ---------------------------------------------------------------------------
// Shared entry helpers
// ---------------------------------------------------------------------------

/** One job in a person's job history, as salaryProfile.getById resolves it. */
type JobOption = {
  id: number;
  employerName: string;
  startDate: string;
  endDate: string | null;
  /** Whether this profile has a complete entry for this job — the whole
   *  encoding. No entry means $0/no bonus, not a fallback to anything. */
  hasEntry: boolean;
  salary: number;
  bonusPercent: number;
  bonusMultiplier: number;
  monthsInBonusYear: number;
  /** This year's actual paid-out bonus, pinned on the same entry — see
   *  SalaryProfileEntry.bonusOverride's docblock. */
  bonusOverride: number | null;
  /** What this profile actually produces for this job. */
  effectiveSalary: number;
  estimatedBonus: number;
  // ── Pay/withholding/bonus-timing fields (see salaryEntrySchema for the full
  // ── field-by-field meaning — these just mirror it for display). ──
  payPeriod: PayPeriod;
  payWeek: PayWeek;
  anchorPayDate: string | null;
  budgetPeriodsPerMonth: number | null;
  w4FilingStatus: W4FilingStatus;
  w4Box2cChecked: boolean;
  additionalFedWithholding: number;
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
  extraPaycheckRouting: ExtraPaycheckRoutingData | null;
  bonusDestination: BonusDestination;
  /** This job's other-pay lines with their amount in this profile. */
  earningRows: EarningRow[];
  /** The formula's bonus, ignoring this year's actual. */
  formulaBonus: number;
};

/**
 * One person's row as salaryProfile.getById returns it.
 *
 * Spelled out rather than inferred from the router: components may not
 * import server modules, and inferring through useQuery's return type
 * needs the call's arguments, which a bare type position doesn't have.
 */
type Detail = {
  personId: number;
  personName: string;
  /** The job this row targets — the real identity of an entry, not
   *  personId. Null when this person has no jobs at all yet. */
  jobId: number | null;
  /** This person's full job history, for the row's job picker. */
  jobOptions: JobOption[];
  employerName: string | null;
  hasEntry: boolean;
  salary: number;
  bonusPercent: number;
  bonusMultiplier: number;
  monthsInBonusYear: number;
  bonusOverride: number | null;
  effectiveSalary: number;
  estimatedBonus: number;
  payPeriod: PayPeriod;
  payWeek: PayWeek;
  anchorPayDate: string | null;
  budgetPeriodsPerMonth: number | null;
  w4FilingStatus: W4FilingStatus;
  w4Box2cChecked: boolean;
  additionalFedWithholding: number;
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
  extraPaycheckRouting: ExtraPaycheckRoutingData | null;
  bonusDestination: BonusDestination;
  earningRows: EarningRow[];
  formulaBonus: number;
};

/**
 * Re-target a row at a different job from its jobOptions — used by the job
 * picker so switching jobs shows THAT job's real entry with no second round
 * trip. Falls back to the row unchanged if the id isn't one of this
 * person's jobs.
 */
function detailForJob(sd: Detail, jobId: number): Detail {
  const opt = sd.jobOptions.find((jo) => jo.id === jobId);
  if (!opt) return sd;
  return {
    ...sd,
    jobId: opt.id,
    employerName: opt.employerName,
    hasEntry: opt.hasEntry,
    salary: opt.salary,
    bonusPercent: opt.bonusPercent,
    bonusMultiplier: opt.bonusMultiplier,
    monthsInBonusYear: opt.monthsInBonusYear,
    bonusOverride: opt.bonusOverride,
    effectiveSalary: opt.effectiveSalary,
    estimatedBonus: opt.estimatedBonus,
    payPeriod: opt.payPeriod,
    payWeek: opt.payWeek,
    anchorPayDate: opt.anchorPayDate,
    budgetPeriodsPerMonth: opt.budgetPeriodsPerMonth,
    w4FilingStatus: opt.w4FilingStatus,
    w4Box2cChecked: opt.w4Box2cChecked,
    additionalFedWithholding: opt.additionalFedWithholding,
    bonusMonth: opt.bonusMonth,
    bonusDayOfMonth: opt.bonusDayOfMonth,
    extraPaycheckRouting: opt.extraPaycheckRouting,
    bonusDestination: opt.bonusDestination,
    earningRows: opt.earningRows,
    formulaBonus: opt.formulaBonus,
  };
}

/** Format a display-unit number for an input without trailing float noise. */
function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** The salary cell for a job that has an entry in this profile. */
function SalaryCell({
  sd,
  draft,
  onDraft,
  onCommit,
}: {
  sd: Detail;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="text-faint text-xs">$</span>
      <input
        type="number"
        aria-label={`${sd.personName} salary`}
        value={draft ?? fmt(sd.salary)}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
        step="1000"
        className="bg-surface-primary text-primary w-28 rounded border px-2 py-1 text-right text-xs"
      />
    </div>
  );
}

/** Header row shared by the read-only and editable tables. Bonus terms
 *  are edited in each job's Bonus section below its row. */
function SalaryTableHead() {
  return (
    <thead>
      <tr className="border-strong border-b-2">
        <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
          Person
        </th>
        <th className="text-muted px-3 py-2 text-left font-medium">Employer</th>
        <th className="text-muted w-32 px-3 py-2 text-right font-medium">
          Salary
        </th>
        <th className="text-muted w-28 px-3 py-2 text-right font-medium">
          Bonus
        </th>
        <th className="text-muted w-32 py-2 pr-4 pl-3 text-right font-medium">
          Total
        </th>
      </tr>
    </thead>
  );
}

/** Columns in the table — the detail row under each job spans them all. */
const TABLE_COLUMNS = 5;

function rowClass(rowIdx: number) {
  return `border-b border-subtle hover:bg-blue-50/60 transition-colors ${
    rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
  }`;
}

/** Household total this profile produces — matches the server's combinedIncome. */
function TotalsFooter({ combinedIncome }: { combinedIncome: number }) {
  return (
    <tfoot>
      <tr className="border-strong border-t-2">
        <td
          colSpan={TABLE_COLUMNS - 1}
          className="text-muted py-2 pr-3 pl-4 text-right font-medium"
        >
          Household income under this profile
        </td>
        <td className="text-primary py-2 pr-4 pl-3 text-right font-semibold tabular-nums">
          {formatCurrency(combinedIncome)}
        </td>
      </tr>
    </tfoot>
  );
}

/** Job picker shared by the read-only and editable rows. */
function JobPicker({
  sd,
  rawSd,
  onChange,
}: {
  sd: Detail;
  rawSd: Detail;
  onChange: (jobId: number) => void;
}) {
  if (rawSd.jobOptions.length <= 1) {
    return <>{sd.employerName ?? "No active job"}</>;
  }
  return (
    <select
      aria-label={`${sd.personName}'s job`}
      value={sd.jobId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="bg-surface-primary text-primary max-w-[10rem] rounded border px-1 py-0.5 text-xs"
    >
      {rawSd.jobOptions.map((jo) => (
        <option key={jo.id} value={jo.id}>
          {jo.employerName}
          {jo.endDate ? ` (ended ${jo.endDate})` : ""}
        </option>
      ))}
    </select>
  );
}

/**
 * A job's entry in this profile with the Paycheck page's own Withholding,
 * Bonus, Other pay and Extra paycheck sections, saving the same way
 * (salaryEntryEdit → patchEntry), plus Pay schedule, which only this
 * editor shows (the Paycheck page shows the schedule, not its fields).
 */
function EntrySections({
  sd,
  editable,
  onUpdate,
  isActiveProfile,
}: {
  sd: Detail;
  editable: boolean;
  onUpdate: (field: string, value: string) => void;
  isActiveProfile: boolean;
}) {
  const canRemoveLines = isAdmin(useUser());
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <PayScheduleSection
          job={sd}
          onUpdateJob={onUpdate}
          readOnly={!editable}
        />
        <TaxWithholdingSection
          job={sd}
          onUpdateJob={onUpdate}
          readOnly={!editable}
        />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <SectionHeader>Bonus</SectionHeader>
          <div className="bg-surface-sunken border-subtle space-y-1.5 rounded-lg border p-4 text-sm">
            <BonusTerms
              terms={sd}
              bonusMonth={sd.bonusMonth}
              bonusDayOfMonth={sd.bonusDayOfMonth}
              bonusDestination={sd.bonusDestination}
              onUpdateJob={onUpdate}
              editable={editable}
              showAll={showsAllBonusTerms(sd)}
              formulaBonus={sd.formulaBonus}
            />
          </div>
        </div>
        {sd.jobId !== null && (
          <OtherPaySection
            jobId={sd.jobId}
            rows={sd.earningRows}
            onSetAmount={(id, amount) =>
              onUpdate(`otherEarnings:${id}`, String(amount))
            }
            readOnly={!editable}
            lineReadOnly={!editable}
            canRemove={editable && canRemoveLines}
            note="Amounts: this profile · lines: every profile"
          />
        )}
        {sd.payPeriod === "biweekly" && (
          <div className="space-y-2">
            <SectionHeader>Extra paycheck</SectionHeader>
            <div className="bg-surface-sunken border-subtle rounded-lg border p-4 text-sm">
              {!isActiveProfile ? (
                <p className="text-muted text-xs">
                  Extra-paycheck routing always applies to the active Salary
                  Profile. Make this profile active to change it here.
                </p>
              ) : sd.jobId === null ? (
                <p className="text-muted text-xs">
                  No job selected for this row.
                </p>
              ) : (
                <ExtraPaycheckDestinationToggle
                  jobId={sd.jobId}
                  routing={sd.extraPaycheckRouting}
                  disabled={!editable}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Read-only detail view — used when canEdit is false and whenever the padlock
 * is locked. A job either has a real entry in this profile (shown plainly)
 * or it doesn't (shown as "—", contributing $0).
 */
function ProfileDetail({
  profileId,
  isActiveProfile,
}: {
  profileId: number;
  isActiveProfile: boolean;
}) {
  const { data: profile } = trpc.salaryProfile.getById.useQuery({
    id: profileId,
  });
  if (!profile) return null;

  const salaryCell = (sd: Detail) => (
    <td
      className={`px-3 py-1.5 text-right tabular-nums ${
        sd.hasEntry ? "text-secondary" : "text-faint"
      }`}
    >
      {sd.hasEntry ? formatCurrency(sd.salary) : "—"}
    </td>
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-primary text-sm font-semibold">{profile.name}</h3>
        {profile.description && (
          <span className="text-caption text-faint">
            — {profile.description}
          </span>
        )}
      </div>

      <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
        Salary &amp; Bonus
      </h4>
      <table className="w-full border-collapse text-xs">
        <SalaryTableHead />
        <tbody>
          {profile.salaryDetails.map((sd, rowIdx) => {
            return (
              <React.Fragment key={sd.personId}>
                <tr className={rowClass(rowIdx)}>
                  <td className="text-secondary py-1.5 pr-3 pl-4 font-medium">
                    {sd.personName}
                  </td>
                  <td className="text-muted px-3 py-1.5">
                    {sd.employerName ?? "No active job"}
                    {!sd.hasEntry && sd.jobId !== null && (
                      <span className="text-caption text-faint ml-1">
                        (not in this profile)
                      </span>
                    )}
                  </td>
                  {salaryCell(sd)}
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      sd.hasEntry ? "text-secondary" : "text-faint"
                    }`}
                  >
                    {sd.hasEntry ? formatCurrency(sd.estimatedBonus) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 pl-3 text-right">
                    <span className="text-secondary font-medium tabular-nums">
                      {formatCurrency(sd.effectiveSalary + sd.estimatedBonus)}
                    </span>
                  </td>
                </tr>
                {sd.hasEntry && (
                  <tr className={rowClass(rowIdx)}>
                    <td
                      colSpan={TABLE_COLUMNS}
                      className="bg-surface-sunken/60 px-4 py-3"
                    >
                      <EntrySections
                        sd={sd}
                        editable={false}
                        onUpdate={() => {}}
                        isActiveProfile={isActiveProfile}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <TotalsFooter combinedIncome={profile.combinedIncome} />
      </table>
    </div>
  );
}

/**
 * Create-new panel. This is the one place a batch form survives: a profile
 * row has to exist before per-job entries have anywhere to go. A new
 * profile starts genuinely empty — no rows, no seeded values, nothing
 * copied from any other profile. Jobs are added to it afterward, in
 * ProfileEditPanel.
 */
function ProfileCreatePanel({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (newId?: number) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.salaryProfile.create.useMutation({
    onSuccess: (created) => onSaved(created.id),
    onError: (e) => setError(e.message),
  });

  const handleCreate = () => {
    createMutation.mutate({
      name,
      description: description || undefined,
    });
  };

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      {error && <FormError message={error} className="mb-3" />}

      <div className="flex items-start justify-between gap-3">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Name">
            <FormInput
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Promotion"
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
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
      <p className="text-caption text-faint mt-3">
        Starts completely empty — add jobs to it after creating.
      </p>
    </div>
  );
}

/**
 * Unlocked, in-place editor for an existing profile. There is no Save button:
 * every field commits on blur (checkbox-free surface, so blur is the only
 * commit moment), mirroring SavingsAllocationTable's draft/commit pattern —
 * local draft strings only exist so multi-digit typing doesn't fire a
 * mutation per keystroke.
 */
function ProfileEditPanel({
  profileId,
  isActiveProfile,
  onSaved,
}: {
  profileId: number;
  /** Extra-paycheck routing always reads/writes the globally-ACTIVE Salary
   *  Profile (see writeJobExtraPaycheckRouting's docblock, savings.ts) —
   *  never a profile a user is merely viewing. The routing editor below
   *  only renders for that profile; a non-active one shows a note instead,
   *  so edits here always land where this screen implies they do. */
  isActiveProfile: boolean;
  onSaved: () => void;
}) {
  const { data: profile } = trpc.salaryProfile.getById.useQuery({
    id: profileId,
  });
  const [error, setError] = useState<string | null>(null);
  /** In-progress text per field; cleared once its mutation is sent. */
  const { drafts, setDraft, clearDraft } = useDraftCommit();
  /** personId → jobId, when the user has picked a DIFFERENT job than the
   *  one the server selected by default (whichever job has an entry, else
   *  the active one) — the row's job picker. Client-only until a field is
   *  actually set under that job. */
  const [jobOverride, setJobOverride] = useState<Record<number, number>>({});

  const updateMutation = trpc.salaryProfile.update.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });
  // patchEntry/removeEntry replace what used to be a client-side
  // read-merge-write of the whole `salaries` blob (from a query snapshot
  // that goes stale the instant a prior commit resolves) posted through
  // `update`. Two fields committed in quick succession could silently
  // clobber each other under the old path — these call the server-side
  // patch procedures directly instead, which merge inside a transaction.
  const patchEntryMutation = trpc.salaryProfile.patchEntry.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });
  const removeEntryMutation = trpc.salaryProfile.removeEntry.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });

  if (!profile) return null;

  const details = profile.salaryDetails;

  // Name is renamed from the profile list (click-to-edit on the row) — the
  // one rename gesture shared by every profile manager.
  const commitDescription = () => {
    const draft = drafts.description;
    if (draft === undefined) return;
    clearDraft("description");
    const trimmed = draft.trim();
    if (trimmed === (profile.description ?? "")) return;
    updateMutation.mutate({ id: profileId, description: trimmed || null });
  };

  /** Add this job to the profile with a blank entry — the explicit action
   *  that turns a "—" row into an editable one. */
  const addEntry = (jobId: number | null) => {
    if (jobId === null) return;
    patchEntryMutation.mutate({
      id: profileId,
      jobId,
      fields: BLANK_SALARY_ENTRY,
    });
  };

  /** Remove this job's entry entirely — it goes back to contributing $0,
   *  the same as a job that was never added. */
  const removeEntry = (jobId: number | null) => {
    if (jobId === null) return;
    removeEntryMutation.mutate({ id: profileId, jobId });
  };

  /** Save one field edit to a job's entry — the same parse and save path
   *  as the Paycheck page (salaryEntryEdit → patchEntry). Entries are always
   *  complete, so this only runs for a job that already has one. */
  const updateEntry = (sd: Detail) => (field: string, value: string) => {
    if (sd.jobId === null || !profile.salaries[String(sd.jobId)]) return;
    const edit = salaryEntryEdit(field, value, {
      otherEarnings: Object.fromEntries(
        sd.earningRows.map((r) => [String(r.id), r.amount]),
      ),
    });
    if (edit === null) toast.error("That value isn't valid here.");
    else if (edit)
      patchEntryMutation.mutate({
        id: profileId,
        jobId: sd.jobId,
        fields: edit,
      });
  };

  const commitSalary = (sd: Detail) => {
    const key = `${sd.personId}:salary`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    if (Number(draft) === sd.salary) return;
    updateEntry(sd)("annualSalary", draft);
  };

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      {error && <FormError message={error} className="mb-3" />}

      <div className="mb-4 max-w-sm">
        <FormField label="Description">
          <FormInput
            type="text"
            value={drafts.description ?? profile.description ?? ""}
            onChange={(e) => setDraft("description", e.target.value)}
            onBlur={commitDescription}
            placeholder="Optional description"
          />
        </FormField>
      </div>

      {details.length > 0 && (
        <div>
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Salary &amp; Bonus
          </h4>
          <p className="text-caption text-faint mb-2">
            A job is either in this profile (edit any field) or it isn&apos;t
            (shown as &ldquo;—&rdquo;, contributing $0) — use + Add to give it
            real numbers.
          </p>
          <table className="w-full border-collapse text-xs">
            <SalaryTableHead />
            <tbody>
              {details.map((rawSd, rowIdx) => {
                // Job picker lets a row target a DIFFERENT job than the one
                // the server picked by default (whichever job has an entry,
                // else the active one) — e.g. setting terms for a job that
                // already ended, or one that hasn't started yet.
                const override = jobOverride[rawSd.personId];
                const sd =
                  override !== undefined
                    ? detailForJob(rawSd, override)
                    : rawSd;
                const isSaving =
                  sd.jobId !== null &&
                  ((patchEntryMutation.isPending &&
                    patchEntryMutation.variables?.jobId === sd.jobId) ||
                    (removeEntryMutation.isPending &&
                      removeEntryMutation.variables?.jobId === sd.jobId));
                return (
                  <React.Fragment key={rawSd.personId}>
                    <tr
                      aria-busy={isSaving}
                      className={`${rowClass(rowIdx)} ${isSaving ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <td className="text-secondary py-1.5 pr-3 pl-4 font-medium">
                        {sd.personName}
                      </td>
                      <td className="text-muted px-3 py-1.5">
                        <JobPicker
                          sd={sd}
                          rawSd={rawSd}
                          onChange={(jobId) =>
                            setJobOverride((prev) => ({
                              ...prev,
                              [rawSd.personId]: jobId,
                            }))
                          }
                        />
                      </td>
                      {sd.hasEntry ? (
                        <>
                          <td className="px-3 py-1.5">
                            <SalaryCell
                              sd={sd}
                              draft={drafts[`${sd.personId}:salary`]}
                              onDraft={(v) =>
                                setDraft(`${sd.personId}:salary`, v)
                              }
                              onCommit={() => commitSalary(sd)}
                            />
                          </td>
                          <td className="text-secondary px-3 py-1.5 text-right tabular-nums">
                            {formatCurrency(sd.estimatedBonus)}
                          </td>
                          <td className="py-1.5 pr-4 pl-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-secondary font-medium tabular-nums">
                                {formatCurrency(
                                  sd.effectiveSalary + sd.estimatedBonus,
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (
                                    await confirm(
                                      `Remove ${sd.employerName ?? "this job"} from this profile? It then contributes $0 here.`,
                                    )
                                  )
                                    removeEntry(sd.jobId);
                                }}
                                title="Remove this job from the profile"
                                aria-label={`Remove ${sd.employerName ?? "this job"} from this profile`}
                                className="text-caption text-faint shrink-0 hover:text-red-500"
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <td
                          colSpan={TABLE_COLUMNS - 2}
                          className="text-faint px-3 py-1.5 text-right"
                        >
                          <div className="flex items-center justify-end gap-2">
                            <span>Not in this profile</span>
                            <button
                              type="button"
                              onClick={() => addEntry(sd.jobId)}
                              disabled={sd.jobId === null}
                              className="text-caption font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
                            >
                              + Add
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {sd.hasEntry && (
                      <tr className={rowClass(rowIdx)}>
                        <td
                          colSpan={TABLE_COLUMNS}
                          className="bg-surface-sunken/60 px-4 py-3"
                        >
                          <EntrySections
                            sd={sd}
                            editable
                            onUpdate={updateEntry(sd)}
                            isActiveProfile={isActiveProfile}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <TotalsFooter combinedIncome={profile.combinedIncome} />
          </table>
        </div>
      )}
    </div>
  );
}
