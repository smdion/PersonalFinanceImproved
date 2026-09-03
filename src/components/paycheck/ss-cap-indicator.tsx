"use client";

import { formatCurrency } from "@/lib/utils/format";
import type { PaycheckResult } from "./types";

export function SSCapIndicator({ paycheck }: { paycheck: PaycheckResult }) {
  const capPeriod = paycheck.yearSchedule.findIndex((p) => p.ficaSS === 0);
  if (capPeriod === -1) return null;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
      <p className="text-blue-800">
        SS wage base cap hit at period {capPeriod + 1} of{" "}
        {paycheck.periodsPerYear}
        {paycheck.bonusPeriod != null &&
          paycheck.bonusPeriod <= capPeriod + 1 && (
            <span className="ml-1 text-xs text-blue-600">
              (bonus in period {paycheck.bonusPeriod} accelerates this)
            </span>
          )}
      </p>
      <p className="mt-1 text-xs text-blue-600">
        Take-home increases by{" "}
        {formatCurrency(paycheck.yearSchedule[0]?.ficaSS ?? 0)}/period after
      </p>
    </div>
  );
}
