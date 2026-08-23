"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import { useScenario } from "@/lib/context/scenario-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { confirm } from "@/components/ui/confirm-dialog";
import { useCloneProfile } from "@/lib/hooks/use-clone-profile";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";
import { PAY_PERIOD_CONFIG } from "@/lib/config/pay-periods";
import {
  PAY_PERIOD_VALUES,
  PAY_WEEK_VALUES,
  W4_FILING_STATUS_VALUES,
  type PayPeriod,
  type PayWeek,
  type W4FilingStatus,
} from "@/lib/config/enum-values";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import { ExtraPaycheckDestinationToggle } from "@/components/savings/extra-paycheck-rules-editor";

/**
 * Salary Profiles tab — the "what if I earned X" axis.
 *
 * Deliberately much thinner than ContributionProfileManager: a Salary
 * Profile's whole content is a jobId → entry map, so there's no
 * contribution math to resolve or aggregate. Every profile is an ordinary row
 * — renamable, editable, and deletable so long as it isn't the last one, the
 * active one, or pinned by a Plan.
 *
 * THERE IS NO LIVE FALLBACK. A job either has a complete entry in a profile
 * — salary, bonus %, and multiplier, all real numbers you typed — or it has
 * none, in which case the profile says nothing about that job and it
 * contributes $0. There's no "leave it alone and it tracks the job record":
 * a job doesn't have a salary of its own to track. Adding a job to a profile
 * is an explicit action; editing any of its three fields is a plain,
 * ordinary edit — no pin/live distinction, no revert-to-live control. If you
 * want a different number, use a different profile.
 *
 * Selecting a profile shows it read-only; unlocking the padlock (in the tab
 * bar above — see budget-content.tsx) makes the same fields editable in
 * place, each committing on blur — the same interaction model as the
 * Savings Profile allocation table. There is no Save button: the only batch
 * form left is "create new", which has to collect a name before a row
 * exists to write to.
 *
 * `monthsInBonusYear` is supported by the data model and by every resolver,
 * but is deliberately NOT surfaced as an editable column: it is a partial-year
 * proration that is rarely customized, and a seventh numeric column would
 * cost more legibility than it buys. New entries default it to 12.
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
  const { isInScenario, setScenarioSalaryProfile } = useScenario();
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

  // Post-migration the active-profile setting always points at a real row;
  // useActiveSalaryProfile repairs it if the row ever goes missing. There is
  // no sentinel id to fall back to.
  const globalActiveSalaryId = activeSalaryId;
  const {
    profileId: effectiveSelectedId,
    source: effectiveSelectedSource,
    isPinned: isPinnedProfile,
  } = useEffectiveProfileId("salary", {
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
      setScenarioSalaryProfile(id);
    } else {
      setActiveSalaryId(id);
    }
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
            <div className="flex items-center gap-5 text-xs">
              {displayedProfile.pinnedSalaryTotal > 0 && (
                <div>
                  <span className="text-faint">Salary total </span>
                  <span className="font-semibold text-secondary">
                    {formatCurrency(displayedProfile.pinnedSalaryTotal)}
                    <span className="text-faint font-normal">/yr</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          <HelpTip text="A Salary Profile sets each person's pay for what-if analysis. Each job either has a complete entry in this profile — salary, bonus %, and multiplier — or it isn't in the profile at all and contributes $0. There's no fallback to a job record: if you want a different number, use a different profile. It is independent of the Contribution Profile — set either, both, or neither. Plan pins and page-level salary overrides always win over a profile." />
        </div>
      )}

      {deleteError && <FormError message={deleteError} />}

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
              name={p.name}
              description={p.description}
              pinnedCount={p.pinnedCount}
              isSelected={!creatingNew && effectiveSelectedId === p.id}
              isActive={globalActiveSalaryId === p.id}
              onSelect={() => {
                setCreatingNew(false);
                setSelectedProfileId(p.id);
              }}
              onDelete={
                canEdit && canDeleteAny
                  ? () => handleDelete(p.id, p.name)
                  : undefined
              }
              onClone={canEdit ? () => cloneProfile(p.id, p.name) : undefined}
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
            <div className="text-xs text-faint">Select a profile.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileListItem({
  name,
  description,
  pinnedCount,
  isSelected,
  isActive,
  onSelect,
  onDelete,
  onClone,
}: {
  name: string;
  description: string | null;
  pinnedCount: number;
  isSelected: boolean;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onClone?: () => void;
}) {
  return (
    <div
      className={`group rounded-lg px-3 py-2 cursor-pointer border transition-colors ${
        isSelected
          ? "border-blue-500 bg-blue-50/50"
          : "border-transparent bg-surface-sunken hover:bg-surface-elevated"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-secondary truncate">
              {name}
            </span>
            {isActive && (
              <span className="text-micro px-1 py-0.5 rounded bg-green-100 text-green-700 font-semibold uppercase">
                Active
              </span>
            )}
          </div>
          <div className="text-caption text-faint truncate">
            {description ??
              (pinnedCount === 0
                ? "Empty"
                : `${pinnedCount} ${pinnedCount === 1 ? "job" : "jobs"} set`)}
          </div>
        </div>
        {(onDelete || onClone) && (
          <div className="flex items-center gap-1 shrink-0 md:max-w-0 md:overflow-hidden md:opacity-0 md:group-hover:max-w-[11rem] md:group-hover:opacity-100 transition-all">
            {onClone && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClone();
                }}
                className="text-caption text-faint hover:text-blue-600"
              >
                clone
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="text-caption text-faint hover:text-red-500"
              >
                ×
              </button>
            )}
          </div>
        )}
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
  // ── Pay/withholding/bonus-timing fields (see Entry below for the full
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
  include401kInBonus: boolean;
  includeBonusInContributions: boolean;
  extraPaycheckRouting: ExtraPaycheckRoutingData | null;
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
  include401kInBonus: boolean;
  includeBonusInContributions: boolean;
  extraPaycheckRouting: ExtraPaycheckRoutingData | null;
};

/** The complete entry shape written to the profile's jsonb — all sixteen
 *  fields, always. Spelled out rather than imported from
 *  server/helpers/salary.ts's SalaryProfileEntry: components may not import
 *  server modules (see the Detail docblock above) — this mirrors it by hand
 *  and must be kept in sync with it and with salaryEntrySchema. */
