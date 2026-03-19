"use client";

import { Card, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { AmortizationTable } from "./amortization-table";
import type { LoanSummary } from "./types";

export function ActiveLoanCard({
  loan,
  showSchedule,
  onToggleSchedule,
}: {
  loan: LoanSummary;
  showSchedule: boolean;
  onToggleSchedule: () => void;
}) {
  return (
    <div className="mb-6">
      <Card title={loan.name}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs rounded-full px-2 py-0.5 bg-green-100 text-green-700">
            Active
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-sm text-muted">Current Balance</p>
            <p className="text-lg font-semibold">
              {formatCurrency(loan.currentBalance)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">Payoff Date</p>
            <p className="text-lg font-semibold">
              {formatDate(loan.payoffDate, "short")}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">Remaining</p>
            <p className="text-lg font-semibold">
              {formatNumber(loan.remainingMonths)} months
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">
              Ahead of Schedule
              <HelpTip text="How many months earlier you'll pay off vs. the original schedule, thanks to extra payments" />
            </p>
            <p className="text-lg font-semibold text-green-700">
              {loan.monthsAheadOfSchedule > 0
                ? `${formatNumber(loan.monthsAheadOfSchedule)} months`
                : "On schedule"}
            </p>
          </div>
        </div>

        <ProgressBar
          value={loan.payoffPercent}
          label="Paid off"
          color="bg-green-500"
        />

        <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
          <div>
            <p className="text-muted">Total Interest Paid</p>
            <p className="font-medium">
              {formatCurrency(loan.totalInterestPaid)}
            </p>
            <p className="text-[10px] text-faint">Interest paid so far</p>
          </div>
          <div>
            <p className="text-muted">
              Lifetime Interest
              <HelpTip text="Total interest you'll pay over the full life of the loan, including the effect of extra payments" />
            </p>
            <p className="font-medium">
              {formatCurrency(loan.totalInterestLife)}
            </p>
            <p className="text-[10px] text-faint">
              Total interest over loan life (with extra payments)
            </p>
          </div>
          <div className="group relative">
            <p className="text-muted">
              Interest Saved
              <HelpTip text="Interest you've avoided by making extra payments compared to the original schedule" />
            </p>
            <p className="font-medium text-green-700">
              {loan.totalInterestSaved > 0
                ? formatCurrency(loan.totalInterestSaved)
                : "$0.00"}
            </p>
            <p className="text-[10px] text-faint">
              vs. original schedule (no extra payments)
            </p>
          </div>
        </div>

        {/* Amortization toggle */}
        <button
          onClick={onToggleSchedule}
          className="mt-4 text-sm text-blue-600 hover:text-blue-800 underline"
        >
          {showSchedule ? "Hide" : "Show"} amortization schedule
        </button>

        {showSchedule && (
          <AmortizationTable schedule={loan.amortizationSchedule} />
        )}
      </Card>
    </div>
  );
}
