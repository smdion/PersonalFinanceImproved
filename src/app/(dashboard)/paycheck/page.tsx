"use client";

/** Paycheck gross-to-net calculator that breaks down taxes, deductions, and take-home pay. */

import { DEDUCTION_PRESETS } from "@/lib/config/paycheck-presets";
import React, { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/page-header";
import { useScenario } from "@/lib/context/scenario-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useUser, hasPermission, isAdmin } from "@/lib/context/user-context";
import {
  resolvePaycheckEditTarget,
  type PaycheckFieldKind,
} from "@/lib/pure/paycheck-edit-target";
import {
  contributionAccountFieldKind,
  deductionFieldKind,
} from "@/lib/db/profile-fields";
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
import type {
  PayPeriod,
  PayWeek,
  W4FilingStatus,
} from "@/lib/config/enum-values";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";

export default function PaycheckPage() {
  const user = useUser();
  const canEditProfiles = hasPermission(user, "contributionProfile");
  const { viewMode: mode } = useScenario();
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

  // This page shows and edits the active profiles — switch them in the
  // header. (Each profile is its own world; there is no "viewing another
  // one" here, so what you edit is always what the rest of the app uses.)
  const displayContribId = contribProfileId;

  const viewingProfileQuery = trpc.contributionProfile.getById.useQuery(
    { id: displayContribId! },
    { enabled: displayContribId != null },
  );
  const activeProfile = viewingProfileQuery.data;

  const invalidateProfileWrite = () => {
    utils.paycheck.invalidate();
    utils.contribution.invalidate();
    utils.contributionProfile.invalidate();
    utils.projection.invalidate();
  };
  // Field-level patch procedures — a transactional read-merge-write of one
  // sub-entry off the freshest profile row. NOT `contributionProfile.update`
  // with a client-rebuilt blob: that rebuild reads from a `getById` snapshot
  // that goes stale the instant an invalidation (e.g. a profile rename)
  // fires, and PUTting the whole `contributionActiveFields` column back then
  // silently wipes every entry the snapshot didn't have. Same clobber class
  // contribution-profile-manager.tsx already moved off (see its patchAccount
  // comment) — this page was the last caller still doing it the old way.
  const setAccountFields =
    trpc.contributionProfile.setAccountActiveFields.useMutation({
      onSuccess: invalidateProfileWrite,
    });
  const setDeductionFields =
    trpc.contributionProfile.setDeductionActiveFields.useMutation({
      onSuccess: invalidateProfileWrite,
    });

  // Helper: patch one or more fields on one entry in the active profile's
  // active fields. The multi-field form exists for entity kinds whose write
  // schema requires certain fields to be set together (or none) — a caller
  // editing an independent field can keep passing a single field/value pair.
  // A field whose value is `undefined` is unset (removed) rather than
  // written. There is no more "jobs" entity kind here: that active-fields
  // bucket (payPeriod/payWeek/anchorPayDate, W-4, bonus timing/flags) was
  // retired in the Stage B migration — those 11 fields now live on the
  // Salary Profile entry instead (see writeSalaryProfileEntry above).
  function updateProfileActiveField(
    entityType: "contributionAccounts" | "deductions",
    entityId: number,
    fieldOrFields: string | Record<string, unknown>,
    value?: unknown,
  ) {
    if (!activeProfile) return;
    const patch =
      typeof fieldOrFields === "string"
        ? { [fieldOrFields]: value }
        : fieldOrFields;
    const fields: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) unset.push(k);
      else fields[k] = v;
    }
    if (entityType === "contributionAccounts") {
      setAccountFields.mutate({
        profileId: activeProfile.id,
        accountId: entityId,
        fields,
        unset: unset.length ? unset : undefined,
      });
    } else {
      setDeductionFields.mutate({
        profileId: activeProfile.id,
        deductionId: entityId,
        fields,
        unset: unset.length ? unset : undefined,
      });
    }
  }

  // Independent Salary Profile axis — the active one, same as above.
  const salaryProfilesQuery = trpc.salaryProfile.list.useQuery();
  const salaryProfiles = salaryProfilesQuery.data ?? [];
  // Always a real row id post-migration — useActiveSalaryProfile repairs the
  // setting if the row it names ever disappears.
  const [displaySalaryId] = useActiveSalaryProfile();
  const displayedSalaryProfile = salaryProfiles.find(
    (p) => p.id === displaySalaryId,
  );
  // Where each kind of edit saves — one rule for the write and its label
  // (lib/pure/paycheck-edit-target.ts).
  const editContext = {
    locked: profileLocked,
    canEditProfiles,
    canEditSetup: isAdmin(user),
    salaryProfileName: displayedSalaryProfile?.name ?? null,
    contributionProfileName: activeProfile?.name ?? null,
  };
  const editTarget = (kind: PaycheckFieldKind) =>
    resolvePaycheckEditTarget(kind, editContext);
  const salaryEditsProfile = editTarget("salary").target === "salaryProfile";
  const contribEditsProfile =
    editTarget("contribution").target === "contributionProfile";

  const updateSalaryProfile = trpc.salaryProfile.update.useMutation({
    onSuccess: () => {
      utils.paycheck.invalidate();
      utils.salaryProfile.invalidate();
      utils.contribution.invalidate();
      utils.budget.invalidate();
      utils.projection.invalidate();
    },
  });

  /** Mirrors SalaryProfileEntry (server/helpers/salary.ts) by hand —
   *  components may not import server modules. Must stay in sync with it
   *  and with salaryEntrySchema. */
  type CompleteSalaryEntry = {
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
    /** Not editable from this page — preserved as-is (or defaulted to
     *  "not configured" for a brand-new entry) whenever a Paycheck-page
     *  field write creates/updates this job's entry. Edited from Salary
     *  Profile Manager instead (see extra-paycheck-rules-editor.tsx). */
    extraPaycheckRouting: ExtraPaycheckRoutingData | null;
    otherEarnings?: Record<string, number>;
  };

  /**
   * Merge a field edit into this job's entry in the displayed Salary
   * Profile. Entries are complete/all-or-nothing (no partial pins) — the
   * first edit to a job that has no entry yet creates one, defaulting
   * every untouched field to `defaults` (that job's currently-resolved
   * values), so the write is always a full 16-field entry.
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
  // page's What-If tab uses.
  const { views, isLoading, error, sharedContribGroupOrder } =
    usePaycheckPersonViews({
      contributionProfileId: displayContribId,
      salaryProfileId: displaySalaryId,
      taxYearOverride,
    });

  // Get available tax years for the toggle. Sourced from contribution_limits
  // alone, matching resolveTaxParams' candidateYears() — that's the only
  // table `requireLimit()` reads, so it's the only one that can make a year
  // safely selectable. Including tax_brackets here would let an admin's
  // early bracket-only seed for a future year surface a picker option that
  // then throws when selected.
  const { data: contribLimitsAll } =
    trpc.settings.contributionLimits.list.useQuery();
  const availableYears = (() => {
    const yrs = new Set<number>();
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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <SkeletonChart height={384} />
          <SkeletonChart height={384} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">
        Failed to load paycheck data: {error.message}
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title="Paycheck"
        subtitle={
          availableYears.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs">Tax Year:</span>
              <div className="flex gap-1">
                {availableYears.map((year) => (
                  <button
                    key={year}
                    onClick={() =>
                      setTaxYearOverride(
                        year === currentYear ? undefined : year,
                      )
                    }
                    className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
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
                <span className="text-xs font-medium text-amber-600">
                  Comparing {taxYearOverride} tables
                </span>
              )}
            </div>
          ) : undefined
        }
      >
        {(displayedSalaryProfile || activeProfile) && (
          <span className="text-muted text-xs">
            Showing{" "}
            {[
              displayedSalaryProfile &&
                `Salary Profile “${displayedSalaryProfile.name}”`,
              activeProfile && `Contribution Profile “${activeProfile.name}”`,
            ]
              .filter(Boolean)
              .join(" and ")}
          </span>
        )}
        <EditLockToggle
          locked={profileLocked}
          onToggle={toggleProfileLock}
          disabled={!canEditProfiles && !isAdmin(user)}
        />
      </PageHeader>

      {views.length === 0 ? (
        <EmptyState
          message="No active jobs found."
          hint="Add jobs on the Historical page to see paycheck breakdowns."
        />
      ) : (
        <div
          className={`grid grid-cols-1 ${views.length > 1 ? "lg:grid-cols-2" : ""} grid-rows-[auto_auto_auto] gap-6`}
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
              // active Salary Profile (see editTarget).
              salaryReadOnly={!salaryEditsProfile}
              contribValueReadOnly={!contribEditsProfile}
              // Only while editing — locked, the padlock already says "View
              // only" and a note under every section is just noise.
              editLabels={
                profileLocked
                  ? undefined
                  : {
                      salary: editTarget("salary").label,
                      contribution: editTarget("contribution").label,
                      setup: editTarget("setup").label,
                    }
              }
              rawDeductions={d.rawDeductions}
              rawContribs={d.rawContribs}
              perContribData={d.perContribData}
              incompleteAccountIds={d.incompleteAccountIds}
              earningRows={d.earningRows}
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
                          const decimalFields = ["additionalFedWithholding"];
                          const parsed = boolFields.includes(field)
                            ? value === "true"
                            : nullableIntFields.includes(field)
                              ? value === ""
                                ? null
                                : Number(value)
                              : nullableDecimalFields.includes(field)
                                ? value === ""
                                  ? null
                                  : Number(value)
                                : decimalFields.includes(field)
                                  ? Number(value)
                                  : value;
                          // A job has no salary, bonus, pay-schedule, or W-4
                          // terms of its own any more — every edit to any of
                          // those lands in the displayed Salary Profile as
                          // part of that job's complete 16-field entry (see
                          // resolveCompensation/SalaryProfileEntry in
                          // server/helpers/salary.ts). Untouched fields
                          // default to this job's currently-resolved values.
                          const salaryProfileEntryDefaults: CompleteSalaryEntry =
                            {
                              salary: d.salary,
                              ...d.resolvedBonusTerms,
                              payPeriod: job.payPeriod,
                              payWeek: job.payWeek,
                              anchorPayDate: job.anchorPayDate ?? null,
                              budgetPeriodsPerMonth:
                                job.budgetPeriodsPerMonth != null
                                  ? Number(job.budgetPeriodsPerMonth)
                                  : null,
                              w4FilingStatus: job.w4FilingStatus,
                              w4Box2cChecked: job.w4Box2cChecked,
                              additionalFedWithholding: Number(
                                job.additionalFedWithholding,
                              ),
                              bonusMonth: job.bonusMonth ?? null,
                              bonusDayOfMonth: job.bonusDayOfMonth ?? null,
                              include401kInBonus: job.include401kInBonus,
                              includeBonusInContributions:
                                job.includeBonusInContributions,
                              extraPaycheckRouting: null,
                            };
                          // An other-pay line's amount per check — saved in
                          // the Salary Profile entry's otherEarnings map.
                          if (field.startsWith("otherEarnings:")) {
                            const num = Number(value);
                            if (!Number.isFinite(num) || num < 0) return;
                            if (!salaryEditsProfile) return;
                            const current = Object.fromEntries(
                              d.earningRows.map((r) => [
                                String(r.id),
                                r.amount,
                              ]),
                            );
                            writeSalaryProfileEntry(
                              job.id,
                              salaryProfileEntryDefaults,
                              {
                                otherEarnings: {
                                  ...current,
                                  [field.slice("otherEarnings:".length)]: num,
                                },
                              },
                            );
                            return;
                          }
                          if (field === "annualSalary") {
                            const num = Number(value);
                            if (isNaN(num) || num <= 0) return;
                            if (!salaryEditsProfile) return;
                            writeSalaryProfileEntry(
                              job.id,
                              salaryProfileEntryDefaults,
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
                                salaryProfileEntryDefaults,
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
                                salaryProfileEntryDefaults,
                                {
                                  bonusOverride:
                                    value === "" ? null : Number(value),
                                },
                              );
                            }
                            return;
                          }
                          // The remaining 11 fields — pay schedule, W-4, and
                          // the bonus-timing/contribution-flag fields — all
                          // moved onto this same Salary Profile entry in the
                          // Stage B migration. There is no more Contribution
                          // Profile "jobs" active-fields bucket (retired
                          // entirely) and no more raw job columns for any of
                          // them; the ONLY write path left is the displayed
                          // Salary Profile, same as salary/bonus above.
                          const salaryProfileNewFields: (keyof CompleteSalaryEntry)[] =
                            [
                              "payPeriod",
                              "payWeek",
                              "anchorPayDate",
                              "budgetPeriodsPerMonth",
                              "w4FilingStatus",
                              "w4Box2cChecked",
                              "additionalFedWithholding",
                              "bonusMonth",
                              "bonusDayOfMonth",
                              "include401kInBonus",
                              "includeBonusInContributions",
                            ];
                          if (
                            salaryProfileNewFields.includes(
                              field as keyof CompleteSalaryEntry,
                            )
                          ) {
                            if (salaryEditsProfile) {
                              writeSalaryProfileEntry(
                                job.id,
                                salaryProfileEntryDefaults,
                                {
                                  [field]: parsed,
                                } as Partial<CompleteSalaryEntry>,
                              );
                            }
                            return;
                          }
                          // Only real job columns left: employerName and
                          // title (jobs.update's trimmed schema — see
                          // settings/paycheck.ts).
                          updateJob.mutate({
                            id: job.id,
                            personId: job.personId,
                            employerName: job.employerName,
                            title: job.title,
                            startDate: job.startDate,
                            endDate: job.endDate ?? undefined,
                            [field]: parsed,
                          });
                        },
                        onUpdateDeduction: (
                          id: number,
                          field: string,
                          value: string,
                        ) => {
                          // amountPerPeriod is the only deduction field a
                          // Contribution Profile can set — it goes through the
                          // same profile writer contribution accounts use.
                          // Structural fields (deductionName/isPretax/
                          // ficaExempt) are never profile-settable and write
                          // the database.
                          // A preset sets both tax flags at once.
                          if (field === "taxTreatment") {
                            if (editTarget("setup").target !== "setup") return;
                            const preset = DEDUCTION_PRESETS.find(
                              (p) => p.key === value,
                            );
                            if (!preset) return;
                            const raw = (
                              d.rawDeductions as RawDeduction[]
                            ).find((dd) => dd.id === id);
                            if (!raw) return;
                            updateDeduction.mutate({
                              id: raw.id,
                              jobId: raw.jobId,
                              deductionName: raw.deductionName,
                              isPretax: preset.isPretax,
                              ficaExempt: preset.ficaExempt,
                            });
                            return;
                          }
                          const target = editTarget(
                            deductionFieldKind(field),
                          ).target;
                          if (target === "contributionProfile") {
                            updateProfileActiveField(
                              "deductions",
                              id,
                              field,
                              value,
                            );
                            return;
                          }
                          if (target !== "setup") return;
                          const raw = (d.rawDeductions as RawDeduction[]).find(
                            (dd) => dd.id === id,
                          );
                          if (!raw) return;
                          updateDeduction.mutate({
                            id: raw.id,
                            jobId: raw.jobId,
                            deductionName: raw.deductionName,
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
                          // Profile-held fields (value/method/match/…) go to
                          // the active Contribution Profile — there is no
                          // account-level fallback for them.
                          const target = editTarget(
                            contributionAccountFieldKind(field),
                          ).target;
                          if (target === "contributionProfile") {
                            updateProfileActiveField(
                              "contributionAccounts",
                              id,
                              field,
                              value,
                            );
                            return;
                          }
                          if (target !== "setup") return;
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
                        onCreateDeduction: (data) =>
                          createDeduction.mutate(data),
                        onDeleteDeduction: async (id: number) => {
                          if (await confirm("Remove this deduction?")) {
                            deleteDeduction.mutate({ id });
                          }
                        },
                        onToggleAutoMax: (
                          id: number,
                          value: boolean,
                          targetContribValue?: number,
                        ) => {
                          const raw = (d.rawContribs as RawContrib[]).find(
                            (cc) => cc.id === id,
                          );
                          if (!raw) return;
                          // autoMaximize is a profile field — read-only
                          // without a profile edit in play (editTarget).
                          if (contribEditsProfile) {
                            // Set autoMaximize (and, when turning it on with a
                            // known target, the resolved contributionValue) via
                            // the field-level patch — the server merges onto the
                            // freshest profile row. An entry can carry just
                            // autoMaximize with no value; contributionValue/Method
                            // are only required together (see
                            // contribAccountActiveFieldsSchema), not whenever an
                            // entry exists. `raw` only appears here if this account
                            // already resolves under this profile, so a stored
                            // method already survives the merge — raw's method is
                            // just the fallback for the rare bare entry.
                            updateProfileActiveField(
                              "contributionAccounts",
                              id,
                              {
                                autoMaximize: value,
                                ...(value && targetContribValue != null
                                  ? {
                                      contributionValue:
                                        String(targetContribValue),
                                      contributionMethod:
                                        raw.contributionMethod,
                                    }
                                  : {}),
                              },
                            );
                            return;
                          }
                        },
                        onDeleteContrib: (id: number) => {
                          deleteContrib.mutate({ id });
                        },
                        onCreateContrib: (data) => {
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
                        onUpdateInstitution: (
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
