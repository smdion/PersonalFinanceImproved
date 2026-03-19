"use client";

import { useState } from "react";
import type { PaycheckResult } from "./types";
import { PAY_PERIOD_CONFIG } from "@/lib/config/pay-periods";

export function PayScheduleInfo({
  job,
  paycheck,
  onUpdateJob,
}: {
  job: {
    payPeriod: string;
    anchorPayDate?: string | null;
    startDate: string;
    budgetPeriodsPerMonth?: string | null;
  };
  paycheck: PaycheckResult;
  onUpdateJob: (field: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const periodLabel: Record<string, string> = {
    weekly: "Weekly",
    biweekly: "Biweekly",
    semimonthly: "Semi-Monthly",
    monthly: "Monthly",
  };

  return (
    <div className="mt-2">
      {/* Collapsed summary — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-faint hover:text-secondary transition-colors group"
        aria-expanded={expanded}
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>
          {periodLabel[job.payPeriod] ?? job.payPeriod}
          {" · "}
          Next: {paycheck.nextPayDate}
          {" · "}
          {paycheck.periodsPerYear}/yr
          {paycheck.extraPaycheckMonths.length > 0 && (
            <>
              {" · "}
              <span className="text-green-600">
                3-check: {paycheck.extraPaycheckMonths.join(", ")}
              </span>
            </>
          )}
        </span>
      </button>

      {/* Expanded controls */}
      {expanded && (
        <div className="mt-2 pl-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <select
            value={job.payPeriod}
            onChange={(e) => onUpdateJob("payPeriod", e.target.value)}
            className="text-xs border rounded px-1.5 py-0.5 bg-surface-primary hover:border-strong cursor-pointer"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="semimonthly">Semi-Monthly</option>
            <option value="monthly">Monthly</option>
          </select>
          <label
            className="flex items-center gap-1"
            title="A known payday — used to calculate pay schedule and 3-paycheck months"
          >
            Payday:
            <input
              type="date"
              value={job.anchorPayDate ?? ""}
              onChange={(e) =>
                onUpdateJob("anchorPayDate", e.target.value || "")
              }
              className="text-xs border rounded px-1.5 py-0.5 bg-surface-primary hover:border-strong cursor-pointer w-[120px]"
              placeholder={job.startDate}
            />
          </label>
          <label
            className="flex items-center gap-1"
            title={`Paychecks included in monthly budget. Default: ${PAY_PERIOD_CONFIG[job.payPeriod]?.defaultBudgetPerMonth ?? ""}. Set to ${((PAY_PERIOD_CONFIG[job.payPeriod]?.periodsPerYear ?? 12) / 12).toFixed(2)} to include all paychecks.`}
          >
            Budget/mo:
            <input
              type="number"
              step="any"
              min="0"
              value={job.budgetPeriodsPerMonth ?? ""}
              onChange={(e) =>
                onUpdateJob("budgetPeriodsPerMonth", e.target.value || "")
              }
              placeholder={String(PAY_PERIOD_CONFIG[job.payPeriod]?.defaultBudgetPerMonth ?? "")}
              className="text-xs border rounded px-1.5 py-0.5 bg-surface-primary hover:border-strong cursor-pointer w-[60px]"
            />
          </label>
        </div>
      )}
    </div>
  );
}
