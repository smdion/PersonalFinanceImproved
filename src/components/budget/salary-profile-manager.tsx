"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import { useScenario } from "@/lib/context/scenario-context";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { ProfileViewingBadge } from "./profile-viewing-badge";
import { confirm } from "@/components/ui/confirm-dialog";

/**
 * Salary Profiles tab — the "what if I earned X" axis.
 *
 * Deliberately much thinner than ContributionProfileManager: a Salary
 * Profile's whole content is a personId → entry map, so there's no
 * contribution math to resolve or aggregate. Every profile is an ordinary row
 * — renamable, editable, and deletable so long as it isn't the last one, the
 * active one, or pinned by a Plan.
 *
 * THERE IS NO MODE TOGGLE. Every field (salary, bonus %, bonus multiplier)
 * renders pre-filled with what that person's job record currently resolves
 * to. Leaving a field as pre-filled writes nothing — it keeps resolving live,
 * so a later raise on the job record flows straight through. Changing a field
 * pins it for this profile, and the ↺ next to a pinned field clears the pin
 * without making the user retype the live number from memory.
 *
 * That is the whole encoding: presence of a value in the stored entry IS the
 * pin. The fields are independent, so pinning a salary leaves bonus terms
 * live (and vice versa) — which is why a pinned salary still earns a bonus.
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
 * cost more legibility than it buys. Pins written by other means are honoured
 * and displayed via the resulting bonus.
 */
