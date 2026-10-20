"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { FieldRow } from "@/components/ui/field-row";
import { DateInput } from "@/components/ui/date-input";
import { BONUS_DESTINATION_OPTIONS } from "@/lib/config/display-labels";
import { safeDivide } from "@/lib/utils/math";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { SectionHeader } from "./section-header";
import type { BonusDestination } from "@/lib/config/enum-values";
import type { PaycheckResult } from "./types";
import type { BonusEstimate } from "@/lib/calculators/types/calculators";

/** "Bonus goes to: Budget | Extra spending" — like the extra paycheck's
 *  choice, saved in the Salary Profile entry. Extra spending gets its own
 *  Living Costs bar. */
function BonusDestinationToggle({
  value,
  onChange,
  disabled,
}: {
  value: BonusDestination;
  onChange: (value: BonusDestination) => void;
  disabled?: boolean;
}) {
  return (
    <FieldRow
      label={
        <>
          Goes to
          <HelpTip text="Extra spending: the bonus isn't part of your budget. Living Costs shows its take-home as its own bar instead of counting it as unallocated." />
        </>
      }
    >
      <SegmentedControl
        ariaLabel="Bonus goes to"
        value={value}
        options={BONUS_DESTINATION_OPTIONS}
        onChange={onChange}
        disabled={disabled}
      />
    </FieldRow>
  );
}

const numeric = (v: string) => v.replace(/[^0-9.]/g, "");

/** Show every bonus term (not only Bonus %): there's a bonus, or this
 *  year's actual is recorded. A 0% row is the way to add one. The one rule
 *  for both salary editors. */
export function showsAllBonusTerms(terms: {
  bonusPercent: number;
  bonusOverride: number | null;
}): boolean {
  return terms.bonusPercent > 0 || terms.bonusOverride !== null;
}

/** The bonus pay date (month/day, every year) as a date-input value: this
 *  year's, or the next year that has it (Feb 29). */
