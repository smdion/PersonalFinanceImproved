"use client";

import { useState } from "react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency, maskAmountsInText } from "@/lib/utils/format";
import { PAY_PERIOD_LABELS } from "@/lib/config/display-labels";
import { PayStub } from "./pay-stub";
import { AnnualSummary } from "./annual-summary";
import { BonusSection } from "./bonus-section";
import { TaxWithholdingSection } from "./tax-withholding-section";
import { ContributionsSection } from "./contributions-section";
import { AddDeductionForm } from "./add-deduction-form";
import { SSCapIndicator } from "./ss-cap-indicator";
import { ExtraPaycheckDestinationToggle } from "@/components/savings/extra-paycheck-rules-editor";
import { SectionHeader } from "./section-header";
import { OtherPaySection } from "./other-pay-section";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import type {
  PaycheckResult,
  ViewMode,
  RawDeduction,
  RawContrib,
  DeductionRowData,
  CreateDeductionData,
  JointContrib,
  EarningRow,
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
  earningRows,
  editLabels,
  lineReadOnly,
  setupReadOnly,
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
  /** Salary Profile fields aren't editable (see resolvePaycheckEditTarget). */
  salaryReadOnly?: boolean;
  /** Contribution Profile fields (amounts) aren't editable. */
  contribValueReadOnly?: boolean;
  /** Deduction / other-pay lines (name, tax treatment, adding) aren't
   *  editable — see resolvePaycheckEditTarget. */
  lineReadOnly?: boolean;
  /** Household setup (employer, title, accounts, removing rows) isn't
   *  editable (admin only). */
  setupReadOnly?: boolean;
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
  /** This job's other-pay lines with their per-check amounts. */
  earningRows?: EarningRow[];
  /** Where each kind of edit saves (resolvePaycheckEditTarget), shown under
   *  the matching section titles. */
  editLabels?: { salary: string; contribution: string; setup: string };
}) {
  const [addingDeduction, setAddingDeduction] = useState<{
    isPretax: boolean;
  } | null>(null);

  const readOnly = interaction.kind === "readonly";
  const handlers = interaction.kind === "live" ? interaction.handlers : null;
  const onUpdateJob = handlers?.onUpdateJob ?? NOOP;
  const onUpdateDeduction = handlers?.onUpdateDeduction ?? NOOP;
  const onUpdateContrib = handlers?.onUpdateContrib ?? NOOP;

  return (
    // Three rows — header, body, contributions — shared with the other
    // person's card through the page grid's subgrid, so each starts at the
    // same height in both cards.
    <div className="bg-surface-primary row-span-3 grid grid-rows-subgrid gap-0 overflow-hidden rounded-xl border shadow-sm">
      {/* Header: person, job, schedule, salary */}
      <div className="border-subtle from-surface-sunken/80 border-b bg-gradient-to-r to-transparent p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
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
                    isEditable={!readOnly && !setupReadOnly}
                    hideEditIcon
                  />
                  {" at "}
                </>
              ) : null}
              <InlineEdit
                value={job.employerName}
                onSave={(v) => onUpdateJob("employerName", v)}
                className="text-muted"
                isEditable={!readOnly && !setupReadOnly}
                hideEditIcon
              />
            </p>
            {/* Computed from the Salary Profile's schedule (edited on the
                Profiles page) — shown here for reference. */}
            <p className="text-faint text-xs">
              {PAY_PERIOD_LABELS[job.payPeriod] ?? job.payPeriod}
              {" · "}
              Next: {paycheck.nextPayDate}
              {" · "}
              {paycheck.periodsPerYear} checks/yr
              {paycheck.extraPaycheckMonths.length > 0 && (
                <>
                  {" · "}3-check months:{" "}
                  {paycheck.extraPaycheckMonths.join(", ")}
                </>
              )}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <InlineEdit
              value={String(salary)}
              onSave={(v) => onUpdateJob("annualSalary", v)}
              formatDisplay={(v) => formatCurrency(Number(v))}
              parseInput={(v) => v.replace(/[^0-9.]/g, "")}
              type="number"
              className="text-lg font-semibold tabular-nums"
              isEditable={!readOnly && !salaryReadOnly}
              hideEditIcon
            />
            <p className="text-faint text-xs">annual salary</p>
          </div>
        </div>
      </div>

      {/* Body — two balanced columns so neither leaves a gap beside the
          other: the tall pay stub with the W-4 and extra-paycheck settings
          under it; the year's totals with the bonus and other pay. Same
          order for every person. */}
      <div className="grid grid-cols-1 content-start gap-4 p-5 md:grid-cols-2">
        <div className="space-y-4">
          <PayStub
            paycheck={paycheck}
            rawDeductions={rawDeductions}
            onUpdateDeduction={onUpdateDeduction}
            alignedPreTax={alignedPreTax}
            alignedPostTax={alignedPostTax}
            onAddDeduction={
              readOnly || lineReadOnly
                ? undefined
                : (isPretax) => setAddingDeduction({ isPretax })
            }
            onDeleteDeduction={handlers?.onDeleteDeduction ?? undefined}
            readOnly={readOnly}
            amountReadOnly={contribValueReadOnly}
            lineReadOnly={lineReadOnly}
            note={editLabels && `Amounts: ${editLabels.contribution}`}
          />
          <TaxWithholdingSection
            job={job}
            onUpdateJob={onUpdateJob}
            readOnly={readOnly}
            salaryReadOnly={salaryReadOnly}
            note={editLabels?.salary}
          />
          {job.payPeriod === "biweekly" && (
            <div className="space-y-2">
              <SectionHeader note={editLabels?.salary}>
                Extra paycheck
              </SectionHeader>
              <div className="bg-surface-sunken border-subtle rounded-lg border p-4 text-sm">
                <ExtraPaycheckDestinationToggle
                  jobId={job.id}
                  routing={job.extraPaycheckRouting ?? null}
                  disabled={readOnly || salaryReadOnly}
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
          <BonusSection
            personId={person.id}
            paycheck={paycheck}
            fullFormulaBonusEstimate={fullFormulaBonusEstimate}
            job={job}
            resolvedBonusTerms={resolvedBonusTerms}
            onUpdateJob={onUpdateJob}
            readOnly={readOnly}
            salaryReadOnly={salaryReadOnly}
            note={editLabels?.salary}
          />
          <OtherPaySection
            jobId={job.id}
            rows={earningRows ?? []}
            onSetAmount={(id, amount) =>
              onUpdateJob(`otherEarnings:${id}`, String(amount))
            }
            readOnly={readOnly}
            amountReadOnly={salaryReadOnly}
            lineReadOnly={lineReadOnly}
            canRemove={!setupReadOnly}
            note={editLabels?.salary}
          />
        </div>
      </div>

      {/* Contributions + extras */}
      <div className="border-subtle space-y-4 border-t px-5 pt-4 pb-5">
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

        <SSCapIndicator paycheck={paycheck} />

        {paycheck.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            {paycheck.warnings.map((w) => (
              <p key={w} className="text-sm text-amber-800 dark:text-amber-300">
                {maskAmountsInText(w)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
