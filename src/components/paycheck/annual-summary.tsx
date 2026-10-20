"use client";

import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FieldRow } from "@/components/ui/field-row";
import { SectionHeader } from "./section-header";
import type { PaycheckResult, ViewMode } from "./types";
import type { BlendedAnnualTotals } from "@/lib/calculators/types/calculators";

type Totals = {
  gross: number;
  preTax: number;
  federal: number;
  fica: number;
  postTax: number;
  net: number;
};

/** The year's totals in the same row order as the pay stub. */
function TotalsPanel({
  title,
  totals,
  footnote,
}: {
  title: string;
  totals: Totals;
  footnote: string;
}) {
  return (
    <div className="space-y-2">
      <SectionHeader>{title}</SectionHeader>
      <div className="bg-surface-sunken border-subtle space-y-1.5 rounded-lg border p-4 text-sm">
        <FieldRow label="Gross pay">
          <span className="font-medium">{formatCurrency(totals.gross)}</span>
        </FieldRow>
        <FieldRow
          label={<span className="text-muted">Before-tax deductions</span>}
        >
          <span className="text-muted">{formatCurrency(totals.preTax)}</span>
        </FieldRow>
        <FieldRow
          label={<span className="text-muted">Federal withholding</span>}
        >
          <span className="text-muted">{formatCurrency(totals.federal)}</span>
        </FieldRow>
        <FieldRow
          label={
            <span className="text-muted">
              Social Security + Medicare
              <HelpTip text="Your share of FICA" />
            </span>
          }
        >
          <span className="text-muted">{formatCurrency(totals.fica)}</span>
        </FieldRow>
        <FieldRow
          label={<span className="text-muted">After-tax deductions</span>}
        >
          <span className="text-muted">{formatCurrency(totals.postTax)}</span>
        </FieldRow>
        <FieldRow
          label={<span className="font-semibold">Net pay</span>}
          className="border-strong border-t pt-1.5"
        >
          <span className="font-semibold text-green-700 dark:text-green-400">
            {formatCurrency(totals.net)}
          </span>
        </FieldRow>
        <p className="text-caption text-faint">{footnote}</p>
      </div>
    </div>
  );
}

export function AnnualSummary({
  paycheck,
  mode,
  blendedAnnual,
}: {
  paycheck: PaycheckResult;
  mode: ViewMode;
  blendedAnnual?: BlendedAnnualTotals;
}) {
  if (mode === "blended" && blendedAnnual) {
    return (
      <TotalsPanel
        title="Year-end estimate"
        totals={{
          gross: blendedAnnual.gross,
          preTax: blendedAnnual.preTaxDeductions,
          federal: blendedAnnual.federalWithholding,
          fica: blendedAnnual.ficaSS + blendedAnnual.ficaMedicare,
          postTax: blendedAnnual.postTaxDeductions,
          net: blendedAnnual.netPay,
        }}
        footnote={blendedAnnual.segments
          .map(
            (seg) => `${seg.periods} checks at ${formatCurrency(seg.salary)}`,
          )
          .join(" + ")}
      />
    );
  }

  // Year-end estimate without salary-change data falls back to projected.
  const ytd = mode === "ytd";
  const checks = ytd ? paycheck.periodsElapsedYtd : paycheck.periodsPerYear;
  const sum = (lines: { amount: number }[]) =>
    lines.reduce((s, d) => s + d.amount, 0);
  return (
    <TotalsPanel
      title={ytd ? "Year to date" : "Projected year"}
      totals={{
        gross: paycheck.gross * checks,
        preTax: sum(paycheck.preTaxDeductions) * checks,
        federal: paycheck.federalWithholding * checks,
        fica: (paycheck.ficaSS + paycheck.ficaMedicare) * checks,
        postTax: sum(paycheck.postTaxDeductions) * checks,
        net: paycheck.netPay * checks,
      }}
      footnote={`${checks} of ${paycheck.periodsPerYear} checks`}
    />
  );
}