function bonusDateValue(month: number, day: number): string {
  let year = new Date().getFullYear();
  while (new Date(year, month - 1, day).getMonth() !== month - 1) year++;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The bonus terms a Salary Profile entry holds — percent, multiplier, this
 * year's actual, the pay date and where it goes. Shared by the Paycheck
 * page's Bonus section and Profiles → Salary, so both edit them the same
 * way (each sends edits through salaryEntryEdit → patchEntry).
 */
export function BonusTerms({
  terms,
  bonusMonth,
  bonusDayOfMonth,
  bonusDestination,
  onUpdateJob,
  editable,
  showAll,
  formulaBonus,
  paidOnHint,
}: {
  terms: {
    bonusPercent: number;
    bonusMultiplier: number;
    bonusOverride: number | null;
  };
  bonusMonth: number | null;
  bonusDayOfMonth: number | null;
  bonusDestination: BonusDestination;
  onUpdateJob: (field: string, value: string) => void;
  editable: boolean;
  /** Every term, not only Bonus % (a 0% row is the way to add a bonus). */
  showAll: boolean;
  /** The formula's bonus, shown beside an empty "actual". */
  formulaBonus?: number;
  /** A line under the pay date (e.g. which pay period it lands in). */
  paidOnHint?: string;
}) {
  return (
    <>
      <FieldRow label="Bonus %">
        <InlineEdit
          value={String(terms.bonusPercent * 100)}
          onSave={(v) =>
            onUpdateJob("bonusPercent", String(Number(numeric(v)) / 100))
          }
          formatDisplay={(v) => formatPercent(Number(v) / 100, 1)}
          parseInput={numeric}
          type="number"
          className="font-medium"
          isEditable={editable}
          hideEditIcon
          ariaLabel="Bonus percent"
        />
      </FieldRow>
      {showAll && (
        <>
          <FieldRow
            label={
              <>
                Multiplier
                <HelpTip text="Scales your bonus target — 1.0x means on-target, higher means exceeding expectations" />
              </>
            }
          >
            <InlineEdit
              value={String(terms.bonusMultiplier)}
              onSave={(v) => onUpdateJob("bonusMultiplier", numeric(v))}
              formatDisplay={(v) => `${Number(v).toFixed(2)}x`}
              parseInput={numeric}
              type="number"
              className="font-medium"
              isEditable={editable}
              hideEditIcon
              ariaLabel="Bonus multiplier"
            />
          </FieldRow>
          <FieldRow
            label={
              <>
                {new Date().getFullYear()} actual
                <HelpTip text="Lock in this year's actual bonus once it's paid out, instead of the calculated salary x percent x multiplier. Only affects this calendar year — next year's projections still use the full formula." />
              </>
            }
            hint={
              terms.bonusOverride === null && formulaBonus !== undefined
                ? `Formula: ${formatCurrency(formulaBonus)}`
                : undefined
            }
          >
            <InlineEdit
              value={
                terms.bonusOverride !== null ? String(terms.bonusOverride) : ""
              }
              onSave={(v) => onUpdateJob("bonusOverride", numeric(v))}
              // "" = not recorded; a recorded $0 is a real "no bonus this year".
              formatDisplay={(v) =>
                v === "" ? "—" : formatCurrency(Number(v))
              }
              parseInput={numeric}
              type="number"
              className="font-medium"
              isEditable={editable}
              hideEditIcon
              ariaLabel={`${new Date().getFullYear()} actual bonus`}
            />
          </FieldRow>
          <FieldRow
            label={
              <>
                Paid on
                <HelpTip text="Date when bonus is typically paid. Helps model contribution timing and cash flow." />
              </>
            }
            hint={paidOnHint}
          >
            <DateInput
              ariaLabel="Bonus paid on"
              value={
                bonusMonth != null
                  ? bonusDateValue(bonusMonth, bonusDayOfMonth ?? 1)
                  : ""
              }
              // One write for both parts of the date ("MM-DD", or "" to
              // clear) — two writes would race on the same profile entry.
              onCommit={(v) => onUpdateJob("bonusDate", v.slice(5))}
              disabled={!editable}
              className="bg-surface-primary w-36 rounded border px-2 py-0.5 text-sm disabled:opacity-60"
            />
          </FieldRow>
          <BonusDestinationToggle
            value={bonusDestination}
            onChange={(v) => onUpdateJob("bonusDestination", v)}
            disabled={!editable}
          />
        </>
      )}
    </>
  );
}

export function BonusSection({
  paycheck,
  fullFormulaBonusEstimate,
  job,
  resolvedBonusTerms,
  bonusAccounts,
  bonusDestination,
  onUpdateJob,
  readOnly,
  salaryReadOnly,
  note,
}: {
  paycheck: PaycheckResult;
  /** The nominal formula bonus, ignoring any current-year pin — shown as
   *  "(calc: $X)" next to the Actual field so pinning a real number
   *  doesn't hide what the formula would otherwise say. */
  fullFormulaBonusEstimate: BonusEstimate;
  job: {
    bonusMonth: number | null;
    bonusDayOfMonth: number | null;
  };
  /** A job carries no bonus terms of its own any more — this is the only
   *  source to pre-fill from (Salary Profile entry, if any, else unset). */
  resolvedBonusTerms: {
    bonusPercent: number;
    bonusMultiplier: number;
    monthsInBonusYear: number;
    /** This year's actual paid-out bonus, pinned on the same Salary Profile
     *  entry — orthogonal to the formula fields above, which future-year
     *  retirement projections always use untouched. Null means unpinned:
     *  the live estimate below uses the formula. */
    bonusOverride: number | null;
  };
  /** The contributions the bonus check takes — each account's own
   *  "Also taken from bonus checks" election, set on its row under
   *  Contributions. */
  bonusAccounts: { id: number; name: string; amount: number }[];
  /** Where this job's bonus goes (its Salary Profile entry). */
  bonusDestination: BonusDestination;
  onUpdateJob: (field: string, value: string) => void;
  /** Sandbox/preview mode — bonus terms are shown but not editable. */
  readOnly?: boolean;
  /** Every editable field here lives on the Salary Profile entry (see
   *  resolvePaycheckEditTarget), so all of them gate on this. */
  salaryReadOnly?: boolean;
  /** Where this section's edits save. */
  note?: string;
}) {
  const { bonusEstimate } = paycheck;
  const editable = !readOnly && !salaryReadOnly;
  // Shown even with no bonus, so a bonus can be added here (a 0% row is
  // the way in) instead of the section disappearing.
  const hasBonus = bonusEstimate.bonusGross > 0;
  const fedRate = safeDivide(
    bonusEstimate.bonusFederalWithholding,
    bonusEstimate.bonusGross,
  );
  const takeHomeRate = safeDivide(
    bonusEstimate.bonusNet,
    bonusEstimate.bonusGross,
  );

  return (
    <div className="space-y-2">
      <SectionHeader note={note}>Bonus</SectionHeader>
      <div className="bg-surface-sunken border-subtle space-y-1.5 rounded-lg border p-4 text-sm">
        <BonusTerms
          terms={resolvedBonusTerms}
          bonusMonth={job.bonusMonth}
          bonusDayOfMonth={job.bonusDayOfMonth}
          bonusDestination={bonusDestination}
          onUpdateJob={onUpdateJob}
          editable={editable}
          showAll={hasBonus || showsAllBonusTerms(resolvedBonusTerms)}
          formulaBonus={fullFormulaBonusEstimate.bonusGross}
          paidOnHint={
            paycheck.bonusPeriod != null
              ? `Pay period ${paycheck.bonusPeriod} of ${paycheck.periodsPerYear}`
              : undefined
          }
        />

        {hasBonus && (
          <div className="border-subtle mt-1 space-y-1 border-t pt-2">
            <FieldRow label="Gross">
              <span className="font-medium">
                {formatCurrency(bonusEstimate.bonusGross)}
              </span>
            </FieldRow>
            <FieldRow
              label={
                <>
                  Federal (supplemental)
                  <HelpTip text="Bonuses use the flat supplemental withholding rate instead of your regular bracket" />
                </>
              }
              hint={`at ${formatPercent(fedRate, 0)}`}
            >
              <span className="text-muted">
                -{formatCurrency(bonusEstimate.bonusFederalWithholding)}
              </span>
            </FieldRow>
            <FieldRow label="Social Security + Medicare">
              <span className="text-muted">
                -{formatCurrency(bonusEstimate.bonusFica)}
              </span>
            </FieldRow>
            {bonusAccounts.map((a) => (
              <FieldRow key={a.id} label={a.name}>
                <span className="text-muted">-{formatCurrency(a.amount)}</span>
              </FieldRow>
            ))}
            {bonusAccounts.length === 0 && (
              <p className="text-caption text-faint">
                No contributions are taken from this bonus. Turn on “Also taken
                from bonus checks” on an account under Contributions.
              </p>
            )}
            <FieldRow
              label={<span className="font-medium">Net</span>}
              hint={`${formatPercent(takeHomeRate, 1)} take-home`}
              className="border-subtle border-t pt-1"
            >
              <span className="font-semibold text-green-700 dark:text-green-400">
                {formatCurrency(bonusEstimate.bonusNet)}
              </span>
            </FieldRow>
          </div>
        )}
      </div>
    </div>
  );
}