type Entry = {
  salary: number;
  bonusPercent: number;
  bonusMultiplier: number;
  monthsInBonusYear: number;
  bonusOverride: number | null;
  payPeriod: PayPeriod;
  payWeek: PayWeek;
  anchorPayDate: string | null;
  budgetPeriodsPerMonth: number | null;
  w4FilingStatus: W4FilingStatus;
  w4Box2cChecked: boolean;
  additionalFedWithholding: number;
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
  include401kInBonus: boolean;
  includeBonusInContributions: boolean;
  /** Where this job's extra (3rd biweekly) paycheck routes, if configured —
   *  edited via the extra-paycheck rules editor rendered below, not through
   *  this panel's own field cells. */
  extraPaycheckRouting: ExtraPaycheckRoutingData | null;
};

/** What a brand-new entry starts as when a job is explicitly added to a
 *  profile — plain zeros/on-target defaults, never copied from anywhere.
 *  The new pay/withholding fields default to the most common real-world
 *  setup (biweekly, MFJ, no extra withholding) rather than to nulls
 *  everywhere, since most of them can't be usefully "empty" — a pay period
 *  has to be something. */
const BLANK_ENTRY: Entry = {
  salary: 0,
  bonusPercent: 0,
  bonusMultiplier: 1,
  monthsInBonusYear: 12,
  bonusOverride: null,
  payPeriod: "biweekly",
  payWeek: "na",
  anchorPayDate: null,
  budgetPeriodsPerMonth: null,
  w4FilingStatus: "MFJ",
  w4Box2cChecked: false,
  additionalFedWithholding: 0,
  bonusMonth: null,
  bonusDayOfMonth: null,
  include401kInBonus: false,
  includeBonusInContributions: true,
  extraPaycheckRouting: null,
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
    include401kInBonus: opt.include401kInBonus,
    includeBonusInContributions: opt.includeBonusInContributions,
    extraPaycheckRouting: opt.extraPaycheckRouting,
  };
}

/** The three fields this table edits, and how each maps display ↔ stored
 *  units. */
