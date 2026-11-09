import type { ContributionCardProps } from "../paycheck/types";
import { Toggle } from "@/components/ui/toggle";
import type { AccountCategory } from "@/lib/config/account-types";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  autoMaxView,
  type AutoMaxTarget,
} from "@/lib/pure/contributions/auto-max";

type AutoMaxProps = {
  contribution: ContributionCardProps["contrib"];
  annualLimit: ContributionCardProps["annualLimit"];
  employerMatchAnnual: number;
  siblingAnnualContributions: number;
  salary: ContributionCardProps["salary"];
  periodsPerYear: ContributionCardProps["periodsPerYear"];
  readOnly: ContributionCardProps["readOnly"];
  onToggleAutoMax: NonNullable<ContributionCardProps["onToggleAutoMax"]>;
};

type Preview = {
  label: string;
  current: string;
  target: string;
  wouldChange: boolean;
};

/** The preview's text for a contribution that fills the room left. */
function targetPreview(t: AutoMaxTarget): Preview {
  const { wouldChange } = t;
  const yearly = (perUnit: string, annual: number) =>
    `${perUnit} (${formatCurrency(annual)}/yr)`;
  switch (t.method) {
    case "percent_of_salary":
      return {
        label: `${t.target}% of salary`,
        current: yearly(`${t.current}%`, t.currentAnnual),
        target: yearly(`${t.target}%`, t.targetAnnual),
        wouldChange,
      };
    case "fixed_per_period":
      return {
        label: `${formatCurrency(t.target)}/paycheck`,
        current: yearly(
          `${formatCurrency(t.current)}/paycheck`,
          t.currentAnnual,
        ),
        target: yearly(`${formatCurrency(t.target)}/paycheck`, t.targetAnnual),
        wouldChange,
      };
    case "fixed_monthly":
      return {
        label: `${formatCurrency(t.target)}/month`,
        current: yearly(`${formatCurrency(t.current)}/month`, t.currentAnnual),
        target: yearly(`${formatCurrency(t.target)}/month`, t.targetAnnual),
        wouldChange,
      };
    case "fixed_annual":
      return {
        label: formatCurrency(t.target),
        current: `${formatCurrency(t.current)}/yr`,
        target: `${formatCurrency(t.target)}/yr`,
        wouldChange,
      };
  }
}

/** The line under an auto-maxed contribution: its value, a year of it, and
 *  the limit. */
function autoMaxedLine(
  method: string,
  currentValue: number,
  currentAnnual: number,
  annualLimit: number | undefined,
): string {
  const toward = `/yr toward ${formatCurrency(annualLimit!, 0)} limit`;
  const annual = formatCurrency(currentAnnual, 0);
  if (method === "percent_of_salary")
    return `Set to ${formatPercent(currentValue / 100)} of salary (${annual}${toward})`;
  if (method === "fixed_per_period")
    return `Set to ${formatCurrency(currentValue)}/paycheck (${annual}${toward})`;
  if (method === "fixed_monthly")
    return `Set to ${formatCurrency(currentValue)}/month (${annual}${toward})`;
  return `Set to ${formatCurrency(currentValue, 0)}${toward}`;
}

/** The IRS-limit card's auto-max toggle and its preview. */
export function AutoMax({
  contribution: c,
  annualLimit,
  employerMatchAnnual,
  siblingAnnualContributions,
  salary,
  periodsPerYear,
  readOnly,
  onToggleAutoMax,
}: AutoMaxProps) {
  const currentValue = Number(c.contributionValue);
  const view = autoMaxView({
    accountType: c.accountType as AccountCategory,
    contributionMethod: c.contributionMethod,
    currentValue,
    annualLimit,
    employerMatchAnnual,
    siblingAnnualContributions,
    salary,
    periodsPerYear,
  });
  if (!view.hasIrsLimit) return null;
  const automaxPreview: Preview | null = view.target
    ? targetPreview(view.target)
    : view.limitUsedByOthers
      ? {
          label: "$0",
          current:
            c.contributionMethod === "percent_of_salary"
              ? `${currentValue}%`
              : formatCurrency(currentValue),
          target: "$0 (limit fully used by other account)",
          wouldChange: currentValue > 0,
        }
      : null;

  return (
    <div className="border-subtle mt-2 border-t pt-2">
      <div className="flex items-center gap-2">
        <Toggle
          isChecked={c.autoMaximize}
          onChange={(v) =>
            onToggleAutoMax(c.id, v, v ? view.target?.target : undefined)
          }
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
          {autoMaxedLine(
            c.contributionMethod,
            currentValue,
            view.currentAnnual,
            annualLimit,
          )}
        </p>
      )}
    </div>
  );
}
