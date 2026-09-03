"use client";

import { useState } from "react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import { PAY_PERIOD_LABELS } from "@/lib/config/display-labels";
import { useScenario } from "@/lib/context/scenario-context";
import { PayStub } from "./pay-stub";
import { AnnualSummary } from "./annual-summary";
import { BonusSection } from "./bonus-section";
import { TaxWithholdingSection } from "./tax-withholding-section";
import { ContributionsSection } from "./contributions-section";
import { AddDeductionForm } from "./add-deduction-form";
import { SSCapIndicator } from "./ss-cap-indicator";
import { ExtraPaycheckDestinationToggle } from "@/components/savings/extra-paycheck-rules-editor";
import { SectionHeader } from "./section-header";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import type {
  PaycheckResult,
  ViewMode,
  RawDeduction,
  RawContrib,
  DeductionRowData,
  CreateDeductionData,
  JointContrib,
} from "./types";
import type { ContribAccountFormValues } from "./contrib-account-form";
import type { PerContribView } from "@/lib/hooks/use-paycheck-person-views";
import type {
  BlendedAnnualTotals,
  BonusEstimate,
} from "@/lib/calculators/types/calculators";

/**
 * Everything in this card that writes. Expressed as ONE discriminated prop
 * rather than a dozen individually-optional callbacks, so a read-only caller
 * says so once and can't forget one of them.
 *
 * `kind: "readonly"` disables in-place editing throughout the tree and omits
 * the add/delete affordances entirely.
 */
export type PersonPaycheckInteraction =
  | {
      kind: "live";
      handlers: {
        onUpdateJob: (field: string, value: string) => void;
        onUpdateDeduction: (id: number, field: string, value: string) => void;
        onUpdateContrib: (id: number, field: string, value: string) => void;
        onCreateDeduction?: (data: CreateDeductionData) => void;
        onDeleteDeduction?: (id: number) => void;
        onToggleAutoMax?: (
          id: number,
          value: boolean,
          targetContribValue?: number,
        ) => void;
        onDeleteContrib?: (id: number) => void;
        onCreateContrib?: (data: ContribAccountFormValues) => void;
        onUpdateInstitution?: (
          id: number,
          performanceAccountId: number | null,
        ) => void;
      };
    }
  | { kind: "readonly" };

const NOOP = () => {};

