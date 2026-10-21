"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { ChipToggle } from "@/components/ui/chip-toggle";
import {
  formatCurrency,
  formatPercent,
  formatSavingsRate,
} from "@/lib/utils/format";
import { taxTypeLabel } from "@/lib/utils/colors";
import type { ViewMode } from "@/lib/calculators/types";
import type {
  HouseholdSavings,
  SavingsTreatment,
} from "@/lib/pure/contributions";

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
 * Without the toggle handlers it's read-only (the Milestones page shows
 * Money Guy's fixed definition this way).
 */
export function SavingsRateBreakdown({
  savings,
  viewMode,
  excludeMatch,
  onToggleMatch,
  includePortfolio,
  onTogglePortfolio,
  highIncome,
  highIncomeThreshold,
  targets,
}: {
  savings: HouseholdSavings;
  viewMode: ViewMode;
  excludeMatch: boolean;
  onToggleMatch?: () => void;
  includePortfolio: boolean;
  onTogglePortfolio?: () => void;
  highIncome: boolean;
  highIncomeThreshold: number;
  targets?: { good: number; great: number };
}) {
  return (
    <div className="mt-1 mb-1 ml-6 space-y-2 text-xs">
      <div className="text-muted space-y-1">
        <p>
          {formatCurrency(savings.total)}
          {VIEW_SUFFIX[viewMode]} of {formatCurrency(savings.compensation)}{" "}
          {viewMode === "ytd" ? "earned" : "total comp"}
        </p>
        {onToggleMatch && onTogglePortfolio && (
          // What the rate counts — the same household setting and switches
          // as the Contributions page.
          <span className="flex flex-wrap items-center gap-1.5">
            <span>Counts</span>
            <ChipToggle
              isChecked={!excludeMatch}
              onChange={onToggleMatch}
              label="Employer match"
              title="Count the employer match (also on the Contributions page)"
            />
            <ChipToggle
              isChecked={includePortfolio}
              onChange={onTogglePortfolio}
              label="Portfolio"
              title="Count brokerage and other non-retirement savings (also on the Contributions page)"
            />
          </span>
        )}
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
            <span className="text-primary">{formatSavingsRate(g.share)}</span>
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
                    {formatSavingsRate(l.share)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {targets && (
        <p className="text-faint">
          {formatPercent(targets.good)} is good, {formatPercent(targets.great)}+
          is great · share of total compensation (salary + bonus)
        </p>
      )}
    </div>
  );
}
