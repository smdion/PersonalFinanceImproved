"use client";

import { memo } from "react";

import { trpc } from "@/lib/trpc";
import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils/format";
import { LoadingCard, ErrorCard } from "./utils";

function formatDuration(months: number): string {
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} mo`;
  if (rem === 0) return `${years} yr`;
  return `${years} yr ${rem} mo`;
}

function MortgageCardImpl() {
  const { data, isLoading, error } =
    trpc.mortgage.computeActiveSummary.useQuery();
  if (isLoading) return <LoadingCard title="Mortgage" />;
  if (error) return <ErrorCard title="Mortgage" message="Failed to load" />;

  const allLoans = data?.result.loans ?? [];
  const activeLoans = allLoans.filter((l) => l.remainingMonths > 0);
  if (activeLoans.length === 0) {
    const hasAnyLoans = allLoans.length > 0;
    return (
      <Card title="Mortgage">
        <p
          className={`text-sm ${hasAnyLoans ? "text-green-600" : "text-muted"}`}
        >
          {hasAnyLoans ? "Paid off!" : "No mortgage on file"}
        </p>
      </Card>
    );
  }

  // Prefer the server-resolved active loan (single computation path — see
  // getActiveMortgageLoan) over just picking the first still-owed loan;
  // fall back to that only when the active loan itself is already paid off.
  const activeLoanResult =
    data?.activeLoanId != null
      ? allLoans.find((l) => l.loanId === data.activeLoanId)
      : undefined;
  const primaryLoan =
    activeLoanResult && activeLoanResult.remainingMonths > 0
      ? activeLoanResult
      : activeLoans[0]!;

  return (
    <Card title="Mortgage" href="/liabilities">
      <Metric
        value={formatCurrency(primaryLoan.currentBalance)}
        label={primaryLoan.name}
      />
      <ProgressBar
        value={primaryLoan.payoffPercent}
        label="Payoff progress"
        variant="success"
        tooltip={`${formatPercent(primaryLoan.payoffPercent)} of original balance paid off — ${formatCurrency(primaryLoan.currentBalance)} remaining`}
      />
      <div className="mt-2 flex justify-between text-sm">
        <span className="text-muted">Remaining</span>
        <span className="text-primary">
          {Math.ceil(primaryLoan.remainingMonths / 12)} years
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-muted">Payoff date</span>
        <span className="text-primary">
          {formatDate(primaryLoan.payoffDate, "short")}
        </span>
      </div>
      {(data?.result.totalMonthsSaved ?? 0) > 0 && (
        <p className="mt-1 text-xs text-green-600">
          {formatDuration(data!.result.totalMonthsSaved)} ahead of original
          timeline
        </p>
      )}
    </Card>
  );
}

export const MortgageCard = memo(MortgageCardImpl);