const FIELDS = {
  salary: {
    label: "Salary",
    /** Stored value ↔ what the input shows. Bonus % is a fraction in the DB
     *  and a percentage in the UI; the others are 1:1. */
    toDisplay: (n: number) => n,
    fromDisplay: (n: number) => n,
    step: "1000",
  },
  bonusPercent: {
    label: "Bonus %",
    toDisplay: (n: number) => n * 100,
    fromDisplay: (n: number) => n / 100,
    step: "0.5",
  },
  bonusMultiplier: {
    label: "Multiplier",
    toDisplay: (n: number) => n,
    fromDisplay: (n: number) => n,
    step: "0.1",
  },
} as const;

type FieldKey = keyof typeof FIELDS;

/** Display labels for the three new enum selects — the raw stored values
 *  (payPeriod/payWeek/w4FilingStatus) are already short and mostly
 *  self-explanatory, but a couple ("na", "HOH") read better spelled out. */
const PAY_PERIOD_LABELS: Record<PayPeriod, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semimonthly: "Semimonthly",
  monthly: "Monthly",
};
const PAY_WEEK_LABELS: Record<PayWeek, string> = {
  even: "Even week",
  odd: "Odd week",
  na: "N/A",
};
const W4_FILING_STATUS_LABELS: Record<W4FilingStatus, string> = {
  MFJ: "Married filing jointly",
  Single: "Single",
  HOH: "Head of household",
};

/** What the input/cell shows: this entry's own value, in display units. */
function entryDisplay(sd: Detail, field: FieldKey): number {
  return FIELDS[field].toDisplay(sd[field]);
}

/** Format a display-unit number for an input without trailing float noise. */
function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** A plain numeric cell for a job that already has an entry in this
 *  profile — every edit is an ordinary edit, no pin/live distinction. */
function EntryNumberCell({
  sd,
  field,
  draft,
  onDraft,
  onCommit,
  prefix,
  suffix,
  width = "w-24",
}: {
  sd: Detail;
  field: FieldKey;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onCommit: () => void;
  prefix?: string;
  suffix?: string;
  width?: string;
}) {
  const value = draft ?? fmt(entryDisplay(sd, field));
  return (
    <div className="flex items-center justify-end gap-1">
      {prefix && <span className="text-xs text-faint">{prefix}</span>}
      <input
        type="number"
        value={value}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
        step={FIELDS[field].step}
        className={`${width} px-2 py-1 text-xs text-right border rounded bg-surface-primary text-primary`}
      />
      {suffix && <span className="text-xs text-faint">{suffix}</span>}
    </div>
  );
}

/** This year's actual bonus pin — a separate cell from EntryNumberCell
 *  because it's nullable (empty = unpinned, formula applies) rather than
 *  always-numeric like the three FIELDS above. */
function BonusOverrideCell({
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
  const value =
    draft ?? (sd.bonusOverride !== null ? fmt(sd.bonusOverride) : "");
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="text-xs text-faint">$</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
        placeholder="—"
        step="1"
        className="w-24 px-2 py-1 text-xs text-right border rounded bg-surface-primary text-primary"
      />
    </div>
  );
}

/** Header row shared by the read-only and editable tables. */
function SalaryTableHead({ editable }: { editable: boolean }) {
  return (
    <thead>
      <tr className="border-b-2 border-strong">
        <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
          Person
        </th>
        <th className="text-left py-2 px-3 text-muted font-medium">Employer</th>
        <th
          className={`text-right py-2 px-3 text-muted font-medium ${editable ? "w-32" : "w-32"}`}
        >
          Salary
        </th>
        <th
          className={`text-right py-2 px-3 text-muted font-medium ${editable ? "w-24" : "w-24"}`}
        >
          Bonus %
        </th>
        <th
          className={`text-right py-2 px-3 text-muted font-medium ${editable ? "w-24" : "w-24"}`}
        >
          Multiplier
        </th>
        <th className="text-right py-2 px-3 text-muted font-medium w-24">
          Actual
        </th>
        <th className="text-right py-2 px-3 text-muted font-medium w-28">
          Bonus
        </th>
        <th className="text-right py-2 pr-4 pl-3 text-muted font-medium w-32">
          Total
        </th>
      </tr>
    </thead>
  );
}

