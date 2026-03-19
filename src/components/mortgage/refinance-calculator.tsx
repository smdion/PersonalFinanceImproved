"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import type { LoanSummary } from "./types";

export function RefinanceCalculator({
  currentLoan,
}: {
  currentLoan: LoanSummary;
}) {
  const [showRefi, setShowRefi] = useState(false);
  const [refiRate, setRefiRate] = useState("");
  const [refiTerm, setRefiTerm] = useState("30");
  const [refiClosingCosts, setRefiClosingCosts] = useState("5000");

  if (!showRefi) {
    return (
      <Card title="Refinance Calculator" className="mb-6">
        <button
          onClick={() => setShowRefi(true)}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
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
      ? Math.ceil(closingCosts / monthlySavings)
      : 0;

  return (
    <Card title="Refinance Calculator" className="mb-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="block text-xs text-muted mb-1">
            New Interest Rate (%)
          </label>
          <input
            type="number"
            step="0.125"
            value={refiRate}
            onChange={(e) => setRefiRate(e.target.value)}
            placeholder="5.5"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">
            New Term (years)
          </label>
          <select
            value={refiTerm}
            onChange={(e) => setRefiTerm(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          >
            <option value="15">15 years</option>
            <option value="20">20 years</option>
            <option value="25">25 years</option>
            <option value="30">30 years</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">
            Closing Costs ($)
          </label>
          <input
            type="number"
            value={refiClosingCosts}
            onChange={(e) => setRefiClosingCosts(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      {refiRate && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
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
                <p className="text-[10px] text-green-600">
                  Save {formatCurrency(monthlySavings)}/mo
                </p>
              )}
              {monthlySavings < 0 && (
                <p className="text-[10px] text-red-500">
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
                <span className="text-xs font-normal ml-1">
                  {netSavings > 0 ? "saved" : "more"}
                </span>
              </p>
              {closingCosts > 0 && breakEvenMonths > 0 && (
                <p className="text-[10px] text-faint">
                  ~{formatNumber(breakEvenMonths)} months to break even
                </p>
              )}
            </div>
          </div>
          <p className="text-[10px] text-faint">
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
        className="mt-3 text-xs text-faint hover:text-muted"
      >
        Hide refinance calculator
      </button>
    </Card>
  );
}
