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
import { SalaryTracker } from "./salary-tracker";
import type {
  PaycheckResult,
  ViewMode,
  RawDeduction,
  RawContrib,
  DeductionRowData,
  CreateDeductionData,
  CreateContribData,
  JointContrib,
} from "./types";

export function PersonPaycheck({
  person,
  job,
  salary,
  futureSalaryChanges,
  paycheck,
  mode,
  activeSalaryOverride,
  onToggleSalary,
  onUpdateJob,
  rawDeductions,
  rawContribs,
  onUpdateDeduction,
  onUpdateContrib,
  alignedPreTax,
  alignedPostTax,
  coverageNote,
  coverageNoteGroup,
  otherJointContribs,
  onCreateDeduction,
  onDeleteDeduction,
  onToggleAutoMax,
  onDeleteContrib,
  onCreateContrib,
  contribExpanded,
  onToggleContrib,
  sharedGroupOrder,
}: {
  person: { name: string; id: number };
  job: {
    id: number;
    employerName: string;
    title: string | null;
    annualSalary: string;
    bonusPercent: string;
    bonusMultiplier: string;
    bonusOverride: string | null;
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
  futureSalaryChanges: { salary: number; effectiveDate: string }[];
  paycheck: PaycheckResult;
  mode: ViewMode;
  activeSalaryOverride: number | null;
  onToggleSalary: (salary: number) => void;
  onUpdateJob: (field: string, value: string) => void;
  rawDeductions: RawDeduction[];
  rawContribs: RawContrib[];
  onUpdateDeduction: (id: number, field: string, value: string) => void;
  onUpdateContrib: (id: number, field: string, value: string) => void;
  alignedPreTax?: DeductionRowData[];
  alignedPostTax?: DeductionRowData[];
  coverageNote?: string;
  coverageNoteGroup?: string;
  otherJointContribs?: JointContrib[];
  onCreateDeduction?: (data: CreateDeductionData) => void;
  onToggleAutoMax?: (
    id: number,
    value: boolean,
    targetContribValue?: number,
  ) => void;
  onDeleteDeduction?: (id: number) => void;
  onDeleteContrib?: (id: number) => void;
  onCreateContrib?: (data: CreateContribData) => void;
  contribExpanded: boolean;
  onToggleContrib: () => void;
  sharedGroupOrder?: string[];
}) {
  const [addingDeduction, setAddingDeduction] = useState<{
    isPretax: boolean;
  } | null>(null);
  const { isInScenario } = useScenario();

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
                    />
                    {" at "}
                  </>
                ) : null}
                <InlineEdit
                  value={job.employerName}
                  onSave={(v) => onUpdateJob("employerName", v)}
                  className="text-muted"
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
              />
              <p className="text-xs text-faint">annual salary</p>
            </div>
          </div>
          <PayScheduleInfo
            job={job}
            paycheck={paycheck}
            onUpdateJob={onUpdateJob}
          />
          <SalaryTracker
            jobId={job.id}
            futureSalaryChanges={futureSalaryChanges}
            activeSalaryOverride={activeSalaryOverride}
            onToggleSalary={onToggleSalary}
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
              isInScenario
                ? undefined
                : (isPretax) => setAddingDeduction({ isPretax })
            }
            onDeleteDeduction={onDeleteDeduction ?? undefined}
          />
          <div className="space-y-4">
            <AnnualSummary paycheck={paycheck} mode={mode} />
            <BonusSection
              paycheck={paycheck}
              job={job}
              onUpdateJob={onUpdateJob}
            />
          </div>
        </div>

        {/* Row 3: Contributions + extras */}
        <div className="px-5 pb-5 pt-1 space-y-4">
          <ContributionsSection
            rawContribs={rawContribs}
            onUpdateContrib={onUpdateContrib}
            onToggleAutoMax={onToggleAutoMax}
            onDeleteContrib={onDeleteContrib}
            onCreateContrib={onCreateContrib}
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
          />

          {/* Add deduction form */}
          {addingDeduction && (
            <AddDeductionForm
              jobId={job.id}
              isPretax={addingDeduction.isPretax}
              onSave={(data) => {
                onCreateDeduction?.(data);
                setAddingDeduction(null);
              }}
              onCancel={() => setAddingDeduction(null)}
            />
          )}

          {/* Indicators */}
          <SSCapIndicator paycheck={paycheck} />

          {paycheck.warnings.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              {paycheck.warnings.map((w, i) => (
                <p key={i} className="text-sm text-yellow-800">
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
