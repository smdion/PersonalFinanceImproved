"use client";

/**
 * Net take-home callout for the What-If Paycheck step, per person and
 * household: the figure the Budget step checks against. Reads the `paycheck`
 * already resolved by `usePaycheckPersonViews`.
 */

import { formatCurrency } from "@/lib/utils/format";
import type { PaycheckPersonView } from "@/lib/hooks/use-paycheck-person-views";

export function WhatIfPaycheckSummary({
  views,
}: {
  views: PaycheckPersonView[];
}) {
  if (views.length === 0) return null;

  const netAnnual = (d: PaycheckPersonView) =>
    d.paycheck.netPay * d.paycheck.periodsPerYear;

  const household = views.reduce((s, d) => s + netAnnual(d), 0);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
      {views.map((d) => (
        <span key={d.person.id}>
          <span className="text-faint">{d.person.name} net: </span>
          <span className="font-semibold">
            {formatCurrency(netAnnual(d))}/yr
          </span>
        </span>
      ))}
      {views.length > 1 && (
        <span>
          <span className="text-faint">Household net: </span>
          <span className="font-semibold">{formatCurrency(household)}/yr</span>
        </span>
      )}
    </div>
  );
}
