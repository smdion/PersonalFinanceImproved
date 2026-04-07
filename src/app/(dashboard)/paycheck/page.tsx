"use client";

/** Paycheck gross-to-net calculator that breaks down taxes, deductions, and take-home pay. */

import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { useScenario } from "@/lib/context/scenario-context";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useUser, hasPermission } from "@/lib/context/user-context";
import { ScenarioBanner } from "@/components/ui/scenario-indicator";
import { EmptyState } from "@/components/ui/empty-state";
import { confirm } from "@/components/ui/confirm-dialog";
import {
  PersonPaycheck,
  ContributionSnapshot,
  alignDeductionRows,
  type RawDeduction,
  type RawContrib,
} from "@/components/paycheck";
import {
  getLimitGroup as configGetLimitGroup,
  getAccountTypeConfig,
  categoriesWithIrsLimit,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

export default function PaycheckPage() {
  const user = useUser();
  const canEditProfiles = hasPermission(user, "contributionProfile");
  const {
    viewMode: mode,
    isInScenario,
    getOverride,
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
  const setTaxYearOverride = (yr: number | undefined) =>
    setTaxYearSetting(yr ?? null);
  const [contribProfileId] = useActiveContribProfile();
  const utils = trpc.useUtils();

  // Contribution profile state
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();
  const contribProfiles = contribProfilesQuery.data ?? [];

  // Local viewing state — defaults to global active, but can view others without activating
  const [viewingContribId, setViewingContribId] = useState<number | null>(null);
  const displayContribId = viewingContribId ?? contribProfileId;

  const viewingProfileQuery = trpc.contributionProfile.getById.useQuery(
    { id: displayContribId! },
    { enabled: displayContribId != null },
  );
  const activeProfile = viewingProfileQuery.data;
  const isProfileMode =
    canEditProfiles && activeProfile != null && !activeProfile.isDefault;

  const updateProfile = trpc.contributionProfile.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.contribution.invalidate();
      utils.contributionProfile.invalidate();
      utils.projection.invalidate();
    },
  });

  // Helper: update a field in the active profile's overrides
  function updateProfileOverride(
    entityType: "contributionAccounts" | "jobs",
    entityId: number,
    field: string,
    value: unknown,
  ) {
    if (!activeProfile) return;
    const existing = activeProfile.contributionOverrides as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const entityOverrides = { ...(existing[entityType] ?? {}) };
    entityOverrides[String(entityId)] = {
      ...(entityOverrides[String(entityId)] ?? {}),
      [field]: value,
    };
    updateProfile.mutate({
      id: activeProfile.id,
      contributionOverrides: { ...existing, [entityType]: entityOverrides },
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
      updateProfileOverride(entityType, entityId, field, value);
      return true;
    }
    return false;
  }

  // Salary overrides from scenario context (used by all pages)
  const scenarioSalaryOverrides = useSalaryOverrides();

  const queryInput = {
    ...(scenarioSalaryOverrides.length > 0
      ? { salaryOverrides: scenarioSalaryOverrides }
      : {}),
    ...(taxYearOverride ? { taxYearOverride } : {}),
    ...(displayContribId != null
      ? { contributionProfileId: displayContribId }
      : {}),
  };
  const {
    data: rawData,
    isLoading,
    error,
  } = trpc.paycheck.computeSummary.useQuery(
    Object.keys(queryInput).length > 0 ? queryInput : undefined,
    { placeholderData: (prev) => prev },
  );

  // Apply scenario overrides to the query data
  const data = (() => {
    if (!rawData || !isInScenario) return rawData?.people;
    return rawData.people.map((d) => {
      if (!d.job) return d;
      // Override job fields
      const job = { ...d.job };
      const jobId = String(job.id);
      for (const field of [
        "annualSalary",
        "bonusPercent",
        "bonusMultiplier",
        "bonusOverride",
        "payPeriod",
        "payWeek",
        "w4FilingStatus",
        "anchorPayDate",
        "additionalFedWithholding",
      ] as const) {
        const override = getOverride("jobs", jobId, field, undefined);
        if (override !== undefined) {
          (job as Record<string, unknown>)[field] = override;
        }
      }
      // Override boolean job fields
      for (const field of [
        "include401kInBonus",
        "w4Box2cChecked",
        "includeBonusInContributions",
      ] as const) {
        const override = getOverride("jobs", jobId, field, undefined);
        if (override !== undefined) {
          (job as Record<string, unknown>)[field] = override;
        }
      }

      // Override raw deduction fields
      const rawDeductions = (d.rawDeductions as RawDeduction[]).map((ded) => {
        const dedId = String(ded.id);
        const amountOverride = getOverride(
          "deductions",
          dedId,
          "amountPerPeriod",
          undefined,
        );
        if (amountOverride !== undefined) {
          return { ...ded, amountPerPeriod: amountOverride as string };
        }
        return ded;
      });

      // Override raw contribution fields
      const rawContribs = (d.rawContribs as RawContrib[]).map((c) => {
        const cId = String(c.id);
        const contrib = { ...c };
        for (const field of [
          "contributionValue",
          "contributionMethod",
          "employerMatchType",
          "employerMatchValue",
          "employerMaxMatchPct",
          "autoMaximize",
        ] as const) {
          const override = getOverride(
            "contributionAccounts",
            cId,
            field,
            undefined,
          );
          if (override !== undefined) {
            (contrib as Record<string, unknown>)[field] = override;
          }
        }
        return contrib;
      });

      // Override salary if scenario has a job salary override
      const salaryOverride = getOverride(
        "jobs",
        jobId,
        "annualSalary",
        undefined,
      );
      const salary =
        salaryOverride !== undefined ? Number(salaryOverride) : d.salary;

      return { ...d, job, rawDeductions, rawContribs, salary };
    });
  })();

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

  const people = data?.filter((d) => d.paycheck && d.job) ?? [];

  const toggleSalaryOverride = (personId: number, salary: number) => {
    // Check if this salary is already active in the scenario
    const currentOverride = scenarioSalaryOverrides.find(
      (o) => o.personId === personId,
    );
    const isCurrentlyActive = currentOverride?.salary === salary;

    if (isCurrentlyActive) {
      // Deactivate: clear this person's salary override from the scenario
      clearOverride("people", personId, "salary");
      // If no more salary overrides remain, clean up the scenario
      const remaining = scenarioSalaryOverrides.filter(
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

  // Build aligned deduction rows and HSA family notes when we have exactly 2 people
  const alignedData = (() => {
    if (people.length !== 2) return null;

    const [p0, p1] = people;
    if (!p0?.paycheck || !p1?.paycheck) return null;

    const d0 = p0.rawDeductions as RawDeduction[];
    const d1 = p1.rawDeductions as RawDeduction[];

    const preTaxAligned = alignDeductionRows(
      p0.paycheck.preTaxDeductions,
      d0,
      p1.paycheck.preTaxDeductions,
      d1,
      p0.job!.id,
      p1.job!.id,
    );
    const postTaxAligned = alignDeductionRows(
      p0.paycheck.postTaxDeductions,
      d0,
      p1.paycheck.postTaxDeductions,
      d1,
      p0.job!.id,
      p1.job!.id,
    );

    // Coverage variant detection: find categories where one person covers the household
    // (e.g., HSA family plan — one person's family HSA covers the other)
    const c0 = p0.rawContribs as RawContrib[];
    const c1 = p1.rawContribs as RawContrib[];

    // Find categories with a coverage variant (e.g., HSA has family vs individual)
    const coverageVariantCategories = categoriesWithIrsLimit().filter(
      (cat) => getAccountTypeConfig(cat).irsLimitKeys?.coverageVariant != null,
    );

    // For each such category, check if one person has family coverage and the other has none
    type CoverageNote = { note: string; group: string } | undefined;
    let coverageNote0: CoverageNote;
    let coverageNote1: CoverageNote;

    for (const cat of coverageVariantCategories) {
      const cfg = getAccountTypeConfig(cat);
      const group = cfg.irsLimitGroup ?? cat;
      const label = cfg.displayLabel;

      const p0Family = c0.find(
        (c) => c.accountType === cat && c.hsaCoverageType === "family",
      );
      const p1Family = c1.find(
        (c) => c.accountType === cat && c.hsaCoverageType === "family",
      );
      const p0Has = c0.some((c) => c.accountType === cat);
      const p1Has = c1.some((c) => c.accountType === cat);

      if (p1Family && !p0Has) {
        coverageNote0 = {
          note: `${label} (Family — via ${p1.person.name})`,
          group,
        };
      }
      if (p0Family && !p1Has) {
        coverageNote1 = {
          note: `${label} (Family — via ${p0.person.name})`,
          group,
        };
      }
    }

    return {
      preTax: [preTaxAligned.left, preTaxAligned.right] as const,
      postTax: [postTaxAligned.left, postTaxAligned.right] as const,
      coverageNotes: [coverageNote0, coverageNote1] as const,
    };
  })();

  // Compute shared contribution group order across all people so they align
  // Include both individual and joint accounts
  const sharedContribGroupOrder = (() => {
    const getLimitGroup = (type: string): string | null => {
      return configGetLimitGroup(type as AccountCategory);
    };
    const getGroupKey = (type: string) => getLimitGroup(type) ?? type;
    const order: string[] = [];
    for (const d of people) {
      for (const c of d.rawContribs as RawContrib[]) {
        const key = getGroupKey(c.accountType);
        if (!order.includes(key)) order.push(key);
      }
    }
    // Include joint account types
    for (const jc of rawData?.jointContribs ?? []) {
      const key = getGroupKey(jc.accountType);
      if (!order.includes(key)) order.push(key);
    }
    return order;
  })();

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
                {availableYears.map((yr) => (
                  <button
                    key={yr}
                    onClick={() =>
                      setTaxYearOverride(yr === currentYear ? undefined : yr)
                    }
                    className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                      (taxYearOverride ?? currentYear) === yr
                        ? "bg-blue-600 text-white"
                        : "bg-surface-elevated text-muted hover:bg-surface-strong"
                    }`}
                  >
                    {yr}
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
        {contribProfiles.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Profile:</span>
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
                  {!p.name.includes("(Live)") && p.isDefault ? " (Live)" : ""}
                </option>
              ))}
            </select>
            {displayContribId !== contribProfileId && (
              <span className="text-[10px] text-muted font-medium">
                (viewing — not active)
              </span>
            )}
            {isProfileMode && (
              <span className="text-[10px] text-amber-600 font-medium">
                Edits update profile
              </span>
            )}
          </div>
        )}
      </PageHeader>

      {people.length === 0 ? (
        <EmptyState
          message="No active jobs found."
          hint="Add jobs on the Historical page to see paycheck breakdowns."
        />
      ) : (
        <div
          className={`grid grid-cols-1 ${people.length > 1 ? "lg:grid-cols-2" : ""} gap-6 grid-rows-[auto_auto_auto]`}
        >
          {people.map((d, idx) => (
            <PersonPaycheck
              key={d.person.id}
              person={d.person}
              job={d.job!}
              salary={d.salary}
              futureSalaryChanges={d.futureSalaryChanges}
              paycheck={d.paycheck!}
              mode={mode}
              blendedAnnual={
                (d as Record<string, unknown>).blendedAnnual as
                  | import("@/lib/calculators/types/calculators").BlendedAnnualTotals
                  | undefined
              }
              activeSalaryOverride={
                scenarioSalaryOverrides.find((o) => o.personId === d.person.id)
                  ?.salary ?? null
              }
              onToggleSalary={(salary) =>
                toggleSalaryOverride(d.person.id, salary)
              }
              rawDeductions={d.rawDeductions as RawDeduction[]}
              rawContribs={d.rawContribs as RawContrib[]}
              alignedPreTax={alignedData?.preTax[idx as 0 | 1]}
              alignedPostTax={alignedData?.postTax[idx as 0 | 1]}
              coverageNote={alignedData?.coverageNotes[idx as 0 | 1]?.note}
              coverageNoteGroup={
                alignedData?.coverageNotes[idx as 0 | 1]?.group
              }
              otherJointContribs={(rawData?.jointContribs ?? []).map((c) => ({
                id: c.id,
                accountType:
                  c.accountType as import("@/lib/config/account-types").AccountCategory,
                subType: c.subType ?? null,
                label: c.label ?? null,
                contributionValue: c.contributionValue ?? "0",
                contributionMethod: c.contributionMethod,
                taxTreatment: c.taxTreatment,
                ownerName: "Joint",
              }))}
              onUpdateJob={(field, value) => {
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
                // Profile mode: bonus fields go to profile overrides
                const bonusFields = [
                  "bonusPercent",
                  "bonusMultiplier",
                  "bonusOverride",
                  "bonusMonth",
                  "bonusDayOfMonth",
                  "monthsInBonusYear",
                  "include401kInBonus",
                  "includeBonusInContributions",
                ];
                if (isProfileMode && bonusFields.includes(field)) {
                  updateProfileOverride("jobs", job.id, field, parsed);
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
                  bonusOverride: job.bonusOverride ?? undefined,
                  bonusMonth: job.bonusMonth ?? undefined,
                  bonusDayOfMonth: job.bonusDayOfMonth ?? undefined,
                  monthsInBonusYear: job.monthsInBonusYear,
                  include401kInBonus: job.include401kInBonus,
                  includeBonusInContributions: job.includeBonusInContributions,
                  additionalFedWithholding: job.additionalFedWithholding,
                  budgetPeriodsPerMonth: job.budgetPeriodsPerMonth ?? undefined,
                  [field]: parsed,
                });
              }}
              onUpdateDeduction={(id, field, value) => {
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
              }}
              onUpdateContrib={(id, field, value) => {
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
                    | "pre_tax"
                    | "tax_free"
                    | "after_tax"
                    | "hsa",
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
              }}
              onCreateDeduction={
                isInScenario
                  ? undefined
                  : (data) => createDeduction.mutate(data)
              }
              onDeleteDeduction={async (id) => {
                if (isInScenario) return; // Can't delete in scenario mode
                if (await confirm("Remove this deduction?")) {
                  deleteDeduction.mutate({ id });
                }
              }}
              onToggleAutoMax={(id, value, targetContribValue) => {
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
                    activeProfile.contributionOverrides as Record<
                      string,
                      Record<string, Record<string, unknown>>
                    >;
                  const entityOverrides = {
                    ...(existing.contributionAccounts ?? {}),
                  };
                  entityOverrides[String(id)] = {
                    ...(entityOverrides[String(id)] ?? {}),
                    autoMaximize: value,
                    ...(value && targetContribValue != null
                      ? { contributionValue: String(targetContribValue) }
                      : {}),
                  };
                  updateProfile.mutate({
                    id: activeProfile.id,
                    contributionOverrides: {
                      ...existing,
                      contributionAccounts: entityOverrides,
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
                    | "pre_tax"
                    | "tax_free"
                    | "after_tax"
                    | "hsa",
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
              }}
              onDeleteContrib={
                isInScenario
                  ? undefined
                  : (id) => {
                      deleteContrib.mutate({ id });
                    }
              }
              onCreateContrib={
                isInScenario ? undefined : (data) => createContrib.mutate(data)
              }
              contribExpanded={contribExpanded}
              onToggleContrib={() => setContribExpanded((prev) => !prev)}
              sharedGroupOrder={sharedContribGroupOrder}
            />
          ))}
        </div>
      )}

      <ContributionSnapshot />
    </div>
  );
}
