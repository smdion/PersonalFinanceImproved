"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import { HelpTip } from "@/components/ui/help-tip";
import { DEFAULT_REFI_CLOSING_COSTS } from "@/lib/constants";
import type { LoanSummary } from "./types";

export function RefinanceCalculator({
  currentLoan,
}: {
  currentLoan: LoanSummary;
}) {
  const [showRefi, setShowRefi] = useState(false);
  const [refiRate, setRefiRate] = useState("");
  const [refiTerm, setRefiTerm] = useState("30");
  const [refiClosingCosts, setRefiClosingCosts] = useState(
    DEFAULT_REFI_CLOSING_COSTS,
  );

  if (!showRefi) {
    return (
      <Card title="Refinance Calculator" className="mb-6">
        <button
          onClick={() => setShowRefi(true)}
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          Compare a refinance scenario...
        </button>
      </Card>
    );
  }

  const balance = currentLoan.currentBalance;
  const newRate = parseFloat(refiRate) / 100 / 12; // monthly rate
  const newTermMonths = parseInt(refiTerm) * 12;
  const closingCosts = parseFloat(refiClosingCosts) || 0;

  // Calculate new monthly payment
  let newMonthly = 0;
  let newTotalInterest = 0;
  if (newRate > 0 && newTermMonths > 0) {
    newMonthly =
      (balance * newRate * Math.pow(1 + newRate, newTermMonths)) /
      (Math.pow(1 + newRate, newTermMonths) - 1);
    newTotalInterest = newMonthly * newTermMonths - balance;
  }

  // Current remaining interest (what you'd pay if you kept the current loan)
  const currentRemainingInterest =
    currentLoan.totalInterestLife - currentLoan.totalInterestPaid;
  // Current monthly P&I payment (from amortization schedule)
  const currentMonthly = currentLoan.amortizationSchedule[0]?.payment ?? 0;

  const netSavings = currentRemainingInterest - newTotalInterest - closingCosts;
  // Break-even: months until monthly payment savings offset closing costs
  const monthlySavings = currentMonthly - newMonthly;
  const breakEvenMonths =
    closingCosts > 0 && monthlySavings > 0
      ? Math.ceil(safeDivide(closingCosts, monthlySavings, 0)!)
      : 0;

  return (
    <Card title="Refinance Calculator" className="mb-6">
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="text-muted mb-1 block text-xs">
            New Interest Rate (%)
          </label>
          <input
            type="number"
            step="0.125"
            value={refiRate}
            onChange={(e) => setRefiRate(e.target.value)}
            placeholder="5.5"
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-muted mb-1 block text-xs">
            New Term (years)
          </label>
          <select
            value={refiTerm}
            onChange={(e) => setRefiTerm(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
          >
            <option value="15">15 years</option>
            <option value="20">20 years</option>
            <option value="25">25 years</option>
            <option value="30">30 years</option>
          </select>
        </div>
        <div>
          <label className="text-muted mb-1 block text-xs">
            Closing Costs ($)
          </label>
          <input
            type="number"
            value={refiClosingCosts}
            onChange={(e) => setRefiClosingCosts(e.target.value)}
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
      </div>

      {refiRate && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
            <div>
              <p className="text-muted">Current Payment</p>
              <p className="text-lg font-semibold">
                {formatCurrency(currentMonthly)}
              </p>
            </div>
            <div>
              <p className="text-muted">New Payment</p>
              <p className="text-lg font-semibold">
                {formatCurrency(newMonthly)}
              </p>
              {monthlySavings > 0 && (
                <p className="text-caption text-green-600">
                  Save {formatCurrency(monthlySavings)}/mo
                </p>
              )}
              {monthlySavings < 0 && (
                <p className="text-caption text-red-500">
                  +{formatCurrency(Math.abs(monthlySavings))}/mo
                </p>
              )}
            </div>
            <div>
              <p className="text-muted">Remaining Interest (Current)</p>
              <p className="text-lg font-semibold">
                {formatCurrency(currentRemainingInterest)}
              </p>
            </div>
            <div>
              <p className="text-muted">New Total Interest</p>
              <p className="text-lg font-semibold">
                {formatCurrency(newTotalInterest)}
              </p>
            </div>
            <div>
              <p className="text-muted">
                Net Savings
                <HelpTip text="Total interest saved (or added) after accounting for closing costs" />
              </p>
              <p
                className={`text-lg font-semibold ${netSavings > 0 ? "text-green-700" : "text-red-600"}`}
              >
                {formatCurrency(Math.abs(netSavings))}
                <span className="ml-1 text-xs font-normal">
                  {netSavings > 0 ? "saved" : "more"}
                </span>
              </p>
              {closingCosts > 0 && breakEvenMonths > 0 && (
                <p className="text-caption text-faint">
                  ~{formatNumber(breakEvenMonths)} months to break even
                </p>
              )}
            </div>
          </div>
          <p className="text-caption text-faint">
            Comparison: remaining interest on current loan (
            {currentLoan.remainingMonths} months left) vs. new {refiTerm}-year
            loan at {refiRate}% on {formatCurrency(balance)} balance.
            {closingCosts > 0
              ? ` Includes ${formatCurrency(closingCosts)} closing costs.`
              : ""}
          </p>
        </div>
      )}

      <button
        onClick={() => setShowRefi(false)}
        className="text-faint hover:text-muted mt-3 text-xs"
      >
        Hide refinance calculator
      </button>
    </Card>
  );
}
