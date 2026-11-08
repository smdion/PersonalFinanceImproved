import type { ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { formatCurrency } from "@/lib/utils/format";
import type { GoalProjection, RawGoal } from "./types";

export function FundApiSyncPanel({
  apiBalance,
  rawGoal,
  serviceLabel,
}: {
  apiBalance:
    | {
        balance: number;
        budgeted: number;
        activity: number;
        goalTarget: number | null;
      }
    | null
    | undefined;
  rawGoal: RawGoal;
  serviceLabel: string;
}) {
  return (
    <>
      {/* ── API sync panel (when linked) ── */}
      {apiBalance && rawGoal.isApiSyncEnabled && (
        <div className="mt-2 mb-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-blue-600">
              {rawGoal.apiCategoryName}
            </span>
          </div>
          <div className="text-label space-y-0.5">
            <div className="flex items-center justify-between">
              <span className="text-blue-500/70">
                ↓ Balance from {serviceLabel}
              </span>
              <span className="font-semibold text-blue-300 tabular-nums">
                {formatCurrency(apiBalance.balance)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-500/70">
                ↑ Monthly goal pushed to {serviceLabel}
              </span>
              <span className="text-blue-300 tabular-nums">
                {formatCurrency(apiBalance.budgeted)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-blue-500/70">Spent in {serviceLabel}</span>
              <span className="text-blue-300/70 tabular-nums">
                {formatCurrency(apiBalance.activity)}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function FundSummaryRow({
  setCollapsed,
  collapsed,
  fundColor,
  projection,
  status,
  rawGoal,
  efundResult,
  savingsGoal,
  menuDropdown,
}: {
  setCollapsed: (c: boolean) => void;
  collapsed: boolean;
  fundColor: string;
  projection: GoalProjection;
  status: { label: string; color: string };
  rawGoal: RawGoal;
  efundResult:
    | { neededAfterRepay: number; targetAmount: number; progress: number }
    | null
    | undefined;
  savingsGoal: { current: number };
  menuDropdown: ReactNode;
}) {
  return (
    <>
      {/* ── Compact summary row (always visible) ── */}
      <div
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 select-none"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setCollapsed(!collapsed);
        }}
      >
        {/* Chevron + color dot */}
        <span className="text-faint shrink-0">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: fundColor }}
        />

        {/* Name — left zone, takes available space */}
        <span className="text-primary min-w-0 flex-1 truncate text-sm font-semibold">
          {projection.name}
        </span>

        {/* Status — fixed width column, colored text only */}
        <span
          className={`text-label w-[110px] shrink-0 text-right font-medium ${status.color}`}
        >
          {status.label}
        </span>

        {/* Balance — fixed width column; e-fund shows still-needed instead of raw balance */}
        <span className="text-primary w-[108px] shrink-0 text-right text-sm font-bold tabular-nums">
          {rawGoal.isEmergencyFund && efundResult
            ? efundResult.neededAfterRepay <= 0
              ? "Fully funded"
              : formatCurrency(efundResult.neededAfterRepay)
            : formatCurrency(savingsGoal.current)}
        </span>

        {/* Monthly — fixed width column, muted when $0 */}
        <span
          className={`w-[80px] shrink-0 text-right text-xs font-semibold tabular-nums ${
            projection.monthlyAllocation > 0 ? "text-green-600" : "text-muted"
          }`}
        >
          {formatCurrency(projection.monthlyAllocation)}/mo
        </span>

        {/* Menu — fixed-width slot so all rows have identical right padding */}
        <div className="flex w-6 shrink-0 justify-center">{menuDropdown}</div>
      </div>
    </>
  );
}
