"use client";

/** Paycheck gross-to-net calculator that breaks down taxes, deductions, and take-home pay. */

import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { useScenario } from "@/lib/context/scenario-context";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
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
  SalaryTracker,
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
    createSessionScenario,
    setActive,
    activeSelection,
    clearOverride,
    activeScenario: _activeScenario,
    deleteSessionScenario,
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
  const isProfileMode = canEditProfiles && activeProfile != null;

  const updateProfile = trpc.contributionProfile.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.contribution.invalidate();
      utils.contributionProfile.invalidate();
      utils.projection.invalidate();
    },
  });

  // Helper: update a field in the active profile's active fields
  function updateProfileActiveField(
    entityType: "contributionAccounts" | "jobs",
    entityId: number,
    field: string,
    value: unknown,
  ) {
    if (!activeProfile) return;
    const existing = activeProfile.contributionActiveFields as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const entityActiveFields = { ...(existing[entityType] ?? {}) };
    entityActiveFields[String(entityId)] = {
      ...(entityActiveFields[String(entityId)] ?? {}),
      [field]: value,
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
    entityType: "contributionAccounts" | "jobs",
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

  // Salary overrides from scenario context (used by all pages)
  const scenarioActiveSalaries = useActiveSalaries();

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
  const [salaryLocked, toggleSalaryLock] = useEditLock(
    EDIT_LOCK_KEYS.paycheckSalary,
  );
  /** Salary figures write to the profile (not the job) while this is true. */
  const salaryEditsProfile = isSalaryProfileMode && !salaryLocked;

  const updateSalaryProfile = trpc.salaryProfile.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.salaryProfile.invalidate();
      utils.contribution.invalidate();
      utils.budget.invalidate();
      utils.projection.invalidate();
    },
  });

  /**
   * Whether this person's SALARY is pinned by the displayed Salary Profile.
   * Only then does a salary edit belong to the profile — an unpinned
   * person's salary lives on their job record, so editing it has to write
   * through to the normal job path (which carries its own, stricter
   * permission gate) rather than being captured into the profile's jsonb.
   *
   * Note this asks about the `salary` field specifically, not about the
   * person having an entry: someone whose profile entry pins only bonus
   * terms still has a live salary that must not be captured here.
   */
  function salaryIsFixedInProfile(personId: number): boolean {
    return (
      displayedSalaryProfile?.salaries[String(personId)]?.salary !== undefined
    );
  }

  /** Pin one person's salary in the displayed Salary Profile, leaving any
   *  bonus terms they have pinned untouched. */
  function writeSalaryProfileFixed(personId: number, salary: number) {
    if (!displayedSalaryProfile) return;
    updateSalaryProfile.mutate({
      id: displayedSalaryProfile.id,
      salaries: {
        ...displayedSalaryProfile.salaries,
        [String(personId)]: {
          ...(displayedSalaryProfile.salaries[String(personId)] ?? {}),
          salary,
        },
      },
    });
  }

  // One shared derivation for the whole page — the same hook the Budget
  // page's What-If tab uses (with honorSessionScenario:false there). Session
  // scenario overrides apply here, which is today's behavior.
  const {
    views,
    isLoading,
    error,
    sharedContribGroupOrder,
    salaryActiveFields: scenarioSalaryOverridesApplied,
  } = usePaycheckPersonViews({
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
  const upsertBonusOverride =
    trpc.settings.jobs.bonusOverrides.upsert.useMutation({
      onSuccess: () => {
        utils.paycheck.invalidate();
        utils.contribution.invalidate();
      },
    });
  const deleteBonusOverride =
    trpc.settings.jobs.bonusOverrides.deleteByJobYear.useMutation({
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

  // Track the session scenario ID created by salary toggle so we can clean it up
  // (must be before early returns to satisfy React hooks rules)
  const salaryScenarioRef = React.useRef<string | null>(null);

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

  const toggleSalaryOverride = (personId: number, salary: number) => {
    // Check if this salary is already active in the scenario
    const currentOverride = scenarioActiveSalaries.find(
      (o) => o.personId === personId,
    );
    const isCurrentlyActive = currentOverride?.salary === salary;

    if (isCurrentlyActive) {
      // Deactivate: clear this person's salary override from the scenario
      clearOverride("people", personId, "salary");
      // If no more salary overrides remain, clean up the scenario
      const remaining = scenarioActiveSalaries.filter(
        (o) => o.personId !== personId,
      );
      if (
        remaining.length === 0 &&
        salaryScenarioRef.current &&
        activeSelection.type === "session"
      ) {
        deleteSessionScenario(salaryScenarioRef.current);
        salaryScenarioRef.current = null;
      }
    } else {
      if (!isInScenario) {
        // Create scenario with salary override already baked in
        const initialOverrides = {
          people: { [String(personId)]: { salary } },
        };
        const scenarioId = createSessionScenario(
          "Upcoming Salary Preview",
          initialOverrides,
        );
        salaryScenarioRef.current = scenarioId;
        setActive({ type: "session", id: scenarioId });
      } else {
        // Already in a scenario — just add/update the override
        setScenarioOverride("people", personId, "salary", salary);
      }
    }
  };

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
            {isSalaryProfileMode && (
              <>
                <EditLockToggle
                  locked={salaryLocked}
                  onToggle={toggleSalaryLock}
                  disabled={!canEditProfiles}
                />
                {!salaryLocked && (
                  <span className="text-caption text-amber-600 font-medium">
                    Fixed-amount salaries update this profile
                  </span>
                )}
              </>
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
            {isProfileMode && (
              <span className="text-caption text-amber-600 font-medium">
                Edits update profile
              </span>
            )}
          </div>
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
              paycheck={d.paycheck}
              mode={mode}
              blendedAnnual={d.blendedAnnual}
              // The padlock guards edits that would land in the Salary
              // Profile — i.e. only people this profile pins at a fixed
              // amount. A "follows job" person's salary edits their job
              // record, which was never padlocked here.
              salaryReadOnly={
                isSalaryProfileMode &&
                salaryLocked &&
                salaryIsFixedInProfile(d.person.id)
              }
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
              // Salary history creates/deletes real salary_changes rows, so
              // it is a slot the live page fills — a sandbox simply doesn't
              // pass it (see PersonPaycheckInteraction's docblock).
              salaryHistorySlot={
                <SalaryTracker
                  jobId={d.job.id}
                  activeSalaryOverride={
                    scenarioSalaryOverridesApplied.find(
                      (o) => o.personId === d.person.id,
                    )?.salary ?? null
                  }
                  onToggleSalary={(salary) =>
                    toggleSalaryOverride(d.person.id, salary)
                  }
                />
              }
              interaction={{
                kind: "live",
                handlers: {
                  onUpdateJob: (field: string, value: string) => {
                    const job = d.job!;
                    const boolFields = [
                      "include401kInBonus",
                      "w4Box2cChecked",
                      "includeBonusInContributions",
                    ];
                    const nullableIntFields = ["bonusMonth", "bonusDayOfMonth"];
                    const nullableDecimalFields = ["budgetPeriodsPerMonth"];
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
                    // Salary-profile mode: the salary figure belongs to the
                    // Salary Profile being viewed ONLY when this person's entry
                    // is a fixed amount. A "follows job" person falls through to
                    // the direct job write below — same target, and same
                    // permission gate, as editing their salary outside profile
                    // mode, so the lighter profile-CRUD gate can't become a back
                    // door into jobs/salary_changes.
                    if (
                      field === "annualSalary" &&
                      salaryEditsProfile &&
                      salaryIsFixedInProfile(job.personId)
                    ) {
                      const num = Number(value);
                      if (!isNaN(num) && num > 0) {
                        writeSalaryProfileFixed(job.personId, num);
                      }
                      return;
                    }
                    // The bonus override is year-scoped (job_bonus_overrides),
                    // not a job column — persist it directly rather than routing
                    // through updateJob or a per-profile "job override" (there's
                    // no year concept in the profile-override JSON blob, so it
                    // can't express "this year only" correctly).
                    if (field === "bonusOverride") {
                      if (value === "") {
                        deleteBonusOverride.mutate({
                          jobId: job.id,
                          year: currentYear,
                        });
                      } else {
                        upsertBonusOverride.mutate({
                          jobId: job.id,
                          year: currentYear,
                          overrideAmount: value,
                        });
                      }
                      return;
                    }
                    // Profile mode: bonus fields go to profile overrides
                    const bonusFields = [
                      "bonusPercent",
                      "bonusMultiplier",
                      "bonusMonth",
                      "bonusDayOfMonth",
                      "monthsInBonusYear",
                      "include401kInBonus",
                      "includeBonusInContributions",
                    ];
                    if (isProfileMode && bonusFields.includes(field)) {
                      updateProfileActiveField("jobs", job.id, field, parsed);
                      return;
                    }
                    updateJob.mutate({
                      id: job.id,
                      personId: job.personId,
                      employerName: job.employerName,
                      annualSalary: job.annualSalary,
                      payPeriod: job.payPeriod,
                      payWeek: job.payWeek,
                      startDate: job.startDate,
                      anchorPayDate: job.anchorPayDate ?? undefined,
                      w4FilingStatus: job.w4FilingStatus,
                      w4Box2cChecked: job.w4Box2cChecked,
                      bonusPercent: job.bonusPercent,
                      bonusMultiplier: job.bonusMultiplier,
                      bonusMonth: job.bonusMonth ?? undefined,
                      bonusDayOfMonth: job.bonusDayOfMonth ?? undefined,
                      monthsInBonusYear: job.monthsInBonusYear,
                      include401kInBonus: job.include401kInBonus,
                      includeBonusInContributions:
                        job.includeBonusInContributions,
                      additionalFedWithholding: job.additionalFedWithholding,
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
                    if (isInScenario) {
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
                    if (writeOverride("contributionAccounts", id, field, value))
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
                      contributionMethod: raw.contributionMethod as
                        | "percent_of_salary"
                        | "fixed_per_period"
                        | "fixed_monthly"
                        | "fixed_annual",
                      contributionValue: raw.contributionValue,
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
                      entityActiveFields[String(id)] = {
                        ...(entityActiveFields[String(id)] ?? {}),
                        autoMaximize: value,
                        ...(value && targetContribValue != null
                          ? { contributionValue: String(targetContribValue) }
                          : {}),
                      };
                      updateProfile.mutate({
                        id: activeProfile.id,
                        contributionActiveFields: {
                          ...existing,
                          contributionAccounts: entityActiveFields,
                        },
                      });
                      return;
                    }
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
                      contributionMethod: raw.contributionMethod as
                        | "percent_of_salary"
                        | "fixed_per_period"
                        | "fixed_annual",
                      contributionValue:
                        value && targetContribValue != null
                          ? String(targetContribValue)
                          : raw.contributionValue,
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
                    : (data) => createContrib.mutate(data),
                },
              }}
            />
          ))}
        </div>
      )}

      <ContributionSnapshot />
    </div>
  );
}
