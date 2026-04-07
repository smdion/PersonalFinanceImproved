"use client";

import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { SectionHeader } from "./section-header";
import type { PaycheckResult, ViewMode } from "./types";
import type { BlendedAnnualTotals } from "@/lib/calculators/types/calculators";

export function AnnualSummary({
  paycheck,
  mode,
  blendedAnnual,
}: {
  paycheck: PaycheckResult;
  mode: ViewMode;
  blendedAnnual?: BlendedAnnualTotals;
}) {
  // Blended mode with data available
  if (mode === "blended" && blendedAnnual) {
    return (
      <div className="space-y-2">
        <SectionHeader>Year-End Estimate</SectionHeader>
        <div className="bg-surface-sunken rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Gross</span>
            <span className="font-medium">
              {formatCurrency(blendedAnnual.gross)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Pre-tax deductions</span>
            <span>{formatCurrency(blendedAnnual.preTaxDeductions)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Federal W/H</span>
            <span>{formatCurrency(blendedAnnual.federalWithholding)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">
              FICA
              <HelpTip text="Combined Social Security + Medicare taxes (your share)" />
            </span>
            <span>
              {formatCurrency(
                blendedAnnual.ficaSS + blendedAnnual.ficaMedicare,
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Post-tax deductions</span>
            <span>{formatCurrency(blendedAnnual.postTaxDeductions)}</span>
          </div>
          <div className="border-t pt-2 flex justify-between font-semibold">
            <span>Net</span>
            <span className="text-green-700">
              {formatCurrency(blendedAnnual.netPay)}
            </span>
          </div>
          <p className="text-xs text-faint">
            {blendedAnnual.segments
              .map(
                (seg) =>
                  `${seg.periods} periods at ${formatCurrency(seg.salary)}`,
              )
              .join(" + ")}
          </p>
        </div>
      </div>
    );
  }

  // Blended mode without data — fall back to projected
  const effectiveMode = mode === "blended" ? "projected" : mode;

  const multiplier =
    effectiveMode === "projected"
      ? paycheck.periodsPerYear
      : paycheck.periodsElapsedYtd;
  const label =
    effectiveMode === "projected" ? "Projected Annual" : "Year-to-Date";

  return (
    <div className="space-y-2">
      <SectionHeader>{label}</SectionHeader>
      <div className="bg-surface-sunken rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Gross</span>
          <span className="font-medium">
            {formatCurrency(paycheck.gross * multiplier)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Pre-tax deductions</span>
          <span>
            {formatCurrency(
              paycheck.preTaxDeductions.reduce((s, d) => s + d.amount, 0) *
                multiplier,
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Federal W/H</span>
          <span>
            {formatCurrency(paycheck.federalWithholding * multiplier)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">
            FICA
            <HelpTip text="Combined Social Security + Medicare taxes (your share)" />
          </span>
          <span>
            {formatCurrency(
              (paycheck.ficaSS + paycheck.ficaMedicare) * multiplier,
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Post-tax deductions</span>
          <span>
            {formatCurrency(
              paycheck.postTaxDeductions.reduce((s, d) => s + d.amount, 0) *
                multiplier,
            )}
          </span>
        </div>
        <div className="border-t pt-2 flex justify-between font-semibold">
          <span>Net</span>
          <span className="text-green-700">
            {formatCurrency(paycheck.netPay * multiplier)}
          </span>
        </div>
        <p className="text-xs text-faint">
          {multiplier} of {paycheck.periodsPerYear} periods
        </p>
      </div>
    </div>
  );
}
