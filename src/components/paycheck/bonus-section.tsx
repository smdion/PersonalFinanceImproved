"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { Toggle } from "@/components/ui/toggle";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { SectionHeader } from "./section-header";
import type { PaycheckResult } from "./types";
import type { BonusEstimate } from "@/lib/calculators/types/calculators";

export function BonusSection({
  paycheck,
  fullFormulaBonusEstimate,
  job,
  resolvedBonusTerms,
  onUpdateJob,
  readOnly,
  salaryReadOnly,
}: {
  paycheck: PaycheckResult;
  /** The nominal formula bonus, ignoring any current-year pin — shown as
   *  "(target: $X)" next to the Actual field so pinning a real number
   *  doesn't hide what the formula would otherwise say. */
  fullFormulaBonusEstimate: BonusEstimate;
  job: {
    bonusMonth: number | null;
    bonusDayOfMonth: number | null;
    include401kInBonus: boolean;
    includeBonusInContributions: boolean;
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
  onUpdateJob: (field: string, value: string) => void;
  /** Sandbox/preview mode — bonus terms are shown but not editable. */
  readOnly?: boolean;
  /** Mirrors PersonPaycheck's salary padlock — bonus %, multiplier, the
   *  current-year Actual pin, "Paid in", and the two toggles below ALL live
   *  on the same Salary Profile entry as salary now (see
   *  writeSalaryProfileEntry in paycheck/page.tsx and SalaryProfileEntry in
   *  server/helpers/salary.ts), so every editable field in this section
   *  gates on this same lock. */
  salaryReadOnly?: boolean;
}) {
  const { bonusEstimate } = paycheck;
  if (bonusEstimate.bonusGross === 0 && resolvedBonusTerms.bonusPercent === 0)
    return null;
  const bonusTermsEditable = !readOnly && !salaryReadOnly;

  return (
    <div className="space-y-2">
      <SectionHeader>Bonus Estimate</SectionHeader>
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-1 text-sm">
        <div className="space-y-1 mb-1">
          <div className="flex items-center gap-1">
            <Toggle
              isChecked={job.include401kInBonus}
              onChange={(v) => onUpdateJob("include401kInBonus", String(v))}
              label="Deduct 401k from bonus"
              size="xs"
              disabled={!bonusTermsEditable}
            />
            <HelpTip text="When on, 401k contributions are withheld from the bonus paycheck just like a regular paycheck." />
          </div>
          <div className="flex items-center gap-1">
            <Toggle
              isChecked={job.includeBonusInContributions}
              onChange={(v) =>
                onUpdateJob("includeBonusInContributions", String(v))
              }
              label="Contributions on salary + bonus"
              size="xs"
              disabled={!bonusTermsEditable}
            />
            <HelpTip text="When on, percent-of-salary contributions (e.g. 401k at 16%) are calculated against salary + bonus instead of salary alone." />
          </div>
        </div>
        <div className="flex justify-between items-center">
          <span>Bonus %</span>
          <InlineEdit
            value={String(resolvedBonusTerms.bonusPercent * 100)}
            onSave={(v) => {
              const pct = Number(v.replace(/[^0-9.]/g, "")) / 100;
              onUpdateJob("bonusPercent", String(pct));
            }}
            formatDisplay={(v) => formatPercent(Number(v) / 100, 1)}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="font-medium"
            isEditable={bonusTermsEditable}
          />
        </div>
        <div className="flex justify-between items-center">
          <span>
            Multiplier
            <HelpTip text="Scales your bonus target — 1.0x means on-target, higher means exceeding expectations" />
          </span>
          <InlineEdit
            value={String(resolvedBonusTerms.bonusMultiplier)}
            onSave={(v) =>
              onUpdateJob("bonusMultiplier", v.replace(/[^0-9.]/g, ""))
            }
            formatDisplay={(v) => `${Number(v).toFixed(2)}x`}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="font-medium"
            isEditable={bonusTermsEditable}
          />
        </div>
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1">
            {new Date().getFullYear()} Actual
            <HelpTip text="Pin this year's actual bonus once it's paid out, instead of the calculated salary x percent x multiplier. Only affects this calendar year — next year's projections still use the full formula." />
            {resolvedBonusTerms.bonusOverride === null && (
              <span className="text-caption text-faint">
                (calc: {formatCurrency(fullFormulaBonusEstimate.bonusGross)})
              </span>
            )}
          </span>
          <InlineEdit
            value={
              resolvedBonusTerms.bonusOverride !== null
                ? String(resolvedBonusTerms.bonusOverride)
                : ""
            }
            onSave={(v) => {
              const cleaned = v.replace(/[^0-9.]/g, "");
              onUpdateJob("bonusOverride", cleaned);
            }}
            formatDisplay={(v) =>
              v && Number(v) > 0 ? formatCurrency(Number(v)) : "—"
            }
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className={`font-medium ${resolvedBonusTerms.bonusOverride !== null ? "text-amber-700" : "text-faint"}`}
            isEditable={bonusTermsEditable}
          />
        </div>
        <div className="flex justify-between items-center">
          <span>
            Paid in
            <HelpTip text="Date when bonus is typically paid. Helps model contribution timing and cash flow." />
          </span>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={
                job.bonusMonth != null
                  ? `${new Date().getFullYear()}-${String(job.bonusMonth).padStart(2, "0")}-${String(job.bonusDayOfMonth ?? 1).padStart(2, "0")}`
                  : ""
              }
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  onUpdateJob("bonusMonth", "");
                  onUpdateJob("bonusDayOfMonth", "");
                } else {
                  const d = new Date(v + "T00:00:00");
                  onUpdateJob("bonusMonth", String(d.getMonth() + 1));
                  onUpdateJob("bonusDayOfMonth", String(d.getDate()));
                }
              }}
              disabled={!bonusTermsEditable}
              className="text-sm border rounded px-2 py-0.5 bg-surface-primary font-medium"
            />
            {bonusTermsEditable && job.bonusMonth != null && (
              <button
                type="button"
                onClick={() => {
                  onUpdateJob("bonusMonth", "");
                  onUpdateJob("bonusDayOfMonth", "");
                }}
                className="text-xs text-faint hover:text-secondary"
                title="Clear date"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {paycheck.bonusPeriod != null && (
          <div className="flex justify-between text-muted text-xs">
            <span>Falls in pay period</span>
            <span className="font-medium">
              {paycheck.bonusPeriod} of {paycheck.periodsPerYear}
            </span>
          </div>
        )}
        {bonusEstimate.bonusGross > 0 &&
          (() => {
            const fedRate =
              bonusEstimate.bonusGross > 0
                ? bonusEstimate.bonusFederalWithholding /
                  bonusEstimate.bonusGross
                : 0;
            const totalTaxRate =
              bonusEstimate.bonusGross > 0
                ? (bonusEstimate.bonusFederalWithholding +
                    bonusEstimate.bonusFica +
                    bonusEstimate.bonusContributions) /
                  bonusEstimate.bonusGross
                : 0;
            return (
              <>
                <div className="flex justify-between">
                  <span>Gross</span>
                  <span className="font-medium">
                    {formatCurrency(bonusEstimate.bonusGross)}
                  </span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>
                    Federal (supplemental)
                    <HelpTip text="Bonuses use the flat supplemental withholding rate instead of your regular bracket" />
                    <span className="text-xs text-faint ml-1">
                      @ {formatPercent(fedRate, 0)}
                    </span>
                  </span>
                  <span>
                    -{formatCurrency(bonusEstimate.bonusFederalWithholding)}
                  </span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>FICA</span>
                  <span>-{formatCurrency(bonusEstimate.bonusFica)}</span>
                </div>
                {bonusEstimate.bonusContributions > 0 && (
                  <div className="flex justify-between text-muted">
                    <span>401k / contributions</span>
                    <span>
                      -{formatCurrency(bonusEstimate.bonusContributions)}
                    </span>
                  </div>
                )}
                <div className="border-t border-yellow-200 pt-1 flex justify-between font-medium">
                  <span>
                    Net
                    <span className="text-xs text-faint font-normal ml-1">
                      ({formatPercent(1 - totalTaxRate, 1)} take-home)
                    </span>
                  </span>
                  <span className="text-green-700">
                    {formatCurrency(bonusEstimate.bonusNet)}
                  </span>
                </div>
              </>
            );
          })()}
      </div>
    </div>
  );
}
