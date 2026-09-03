"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
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
      <h2 className="text-secondary mb-3 text-lg font-semibold">
        Historical Loans
      </h2>
      {historicalLoans.map((loan, idx) => {
        const histEntry = loanHistory.find((h) => h.loanId === loan.loanId);
        const isRefinanced = loan.wasRefinanced ?? !!histEntry?.refinancedInto;
        return (
          <div key={loan.name} className="mb-4 opacity-75">
            <Card title={loan.name}>
              <div className="mb-3 flex items-center gap-2">
                <Badge color="gray" size="sm" shape="pill" case="normal">
                  Historical
                </Badge>
                {isRefinanced ? (
                  <Badge color="blue" size="sm" shape="pill" case="normal">
                    Refinanced
                  </Badge>
                ) : (
                  <Badge color="green" size="sm" shape="pill" case="normal">
                    Paid Off
                  </Badge>
                )}
                {histEntry?.refinancedInto && (
                  <span className="text-muted text-xs">
                    into {histEntry.refinancedInto}
                  </span>
                )}
              </div>
              <div className="mb-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-6">
                <div>
                  <p className="text-faint">Original Balance</p>
                  <p className="text-muted font-medium">
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
                  <p className="text-faint">Rate</p>
                  <p className="text-muted font-medium">
                    {histEntry ? formatPercent(histEntry.interestRate, 3) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-faint">
                    {isRefinanced ? "Refinanced Date" : "Paid Off Date"}
                  </p>
                  <p className="text-muted font-medium">
                    {loan.paidOffDate
                      ? formatDate(loan.paidOffDate, "short")
                      : formatDate(loan.payoffDate, "short")}
                  </p>
                </div>
                <div>
                  <p className="text-faint">Total Interest Paid</p>
                  <p className="text-muted font-medium">
                    {formatCurrency(loan.totalInterestPaid)}
                  </p>
                </div>
                <div>
                  <p className="text-faint">
                    {isRefinanced ? "Balance at Refinance" : "Final Balance"}
                  </p>
                  <p className="text-muted font-medium">
                    {loan.endedBalance !== undefined &&
                    loan.endedBalance !== null
                      ? formatCurrency(loan.endedBalance)
                      : formatCurrency(0)}
                  </p>
                </div>
                <div>
                  <p className="text-faint">Status</p>
                  <p className="text-muted font-medium">
                    {isRefinanced ? "Refinanced" : "Paid off"}
                  </p>
                </div>
              </div>
              <button
                onClick={() =>
                  onToggleHistSchedule(showHistSchedule === idx ? null : idx)
                }
                className="text-sm text-blue-600 underline hover:text-blue-800"
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
