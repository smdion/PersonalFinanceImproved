"use client";

/** Paycheck gross-to-net calculator that breaks down taxes, deductions, and take-home pay. */

import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { useScenario } from "@/lib/context/scenario-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { ScenarioBanner } from "@/components/ui/scenario-indicator";
import { EmptyState } from "@/components/ui/empty-state";
import { confirm } from "@/components/ui/confirm-dialog";
import {
  PersonPaycheck,
  ContributionSnapshot,
  type RawDeduction,
  type RawContrib,
} from "@/components/paycheck";
import { usePaycheckPersonViews } from "@/lib/hooks/use-paycheck-person-views";
import {
  EditLockToggle,
  EDIT_LOCK_KEYS,
  useEditLock,
} from "@/components/ui/edit-lock-toggle";

export default function PaycheckPage() {
  const user = useUser();
  const canEditProfiles = hasPermission(user, "contributionProfile");
  const {
    viewMode: mode,
    isInScenario,
    setOverride: setScenarioOverride,
    activeScenario: _activeScenario,
  } = useScenario();
  const [contribExpanded, setContribExpanded] = useState(false);
  const [taxYearSetting, setTaxYearSetting] = usePersistedSetting<
    number | null
  >("paycheck_tax_year", null);
  const taxYearOverride = taxYearSetting ?? undefined;
  const setTaxYearOverride = (year: number | undefined) =>
    setTaxYearSetting(year ?? null);
  const [contribProfileId] = useActiveContribProfile();
  const utils = trpc.useUtils();

  /** Same shared lock as the Budget page's four profile tabs and the
   *  standalone Savings page — Salary/Contribution profile editing here is
   *  the same underlying data, just from a different page, so locking it
   *  anywhere locks it everywhere. */
  const [profileLocked, toggleProfileLock] = useEditLock(
    EDIT_LOCK_KEYS.profileEditLocked,
  );

  // Contribution profile state
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();
  const contribProfiles = contribProfilesQuery.data ?? [];

  // Local viewing state — defaults to global active, but can view others without activating
  const [viewingContribId, setViewingContribId] = useState<number | null>(null);
  // Plan pin -> local viewing selection -> globally-active profile (single computation path)
  const { profileId: displayContribId } = useEffectiveProfileId(
    "contribution",
    {
      validIds: contribProfiles.map((p) => p.id),
      localSelection: viewingContribId,
      globalDefaultId: contribProfileId,
    },
  );

  const viewingProfileQuery = trpc.contributionProfile.getById.useQuery(
    { id: displayContribId! },
    { enabled: displayContribId != null },
  );
  const activeProfile = viewingProfileQuery.data;
  const contribProfileActive = canEditProfiles && activeProfile != null;
  /** Mirrors salaryEditsProfile — locked means edits fall through to the
   *  direct-write path instead of the profile's active fields. */
  const isProfileMode = contribProfileActive && !profileLocked;

  const updateProfile = trpc.contributionProfile.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.contribution.invalidate();
      utils.contributionProfile.invalidate();
      utils.projection.invalidate();
    },
  });

  // Helper: update one or more fields in the active profile's active
  // fields, in a single atomic write. Multi-field form exists because
  // payPeriod/payWeek/anchorPayDate are a coupled schedule unit the write
  // schema requires to be set together (or none) — editing just one of
  // them via the single-field form would transiently violate that and be
  // rejected. Callers editing an independent field can keep passing a
  // single field/value pair.
  function updateProfileActiveField(
    entityType: "contributionAccounts" | "jobs" | "deductions",
    entityId: number,
    fieldOrFields: string | Record<string, unknown>,
    value?: unknown,
  ) {
    if (!activeProfile) return;
    const existing = activeProfile.contributionActiveFields as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const entityActiveFields = { ...(existing[entityType] ?? {}) };
    const patch =
      typeof fieldOrFields === "string"
        ? { [fieldOrFields]: value }
        : fieldOrFields;
    entityActiveFields[String(entityId)] = {
      ...(entityActiveFields[String(entityId)] ?? {}),
      ...patch,
    };
    updateProfile.mutate({
      id: activeProfile.id,
      contributionActiveFields: {
        ...existing,
        [entityType]: entityActiveFields,
      },
    });
  }

  /**
   * Dispatch a field edit to the correct target (scenario, profile, or direct DB).
   * Returns true if handled by scenario or profile mode; false means caller should do a direct DB write.
   */
  function writeOverride(
    entityType: "contributionAccounts" | "jobs" | "deductions",
    entityId: number,
    field: string,
    value: string | number | boolean | null,
  ): boolean {
    if (isInScenario) {
      setScenarioOverride(entityType, entityId, field, value);
      return true;
    }
    if (isProfileMode) {
      updateProfileActiveField(entityType, entityId, field, value);
      return true;
    }
    return false;
  }

  // Independent Salary Profile axis. Same three-tier resolution as the
  // contribution axis above (Plan pin -> this page's dropdown -> globally
  // active), rather than useEffectiveSalaryProfileId(), because the picker
  // needs a local-selection tier that hook deliberately doesn't have. The
  // resolved id feeds both the picker and the query input below, so they
  // can't drift.
  const salaryProfilesQuery = trpc.salaryProfile.list.useQuery();
  const salaryProfiles = salaryProfilesQuery.data ?? [];
  const [activeSalaryId] = useActiveSalaryProfile();
  const [viewingSalaryId, setViewingSalaryId] = useState<number | null>(null);
  const { profileId: displaySalaryId } = useEffectiveProfileId("salary", {
    validIds: salaryProfiles.map((p) => p.id),
    localSelection: viewingSalaryId,
    // Always a real row id post-migration — useActiveSalaryProfile repairs
    // the setting if the row it names ever disappears.
    globalDefaultId: activeSalaryId,
  });
  const displayedSalaryProfile = salaryProfiles.find(
    (p) => p.id === displaySalaryId,
  );
  const isSalaryProfileMode = canEditProfiles && displayedSalaryProfile != null;
  /** Salary figures write to the profile (not the job) while this is true. */
  const salaryEditsProfile = isSalaryProfileMode && !profileLocked;

  const updateSalaryProfile = trpc.salaryProfile.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.salaryProfile.invalidate();
      utils.contribution.invalidate();
      utils.budget.invalidate();
      utils.projection.invalidate();
    },
  });

  type CompleteSalaryEntry = {
    salary: number;
    bonusPercent: number;
    bonusMultiplier: number;
    monthsInBonusYear: number;
    bonusOverride: number | null;
  };

  /**
   * Merge a field edit into this job's entry in the displayed Salary
   * Profile. Entries are complete/all-or-nothing (no partial pins) — the
   * first edit to a job that has no entry yet creates one, defaulting
   * every untouched field to `defaults` (that job's currently-resolved
   * values), so the write is always a full 5-field entry.
   */
  function writeSalaryProfileEntry(
    jobId: number,
    defaults: CompleteSalaryEntry,
    updates: Partial<CompleteSalaryEntry>,
  ) {
    if (!displayedSalaryProfile) return;
    const existing = displayedSalaryProfile.salaries[String(jobId)];
    updateSalaryProfile.mutate({
      id: displayedSalaryProfile.id,
      salaries: {
        ...displayedSalaryProfile.salaries,
        [String(jobId)]: { ...(existing ?? defaults), ...updates },
      },
    });
  }

  // One shared derivation for the whole page — the same hook the Budget
  // page's What-If tab uses (with honorSessionScenario:false there). Session
  // scenario overrides apply here, which is today's behavior.
  const { views, isLoading, error, sharedContribGroupOrder } =
    usePaycheckPersonViews({
      contributionProfileId: displayContribId,
      salaryProfileId: displaySalaryId,
      taxYearOverride,
      honorSessionScenario: true,
    });

  // Get available tax years for the toggle (union of brackets + limits years)
  const { data: taxBrackets } = trpc.settings.taxBrackets.list.useQuery();
  const { data: contribLimitsAll } =
    trpc.settings.contributionLimits.list.useQuery();
  const availableYears = (() => {
    const yrs = new Set<number>();
    if (taxBrackets) for (const tb of taxBrackets) yrs.add(tb.taxYear);
    if (contribLimitsAll) for (const l of contribLimitsAll) yrs.add(l.taxYear);
    return Array.from(yrs).sort((a, b) => b - a);
  })();
  const currentYear = new Date().getFullYear();
  const updateJob = trpc.settings.jobs.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.contribution.invalidate();
    },
  });
  const updateDeduction = trpc.settings.deductions.update.useMutation({
    onSuccess: () => utils.paycheck.invalidate(),
  });
  const createDeduction = trpc.settings.deductions.create.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
    },
  });
  const deleteDeduction = trpc.settings.deductions.delete.useMutation({
    onSuccess: () => utils.paycheck.invalidate(),
  });
  const updateContrib = trpc.settings.contributionAccounts.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.contribution.invalidate();
    },
  });
  const createContrib = trpc.settings.contributionAccounts.create.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.contribution.invalidate();
    },
  });
  const deleteContrib = trpc.settings.contributionAccounts.delete.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.contribution.invalidate();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SkeletonChart height={384} />
          <SkeletonChart height={384} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load paycheck data: {error.message}
      </p>
    );
  }

  return (
    <div>
      <ScenarioBanner />
      <PageHeader
        title="Paycheck"
        subtitle={
          availableYears.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Tax Year:</span>
              <div className="flex gap-1">
                {availableYears.map((year) => (
                  <button
                    key={year}
                    onClick={() =>
                      setTaxYearOverride(
                        year === currentYear ? undefined : year,
                      )
                    }
                    className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                      (taxYearOverride ?? currentYear) === year
                        ? "bg-blue-600 text-white"
                        : "bg-surface-elevated text-muted hover:bg-surface-strong"
                    }`}
                  >
                    {year}
                  </button>
                ))}
              </div>
              {taxYearOverride && taxYearOverride !== currentYear && (
                <span className="text-xs text-amber-600 font-medium">
                  Comparing {taxYearOverride} tables
                </span>
              )}
            </div>
          ) : undefined
        }
      >
        {salaryProfiles.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Salary:</span>
            <select
              className="text-xs border rounded px-2 py-1 bg-surface-primary"
              value={displaySalaryId ?? ""}
              onChange={(e) => setViewingSalaryId(Number(e.target.value))}
              aria-label="Salary profile"
            >
              {salaryProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {displaySalaryId !== activeSalaryId && (
              <span className="text-caption text-muted font-medium">
                (viewing — not active)
              </span>
            )}
          </div>
        )}
        {contribProfiles.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Contribution:</span>
            <select
              className="text-xs border rounded px-2 py-1 bg-surface-primary"
              value={displayContribId ?? ""}
              onChange={(e) =>
                setViewingContribId(
                  e.target.value ? Number(e.target.value) : null,
                )
              }
            >
              {contribProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {displayContribId !== contribProfileId && (
              <span className="text-caption text-muted font-medium">
                (viewing — not active)
              </span>
            )}
          </div>
        )}
        {(isSalaryProfileMode || contribProfileActive) && (
          <EditLockToggle
            locked={profileLocked}
            onToggle={toggleProfileLock}
            disabled={!canEditProfiles}
          />
        )}
      </PageHeader>

      {views.length === 0 ? (
        <EmptyState
          message="No active jobs found."
          hint="Add jobs on the Historical page to see paycheck breakdowns."
        />
      ) : (
        <div
          className={`grid grid-cols-1 ${views.length > 1 ? "lg:grid-cols-2" : ""} gap-6 grid-rows-[auto_auto_auto]`}
        >
          {views.map((d) => (
            <PersonPaycheck
              key={d.person.id}
              person={d.person}
              job={d.job}
              salary={d.salary}
              resolvedBonusTerms={d.resolvedBonusTerms}
              paycheck={d.paycheck}
              fullFormulaBonusEstimate={d.fullFormulaBonusEstimate}
              mode={mode}
              blendedAnnual={d.blendedAnnual}
              // A job has no salary of its own — every edit lands in the
              // displayed Salary Profile, so editing requires a profile in
              // view and the padlock unlocked.
              salaryReadOnly={!isSalaryProfileMode || profileLocked}
              // Mirrors salaryReadOnly — isProfileMode already folds in
              // profileLocked (see its definition above).
              contribValueReadOnly={!isProfileMode}
              rawDeductions={d.rawDeductions}
              rawContribs={d.rawContribs}
              perContribData={d.perContribData}
              alignedPreTax={d.alignedPreTax}
              alignedPostTax={d.alignedPostTax}
              coverageNote={d.coverageNote}
              coverageNoteGroup={d.coverageNoteGroup}
              otherJointContribs={d.otherJointContribs}
              contribExpanded={contribExpanded}
              onToggleContrib={() => setContribExpanded((prev) => !prev)}
              sharedGroupOrder={sharedContribGroupOrder}
              interaction={
                profileLocked
                  ? { kind: "readonly" }
                  : {
                      kind: "live",
                      handlers: {
                        onUpdateJob: (field: string, value: string) => {
                          const job = d.job!;
                          const boolFields = [
                            "include401kInBonus",
                            "w4Box2cChecked",
                            "includeBonusInContributions",
                          ];
                          const nullableIntFields = [
                            "bonusMonth",
                            "bonusDayOfMonth",
                          ];
                          const nullableDecimalFields = [
                            "budgetPeriodsPerMonth",
                          ];
                          const parsed = boolFields.includes(field)
                            ? value === "true"
                            : nullableIntFields.includes(field)
                              ? value === ""
                                ? null
                                : Number(value)
                              : nullableDecimalFields.includes(field)
                                ? value === ""
                                  ? null
                                  : value
                                : value;
                          if (isInScenario) {
                            setScenarioOverride("jobs", job.id, field, parsed);
                            return;
                          }
                          // A job has no salary or bonus terms of its own — every
                          // edit lands in the displayed Salary Profile as part of
                          // that job's complete entry (see resolveCompensation in
                          // server/helpers/salary.ts). Untouched fields default to
                          // this job's currently-resolved values.
                          if (field === "annualSalary") {
                            const num = Number(value);
                            if (isNaN(num) || num <= 0) return;
                            if (!salaryEditsProfile) return;
                            writeSalaryProfileEntry(
                              job.id,
                              { salary: d.salary, ...d.resolvedBonusTerms },
                              { salary: num },
                            );
                            return;
                          }
                          const salaryProfileBonusFields = [
                            "bonusPercent",
                            "bonusMultiplier",
                            "monthsInBonusYear",
                          ];
                          if (salaryProfileBonusFields.includes(field)) {
                            if (salaryEditsProfile) {
                              writeSalaryProfileEntry(
                                job.id,
                                { salary: d.salary, ...d.resolvedBonusTerms },
                                {
                                  [field as
                                    | "bonusPercent"
                                    | "bonusMultiplier"
                                    | "monthsInBonusYear"]: Number(parsed),
                                },
                              );
                            }
                            return;
                          }
                          // This year's actual bonus, pinned on the same entry —
                          // orthogonal to the formula fields above (see
                          // SalaryProfileEntry.bonusOverride's docblock).
                          if (field === "bonusOverride") {
                            if (salaryEditsProfile) {
                              writeSalaryProfileEntry(
                                job.id,
                                { salary: d.salary, ...d.resolvedBonusTerms },
                                {
                                  bonusOverride:
                                    value === "" ? null : Number(value),
                                },
                              );
                            }
                            return;
                          }
                          // Profile mode: the remaining bonus-adjacent fields
                          // (still real job columns), tax-input fields, and
                          // the coupled payPeriod/payWeek/anchorPayDate
                          // schedule unit all go to Contribution Profile
                          // active fields — same mechanism, no field-level
                          // carve-out (see the Contribution Profile plan's
                          // governing principle). employerName was already
                          // in the write-side schema allowlist but missing
                          // here — a pre-existing gap, fixed in the same pass.
                          const contribProfileBonusFields = [
                            "bonusMonth",
                            "bonusDayOfMonth",
                            "include401kInBonus",
                            "includeBonusInContributions",
                            "employerName",
                            "w4FilingStatus",
                            "w4Box2cChecked",
                            "additionalFedWithholding",
                            // payPeriod/payWeek/anchorPayDate are handled
                            // above (coupled-triplet special case), not here.
                          ];
                          // payPeriod/payWeek/anchorPayDate are a coupled
                          // schedule unit the write schema requires set
                          // together — write all three atomically, using
                          // this job's currently-resolved values (already
                          // live-default-or-active-profile, from `job`) for
                          // the two fields not being edited right now.
                          const schedulePeriodFields = [
                            "payPeriod",
                            "payWeek",
                            "anchorPayDate",
                          ];
                          if (
                            isProfileMode &&
                            schedulePeriodFields.includes(field)
                          ) {
                            updateProfileActiveField("jobs", job.id, {
                              payPeriod: job.payPeriod,
                              payWeek: job.payWeek,
                              anchorPayDate: job.anchorPayDate ?? undefined,
                              [field]: parsed,
                            });
                            return;
                          }
                          if (
                            isProfileMode &&
                            contribProfileBonusFields.includes(field)
                          ) {
                            updateProfileActiveField(
                              "jobs",
                              job.id,
                              field,
                              parsed,
                            );
                            return;
                          }
                          updateJob.mutate({
                            id: job.id,
                            personId: job.personId,
                            employerName: job.employerName,
                            payPeriod: job.payPeriod,
                            payWeek: job.payWeek,
                            startDate: job.startDate,
                            anchorPayDate: job.anchorPayDate ?? undefined,
                            w4FilingStatus: job.w4FilingStatus,
                            w4Box2cChecked: job.w4Box2cChecked,
                            bonusMonth: job.bonusMonth ?? undefined,
                            bonusDayOfMonth: job.bonusDayOfMonth ?? undefined,
                            include401kInBonus: job.include401kInBonus,
                            includeBonusInContributions:
                              job.includeBonusInContributions,
                            additionalFedWithholding:
                              job.additionalFedWithholding,
                            budgetPeriodsPerMonth:
                              job.budgetPeriodsPerMonth ?? undefined,
                            [field]: parsed,
                          });
                        },
                        onUpdateDeduction: (
                          id: number,
                          field: string,
                          value: string,
                        ) => {
                          // amountPerPeriod is the only deduction field a
                          // Contribution Profile can set as an active field
                          // (Part B scope) — route it through the same
                          // scenario-or-profile dispatcher contribution
                          // accounts already use. Structural fields
                          // (deductionName/isPretax/ficaExempt) stay on the
                          // old scenario-or-raw path — they're never
                          // profile-settable.
                          if (field === "amountPerPeriod") {
                            if (writeOverride("deductions", id, field, value))
                              return;
                          } else if (isInScenario) {
                            setScenarioOverride("deductions", id, field, value);
                            return;
                          }
                          const raw = (d.rawDeductions as RawDeduction[]).find(
                            (dd) => dd.id === id,
                          );
                          if (!raw) return;
                          updateDeduction.mutate({
                            id: raw.id,
                            jobId: raw.jobId,
                            deductionName: raw.deductionName,
                            amountPerPeriod: raw.amountPerPeriod,
                            isPretax: raw.isPretax,
                            ficaExempt: raw.ficaExempt,
                            [field]: value,
                          });
                        },
                        onUpdateContrib: (
                          id: number,
                          field: string,
                          value: string,
                        ) => {
                          // contributionValue/contributionMethod have no
                          // account-level fallback anymore — writeOverride is the
                          // ONLY path for them (scenario or profile active
                          // fields); there is nothing left for the direct-write
                          // fallback below to do with those two fields.
                          if (
                            writeOverride(
                              "contributionAccounts",
                              id,
                              field,
                              value,
                            )
                          )
                            return;
                          const raw = (d.rawContribs as RawContrib[]).find(
                            (cc) => cc.id === id,
                          );
                          if (!raw) return;
                          updateContrib.mutate({
                            id: raw.id,
                            personId: raw.personId,
                            accountType: raw.accountType,
                            taxTreatment: raw.taxTreatment as
                              "pre_tax" | "tax_free" | "after_tax" | "hsa",
                            employerMatchType: raw.employerMatchType as
                              | "none"
                              | "percent_of_contribution"
                              | "dollar_match"
                              | "fixed_annual",
                            isActive: raw.isActive,
                            [field]: value,
                          });
                        },
                        onCreateDeduction: isInScenario
                          ? undefined
                          : (data) => createDeduction.mutate(data),
                        onDeleteDeduction: async (id: number) => {
                          if (isInScenario) return; // Can't delete in scenario mode
                          if (await confirm("Remove this deduction?")) {
                            deleteDeduction.mutate({ id });
                          }
                        },
                        onToggleAutoMax: (
                          id: number,
                          value: boolean,
                          targetContribValue?: number,
                        ) => {
                          if (isInScenario) {
                            setScenarioOverride(
                              "contributionAccounts",
                              id,
                              "autoMaximize",
                              value,
                            );
                            return;
                          }
                          const raw = (d.rawContribs as RawContrib[]).find(
                            (cc) => cc.id === id,
                          );
                          if (!raw) return;
                          if (isProfileMode) {
                            // Set both autoMaximize and contributionValue in one profile update
                            if (!activeProfile) return;
                            const existing =
                              activeProfile.contributionActiveFields as Record<
                                string,
                                Record<string, Record<string, unknown>>
                              >;
                            const entityActiveFields = {
                              ...(existing.contributionAccounts ?? {}),
                            };
                            // An entry can carry just autoMaximize with no value —
                            // contributionValue/Method are only required together
                            // (see contribAccountActiveFieldsSchema), not whenever
                            // an entry exists at all. `raw` only appears here if
                            // this account already resolves under this profile, so
                            // if a real value exists it's already in `prior`.
                            const prior = entityActiveFields[String(id)] ?? {};
                            entityActiveFields[String(id)] = {
                              ...prior,
                              autoMaximize: value,
                              ...(value && targetContribValue != null
                                ? {
                                    contributionValue:
                                      String(targetContribValue),
                                    contributionMethod:
                                      prior.contributionMethod ??
                                      raw.contributionMethod,
                                  }
                                : {}),
                            };
                            updateProfile.mutate({
                              id: activeProfile.id,
                              contributionActiveFields: {
                                ...existing,
                                contributionAccounts: entityActiveFields,
                              } as typeof activeProfile.contributionActiveFields,
                            });
                            return;
                          }
                          // No profile loaded / no edit permission — autoMaximize
                          // itself is still a real account column, but there's no
                          // account-level contribution value left to also push to
                          // the target here (that only exists in profile mode).
                          updateContrib.mutate({
                            id: raw.id,
                            personId: raw.personId,
                            accountType: raw.accountType,
                            taxTreatment: raw.taxTreatment as
                              "pre_tax" | "tax_free" | "after_tax" | "hsa",
                            employerMatchType: raw.employerMatchType as
                              | "none"
                              | "percent_of_contribution"
                              | "dollar_match"
                              | "fixed_annual",
                            isActive: raw.isActive,
                            autoMaximize: value,
                          });
                        },
                        onDeleteContrib: isInScenario
                          ? undefined
                          : (id: number) => {
                              deleteContrib.mutate({ id });
                            },
                        onCreateContrib: isInScenario
                          ? undefined
                          : (data) => {
                              // A form linking into an existing (often inactive
                              // stub) contribution row carries its id — update
                              // that row instead of creating a duplicate.
                              const { id, ...rest } = data;
                              if (id != null) {
                                updateContrib.mutate({ id, ...rest });
                              } else {
                                createContrib.mutate(rest);
                              }
                            },
                        onUpdateInstitution: isInScenario
                          ? undefined
                          : (
                              id: number,
                              performanceAccountId: number | null,
                            ) => {
                              const raw = (d.rawContribs as RawContrib[]).find(
                                (cc) => cc.id === id,
                              );
                              if (!raw) return;
                              updateContrib.mutate({
                                id: raw.id,
                                personId: raw.personId,
                                accountType: raw.accountType,
                                taxTreatment: raw.taxTreatment as
                                  "pre_tax" | "tax_free" | "after_tax" | "hsa",
                                employerMatchType: raw.employerMatchType as
                                  | "none"
                                  | "percent_of_contribution"
                                  | "dollar_match"
                                  | "fixed_annual",
                                isActive: raw.isActive,
                                performanceAccountId,
                              });
                            },
                      },
                    }
              }
            />
          ))}
        </div>
      )}

      <ContributionSnapshot />
    </div>
  );
}
