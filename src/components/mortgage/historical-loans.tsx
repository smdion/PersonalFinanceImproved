"use client";

import { Card } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { AmortizationTable } from "./amortization-table";
import type { LoanSummary, LoanHistoryEntry } from "./types";

export function HistoricalLoans({
  historicalLoans,
  loanHistory,
  showHistSchedule,
  onToggleHistSchedule,
}: {
  historicalLoans: LoanSummary[];
  loanHistory: LoanHistoryEntry[];
  showHistSchedule: number | null;
  onToggleHistSchedule: (idx: number | null) => void;
}) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-secondary mb-3">
        Historical Loans
      </h2>
      {historicalLoans.map((loan, idx) => {
        const histEntry = loanHistory.find((h) => h.loanId === loan.loanId);
        const isRefinanced = loan.wasRefinanced ?? !!histEntry?.refinancedInto;
        return (
          <div key={loan.name} className="mb-4 opacity-75">
            <Card title={loan.name}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs rounded-full px-2 py-0.5 bg-surface-strong text-muted">
                  Historical
                </span>
                {isRefinanced ? (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-blue-100 text-blue-700">
                    Refinanced
                  </span>
                ) : (
                  <span className="text-xs rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">
                    Paid Off
                  </span>
                )}
                {histEntry?.refinancedInto && (
                  <span className="text-xs text-muted">
                    into {histEntry.refinancedInto}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-3 text-sm">
                <div>
                  <p className="text-faint">Original Balance</p>
                  <p className="font-medium text-muted">
                    {formatCurrency(
                      loan.amortizationSchedule[0]
                        ? loan.amortizationSchedule[0].balance +
                            loan.amortizationSchedule[0].principal +
                            loan.amortizationSchedule[0].extraPayment
                        : 0,
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-faint">
                    {isRefinanced ? "Refinanced Date" : "Paid Off Date"}
                  </p>
                  <p className="font-medium text-muted">
                    {loan.paidOffDate
                      ? formatDate(loan.paidOffDate, "short")
                      : formatDate(loan.payoffDate, "short")}
                  </p>
                </div>
                <div>
                  <p className="text-faint">Total Interest Paid</p>
                  <p className="font-medium text-muted">
                    {formatCurrency(loan.totalInterestPaid)}
                  </p>
                </div>
                <div>
                  <p className="text-faint">
                    {isRefinanced ? "Balance at Refinance" : "Final Balance"}
                  </p>
                  <p className="font-medium text-muted">
                    {loan.endedBalance !== undefined &&
                    loan.endedBalance !== null
                      ? formatCurrency(loan.endedBalance)
                      : formatCurrency(0)}
                  </p>
                </div>
                <div>
                  <p className="text-faint">Status</p>
                  <p className="font-medium text-muted">
                    {isRefinanced ? "Refinanced" : "Paid off"}
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  onToggleHistSchedule(showHistSchedule === idx ? null : idx)
                }
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                {showHistSchedule === idx ? "Hide" : "Show"} amortization
                schedule
              </button>
              {showHistSchedule === idx && (
                <AmortizationTable schedule={loan.amortizationSchedule} />
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
