"use client";

import { safeDivide } from "@/lib/utils/math";
import { SegmentedControl } from "./segmented-control";

export type ContribPeriod = "annual" | "monthly" | "paycheck";

const PERIOD_LABELS: Record<ContribPeriod, string> = {
  paycheck: "Per check",
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
      return safeDivide(1, periodsPerYear, 0)!;
    case "monthly":
      return 1 / 12;
    case "annual":
    default:
      return 1;
  }
}

const PERIOD_OPTIONS = (["paycheck", "monthly", "annual"] as const).map(
  (value) => ({ value, label: PERIOD_LABELS[value] }),
);

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
    <div className={className}>
      <SegmentedControl
        ariaLabel="Show amounts"
        value={value}
        options={PERIOD_OPTIONS}
        onChange={onChange}
      />
    </div>
  );
}