export function SalaryProfileManager({
  canEdit,
  locked,
}: {
  canEdit: boolean;
  /** Owned by budget-content.tsx's single tab-bar padlock — see its
   *  useEditLock(EDIT_LOCK_KEYS.budgetSalary) call. */
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
              <div>
                <span className="text-faint">People pinned </span>
                <span className="font-semibold text-secondary">
                  {displayedProfile.pinnedCount}
                </span>
              </div>
              {displayedProfile.pinnedSalaryTotal > 0 && (
                <div>
                  <span className="text-faint">Pinned salary </span>
                  <span className="font-semibold text-secondary">
                    {formatCurrency(displayedProfile.pinnedSalaryTotal)}
                    <span className="text-faint font-normal">/yr</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          <HelpTip text="A Salary Profile sets each person's pay for what-if analysis. Every field starts at what their job record says right now — leave it alone and it keeps tracking the job, change it and this profile pins it. Salary and bonus pin independently, so a pinned salary still earns its bonus. It is independent of the Contribution Profile — pin either, both, or neither. Plan pins and page-level salary overrides always win over a profile." />
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
            />
          ))}
        </div>

        {/* Right: detail / inline editor */}
        <div>
          {creatingNew ? (
            <ProfileCreatePanel
              profiles={profiles}
              onCancel={() => setCreatingNew(false)}
              onSaved={(newId) => {
                setCreatingNew(false);
                invalidateProfileDeps();
                if (newId !== undefined) setSelectedProfileId(newId);
              }}
            />
          ) : effectiveSelectedId != null ? (
            !canEdit || locked ? (
              <ProfileDetail profileId={effectiveSelectedId} />
            ) : (
              <ProfileEditPanel
                profileId={effectiveSelectedId}
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
}: {
  name: string;
  description: string | null;
  pinnedCount: number;
  isSelected: boolean;
  isActive: boolean;
  onSelect: () => void;
  onDelete?: () => void;
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
                ? "Everything follows the job records"
                : `${pinnedCount} ${pinnedCount === 1 ? "person" : "people"} pinned`)}
          </div>
        </div>
        {onDelete && (
          <div className="flex items-center gap-1 shrink-0 md:max-w-0 md:overflow-hidden md:opacity-0 md:group-hover:max-w-[9rem] md:group-hover:opacity-100 transition-all">
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
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared entry helpers
// ---------------------------------------------------------------------------

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
  employerName: string | null;
  baseSalary: number;
  jobSalary: number;
  jobBonusPercent: number;
  jobBonusMultiplier: number;
  jobMonthsInBonusYear: number;
  pinnedSalary: number | null;
  pinnedBonusPercent: number | null;
  pinnedBonusMultiplier: number | null;
  pinnedMonthsInBonusYear: number | null;
  effectiveSalary: number;
  estimatedBonus: number;
};

/** The stored entry shape — every field optional, presence means pinned. */
type Entry = {
  salary?: number;
  bonusPercent?: number;
  bonusMultiplier?: number;
  monthsInBonusYear?: number;
};

/**
 * Rebuild the profile's stored entry map from the rows the server just sent.
 *
 * Round-tripping through `pinned*` (rather than keeping a separate client
 * copy of `salaries`) means a write always sends exactly what the server
 * currently believes plus the one field being changed, so two edits in quick
 * succession can't resurrect a pin the first one cleared.
 */
function storedEntries(details: Detail[]): Record<string, Entry> {
  const out: Record<string, Entry> = {};
  for (const sd of details) {
    const entry: Entry = {};
    if (sd.pinnedSalary !== null) entry.salary = sd.pinnedSalary;
    if (sd.pinnedBonusPercent !== null)
      entry.bonusPercent = sd.pinnedBonusPercent;
    if (sd.pinnedBonusMultiplier !== null)
      entry.bonusMultiplier = sd.pinnedBonusMultiplier;
    if (sd.pinnedMonthsInBonusYear !== null)
      entry.monthsInBonusYear = sd.pinnedMonthsInBonusYear;
    if (Object.keys(entry).length > 0) out[String(sd.personId)] = entry;
  }
  return out;
}

/** The three fields this table edits, and how each maps to live/pinned. */
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

/** The live (job-record) value a field pre-fills with, in display units. */
function liveDisplay(sd: Detail, field: FieldKey): number {
  if (field === "salary") return sd.jobSalary;
  if (field === "bonusPercent")
    return FIELDS.bonusPercent.toDisplay(sd.jobBonusPercent);
  return sd.jobBonusMultiplier;
}

/** The pinned value for a field, or null when it resolves live. */
function pinnedValue(sd: Detail, field: FieldKey): number | null {
  if (field === "salary") return sd.pinnedSalary;
  if (field === "bonusPercent") return sd.pinnedBonusPercent;
  return sd.pinnedBonusMultiplier;
}

/** What the input shows: the pin if there is one, else the live value. */
function displayValue(sd: Detail, field: FieldKey): number {
  const pinned = pinnedValue(sd, field);
  return pinned !== null
    ? FIELDS[field].toDisplay(pinned)
    : liveDisplay(sd, field);
}

/** Format a display-unit number for an input without trailing float noise. */
function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * A numeric cell that is pre-filled with the live value and pins on change.
 *
 * The pin state is visible (amber + a ↺ to clear it) rather than implied, so
 * "this number is frozen for this profile" and "this number tracks the job
 * record" are distinguishable at a glance — which is the job the old
 * Follows-job/Fixed-amount toggle used to do, without a separate control
 * whose state could contradict the value beside it.
 */
function PinnedNumberCell({
  sd,
  field,
  draft,
  onDraft,
  onCommit,
  onReset,
  prefix,
  suffix,
  width = "w-24",
}: {
  sd: Detail;
  field: FieldKey;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onCommit: () => void;
  onReset: () => void;
  prefix?: string;
  suffix?: string;
  width?: string;
}) {
  const isPinned = pinnedValue(sd, field) !== null;
  const value = draft ?? fmt(displayValue(sd, field));
  return (
    <div className="flex items-center justify-end gap-1">
      {prefix && <span className="text-xs text-faint">{prefix}</span>}
      <input
        type="number"
        value={value}
        onChange={(e) => onDraft(e.target.value)}
        onBlur={onCommit}
        step={FIELDS[field].step}
        title={
          isPinned
            ? `Pinned by this profile. Live value: ${fmt(liveDisplay(sd, field))}`
            : "Follows the job record"
        }
        className={`${width} px-2 py-1 text-xs text-right border rounded bg-surface-primary ${
          isPinned
            ? "text-amber-600 font-medium border-amber-400"
            : "text-primary"
        }`}
      />
      {suffix && <span className="text-xs text-faint">{suffix}</span>}
      <button
        type="button"
        onClick={onReset}
        disabled={!isPinned}
        title={isPinned ? "Reset to the live job value" : "Already live"}
        className="text-caption text-faint hover:text-blue-600 disabled:opacity-0 disabled:cursor-default w-3.5 shrink-0"
      >
        ↺
      </button>
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
          className={`text-right py-2 px-3 text-muted font-medium ${editable ? "w-44" : "w-32"}`}
        >
          Salary
        </th>
        <th
          className={`text-right py-2 px-3 text-muted font-medium ${editable ? "w-36" : "w-24"}`}
        >
          Bonus %
        </th>
        <th
          className={`text-right py-2 px-3 text-muted font-medium ${editable ? "w-36" : "w-24"}`}
        >
          Multiplier
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
          colSpan={6}
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

/**
 * Read-only detail view — used when canEdit is false and whenever the padlock
 * is locked. Every person shows a real salary and bonus: what their job
 * resolves to, with any pinned field replacing it (shown in amber).
 */
function ProfileDetail({ profileId }: { profileId: number }) {
  const { data: profile } = trpc.salaryProfile.getById.useQuery({
    id: profileId,
  });
  if (!profile) return null;

  const cell = (sd: Detail, field: FieldKey, suffix?: string) => {
    const isPinned = pinnedValue(sd, field) !== null;
    return (
      <td
        className={`py-1.5 px-3 text-right tabular-nums ${
          isPinned ? "text-amber-600 font-medium" : "text-secondary"
        }`}
        title={
          isPinned
            ? `Pinned by this profile. Live value: ${fmt(liveDisplay(sd, field))}`
            : "Follows the job record"
        }
      >
        {field === "salary"
          ? formatCurrency(displayValue(sd, field))
          : `${fmt(displayValue(sd, field))}${suffix ?? ""}`}
      </td>
    );
  };

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
          {profile.salaryDetails.map((sd, rowIdx) => (
            <tr key={sd.personId} className={rowClass(rowIdx)}>
              <td className="py-1.5 pl-4 pr-3 font-medium text-secondary">
                {sd.personName}
              </td>
              <td className="py-1.5 px-3 text-muted">
                {sd.employerName ?? "No active job"}
              </td>
              {cell(sd, "salary")}
              {cell(sd, "bonusPercent", "%")}
              {cell(sd, "bonusMultiplier", "×")}
              <td className="py-1.5 px-3 text-right tabular-nums text-secondary">
                {formatCurrency(sd.estimatedBonus)}
              </td>
              <td className="py-1.5 pr-4 pl-3 text-right tabular-nums font-medium text-secondary">
                {formatCurrency(sd.effectiveSalary + sd.estimatedBonus)}
              </td>
            </tr>
          ))}
        </tbody>
        <TotalsFooter combinedIncome={profile.combinedIncome} />
      </table>
    </div>
  );
}

/**
 * Create-new panel. This is the one place a batch form survives: a profile
 * row has to exist before per-field edits have anywhere to go, so the name
 * (and any starting pins) are collected and sent as a single create.
 * Once created, the profile is edited in place via ProfileEditPanel.
 */
function ProfileCreatePanel({
  profiles,
  onCancel,
  onSaved,
}: {
  profiles: { id: number; name: string }[];
  onCancel: () => void;
  onSaved: (newId?: number) => void;
}) {
  /** Opt-in "start from an existing profile". Empty = start fresh, which is
   *  every field following its job record — a new what-if profile must never
   *  silently inherit and freeze whatever was pinned when it was created. */
  const [startFromId, setStartFromId] = useState<number | "">("");
  /** Any existing profile supplies the per-person rows and their live job
   *  values; when startFromId is set it also supplies the starting pins. */
  const rowsSourceId = startFromId === "" ? profiles[0]?.id : startFromId;
  const { data: baseData } = trpc.salaryProfile.getById.useQuery(
    { id: rowsSourceId! },
    { enabled: rowsSourceId !== undefined },
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /** `${personId}:${field}` → in-progress text. Absent = untouched, which
   *  takes the seed below (the started-from profile's pin, else live). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.salaryProfile.create.useMutation({
    onSuccess: (created) => onSaved(created.id),
    onError: (e) => setError(e.message),
  });

  const startingFrom = startFromId !== "";

  /** What this row's field shows: an explicit draft, else the seed. When not
   *  copying a profile the seed is always the LIVE value, so an untouched
   *  form creates a profile that pins nothing. */
  const seedFor = (sd: Detail, field: FieldKey) =>
    startingFrom ? displayValue(sd, field) : liveDisplay(sd, field);

  const valueFor = (sd: Detail, field: FieldKey) =>
    drafts[`${sd.personId}:${field}`] ?? fmt(seedFor(sd, field));

  const handleCreate = () => {
    const salaries: Record<string, Entry> = {};
    for (const sd of baseData?.salaryDetails ?? []) {
      const entry: Entry = {};
      for (const field of Object.keys(FIELDS) as FieldKey[]) {
        const raw = valueFor(sd, field);
        const num = parseFloat(raw);
        // Unparseable, negative, or exactly the live value ⇒ no pin. The
        // last of those is decision 5: leaving a pre-filled field alone must
        // write nothing, or every new profile would freeze every number.
        if (isNaN(num) || num < 0) continue;
        if (num === liveDisplay(sd, field)) continue;
        entry[field] = FIELDS[field].fromDisplay(num);
      }
      // Copying a profile also copies any months-in-bonus-year pin, which
      // this table doesn't surface but must not silently drop.
      if (startingFrom && sd.pinnedMonthsInBonusYear !== null)
        entry.monthsInBonusYear = sd.pinnedMonthsInBonusYear;
      if (Object.keys(entry).length > 0) salaries[String(sd.personId)] = entry;
    }
    createMutation.mutate({
      name,
      description: description || undefined,
      salaries,
    });
  };

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      {error && <FormError message={error} className="mb-3" />}

      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
          <div>
            <label className="text-label font-medium text-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Promotion"
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
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </div>

      {profiles.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-label font-medium text-muted">
            Start from an existing profile
          </label>
          <select
            value={startFromId === "" ? "" : String(startFromId)}
            onChange={(e) => {
              setStartFromId(e.target.value ? Number(e.target.value) : "");
              setDrafts({});
            }}
            className="px-2 py-1 text-xs border rounded bg-surface-primary text-primary"
          >
            <option value="">
              Start fresh (everything follows the job records)
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                Copy from {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {baseData?.salaryDetails && baseData.salaryDetails.length > 0 && (
        <div>
          <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
            Salary &amp; Bonus
          </h4>
          <p className="text-caption text-faint mb-2">
            Fields start at each person&apos;s current job values. Leave one
            alone and it keeps tracking the job record; change it and this
            profile pins it.
          </p>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b-2 border-strong">
                <th className="text-left py-2 pl-4 pr-3 text-muted font-medium">
                  Person
                </th>
                <th className="text-left py-2 px-3 text-muted font-medium">
                  Employer
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-40">
                  Salary
                </th>
                <th className="text-right py-2 px-3 text-muted font-medium w-32">
                  Bonus %
                </th>
                <th className="text-right py-2 pr-4 pl-3 text-muted font-medium w-32">
                  Multiplier
                </th>
              </tr>
            </thead>
            <tbody>
              {baseData.salaryDetails.map((sd, rowIdx) => {
                const input = (
                  field: FieldKey,
                  prefix?: string,
                  suffix?: string,
                ) => (
                  <div className="flex items-center justify-end gap-1">
                    {prefix && (
                      <span className="text-xs text-faint">{prefix}</span>
                    )}
                    <input
                      type="number"
                      value={valueFor(sd, field)}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [`${sd.personId}:${field}`]: e.target.value,
                        }))
                      }
                      step={FIELDS[field].step}
                      className="w-24 px-2 py-1 text-xs text-right border rounded bg-surface-primary text-primary"
                    />
                    {suffix && (
                      <span className="text-xs text-faint">{suffix}</span>
                    )}
                  </div>
                );
                return (
                  <tr key={sd.personId} className={rowClass(rowIdx)}>
                    <td className="py-1.5 pl-4 pr-3 font-medium text-secondary">
                      {sd.personName}
                    </td>
                    <td className="py-1.5 px-3 text-muted">
                      {sd.employerName ?? "No active job"}
                    </td>
                    <td className="py-1.5 px-3">{input("salary", "$")}</td>
                    <td className="py-1.5 px-3">
                      {input("bonusPercent", undefined, "%")}
                    </td>
                    <td className="py-1.5 pr-4 pl-3">
                      {input("bonusMultiplier", undefined, "×")}
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

/**
 * Unlocked, in-place editor for an existing profile. There is no Save button:
 * every field commits on blur (checkbox-free surface, so blur is the only
 * commit moment), mirroring SavingsAllocationTable's draft/commit pattern —
 * local draft strings only exist so multi-digit typing doesn't fire a
 * mutation per keystroke.
 */
function ProfileEditPanel({
  profileId,
  onSaved,
}: {
  profileId: number;
  onSaved: () => void;
}) {
  const { data: profile } = trpc.salaryProfile.getById.useQuery({
    id: profileId,
  });
  const [error, setError] = useState<string | null>(null);
  /** In-progress text per field; cleared once its mutation is sent. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const updateMutation = trpc.salaryProfile.update.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
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

  /** Write the whole entry map back with one person's one field changed.
   *  `next === undefined` clears the pin (the ↺ affordance). */
  const writeField = (personId: number, field: FieldKey, next?: number) => {
    const salaries = storedEntries(details);
    const key = String(personId);
    const entry: Entry = { ...(salaries[key] ?? {}) };
    if (next === undefined) delete entry[field];
    else entry[field] = next;
    if (Object.keys(entry).length > 0) salaries[key] = entry;
    else delete salaries[key];
    updateMutation.mutate({ id: profileId, salaries });
  };

  const commitField = (sd: Detail, field: FieldKey) => {
    const key = `${sd.personId}:${field}`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const trimmed = draft.trim();
    const num = parseFloat(trimmed);
    // A blank or unusable box means "no pin" rather than a zero pin — a zero
    // salary is a real, destructive value to write by accident.
    if (trimmed === "" || isNaN(num) || num < 0) {
      if (pinnedValue(sd, field) !== null) writeField(sd.personId, field);
      return;
    }
    // Back to exactly the live value ⇒ unpin, so the field resumes tracking
    // the job record instead of freezing today's number forever.
    if (num === liveDisplay(sd, field)) {
      if (pinnedValue(sd, field) !== null) writeField(sd.personId, field);
      return;
    }
    const stored = FIELDS[field].fromDisplay(num);
    if (pinnedValue(sd, field) === stored) return;
    writeField(sd.personId, field, stored);
  };

  const resetField = (sd: Detail, field: FieldKey) => {
    clearDraft(`${sd.personId}:${field}`);
    if (pinnedValue(sd, field) !== null) writeField(sd.personId, field);
  };

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      {error && <FormError message={error} className="mb-3" />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-label font-medium text-muted">Name</label>
          <input
            type="text"
            value={drafts.name ?? profile.name}
            onChange={(e) => setDraft("name", e.target.value)}
            onBlur={commitName}
            className="mt-0.5 w-full px-2 py-1.5 text-xs border rounded bg-surface-primary text-primary"
          />
        </div>
        <div>
          <label className="text-label font-medium text-muted">
            Description
          </label>
          <input
            type="text"
            value={drafts.description ?? profile.description ?? ""}
            onChange={(e) => setDraft("description", e.target.value)}
            onBlur={commitDescription}
            placeholder="Optional description"
            className="mt-0.5 w-full px-2 py-1.5 text-xs border rounded bg-surface-primary text-primary"
          />
        </div>
      </div>

      {details.length > 0 && (
        <div>
          <h4 className="text-label font-semibold text-muted uppercase tracking-wide mb-2">
            Salary &amp; Bonus
          </h4>
          <p className="text-caption text-faint mb-2">
            Fields start at each person&apos;s current job values. Change one to
            pin it for this profile (shown in amber); use ↺ to go back to
            following the job record.
          </p>
          <table className="w-full text-xs border-collapse">
            <SalaryTableHead editable />
            <tbody>
              {details.map((sd, rowIdx) => {
                const cellFor = (
                  field: FieldKey,
                  prefix?: string,
                  suffix?: string,
                ) => (
                  <PinnedNumberCell
                    sd={sd}
                    field={field}
                    draft={drafts[`${sd.personId}:${field}`]}
                    onDraft={(v) => setDraft(`${sd.personId}:${field}`, v)}
                    onCommit={() => commitField(sd, field)}
                    onReset={() => resetField(sd, field)}
                    prefix={prefix}
                    suffix={suffix}
                    width={field === "salary" ? "w-28" : "w-20"}
                  />
                );
                return (
                  <tr key={sd.personId} className={rowClass(rowIdx)}>
                    <td className="py-1.5 pl-4 pr-3 font-medium text-secondary">
                      {sd.personName}
                    </td>
                    <td className="py-1.5 px-3 text-muted">
                      {sd.employerName ?? "No active job"}
                    </td>
                    <td className="py-1.5 px-3">{cellFor("salary", "$")}</td>
                    <td className="py-1.5 px-3">
                      {cellFor("bonusPercent", undefined, "%")}
                    </td>
                    <td className="py-1.5 px-3">
                      {cellFor("bonusMultiplier", undefined, "×")}
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums text-secondary">
                      {formatCurrency(sd.estimatedBonus)}
                    </td>
                    <td className="py-1.5 pr-4 pl-3 text-right tabular-nums font-medium text-secondary">
                      {formatCurrency(sd.effectiveSalary + sd.estimatedBonus)}
                    </td>
                  </tr>
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