function rowClass(rowIdx: number) {
  return `border-b border-subtle hover:bg-blue-50/60 transition-colors ${
    rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
  }`;
}

/** Household total this profile produces — matches the server's combinedIncome. */
function TotalsFooter({ combinedIncome }: { combinedIncome: number }) {
  return (
    <tfoot>
      <tr className="border-t-2 border-strong">
        <td
          colSpan={7}
          className="py-2 pl-4 pr-3 text-right text-muted font-medium"
        >
          Household income under this profile
        </td>
        <td className="py-2 pr-4 pl-3 text-right tabular-nums font-semibold text-primary">
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
      value={sd.jobId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="text-xs border rounded bg-surface-primary text-primary px-1 py-0.5 max-w-[10rem]"
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

/** One labeled value in the read-only pay/withholding details grid. */
function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-micro text-faint uppercase tracking-wide">
        {label}
      </div>
      <div className="text-xs text-secondary">{value}</div>
    </div>
  );
}

/**
 * Read-only grid of the 11 pay/withholding/bonus-timing fields — too many to
 * fit as table columns, so shown as a second row beneath each job (see
 * PayTaxDetailsEdit's docblock for the same tradeoff on the editable side).
 * Always shown, not behind a collapse toggle — extra-paycheck routing lives
 * in this same panel now and must never be hidden by default.
 */
function PayTaxDetailsView({ sd }: { sd: Detail }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
      <DetailStat label="Pay period" value={PAY_PERIOD_LABELS[sd.payPeriod]} />
      <DetailStat label="Pay week" value={PAY_WEEK_LABELS[sd.payWeek]} />
      <DetailStat
        label="Anchor pay date"
        value={sd.anchorPayDate ?? "— (uses job start date)"}
      />
      <DetailStat
        label="Budget periods/mo"
        value={
          sd.budgetPeriodsPerMonth !== null
            ? fmt(sd.budgetPeriodsPerMonth)
            : `${PAY_PERIOD_CONFIG[sd.payPeriod]?.defaultBudgetPerMonth ?? "—"} (derived)`
        }
      />
      <DetailStat
        label="W-4 filing status"
        value={W4_FILING_STATUS_LABELS[sd.w4FilingStatus]}
      />
      <DetailStat
        label="W-4 step 2(c)"
        value={sd.w4Box2cChecked ? "Checked" : "Unchecked"}
      />
      <DetailStat
        label="Extra fed withholding"
        value={formatCurrency(sd.additionalFedWithholding)}
      />
      <DetailStat
        label="Bonus month"
        value={sd.bonusMonth !== null ? String(sd.bonusMonth) : "—"}
      />
      <DetailStat
        label="Bonus day"
        value={sd.bonusDayOfMonth !== null ? String(sd.bonusDayOfMonth) : "—"}
      />
      <DetailStat
        label="401(k) on bonus"
        value={sd.include401kInBonus ? "Yes" : "No"}
      />
      <DetailStat
        label="Bonus counts toward contributions"
        value={sd.includeBonusInContributions ? "Yes" : "No"}
      />
    </div>
  );
}

/**
 * Editable grid of the 11 pay/withholding/bonus-timing fields — the
 * editable twin of PayTaxDetailsView. Enum selects and checkboxes commit
 * immediately (no typing state to debounce); the date/nullable-number
 * inputs go through the same drafts/commit-on-blur plumbing as the rest of
 * this panel.
 */
