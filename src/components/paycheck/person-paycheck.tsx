"use client";

import { useRef, useState } from "react";
import { useScrollToFocus } from "@/components/ui/focus-target";
import { InlineEdit } from "@/components/ui/inline-edit";
import {
  accountDisplayName,
  formatCurrency,
  maskAmountsInText,
} from "@/lib/utils/format";
import { PAY_PERIOD_LABELS } from "@/lib/config/display-labels";
import { PayStub } from "./pay-stub";
import { AnnualSummary } from "./annual-summary";
import { BonusSection } from "./bonus-section";
import { splitLineLabel } from "./deduction-row";
import { isPreTax } from "@/lib/calculators/paycheck";
import { TaxWithholdingSection } from "./tax-withholding-section";
import { ContributionsSection } from "./contributions-section";
import { AddDeductionForm } from "./add-deduction-form";
import { SSCapIndicator } from "./ss-cap-indicator";
import { ExtraPaycheckDestinationToggle } from "@/components/savings/extra-paycheck-rules-editor";
import { SectionHeader } from "./section-header";
import { OtherPaySection } from "./other-pay-section";
import type { ExtraPaycheckRoutingData } from "@/lib/db/schema-pg";
import type { BonusDestination } from "@/lib/config/enum-values";
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
import { PaystubCheck } from "./paystub-check";
import type { FicaRates } from "@/lib/pure/paystub-check";
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
type PersonPaycheckInteraction =
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

/** An account's name in the Bonus section: its own name, and — like the
 *  pay stub — which one it is when the stub has the same name before and
 *  after tax (splitLineLabel). */
function bonusAccountName(
  raw: RawContrib,
  lines: Parameters<typeof splitLineLabel>[2],
): string {
  const custom = raw.displayNameCustom ?? raw.displayNameActive;
  if (custom) return custom;
  // The account's line on the pay stub is named this (buildContribAccounts).
  const lineName = raw.subType || raw.label || raw.accountType;
  return (
    splitLineLabel(lineName, isPreTax(raw.taxTreatment), lines) ??
    accountDisplayName(raw)
  );
}

export function PersonPaycheck({
  person,
  job,
  salary,
  resolvedBonusTerms,
  paycheck,
  paystubPaycheck,
  fullFormulaBonusEstimate,
  mode,
  blendedAnnual,
  salaryReadOnly,
  contribValueReadOnly,
  rawDeductions,
  rawContribs,
  bonusCheckAccounts,
  bonusDestination,
  ficaRates,
  perContribData,
  alignedPreTax,
  alignedPostTax,
  coverageNote,
  coverageNoteGroup,
  otherJointContribs,
  contribExpanded,
  onToggleContrib,
  scrollToContribs = false,
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
     *  changed (paycheck/page.tsx saves them with salaryProfile.patchEntry). */
    bonusMonth: number | null;
    bonusDayOfMonth: number | null;
    personId: number;
    w4FilingStatus: string;
    w4Box2cChecked: boolean;
    additionalFedWithholding: number;
    payPeriod: string;
    anchorPayDate?: string | null;
    startDate: string;
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
  /** The paycheck on the configured contributions — what payroll actually
   *  deducts, for the pay-stub check — when a contribution is over an IRS
   *  limit (null/absent = same as `paycheck`). */
  paystubPaycheck?: PaycheckResult | null;
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
  /** The accounts the bonus check takes, and how much (fromBonus). */
  bonusCheckAccounts: { id: number; amount: number }[];
  /** Where this job's bonus goes (its Salary Profile entry). */
  bonusDestination: BonusDestination;
  /** The year's FICA figures (tax data) for "Check against a pay stub". */
  ficaRates: FicaRates | null;
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
  /** A link landed on contributions: scroll here (the first person only). */
  scrollToContribs?: boolean;
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
  const contribsRef = useRef<HTMLDivElement>(null);
  useScrollToFocus(contribsRef, scrollToContribs && contribExpanded);
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
            paycheck={paycheck}
            fullFormulaBonusEstimate={fullFormulaBonusEstimate}
            job={job}
            resolvedBonusTerms={resolvedBonusTerms}
            bonusAccounts={bonusCheckAccounts.map((a) => {
              const raw = rawContribs.find((c) => c.id === a.id);
              return {
                id: a.id,
                name: raw
                  ? bonusAccountName(raw, {
                      preTax: alignedPreTax ?? paycheck.preTaxDeductions,
                      postTax: alignedPostTax ?? paycheck.postTaxDeductions,
                    })
                  : "Contribution",
                amount: a.amount,
              };
            })}
            bonusDestination={bonusDestination}
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
        {ficaRates && (
          <PaystubCheck
            paycheck={paystubPaycheck ?? paycheck}
            rates={ficaRates}
            payPeriod={job.payPeriod}
            anchor={job.anchorPayDate ?? job.startDate}
          />
        )}
        <div ref={contribsRef}>
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
        </div>

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
