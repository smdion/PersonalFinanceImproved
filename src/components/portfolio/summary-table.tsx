"use client";

/** Small shared renderer used by the portfolio Account Balance Overview —
 *  label/amount rows with a total and optional percentage of total. */

import { formatCurrency, formatPercent } from "@/lib/utils/format";

export function SummaryTable({
  title,
  rows,
  total,
  showPct = false,
}: {
  title: string;
  rows: { label: string; amount: number }[];
  total: number;
  showPct?: boolean;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
        {title}
      </h4>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between">
            <span className="text-xs text-muted">{r.label}</span>
            <span className="text-xs font-medium text-primary tabular-nums">
              {formatCurrency(r.amount)}
              {showPct && total > 0 && (
                <span className="text-faint ml-1">
                  ({formatPercent(r.amount / total, 1)})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-baseline justify-between mt-1.5 pt-1.5 border-t">
        <span className="text-xs font-semibold text-secondary">Total</span>
        <span className="text-xs font-bold text-primary tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}
