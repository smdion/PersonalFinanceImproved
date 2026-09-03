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
      <h4 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
        {title}
      </h4>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between">
            <span className="text-muted text-xs">{r.label}</span>
            <span className="text-primary text-xs font-medium tabular-nums">
              {formatCurrency(r.amount)}
              {showPct && total > 0 && (
                <span className="text-faint ml-1">
                  {/* lint-violation-ok: guarded by total > 0 above */}(
                  {formatPercent(r.amount / total, 1)})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between border-t pt-1.5">
        <span className="text-secondary text-xs font-semibold">Total</span>
        <span className="text-primary text-xs font-bold tabular-nums">
          {formatCurrency(total)}
        </span>
      </div>
    </div>
  );
}
