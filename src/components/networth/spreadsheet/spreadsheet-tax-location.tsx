"use client";

/** Tax Location YTD — two side-by-side mini tables showing Retirement and Portfolio
 *  tax-type distribution. Labels from taxTypeLabel() (lib/utils/colors.ts) —
 *  the same source tax-location-pie.tsx uses, so the pie chart and this
 *  table agree on tax-type display text for identical data. A prior
 *  version used display-labels.ts's TAX_TYPE_LABELS, a second label
 *  source that had genuinely drifted — "Tax-Deferred"/"Tax-Free" here vs
 *  "Traditional"/"Roth" everywhere else. */

import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils/format";
import { sumBy, safeDivide } from "@/lib/utils/math";
import { taxTypeLabel } from "@/lib/utils/colors";
import type { TaxLocationBreakdown } from "./types";

type SpreadsheetTaxLocationProps = {
  yearA: TaxLocationBreakdown | null;
  yearB: TaxLocationBreakdown | null;
  yearALabel: number;
  yearBLabel: number;
};

/** Render a tax location mini table for one parent category. */
function TaxLocationMiniTable({
  title,
  yearAData,
  yearBData,
  yearALabel,
  yearBLabel,
}: {
  title: string;
  yearAData: Record<string, number>;
  yearBData: Record<string, number>;
  yearALabel: number;
  yearBLabel: number;
}) {
  // Derive tax type keys from both years' data
  const taxTypes = Array.from(
    new Set([...Object.keys(yearAData), ...Object.keys(yearBData)]),
  ).sort();

  const totalA = sumBy(Object.values(yearAData), (v) => v);
  const totalB = sumBy(Object.values(yearBData), (v) => v);

  if (taxTypes.length === 0) return null;

  return (
    <div>
      <h4 className="text-muted mb-1 text-xs font-semibold">{title}</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-muted py-1 pr-2 text-left font-medium" />
            <th className="text-muted px-2 py-1 text-right font-medium">
              {yearALabel}
            </th>
            <th className="text-muted py-1 pl-2 text-right font-medium">
              {yearBLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {taxTypes.map((taxType, index) => {
            const valA = yearAData[taxType] ?? 0;
            const valB = yearBData[taxType] ?? 0;
            const pctA = safeDivide(valA, totalA, 0);
            const pctB = safeDivide(valB, totalB, 0);
            // Use display label from config, with fallback
            const label = taxTypeLabel(taxType);

            return (
              <tr
                key={taxType}
                className={`border-subtle border-b ${index % 2 === 0 ? "bg-surface-sunken/50" : ""}`}
              >
                <td className="text-secondary py-1 pr-2">{label}</td>
                <td className="px-2 py-1 text-right">
                  {formatPercent(pctA, 1)}
                </td>
                <td className="py-1 pl-2 text-right">
                  {formatPercent(pctB, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Merge two tax-type records (sum values for matching keys). */
function mergeTaxBuckets(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const merged: Record<string, number> = { ...a };
  for (const [key, val] of Object.entries(b)) {
    merged[key] = (merged[key] ?? 0) + val;
  }
  return merged;
}

export function SpreadsheetTaxLocation({
  yearA,
  yearB,
  yearALabel,
  yearBLabel,
}: SpreadsheetTaxLocationProps) {
  const emptyBreakdown = { retirement: {}, portfolio: {} };
  const a = yearA ?? emptyBreakdown;
  const b = yearB ?? emptyBreakdown;

  const hasRetirementData =
    Object.keys(a.retirement).length > 0 ||
    Object.keys(b.retirement).length > 0;
  if (!hasRetirementData) return null;

  return (
    <Card title="Tax Location - YTD" className="mb-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {hasRetirementData && (
          <TaxLocationMiniTable
            title="Retirement"
            yearAData={a.retirement}
            yearBData={b.retirement}
            yearALabel={yearALabel}
            yearBLabel={yearBLabel}
          />
        )}
        {/* Portfolio = total (all accounts = retirement + portfolio parent categories merged) */}
        <TaxLocationMiniTable
          title="Portfolio"
          yearAData={mergeTaxBuckets(a.retirement, a.portfolio)}
          yearBData={mergeTaxBuckets(b.retirement, b.portfolio)}
          yearALabel={yearALabel}
          yearBLabel={yearBLabel}
        />
      </div>
    </Card>
  );
}
