"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import type { ViewMode } from "@/lib/calculators/types";
import type {
  HouseholdSavings,
  SavingsTreatment,
} from "@/lib/pure/contributions";

// A real, nonzero contribution can still round to "0%" at the default 0
// decimals (e.g. $100/mo against a $250k household income is ~0.5%), which
// reads as "nothing here" even though dollars are genuinely flowing.  Fall
// back to 1 decimal only in that specific case so small-but-real categories
// stay visible without adding decimal noise to the common (larger) values.
function formatBreakdownPercent(fraction: number): string {
  if (fraction > 0 && Math.round(fraction * 100) === 0) {
    return formatPercent(fraction, 1);
  }
  return formatPercent(fraction);
}

const LINE_LABEL: Record<SavingsTreatment | "match", string> = {
  preTax: taxTypeLabel("preTax"),
  taxFree: taxTypeLabel("taxFree"),
  afterTax: "After-tax",
  hsa: "HSA",
  match: "Employer match",
};

const LINE_HELP: Record<SavingsTreatment | "match", string> = {
  preTax:
    "Traditional contributions. Reduces taxable income now, taxed on withdrawal in retirement.",
  taxFree:
    "Roth contributions. No tax break now, but withdrawals in retirement are tax-free.",
  afterTax: "Taxable/brokerage contributions (after-tax) within this group.",
  hsa: "HSA contributions within this group. Triple tax-advantaged — not Traditional or Roth.",
  match: "Employer contributions on top of your own.",
};

const VIEW_SUFFIX: Record<ViewMode, string> = {
  projected: "/year",
  blended: " est. this year",
  ytd: " so far",
};

/**
 * What the household savings rate is made of — the Financial Checkup's
 * Savings Rate row, expanded: dollars over compensation, by goal group
 * (Retirement / Portfolio) and tax treatment, with the employer-match switch.
 */
export function SavingsRateBreakdown({
  savings,
  viewMode,
  excludeMatch,
  onToggleMatch,
  highIncome,
  highIncomeThreshold,
  targets,
}: {
  savings: HouseholdSavings;
  viewMode: ViewMode;
  excludeMatch: boolean;
  onToggleMatch: () => void;
  highIncome: boolean;
  highIncomeThreshold: number;
  targets: { good: number; great: number };
}) {
  return (
    <div className="mt-1 mb-1 ml-6 space-y-2 text-xs">
      <div className="text-muted flex items-center justify-between gap-2">
        <span>
          {formatCurrency(savings.total)}
          {VIEW_SUFFIX[viewMode]} of {formatCurrency(savings.compensation)}{" "}
          {viewMode === "ytd" ? "earned" : "total comp"}
        </span>
        <button
          type="button"
          onClick={onToggleMatch}
          className="bg-surface-elevated hover:bg-surface-strong text-muted rounded-full px-2 py-0.5 whitespace-nowrap transition-colors"
        >
          {excludeMatch ? "Incl. match" : "Excl. match"}
        </button>
      </div>
      {excludeMatch && highIncome && (
        <p className="text-amber-600">
          Employer match left out above {formatCurrency(highIncomeThreshold)}{" "}
          income
        </p>
      )}
      {!excludeMatch && highIncome && (
        <p className="text-amber-600">
          Including employer match — not meaningful above{" "}
          {formatCurrency(highIncomeThreshold)} income
        </p>
      )}
      {savings.groups.map((g) => (
        <div key={g.group}>
          <div className="flex justify-between text-sm">
            <span className="text-muted capitalize">{g.group}</span>
            <span className="text-primary">
              {formatBreakdownPercent(g.share)}
            </span>
          </div>
          {g.lines.length > 0 && (
            <div className="mt-0.5 ml-3 space-y-0.5">
              {g.lines.map((l) => (
                <div key={l.key} className="text-muted flex justify-between">
                  <span>
                    {LINE_LABEL[l.key]}
                    <HelpTip text={LINE_HELP[l.key]} />
                  </span>
                  <span className="text-secondary font-medium">
                    {formatBreakdownPercent(l.share)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <p className="text-faint">
        {formatPercent(targets.good)} is good, {formatPercent(targets.great)}+
        is great · share of total compensation (salary + bonus)
      </p>
    </div>
  );
}
