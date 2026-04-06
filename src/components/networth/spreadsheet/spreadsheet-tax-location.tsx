"use client";

/** Tax Location YTD — two side-by-side mini tables showing Retirement and Portfolio
 *  tax-type distribution. Labels from display-labels.ts (per RULES.md). */

import { Card } from "@/components/ui/card";
import { formatPercent } from "@/lib/utils/format";
import { TAX_TYPE_LABELS } from "@/lib/config/display-labels";
import type { TaxLocationBreakdown } from "./types";

type Props = {
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

  const totalA = Object.values(yearAData).reduce((s, v) => s + v, 0);
  const totalB = Object.values(yearBData).reduce((s, v) => s + v, 0);

  if (taxTypes.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-semibold text-muted mb-1">{title}</h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-left py-1 pr-2 text-muted font-medium" />
            <th className="text-right py-1 px-2 text-muted font-medium">
              {yearALabel}
            </th>
            <th className="text-right py-1 pl-2 text-muted font-medium">
              {yearBLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {taxTypes.map((taxType, index) => {
            const valA = yearAData[taxType] ?? 0;
            const valB = yearBData[taxType] ?? 0;
            const pctA = totalA > 0 ? valA / totalA : 0;
            const pctB = totalB > 0 ? valB / totalB : 0;
            // Use display label from config, with fallback
            const label = TAX_TYPE_LABELS[taxType] ?? taxType;

            return (
              <tr
                key={taxType}
                className={`border-b border-subtle ${index % 2 === 0 ? "bg-surface-sunken/50" : ""}`}
              >
                <td className="py-1 pr-2 text-secondary">{label}</td>
                <td className="text-right py-1 px-2">
                  {formatPercent(pctA, 1)}
                </td>
                <td className="text-right py-1 pl-2">
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
}: Props) {
  const emptyBreakdown = { retirement: {}, portfolio: {} };
  const a = yearA ?? emptyBreakdown;
  const b = yearB ?? emptyBreakdown;

  const hasRetirementData =
    Object.keys(a.retirement).length > 0 ||
    Object.keys(b.retirement).length > 0;
  if (!hasRetirementData) return null;

  return (
    <Card title="Tax Location - YTD" className="mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
