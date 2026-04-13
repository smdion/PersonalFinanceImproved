"use client";

import { accountColor, accountMatchColor } from "@/lib/utils/colors";
import { formatPercent } from "@/lib/utils/format";
import { OVER_LIMIT_THRESHOLD } from "@/lib/constants";

export function FundingBar({
  pct,
  matchPct,
  matchCountsTowardLimit,
  accountType,
}: {
  pct: number;
  matchPct?: number;
  matchCountsTowardLimit?: boolean;
  accountType?: string;
}) {
  const showMatchBeyond = (matchPct ?? 0) > 0 && !matchCountsTowardLimit;
  const employeeClamped = Math.min(pct, 1);
  const totalPct = showMatchBeyond ? pct + (matchPct ?? 0) : pct;
  const typeColor = accountType ? accountColor(accountType) : null;
  const color =
    pct > OVER_LIMIT_THRESHOLD
      ? "bg-red-500"
      : (typeColor ??
        (pct >= 1
          ? "bg-green-500"
          : pct >= 0.75
            ? "bg-blue-500"
            : pct >= 0.5
              ? "bg-yellow-500"
              : "bg-red-400"));
  const matchBarColor = accountType
    ? accountMatchColor(accountType)
    : "bg-blue-300/60";

  if (!showMatchBeyond) {
    return (
      <div
        className="w-full bg-surface-strong rounded-full h-2"
        title={`Employee contribution: ${formatPercent(pct)} of IRS limit`}
      >
        <div
          className={`${color} h-2 rounded-full transition-all`}
          style={{ width: `${employeeClamped * 100}%` }}
        />
      </div>
    );
  }

  // Scale factor: if total > 1 we need to shrink to fit, otherwise use 100%
  const scale = totalPct > 1 ? 1 / totalPct : 1;
  const employeeWidth = employeeClamped * scale * 100;
  const matchWidth = (matchPct ?? 0) * scale * 100;
  const limitPosition = 1 * scale * 100; // where 100% IRS limit line falls

  return (
    <div className="w-full bg-surface-strong rounded-full h-2 relative">
      {/* Employee contribution bar */}
      <div
        className={`${color} h-2 rounded-l-full transition-all absolute left-0 top-0`}
        style={{ width: `${employeeWidth}%` }}
        title={`Employee contribution: ${formatPercent(pct)} of IRS limit`}
      />
      {/* Employer match bar (shown separately, does not count toward IRS limit) */}
      <div
        className={`${matchBarColor} h-2 rounded-r-full transition-all absolute top-0`}
        style={{ left: `${employeeWidth}%`, width: `${matchWidth}%` }}
        title={`Employer match (does not count toward IRS limit)`}
      />
      {/* IRS limit marker line */}
      <div
        className="absolute top-[-2px] h-[12px] w-[2px] bg-surface-emphasis"
        style={{ left: `${limitPosition}%` }}
        title="Vertical line = 100% IRS annual limit"
      />
    </div>
  );
}
