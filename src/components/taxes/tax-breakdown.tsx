"use client";

/**
 * This year's household tax, line by line — the Taxes page. The household
 * tax (calculateHouseholdTax) on household annual income, plus withholding
 * so far from the year schedule and the tax notes (e.g. Additional
 * Medicare owed at filing). The dashboard shows only the two-line summary.
 */
import { Card } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import {
  formatCurrency,
  formatPercent,
  maskAmountsInText,
} from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { withheldThroughPeriod } from "@/lib/calculators/paycheck";
import type { RouterOutputs } from "@/lib/trpc";

type PaycheckSummary = RouterOutputs["paycheck"]["computeSummary"];

function Row({
  label,
  value,
  help,
  strong,
}: {
  label: string;
  value: string;
  help?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted inline-flex items-center">
        {label}
        {help && <HelpTip text={help} />}
      </span>
      <span className={strong ? "text-primary font-semibold" : "text-primary"}>
        {value}
      </span>
    </div>
  );
}

export function TaxBreakdown({ data }: { data: PaycheckSummary }) {
  const income = data.householdIncome;
  const tax = data.householdTax;
  if (!income || !tax) return null;
  const people = data.people.filter((d) => d.paycheck);
  const withheld = people.map((d) =>
    withheldThroughPeriod(
      d.paycheck!.yearSchedule,
      d.paycheck!.periodsElapsedYtd,
    ),
  );
  return (
    <Card title={`${data.taxYear} tax (projected)`}>
      <div className="space-y-1 text-sm">
        <Row
          label={
            income.otherCashPay > 0
              ? "Salary + bonus + other pay"
              : "Salary + bonus"
          }
          value={formatCurrency(income.gross)}
          help="Household annual income: salary plus your set bonus (the formula if none is set), plus any other pay on your checks."
        />
        {income.imputedIncome > 0 && (
          <Row
            label="Taxable benefits (not paid)"
            value={`+${formatCurrency(income.imputedIncome)}`}
            help="Benefits taxed as pay but never paid to you — e.g. group life insurance over $50k. They raise your taxable wages, not your take-home."
          />
        )}
        <Row
          label="Pre-tax money"
          value={`−${formatCurrency(income.preTaxFederal)}`}
          help="Pre-tax 401(k), payroll HSA and pre-tax deductions, including what the bonus check takes."
        />
        <Row label="AGI (wages)" value={formatCurrency(tax.wageAgi)} />
        <Row label="Taxable income" value={formatCurrency(tax.taxableIncome)} />
        <div className="border-subtle my-2 border-t" />
        <Row
          label="Federal income tax"
          value={formatCurrency(tax.federalTax)}
        />
        <Row label="Social Security" value={formatCurrency(tax.ficaSS)} />
        <Row
          label="Medicare"
          value={formatCurrency(tax.ficaMedicare)}
          help={
            tax.additionalMedicare > 0
              ? `Includes ${formatCurrency(tax.additionalMedicare)} Additional Medicare Tax.`
              : undefined
          }
        />
        <Row label="Total" value={formatCurrency(tax.totalTax)} strong />
        <Row
          label="Effective · marginal"
          value={`${formatPercent(tax.effectiveRate, 1)} · ${formatPercent(tax.marginalRate, 1)}`}
          help="Effective: federal income tax ÷ AGI, the way your tax history is figured. Marginal: the bracket your top dollar is in."
        />
        <div className="border-subtle my-2 border-t" />
        <Row
          label="Withheld so far (federal + FICA)"
          value={formatCurrency(sumBy(withheld, (w) => w.federal + w.fica))}
        />
        {tax.warnings.map((w) => (
          <p key={w} className="text-faint pt-1 text-xs">
            {maskAmountsInText(w)}
          </p>
        ))}
      </div>
    </Card>
  );
}
