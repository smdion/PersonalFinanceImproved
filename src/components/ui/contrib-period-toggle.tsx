"use client";

import React from "react";

export type ContribPeriod = "annual" | "monthly" | "paycheck";

const PERIOD_LABELS: Record<ContribPeriod, string> = {
  paycheck: "Per Paycheck",
  monthly: "Monthly",
  annual: "Annual",
};

const PERIOD_SUFFIXES: Record<ContribPeriod, string> = {
  paycheck: "/check",
  monthly: "/mo",
  annual: "/yr",
};

export function getPeriodSuffix(period: ContribPeriod): string {
  return PERIOD_SUFFIXES[period];
}

/**
 * Convert an annual amount to the selected period.
 * For paycheck, uses the person's periodsPerYear.
 */
export function getContribMultiplier(
  period: ContribPeriod,
  periodsPerYear: number,
): number {
  switch (period) {
    case "paycheck":
      return 1 / periodsPerYear;
    case "monthly":
      return 1 / 12;
    case "annual":
    default:
      return 1;
  }
}

export function ContribPeriodToggle({
  value,
  onChange,
  className,
}: {
  value: ContribPeriod;
  onChange: (period: ContribPeriod) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex bg-surface-elevated rounded-lg p-1 ${className ?? ""}`}
    >
      {(["paycheck", "monthly", "annual"] as ContribPeriod[]).map((period) => (
        <button
          key={period}
          role="tab"
          aria-selected={value === period}
          onClick={() => onChange(period)}
          className={`px-3 py-1 text-xs rounded-md transition-colors ${
            value === period
              ? "bg-surface-primary text-primary shadow-sm font-medium"
              : "text-muted hover:text-primary"
          }`}
        >
          {PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  );
}
