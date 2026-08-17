"use client";

/**
 * Net take-home callout for the What-If tab's Paycheck step — deliberately
 * NOT a full pay-stub breakdown. The itemized version (Gross/Bonus/Pre-Tax/
 * Federal/FICA/Post-Tax) was cut: it just restated numbers the salary and
 * deductions editors right above it already show or imply, without helping
 * anyone decide anything. The one number that actually feeds a decision
 * here is take-home pay — it's what Step 3 (Budget) checks against — so
 * that's the one this shows, prominently, per person and household.
 *
 * Same source as before: `paycheck`, already resolved once by
 * `usePaycheckPersonViews`. No new computation.
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
    <div className="flex items-center flex-wrap gap-x-6 gap-y-1 text-xs bg-green-50 text-green-700 rounded-md px-3 py-2">
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