function PayTaxDetailsEdit({
  sd,
  drafts,
  setDraft,
  onWriteField,
  onCommitAnchorPayDate,
  onCommitBudgetPeriodsPerMonth,
  onCommitAdditionalFedWithholding,
  onCommitBonusMonth,
  onCommitBonusDayOfMonth,
}: {
  sd: Detail;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  onWriteField: <K extends keyof Entry>(
    sd: Detail,
    field: K,
    value: Entry[K],
  ) => void;
  onCommitAnchorPayDate: (sd: Detail) => void;
  onCommitBudgetPeriodsPerMonth: (sd: Detail) => void;
  onCommitAdditionalFedWithholding: (sd: Detail) => void;
  onCommitBonusMonth: (sd: Detail) => void;
  onCommitBonusDayOfMonth: (sd: Detail) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
      <FormField label="Pay period">
        <FormSelect
          value={sd.payPeriod}
          onChange={(e) =>
            onWriteField(sd, "payPeriod", e.target.value as PayPeriod)
          }
        >
          {PAY_PERIOD_VALUES.map((v) => (
            <option key={v} value={v}>
              {PAY_PERIOD_LABELS[v]}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Pay week">
        <FormSelect
          value={sd.payWeek}
          onChange={(e) =>
            onWriteField(sd, "payWeek", e.target.value as PayWeek)
          }
        >
          {PAY_WEEK_VALUES.map((v) => (
            <option key={v} value={v}>
              {PAY_WEEK_LABELS[v]}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <FormField label="Anchor pay date">
        <FormInput
          type="date"
          value={
            drafts[`${sd.personId}:anchorPayDate`] ?? sd.anchorPayDate ?? ""
          }
          onChange={(e) =>
            setDraft(`${sd.personId}:anchorPayDate`, e.target.value)
          }
          onBlur={() => onCommitAnchorPayDate(sd)}
        />
      </FormField>
      <FormField label="Budget periods/mo">
        <FormInput
          type="number"
          step="any"
          min="0"
          value={
            drafts[`${sd.personId}:budgetPeriodsPerMonth`] ??
            (sd.budgetPeriodsPerMonth !== null
              ? fmt(sd.budgetPeriodsPerMonth)
              : "")
          }
          onChange={(e) =>
            setDraft(`${sd.personId}:budgetPeriodsPerMonth`, e.target.value)
          }
          onBlur={() => onCommitBudgetPeriodsPerMonth(sd)}
          placeholder={String(
            PAY_PERIOD_CONFIG[sd.payPeriod]?.defaultBudgetPerMonth ?? "",
          )}
        />
      </FormField>
      <FormField label="W-4 filing status">
        <FormSelect
          value={sd.w4FilingStatus}
          onChange={(e) =>
            onWriteField(sd, "w4FilingStatus", e.target.value as W4FilingStatus)
          }
        >
          {W4_FILING_STATUS_VALUES.map((v) => (
            <option key={v} value={v}>
              {W4_FILING_STATUS_LABELS[v]}
            </option>
          ))}
        </FormSelect>
      </FormField>
      <label className="flex items-center gap-1.5 text-xs text-secondary self-end pb-1.5">
        <input
          type="checkbox"
          checked={sd.w4Box2cChecked}
          onChange={(e) => onWriteField(sd, "w4Box2cChecked", e.target.checked)}
        />
        W-4 step 2(c)
      </label>
      <FormField label="Extra fed withholding">
        <FormInput
          type="number"
          step="1"
          min="0"
          value={
            drafts[`${sd.personId}:additionalFedWithholding`] ??
            fmt(sd.additionalFedWithholding)
          }
          onChange={(e) =>
            setDraft(`${sd.personId}:additionalFedWithholding`, e.target.value)
          }
          onBlur={() => onCommitAdditionalFedWithholding(sd)}
        />
      </FormField>
      <FormField label="Bonus month (1-12)">
        <FormInput
          type="number"
          step="1"
          min="1"
          max="12"
          value={
            drafts[`${sd.personId}:bonusMonth`] ??
            (sd.bonusMonth !== null ? String(sd.bonusMonth) : "")
          }
          onChange={(e) =>
            setDraft(`${sd.personId}:bonusMonth`, e.target.value)
          }
          onBlur={() => onCommitBonusMonth(sd)}
          placeholder="—"
        />
      </FormField>
      <FormField label="Bonus day (1-31)">
        <FormInput
          type="number"
          step="1"
          min="1"
          max="31"
          value={
            drafts[`${sd.personId}:bonusDayOfMonth`] ??
            (sd.bonusDayOfMonth !== null ? String(sd.bonusDayOfMonth) : "")
          }
          onChange={(e) =>
            setDraft(`${sd.personId}:bonusDayOfMonth`, e.target.value)
          }
          onBlur={() => onCommitBonusDayOfMonth(sd)}
          placeholder="—"
        />
      </FormField>
      <label className="flex items-center gap-1.5 text-xs text-secondary self-end pb-1.5">
        <input
          type="checkbox"
          checked={sd.include401kInBonus}
          onChange={(e) =>
            onWriteField(sd, "include401kInBonus", e.target.checked)
          }
        />
        401(k) on bonus
      </label>
      <label className="flex items-center gap-1.5 text-xs text-secondary self-end pb-1.5">
        <input
          type="checkbox"
          checked={sd.includeBonusInContributions}
          onChange={(e) =>
            onWriteField(sd, "includeBonusInContributions", e.target.checked)
          }
        />
        Bonus counts toward contributions
      </label>
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
  const { isInScenario } = useScenario();
  if (!profile) return null;

  const cell = (sd: Detail, field: FieldKey, suffix?: string) => (
    <td
      className={`py-1.5 px-3 text-right tabular-nums ${
        sd.hasEntry ? "text-secondary" : "text-faint"
      }`}
    >
      {!sd.hasEntry
        ? "—"
        : field === "salary"
          ? formatCurrency(entryDisplay(sd, field))
          : `${fmt(entryDisplay(sd, field))}${suffix ?? ""}`}
    </td>
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-sm font-semibold text-primary">{profile.name}</h3>
        {profile.description && (
          <span className="text-caption text-faint">
            — {profile.description}
          </span>
        )}
      </div>

      <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
        Salary &amp; Bonus
      </h4>
      <table className="w-full text-xs border-collapse">
        <SalaryTableHead editable={false} />
        <tbody>
          {profile.salaryDetails.map((sd, rowIdx) => {
            return (
              <React.Fragment key={sd.personId}>
                <tr className={rowClass(rowIdx)}>
                  <td className="py-1.5 pl-4 pr-3 font-medium text-secondary">
                    {sd.personName}
                  </td>
                  <td className="py-1.5 px-3 text-muted">
                    {sd.employerName ?? "No active job"}
                    {!sd.hasEntry && sd.jobId !== null && (
                      <span className="text-caption text-faint ml-1">
                        (not in this profile)
                      </span>
                    )}
                  </td>
                  {cell(sd, "salary")}
                  {cell(sd, "bonusPercent", "%")}
                  {cell(sd, "bonusMultiplier", "×")}
                  <td
                    className={`py-1.5 px-3 text-right tabular-nums ${
                      sd.hasEntry && sd.bonusOverride !== null
                        ? "text-amber-700"
                        : "text-faint"
                    }`}
                  >
                    {sd.hasEntry && sd.bonusOverride !== null
                      ? formatCurrency(sd.bonusOverride)
                      : "—"}
                  </td>
                  <td
                    className={`py-1.5 px-3 text-right tabular-nums ${
                      sd.hasEntry ? "text-secondary" : "text-faint"
                    }`}
                  >
                    {sd.hasEntry ? formatCurrency(sd.estimatedBonus) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 pl-3 text-right">
                    <span className="tabular-nums font-medium text-secondary">
                      {formatCurrency(sd.effectiveSalary + sd.estimatedBonus)}
                    </span>
                  </td>
                </tr>
                {sd.hasEntry && (
                  <tr className={rowClass(rowIdx)}>
                    <td colSpan={8} className="py-3 px-4 bg-surface-sunken/60">
                      <PayTaxDetailsView sd={sd} />
                      <div className="mt-4 pt-3 border-t border-subtle/50">
                        <h5 className="text-caption text-faint font-medium uppercase tracking-wide mb-2">
                          Extra Paycheck Routing
                        </h5>
                        {!isActiveProfile ? (
                          <p className="text-xs text-muted">
                            Extra-paycheck routing always applies to the
                            globally-active Salary Profile. Activate this
                            profile to edit routing here.
                          </p>
                        ) : sd.jobId === null ? (
                          <p className="text-xs text-muted">
                            No job selected for this row.
                          </p>
                        ) : (
                          <ExtraPaycheckDestinationToggle
                            jobId={sd.jobId}
                            routing={sd.extraPaycheckRouting}
                            disabled={isInScenario}
                          />
                        )}
                      </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
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
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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
  const { isInScenario } = useScenario();
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

  if (!profile) return null;

  const details = profile.salaryDetails;

  const commitName = () => {
    const draft = drafts.name;
    if (draft === undefined) return;
    clearDraft("name");
    const trimmed = draft.trim();
    if (!trimmed || trimmed === profile.name) return;
    updateMutation.mutate({ id: profileId, name: trimmed });
  };

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
    updateMutation.mutate({
      id: profileId,
      salaries: { ...profile.salaries, [String(jobId)]: BLANK_ENTRY },
    });
  };

  /** Remove this job's entry entirely — it goes back to contributing $0,
   *  the same as a job that was never added. */
  const removeEntry = (jobId: number | null) => {
    if (jobId === null) return;
    const salaries = { ...profile.salaries };
    delete salaries[String(jobId)];
    updateMutation.mutate({ id: profileId, salaries });
  };

  /** Update one field of an already-existing entry. Entries are always
   *  complete, so this only ever runs for a job that already has one.
   *  Generic over Entry's keys so both the original numeric fields and the
   *  11 new fields (enums, booleans, nullable dates/numbers) share this one
   *  write path. */
  const writeField = <K extends keyof Entry>(
    sd: Detail,
    field: K,
    stored: Entry[K],
  ) => {
    if (sd.jobId === null) return;
    const key = String(sd.jobId);
    const existing = profile.salaries[key];
    if (!existing) return;
    updateMutation.mutate({
      id: profileId,
      salaries: {
        ...profile.salaries,
        [key]: { ...existing, [field]: stored },
      },
    });
  };

  /** Empty clears the pin back to null (unpinned, formula applies) — unlike
   *  the always-numeric fields below, an empty commit here is meaningful,
   *  not a no-op. */
  const commitBonusOverride = (sd: Detail) => {
    const key = `${sd.personId}:bonusOverride`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (sd.bonusOverride === null) return;
      writeField(sd, "bonusOverride", null);
      return;
    }
    const num = parseFloat(trimmed);
    if (isNaN(num) || num < 0) return;
    if (sd.bonusOverride === num) return;
    writeField(sd, "bonusOverride", num);
  };

  const commitField = (sd: Detail, field: FieldKey) => {
    const key = `${sd.personId}:${field}`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const trimmed = draft.trim();
    const num = parseFloat(trimmed);
    if (trimmed === "" || isNaN(num) || num < 0) return;
    const stored = FIELDS[field].fromDisplay(num);
    if (sd[field] === stored) return;
    writeField(sd, field, stored);
  };

  /** Empty commits back to null — like commitBonusOverride, empty is a
   *  meaningful "no anchor date, use job start date" value, not a no-op. */
  const commitAnchorPayDate = (sd: Detail) => {
    const key = `${sd.personId}:anchorPayDate`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (sd.anchorPayDate === next) return;
    writeField(sd, "anchorPayDate", next);
  };

  const commitBudgetPeriodsPerMonth = (sd: Detail) => {
    const key = `${sd.personId}:budgetPeriodsPerMonth`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (sd.budgetPeriodsPerMonth === null) return;
      writeField(sd, "budgetPeriodsPerMonth", null);
      return;
    }
    const num = parseFloat(trimmed);
    if (isNaN(num) || num < 0) return;
    if (sd.budgetPeriodsPerMonth === num) return;
    writeField(sd, "budgetPeriodsPerMonth", num);
  };

  const commitAdditionalFedWithholding = (sd: Detail) => {
    const key = `${sd.personId}:additionalFedWithholding`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const trimmed = draft.trim();
    const num = trimmed === "" ? 0 : parseFloat(trimmed);
    if (isNaN(num) || num < 0) return;
    if (sd.additionalFedWithholding === num) return;
    writeField(sd, "additionalFedWithholding", num);
  };

  /** Shared by bonusMonth/bonusDayOfMonth — both nullable, 1-based, ranged
   *  integers with the same "empty clears back to null" semantics. */
  const commitNullableInt = (
    sd: Detail,
    field: "bonusMonth" | "bonusDayOfMonth",
    min: number,
    max: number,
  ) => {
    const key = `${sd.personId}:${field}`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (sd[field] === null) return;
      writeField(sd, field, null);
      return;
    }
    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < min || num > max) return;
    if (sd[field] === num) return;
    writeField(sd, field, num);
  };
  const commitBonusMonth = (sd: Detail) =>
    commitNullableInt(sd, "bonusMonth", 1, 12);
  const commitBonusDayOfMonth = (sd: Detail) =>
    commitNullableInt(sd, "bonusDayOfMonth", 1, 31);

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      {error && <FormError message={error} className="mb-3" />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <FormField label="Name">
          <FormInput
            type="text"
            value={drafts.name ?? profile.name}
            onChange={(e) => setDraft("name", e.target.value)}
            onBlur={commitName}
          />
        </FormField>
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
          <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
            Salary &amp; Bonus
          </h4>
          <p className="text-caption text-faint mb-2">
            A job is either in this profile (edit any field) or it isn&apos;t
            (shown as &ldquo;—&rdquo;, contributing $0) — use + Add to give it
            real numbers.
          </p>
          <table className="w-full text-xs border-collapse">
            <SalaryTableHead editable />
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
                const cellFor = (
                  field: FieldKey,
                  prefix?: string,
                  suffix?: string,
                ) => (
                  <EntryNumberCell
                    sd={sd}
                    field={field}
                    draft={drafts[`${sd.personId}:${field}`]}
                    onDraft={(v) => setDraft(`${sd.personId}:${field}`, v)}
                    onCommit={() => commitField(sd, field)}
                    prefix={prefix}
                    suffix={suffix}
                    width={field === "salary" ? "w-28" : "w-20"}
                  />
                );
                return (
                  <React.Fragment key={rawSd.personId}>
                    <tr className={rowClass(rowIdx)}>
                      <td className="py-1.5 pl-4 pr-3 font-medium text-secondary">
                        {sd.personName}
                      </td>
                      <td className="py-1.5 px-3 text-muted">
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
                          <td className="py-1.5 px-3">
                            {cellFor("salary", "$")}
                          </td>
                          <td className="py-1.5 px-3">
                            {cellFor("bonusPercent", undefined, "%")}
                          </td>
                          <td className="py-1.5 px-3">
                            {cellFor("bonusMultiplier", undefined, "×")}
                          </td>
                          <td className="py-1.5 px-3">
                            <BonusOverrideCell
                              sd={sd}
                              draft={drafts[`${sd.personId}:bonusOverride`]}
                              onDraft={(v) =>
                                setDraft(`${sd.personId}:bonusOverride`, v)
                              }
                              onCommit={() => commitBonusOverride(sd)}
                            />
                          </td>
                          <td className="py-1.5 px-3 text-right tabular-nums text-secondary">
                            {formatCurrency(sd.estimatedBonus)}
                          </td>
                          <td className="py-1.5 pr-4 pl-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="tabular-nums font-medium text-secondary">
                                {formatCurrency(
                                  sd.effectiveSalary + sd.estimatedBonus,
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeEntry(sd.jobId)}
                                title="Remove this job from the profile"
                                className="text-caption text-faint hover:text-red-500 shrink-0"
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <td
                          colSpan={6}
                          className="py-1.5 px-3 text-right text-faint"
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
                          colSpan={8}
                          className="py-3 px-4 bg-surface-sunken/60"
                        >
                          <PayTaxDetailsEdit
                            sd={sd}
                            drafts={drafts}
                            setDraft={setDraft}
                            onWriteField={writeField}
                            onCommitAnchorPayDate={commitAnchorPayDate}
                            onCommitBudgetPeriodsPerMonth={
                              commitBudgetPeriodsPerMonth
                            }
                            onCommitAdditionalFedWithholding={
                              commitAdditionalFedWithholding
                            }
                            onCommitBonusMonth={commitBonusMonth}
                            onCommitBonusDayOfMonth={commitBonusDayOfMonth}
                          />
                          <div className="mt-4 pt-3 border-t border-subtle/50">
                            <h5 className="text-caption text-faint font-medium uppercase tracking-wide mb-2">
                              Extra Paycheck Routing
                            </h5>
                            {!isActiveProfile ? (
                              <p className="text-xs text-muted">
                                Extra-paycheck routing always applies to the
                                globally-active Salary Profile. Activate this
                                profile to edit routing here.
                              </p>
                            ) : sd.jobId === null ? (
                              <p className="text-xs text-muted">
                                No job selected for this row.
                              </p>
                            ) : (
                              <ExtraPaycheckDestinationToggle
                                jobId={sd.jobId}
                                routing={sd.extraPaycheckRouting}
                                disabled={isInScenario}
                              />
                            )}
                          </div>
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
