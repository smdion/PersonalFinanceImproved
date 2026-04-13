"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import type { LoanSummary, LoanHistoryEntry } from "./types";

export function RefinanceImpact({
  historicalLoans,
  activeLoans,
  loanHistory,
}: {
  historicalLoans: LoanSummary[];
  activeLoans: LoanSummary[];
  loanHistory: LoanHistoryEntry[];
}) {
  // Compare the original (root) loan's full-term cost against the actual refinance path.
  // "If we had stayed on the original loan, how much more/less interest would we pay?"
  const chainLoans = [...historicalLoans, ...activeLoans];

  // Find the root loan in the chain — the one no other loan refinanced into
  const refinancedIntoNames = new Set(
    loanHistory.map((h) => h.refinancedInto).filter(Boolean),
  );
  const originalLoan =
    historicalLoans.find((l) => !refinancedIntoNames.has(l.name)) ??
    historicalLoans[0];

  // Old path: interest remaining on the original loan from first refinance date through full term
  const standardInterestToEndDate = originalLoan
    ? originalLoan.totalInterestLife + originalLoan.totalInterestSaved
    : 0;
  const fullTermInterest =
    originalLoan?.fullTermStandardInterest ?? standardInterestToEndDate;
  const remainingOldInterest = fullTermInterest - standardInterestToEndDate;

  // New path: intermediate historical loan interest + active loan interest
  const intermediateInterest = historicalLoans
    .filter((l) => l !== originalLoan)
    .reduce((s, l) => s + l.totalInterestLife, 0);
  const activeLoanInterest = activeLoans.reduce(
    (s, l) => s + l.totalInterestLife,
    0,
  );
  const newPathTotalInterest = intermediateInterest + activeLoanInterest;

  // Net savings = old path remaining - new path total
  const netSavings = remainingOldInterest - newPathTotalInterest;

  return (
    <Card
      title={
        <>
          Refinance Impact
          <HelpTip text="Compares total interest across the full refinance chain (all intermediate and current loans) against what you would have paid staying on the original loan." />
        </>
      }
      className="mb-6"
    >
      <p className="text-xs text-faint mb-3">
        Compares the full refinance chain (
        {chainLoans.map((l) => l.name).join(" → ")}) against staying on the
        original loan ({originalLoan?.name ?? "original"}) through its full
        term.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-strong text-muted text-xs">
              <th className="text-left py-2 pr-4 font-medium">Loan</th>
              <th className="text-right py-2 px-3 font-medium">
                Interest Paid
              </th>
              <th className="text-right py-2 px-3 font-medium">
                Projected Remaining
              </th>
              <th className="text-right py-2 px-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {chainLoans.map((loan) => {
              const hist = loanHistory.find((h) => h.loanId === loan.loanId);
              const isHistorical = !!hist?.refinancedInto;
              const remainingInterest = isHistorical
                ? 0
                : loan.totalInterestLife - loan.totalInterestPaid;
              return (
                <tr key={loan.name} className="border-b border-subtle">
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          loan.remainingMonths > 0
                            ? "bg-green-500"
                            : "bg-surface-divider"
                        }`}
                      />
                      <span className="font-medium">{loan.name}</span>
                    </div>
                  </td>
                  <td className="text-right py-2 px-3">
                    {formatCurrency(loan.totalInterestPaid)}
                  </td>
                  <td className="text-right py-2 px-3 text-muted">
                    {remainingInterest > 0
                      ? formatCurrency(remainingInterest)
                      : "\u2014"}
                  </td>
                  <td className="text-right py-2 px-3 text-xs">
                    {hist?.refinancedInto ? (
                      <span className="text-faint">
                        Refinanced &rarr; {hist.refinancedInto}
                      </span>
                    ) : loan.remainingMonths > 0 ? (
                      <span className="text-green-600">Active</span>
                    ) : (
                      <span className="text-faint">Paid off</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {/* Summary rows — from refinance date forward */}
            <tr className="border-t-2 border-strong">
              <td className="py-2 pr-4 text-xs text-muted" colSpan={4}>
                From refinance date forward:
              </td>
            </tr>
            <tr className="text-muted">
              <td className="py-1.5 pr-4 text-xs">
                If kept {originalLoan?.name ?? "original"} — remaining interest
                through full term
              </td>
              <td />
              <td className="text-right py-1.5 px-3">
                {formatCurrency(remainingOldInterest)}
              </td>
              <td />
            </tr>
            <tr className="text-muted">
              <td className="py-1.5 pr-4 text-xs">
                Actual path — total interest across {chainLoans.length - 1}{" "}
                refinance{chainLoans.length - 1 !== 1 ? "s" : ""}
              </td>
              <td />
              <td className="text-right py-1.5 px-3">
                {formatCurrency(newPathTotalInterest)}
              </td>
              <td />
            </tr>
            <tr
              className={`font-semibold ${netSavings > 0 ? "text-green-700" : "text-red-600"}`}
            >
              <td className="py-2 pr-4">
                {netSavings > 0
                  ? "Net Interest Saved by Refinancing"
                  : "Additional Interest from Refinancing"}
              </td>
              <td />
              <td className="text-right py-2 px-3">
                {formatCurrency(Math.abs(netSavings))}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
