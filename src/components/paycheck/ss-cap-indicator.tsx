"use client";

import { formatCurrency } from "@/lib/utils/format";
import type { PaycheckResult } from "./types";

export function SSCapIndicator({ paycheck }: { paycheck: PaycheckResult }) {
  const capPeriod = paycheck.yearSchedule.findIndex((p) => p.ficaSS === 0);
  if (capPeriod === -1) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
      <p className="text-blue-800">
        SS wage base cap hit at period {capPeriod + 1} of{" "}
        {paycheck.periodsPerYear}
        {paycheck.bonusPeriod != null &&
          paycheck.bonusPeriod <= capPeriod + 1 && (
            <span className="text-blue-600 text-xs ml-1">
              (bonus in period {paycheck.bonusPeriod} accelerates this)
            </span>
          )}
      </p>
      <p className="text-blue-600 text-xs mt-1">
        Take-home increases by{" "}
        {formatCurrency(paycheck.yearSchedule[0]?.ficaSS ?? 0)}/period after
      </p>
    </div>
  );
}
