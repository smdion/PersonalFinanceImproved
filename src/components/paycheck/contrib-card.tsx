"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { Toggle } from "@/components/ui/toggle";
import {
  formatCurrency,
  formatPercent,
  accountDisplayName,
} from "@/lib/utils/format";
import { confirm } from "@/components/ui/confirm-dialog";
import { InlineAccountType } from "./inline-account-type";
import type { ContribCardProps } from "./types";
import {
  categoriesWithIrsLimit,
  getLimitGroup,
  isOverflowTarget,
  getDisplayConfig,
  getAccountTypeConfig,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_LABELS as TAX_LABELS } from "@/lib/config/display-labels";
import type { AccountCategory } from "@/lib/config/account-types";

export function ContribCard({
  contrib: c,
  onUpdateContrib,
  onToggleAutoMax,
  onDeleteContrib,
  _methodLabel,
  salary,
  periodsPerYear,
  annualLimit,
  siblingAnnualContribs = 0,
  employerMatchAnnual = 0,
}: ContribCardProps) {
  return (
    <div className="bg-surface-primary border rounded-lg p-3 text-sm shadow-sm group/card relative">
      {onDeleteContrib && (
        <button
          onClick={async () => {
            if (
              await confirm(
                `Remove ${accountDisplayName({ accountType: c.accountType })} (${c.taxTreatment}) contribution account?`,
              )
            )
              onDeleteContrib(c.id);
          }}
          className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-red-100 text-red-500 hover:bg-red-200 text-[10px] leading-none flex items-center justify-center opacity-0 group-hover/card:opacity-100 transition-opacity"
          title="Delete contribution account"
        >
          ×
        </button>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {c.displayNameOverride ? (
            <span className="text-xs font-medium text-amber-600">
              {c.displayNameOverride}
            </span>
          ) : (
            <>
              <InlineAccountType
                value={c.accountType}
                onSave={(v) => onUpdateContrib(c.id, "accountType", v)}
              />
              {c.ownership === "joint" && (
                <span className="text-xs text-faint font-medium">(Joint)</span>
              )}
              {c.hsaCoverageType === "family" && (
                <span className="text-xs text-blue-600 font-medium">
                  (Family)
                </span>
              )}
              {/* Show account name for brokerage sub-types (ESPP, named accounts) */}
              {isOverflowTarget(c.accountType) && (c.subType || c.label) && (
                <span className="text-xs text-muted font-medium">
                  {getDisplayConfig(
                    c.accountType,
                    c.subType,
                  ).displayLabel.toLowerCase() !== c.accountType.toLowerCase()
                    ? getDisplayConfig(c.accountType, c.subType).displayLabel
                    : (c.label ?? c.subType)}
                </span>
              )}
            </>
          )}
          <span className="text-faint text-xs">
            {TAX_LABELS[c.taxTreatment] ?? c.taxTreatment}
          </span>
          {c.jobId === null && (
            <span
              className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded px-0.5 leading-tight"
              title="Also tracked as a budget item. Values are independent — editing here won't change the budget."
            >
              BG
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <InlineEdit
            value={c.contributionValue}
            onSave={(v) => onUpdateContrib(c.id, "contributionValue", v)}
            formatDisplay={(v) => {
              const num = Number(v);
              return c.contributionMethod === "percent_of_salary"
                ? formatPercent(num / 100)
                : formatCurrency(num);
            }}
            parseInput={(v) => v.replace(/[^0-9.]/g, "")}
            type="number"
            className="font-medium"
          />
          <select
            value={c.contributionMethod}
            onChange={(e) =>
              onUpdateContrib(c.id, "contributionMethod", e.target.value)
            }
            className="text-[10px] text-faint bg-transparent border-none cursor-pointer hover:text-secondary focus:outline-none appearance-none pr-3"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 0 center",
            }}
            title="Change contribution method"
          >
            <option value="percent_of_salary">% of salary</option>
            <option value="fixed_per_period">$/period</option>
            <option value="fixed_monthly">$/month</option>
            <option value="fixed_annual">$/year</option>
          </select>
        </div>
      </div>

      {/* Joint account clarification */}
      {c.ownership === "joint" && (
        <p className="text-[10px] text-faint mt-1">
          Shared contribution (total, not per person)
        </p>
      )}

      {/* Employer match info — editable */}
      {c.employerMatchType !== "none" && (
        <div className="text-xs text-muted mt-1 flex flex-wrap items-center gap-1">
          {getDisplayConfig(c.accountType, c.subType).hasDiscountBar ? (
            <>
              <InlineEdit
                value={c.employerMatchValue ?? "0"}
                onSave={(v) => onUpdateContrib(c.id, "employerMatchValue", v)}
                formatDisplay={(v) => formatPercent(Number(v) / 100, 0)}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-muted"
              />
              <span>discount</span>
            </>
          ) : c.employerMatchType === "fixed_annual" ? (
            <>
              <span>Employer:</span>
              <InlineEdit
                value={c.employerMatchValue ?? "0"}
                onSave={(v) => onUpdateContrib(c.id, "employerMatchValue", v)}
                formatDisplay={(v) => `${formatCurrency(Number(v))}/yr`}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-muted"
              />
            </>
          ) : (
            <>
              <span>Employer match:</span>
              <InlineEdit
                value={c.employerMatchValue ?? "0"}
                onSave={(v) => onUpdateContrib(c.id, "employerMatchValue", v)}
                formatDisplay={(v) => formatPercent(Number(v) / 100, 0)}
                parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                type="number"
                className="text-muted"
              />
              {c.employerMaxMatchPct && (
                <>
                  <span>up to</span>
                  <InlineEdit
                    value={c.employerMaxMatchPct}
                    onSave={(v) =>
                      onUpdateContrib(c.id, "employerMaxMatchPct", v)
                    }
                    formatDisplay={(v) =>
                      `${formatPercent(Number(v))} of salary`
                    }
                    parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                    type="number"
                    className="text-muted"
                  />
                </>
              )}
            </>
          )}
          <select
            value={c.employerMatchType}
            onChange={(e) =>
              onUpdateContrib(c.id, "employerMatchType", e.target.value)
            }
            className="text-[10px] text-faint bg-transparent border-none cursor-pointer hover:text-secondary focus:outline-none ml-1"
          >
            <option value="none">No match</option>
            <option value="percent_of_contribution">% of contribution</option>
            <option value="fixed_annual">Fixed annual</option>
          </select>
        </div>
      )}
      {c.employerMatchType === "none" && (
        <div className="text-[10px] text-faint mt-1">
          <select
            value="none"
            onChange={(e) =>
              onUpdateContrib(c.id, "employerMatchType", e.target.value)
            }
            className="text-[10px] text-faint bg-transparent border-none cursor-pointer hover:text-secondary focus:outline-none"
          >
            <option value="none">No employer match</option>
            <option value="percent_of_contribution">Add % match</option>
            <option value="fixed_annual">Add fixed annual match</option>
          </select>
        </div>
      )}

      {/* Auto-max toggle with explanation */}
      {categoriesWithIrsLimit().includes(c.accountType as AccountCategory) &&
        onToggleAutoMax &&
        (() => {
          // Compute what automax would set the contribution to
          // Account for sibling contributions sharing the same IRS limit (e.g., Trad 401k + Roth 401k)
          // For HSA: employer match counts toward the IRS limit, so subtract it from available space
          const currentValue = Number(c.contributionValue);
          const irsCategory = categoriesWithIrsLimit().includes(
            c.accountType as AccountCategory,
          );
          const matchCounts =
            irsCategory &&
            getAccountTypeConfig(c.accountType as AccountCategory)
              .matchCountsTowardLimit;
          const employerToward = matchCounts ? employerMatchAnnual : 0;
          const remainingLimit =
            annualLimit && annualLimit > 0
              ? Math.max(
                  0,
                  annualLimit - siblingAnnualContribs - employerToward,
                )
              : 0;
          let automaxPreview: {
            label: string;
            current: string;
            target: string;
            wouldChange: boolean;
            siblingNote?: string;
          } | null = null;

          if (remainingLimit > 0) {
            const siblingNote =
              siblingAnnualContribs > 0
                ? `${formatCurrency(siblingAnnualContribs)}/yr used by other ${(getLimitGroup(c.accountType as AccountCategory) ?? c.accountType).toUpperCase()} account`
                : undefined;

            if (
              c.contributionMethod === "percent_of_salary" &&
              salary &&
              salary > 0
            ) {
              const currentAnnual = salary * (currentValue / 100);
              const targetPct = Math.floor((remainingLimit / salary) * 100);
              const targetAnnual = salary * (targetPct / 100);
              automaxPreview = {
                label: `${targetPct}% of salary`,
                current: `${currentValue}% (${formatCurrency(currentAnnual)}/yr)`,
                target: `${targetPct}% (${formatCurrency(targetAnnual)}/yr)`,
                wouldChange: targetPct !== currentValue,
                siblingNote,
              };
            } else if (
              c.contributionMethod === "fixed_per_period" &&
              periodsPerYear
            ) {
              const currentAnnual = currentValue * periodsPerYear;
              const targetPerPeriod =
                Math.floor((remainingLimit / periodsPerYear) * 100) / 100;
              automaxPreview = {
                label: `${formatCurrency(targetPerPeriod)}/period`,
                current: `${formatCurrency(currentValue)}/period (${formatCurrency(currentAnnual)}/yr)`,
                target: `${formatCurrency(targetPerPeriod)}/period (${formatCurrency(targetPerPeriod * periodsPerYear)}/yr)`,
                wouldChange: Math.abs(targetPerPeriod - currentValue) > 0.01,
                siblingNote,
              };
            } else if (c.contributionMethod === "fixed_monthly") {
              const currentAnnual = currentValue * 12;
              const targetMonthly =
                Math.floor((remainingLimit / 12) * 100) / 100;
              automaxPreview = {
                label: `${formatCurrency(targetMonthly)}/month`,
                current: `${formatCurrency(currentValue)}/month (${formatCurrency(currentAnnual)}/yr)`,
                target: `${formatCurrency(targetMonthly)}/month (${formatCurrency(targetMonthly * 12)}/yr)`,
                wouldChange: Math.abs(targetMonthly - currentValue) > 0.01,
                siblingNote,
              };
            } else if (c.contributionMethod === "fixed_annual") {
              automaxPreview = {
                label: formatCurrency(remainingLimit),
                current: `${formatCurrency(currentValue)}/yr`,
                target: `${formatCurrency(remainingLimit)}/yr`,
                wouldChange: Math.abs(remainingLimit - currentValue) > 0.01,
                siblingNote,
              };
            }
          } else if (
            annualLimit &&
            annualLimit > 0 &&
            siblingAnnualContribs >= annualLimit
          ) {
            // Sibling already uses the full limit
            automaxPreview = {
              label: "$0",
              current:
                c.contributionMethod === "percent_of_salary"
                  ? `${currentValue}%`
                  : formatCurrency(currentValue),
              target: "$0 (limit fully used by other account)",
              wouldChange: currentValue > 0,
            };
          }

          return (
            <div className="mt-2 pt-2 border-t border-subtle">
              <div className="flex items-center gap-2">
                <Toggle
                  checked={c.autoMaximize}
                  onChange={(v) => {
                    // When toggling ON, compute the target contribution value
                    let targetValue: number | undefined;
                    if (v && remainingLimit > 0) {
                      if (
                        c.contributionMethod === "percent_of_salary" &&
                        salary &&
                        salary > 0
                      ) {
                        targetValue = Math.floor(
                          (remainingLimit / salary) * 100,
                        );
                      } else if (
                        c.contributionMethod === "fixed_per_period" &&
                        periodsPerYear
                      ) {
                        targetValue =
                          Math.floor((remainingLimit / periodsPerYear) * 100) /
                          100;
                      } else if (c.contributionMethod === "fixed_monthly") {
                        targetValue =
                          Math.floor((remainingLimit / 12) * 100) / 100;
                      } else if (c.contributionMethod === "fixed_annual") {
                        targetValue = remainingLimit;
                      }
                    }
                    onToggleAutoMax(c.id, v, targetValue);
                  }}
                  label="Auto-max"
                  size="xs"
                />
                {automaxPreview && !c.autoMaximize && (
                  <span className="text-[10px] text-faint">
                    &rarr; {automaxPreview.label}
                  </span>
                )}
              </div>
              {/* Preview: show what would change when NOT enabled */}
              {!c.autoMaximize &&
                automaxPreview &&
                automaxPreview.wouldChange && (
                  <div className="text-[10px] mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    <div className="flex justify-between">
                      <span className="text-muted">Current:</span>
                      <span className="text-secondary">
                        {automaxPreview.current}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-600 font-medium">
                        Auto-max:
                      </span>
                      <span className="text-amber-700 font-medium">
                        {automaxPreview.target}
                      </span>
                    </div>
                    <p className="text-faint mt-0.5">
                      IRS limit: {formatCurrency(annualLimit!)}/yr
                    </p>
                  </div>
                )}
              {!c.autoMaximize &&
                automaxPreview &&
                !automaxPreview.wouldChange && (
                  <p className="text-[10px] text-green-600 mt-1">
                    Already at max — no change needed
                  </p>
                )}
              {/* Status when enabled */}
              {c.autoMaximize && (
                <p className="text-[10px] text-green-600 mt-1">
                  {c.contributionMethod === "percent_of_salary"
                    ? `Set to ${formatPercent(currentValue / 100)} of salary (${formatCurrency(salary ? salary * (currentValue / 100) : 0)}/yr toward ${formatCurrency(annualLimit!)} limit)`
                    : c.contributionMethod === "fixed_per_period"
                      ? `Set to ${formatCurrency(currentValue)}/period (${formatCurrency(currentValue * periodsPerYear!)}/yr toward ${formatCurrency(annualLimit!)} limit)`
                      : c.contributionMethod === "fixed_monthly"
                        ? `Set to ${formatCurrency(currentValue)}/month (${formatCurrency(currentValue * 12)}/yr toward ${formatCurrency(annualLimit!)} limit)`
                        : `Set to ${formatCurrency(currentValue)}/yr toward ${formatCurrency(annualLimit!)} limit`}
                </p>
              )}
            </div>
          );
        })()}
    </div>
  );
}
