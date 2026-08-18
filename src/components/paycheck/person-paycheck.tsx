"use client";

import { useState } from "react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import { useScenario } from "@/lib/context/scenario-context";
import { PayStub } from "./pay-stub";
import { AnnualSummary } from "./annual-summary";
import { BonusSection } from "./bonus-section";
import { ContributionsSection } from "./contributions-section";
import { AddDeductionForm } from "./add-deduction-form";
import { SSCapIndicator } from "./ss-cap-indicator";
import { PayScheduleInfo } from "./pay-schedule-info";
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
import type { BlendedAnnualTotals } from "@/lib/calculators/types/calculators";

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
  mode,
  blendedAnnual,
  salaryReadOnly,
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
}: {
  person: { name: string; id: number };
  job: {
    id: number;
    employerName: string;
    title: string | null;
    bonusMonth: number | null;
    bonusDayOfMonth: number | null;
    include401kInBonus: boolean;
    includeBonusInContributions: boolean;
    payPeriod: string;
    payWeek: string;
    personId: number;
    w4FilingStatus: string;
    w4Box2cChecked: boolean;
    startDate: string;
    anchorPayDate?: string | null;
    budgetPeriodsPerMonth?: string | null;
  };
  salary: number;
  /** The bonus terms actually in effect (Salary Profile pin, if any, else
   *  unset) — a job carries no bonus terms of its own any more, so this is
   *  the only source BonusSection can pre-fill from. */
  resolvedBonusTerms: {
    bonusPercent: number;
    bonusMultiplier: number;
    monthsInBonusYear: number;
  };
  paycheck: PaycheckResult;
  mode: ViewMode;
  blendedAnnual?: BlendedAnnualTotals;
  /** True while a Salary Profile is being previewed with its padlock locked —
   *  the figure shown belongs to that profile, so it is not editable until the
   *  padlock is opened (which routes the edit to the profile, not the job). */
  salaryReadOnly?: boolean;
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
      <div className="row-span-3 bg-surface-primary border rounded-xl shadow-sm overflow-hidden">
        {/* Header: person, salary, extra paycheck months */}
        <div className="p-5 border-b border-subtle bg-gradient-to-r from-surface-sunken/80 to-transparent">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-primary">{person.name}</h2>
              <p className="text-sm text-muted">
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
              <p className="text-xs text-faint">annual salary</p>
            </div>
          </div>
          <PayScheduleInfo
            job={job}
            paycheck={paycheck}
            onUpdateJob={onUpdateJob}
            readOnly={readOnly}
          />
        </div>

        {/* Two-column layout: Pay stub + Annual summary side by side */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <div className="space-y-4">
            <AnnualSummary
              paycheck={paycheck}
              mode={mode}
              blendedAnnual={blendedAnnual}
            />
            <BonusSection
              paycheck={paycheck}
              job={job}
              resolvedBonusTerms={resolvedBonusTerms}
              onUpdateJob={onUpdateJob}
              readOnly={readOnly}
              salaryReadOnly={salaryReadOnly}
            />
          </div>
        </div>

        {/* Row 3: Contributions + extras */}
        <div className="px-5 pb-5 pt-1 space-y-4">
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
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
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