export function PersonPaycheck({
  person,
  job,
  salary,
  resolvedBonusTerms,
  paycheck,
  fullFormulaBonusEstimate,
  mode,
  blendedAnnual,
  salaryReadOnly,
  contribValueReadOnly,
  rawDeductions,
  rawContribs,
  perContribData,
  alignedPreTax,
  alignedPostTax,
  coverageNote,
  coverageNoteGroup,
  otherJointContribs,
  contribExpanded,
  onToggleContrib,
  sharedGroupOrder,
  interaction,
  incompleteAccountIds,
}: {
  person: { name: string; id: number };
  job: {
    id: number;
    employerName: string;
    title: string | null;
    /** These 7 fields no longer live on the raw job row — they resolve
     *  through the active Salary Profile's entry for this job (see
     *  SalaryProfileEntry in server/helpers/salary.ts). paycheck.ts's
     *  computeSummary still merges them flat onto `job` for the client
     *  (the same pattern use-paycheck-person-views.ts's `job: any` and
     *  household-income-card.tsx already rely on), so they're read the
     *  same way here as before the migration — only their write path
     *  changed (paycheck/page.tsx now routes them to salaryProfile.update
     *  instead of settings.jobs.update). */
    bonusMonth: number | null;
    bonusDayOfMonth: number | null;
    include401kInBonus: boolean;
    includeBonusInContributions: boolean;
    personId: number;
    w4FilingStatus: string;
    w4Box2cChecked: boolean;
    additionalFedWithholding: number;
    payPeriod: string;
    extraPaycheckRouting: ExtraPaycheckRoutingData | null;
  };
  salary: number;
  /** The bonus terms actually in effect (Salary Profile pin, if any, else
   *  unset) — a job carries no bonus terms of its own any more, so this is
   *  the only source BonusSection can pre-fill from. */
  resolvedBonusTerms: {
    bonusPercent: number;
    bonusMultiplier: number;
    monthsInBonusYear: number;
    bonusOverride: number | null;
  };
  paycheck: PaycheckResult;
  /** The nominal formula bonus, ignoring any current-year pin — lets
   *  BonusSection show "target" alongside "actual" when
   *  resolvedBonusTerms.bonusOverride is set. */
  fullFormulaBonusEstimate: BonusEstimate;
  mode: ViewMode;
  blendedAnnual?: BlendedAnnualTotals;
  /** True while a Salary Profile is being previewed with its padlock locked —
   *  the figure shown belongs to that profile, so it is not editable until the
   *  padlock is opened (which routes the edit to the profile, not the job). */
  salaryReadOnly?: boolean;
  /** Mirrors the Contribution padlock — contributionValue/Method writes into
   *  the viewed Contribution Profile's active fields when unlocked. */
  contribValueReadOnly?: boolean;
  rawDeductions: RawDeduction[];
  rawContribs: RawContrib[];
  /** Contribution annual/limit figures, resolved ONCE by the caller's shared
   *  hook. This card and its children never query for them. */
  perContribData: PerContribView[];
  alignedPreTax?: DeductionRowData[];
  alignedPostTax?: DeductionRowData[];
  coverageNote?: string;
  coverageNoteGroup?: string;
  otherJointContribs?: JointContrib[];
  contribExpanded: boolean;
  onToggleContrib: () => void;
  sharedGroupOrder?: string[];
  interaction: PersonPaycheckInteraction;
  /** Contribution accounts belonging to this person/job with no active
   *  value under the current Contribution Profile — see
   *  getIncompleteContribAccountIds. Surfaced as a badge, never silently
   *  dropped from the total. */
  incompleteAccountIds?: number[];
}) {
  const [addingDeduction, setAddingDeduction] = useState<{
    isPretax: boolean;
  } | null>(null);
  const { isInScenario } = useScenario();

  const readOnly = interaction.kind === "readonly";
  const handlers = interaction.kind === "live" ? interaction.handlers : null;
  const onUpdateJob = handlers?.onUpdateJob ?? NOOP;
  const onUpdateDeduction = handlers?.onUpdateDeduction ?? NOOP;
  const onUpdateContrib = handlers?.onUpdateContrib ?? NOOP;

  return (
    <div className="row-span-3 grid grid-rows-subgrid gap-0">
      {/* Unified person card with accent border */}
      <div className="bg-surface-primary row-span-3 overflow-hidden rounded-xl border shadow-sm">
        {/* Header: person, salary, extra paycheck months */}
        <div className="border-subtle from-surface-sunken/80 border-b bg-gradient-to-r to-transparent p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-primary flex items-center gap-2 text-xl font-bold">
                {person.name}
                {incompleteAccountIds && incompleteAccountIds.length > 0 && (
                  <span
                    className="text-caption rounded bg-amber-50 px-1 leading-tight font-semibold text-amber-700"
                    title={`${incompleteAccountIds.length} contribution account(s) have no active value under the current Contribution Profile — excluded from totals below.`}
                  >
                    Incomplete
                  </span>
                )}
              </h2>
              <p className="text-muted text-sm">
                {job.title ? (
                  <>
                    <InlineEdit
                      value={job.title}
                      onSave={(v) => onUpdateJob("title", v)}
                      className="text-muted"
                      isEditable={!readOnly}
                    />
                    {" at "}
                  </>
                ) : null}
                <InlineEdit
                  value={job.employerName}
                  onSave={(v) => onUpdateJob("employerName", v)}
                  className="text-muted"
                  isEditable={!readOnly}
                />
              </p>
              {/* Read-only pay-schedule summary — editing the schedule
                  itself (payPeriod/anchorPayDate/etc.) now lives on Salary
                  Profile Manager, but the computed values below (next
                  payday, periods/year, 3-check months) have no relationship
                  to WHERE the schedule is edited, so they stay here. */}
              <p className="text-faint text-xs">
                {PAY_PERIOD_LABELS[job.payPeriod] ?? job.payPeriod}
                {" · "}
                Next: {paycheck.nextPayDate}
                {" · "}
                {paycheck.periodsPerYear}/yr
                {paycheck.extraPaycheckMonths.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-green-600">
                      3-check: {paycheck.extraPaycheckMonths.join(", ")}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="text-right">
              <InlineEdit
                value={String(salary)}
                onSave={(v) => onUpdateJob("annualSalary", v)}
                formatDisplay={(v) => formatCurrency(Number(v))}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-lg font-semibold"
                isEditable={!readOnly && !salaryReadOnly}
              />
              <p className="text-faint text-xs">annual salary</p>
            </div>
          </div>
        </div>

        {/* Two-column layout: Pay stub + Annual summary side by side */}
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <div className="space-y-4">
            <PayStub
              paycheck={paycheck}
              rawDeductions={rawDeductions}
              onUpdateDeduction={onUpdateDeduction}
              alignedPreTax={alignedPreTax}
              alignedPostTax={alignedPostTax}
              onAddDeduction={
                readOnly || isInScenario
                  ? undefined
                  : (isPretax) => setAddingDeduction({ isPretax })
              }
              onDeleteDeduction={handlers?.onDeleteDeduction ?? undefined}
              readOnly={readOnly}
            />
            {job.payPeriod === "biweekly" && (
              <div className="space-y-2">
                <SectionHeader>Extra Paycheck</SectionHeader>
                <div className="bg-surface-sunken border-subtle rounded-lg border p-4 text-sm">
                  <ExtraPaycheckDestinationToggle
                    jobId={job.id}
                    routing={job.extraPaycheckRouting ?? null}
                    disabled={isInScenario}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <AnnualSummary
              paycheck={paycheck}
              mode={mode}
              blendedAnnual={blendedAnnual}
            />
            <TaxWithholdingSection
              job={job}
              onUpdateJob={onUpdateJob}
              readOnly={readOnly}
              salaryReadOnly={salaryReadOnly}
            />
            <BonusSection
              paycheck={paycheck}
              fullFormulaBonusEstimate={fullFormulaBonusEstimate}
              job={job}
              resolvedBonusTerms={resolvedBonusTerms}
              onUpdateJob={onUpdateJob}
              readOnly={readOnly}
              salaryReadOnly={salaryReadOnly}
            />
          </div>
        </div>

        {/* Row 3: Contributions + extras */}
        <div className="space-y-4 px-5 pt-1 pb-5">
          <ContributionsSection
            rawContribs={rawContribs}
            perContribData={perContribData}
            onUpdateContrib={onUpdateContrib}
            onToggleAutoMax={handlers?.onToggleAutoMax}
            onDeleteContrib={handlers?.onDeleteContrib}
            onCreateContrib={handlers?.onCreateContrib}
            onUpdateInstitution={handlers?.onUpdateInstitution}
            coverageNote={coverageNote}
            coverageNoteGroup={coverageNoteGroup}
            otherJointContribs={otherJointContribs}
            salary={salary}
            periodsPerYear={paycheck.periodsPerYear}
            isExpanded={contribExpanded}
            onToggleExpand={onToggleContrib}
            sharedGroupOrder={sharedGroupOrder}
            personId={person.id}
            jobId={job.id}
            readOnly={readOnly}
            contribValueReadOnly={contribValueReadOnly}
          />

          {/* Add deduction form */}
          {addingDeduction && (
            <AddDeductionForm
              jobId={job.id}
              isPretax={addingDeduction.isPretax}
              onSave={(data) => {
                handlers?.onCreateDeduction?.(data);
                setAddingDeduction(null);
              }}
              onCancel={() => setAddingDeduction(null)}
            />
          )}

          {/* Indicators */}
          <SSCapIndicator paycheck={paycheck} />

          {paycheck.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
              {paycheck.warnings.map((w) => (
                <p key={w} className="text-sm text-yellow-800">
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* end unified person card */}
    </div>
  );
}
