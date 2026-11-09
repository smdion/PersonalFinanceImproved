import type { ContributionCardProps } from "./types";
import { Toggle } from "@/components/ui/toggle";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  categoriesWithIrsLimit,
  getLimitGroup,
  getAccountTypeConfig,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";

/** The IRS-limit card's auto-max toggle and its preview. */
export function renderAutoMax(
  annualLimit: ContributionCardProps["annualLimit"],
  c: ContributionCardProps["contrib"],
  employerMatchAnnual: number,
  onToggleAutoMax: NonNullable<ContributionCardProps["onToggleAutoMax"]>,
  periodsPerYear: ContributionCardProps["periodsPerYear"],
  readOnly: ContributionCardProps["readOnly"],
  salary: ContributionCardProps["salary"],
  siblingAnnualContributions: number,
) {
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
      ? Math.max(0, annualLimit - siblingAnnualContributions - employerToward)
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
      siblingAnnualContributions > 0
        ? `${formatCurrency(siblingAnnualContributions)}/yr used by other ${(getLimitGroup(c.accountType as AccountCategory) ?? c.accountType).toUpperCase()} account`
        : undefined;

    if (c.contributionMethod === "percent_of_salary" && salary && salary > 0) {
      const currentAnnual = salary * (currentValue / 100);
      const targetPercent = Math.floor((remainingLimit / salary) * 100);
      const targetAnnual = salary * (targetPercent / 100);
      automaxPreview = {
        label: `${targetPercent}% of salary`,
        current: `${currentValue}% (${formatCurrency(currentAnnual)}/yr)`,
        target: `${targetPercent}% (${formatCurrency(targetAnnual)}/yr)`,
        wouldChange: targetPercent !== currentValue,
        siblingNote,
      };
    } else if (c.contributionMethod === "fixed_per_period" && periodsPerYear) {
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
      const targetMonthly = Math.floor((remainingLimit / 12) * 100) / 100;
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
    siblingAnnualContributions >= annualLimit
  ) {
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
    <div className="border-subtle mt-2 border-t pt-2">
      <div className="flex items-center gap-2">
        <Toggle
          isChecked={c.autoMaximize}
          onChange={(v) => {
            let targetValue: number | undefined;
            if (v && remainingLimit > 0) {
              if (
                c.contributionMethod === "percent_of_salary" &&
                salary &&
                salary > 0
              ) {
                targetValue = Math.floor((remainingLimit / salary) * 100);
              } else if (
                c.contributionMethod === "fixed_per_period" &&
                periodsPerYear
              ) {
                targetValue =
                  Math.floor((remainingLimit / periodsPerYear) * 100) / 100;
              } else if (c.contributionMethod === "fixed_monthly") {
                targetValue = Math.floor((remainingLimit / 12) * 100) / 100;
              } else if (c.contributionMethod === "fixed_annual") {
                targetValue = remainingLimit;
              }
            }
            onToggleAutoMax(c.id, v, targetValue);
          }}
          label="Auto-max"
          size="xs"
          disabled={readOnly}
        />
        {automaxPreview && !c.autoMaximize && (
          <span className="text-caption text-faint">
            &rarr; {automaxPreview.label}
          </span>
        )}
      </div>
      {!c.autoMaximize && automaxPreview && automaxPreview.wouldChange && (
        <div className="text-caption mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1">
          <div className="flex justify-between">
            <span className="text-muted">Current:</span>
            <span className="text-secondary">{automaxPreview.current}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-amber-600">Auto-max:</span>
            <span className="font-medium text-amber-700">
              {automaxPreview.target}
            </span>
          </div>
          <p className="text-faint mt-0.5">
            IRS limit: {formatCurrency(annualLimit!)}/yr
          </p>
        </div>
      )}
      {!c.autoMaximize && automaxPreview && !automaxPreview.wouldChange && (
        <p className="text-caption mt-1 text-green-600">
          Already at max — no change needed
        </p>
      )}
      {c.autoMaximize && (
        <p className="text-caption mt-1 text-green-600">
          {c.contributionMethod === "percent_of_salary"
            ? `Set to ${formatPercent(currentValue / 100)} of salary (${formatCurrency(salary ? salary * (currentValue / 100) : 0, 0)}/yr toward ${formatCurrency(annualLimit!, 0)} limit)`
            : c.contributionMethod === "fixed_per_period"
              ? `Set to ${formatCurrency(currentValue)}/period (${formatCurrency(currentValue * periodsPerYear!, 0)}/yr toward ${formatCurrency(annualLimit!, 0)} limit)`
              : c.contributionMethod === "fixed_monthly"
                ? `Set to ${formatCurrency(currentValue)}/month (${formatCurrency(currentValue * 12, 0)}/yr toward ${formatCurrency(annualLimit!, 0)} limit)`
                : `Set to ${formatCurrency(currentValue, 0)}/yr toward ${formatCurrency(annualLimit!, 0)} limit`}
        </p>
      )}
    </div>
  );
}
