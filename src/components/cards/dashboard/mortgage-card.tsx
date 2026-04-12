import { memo } from "react";
("use client");

import { trpc } from "@/lib/trpc";
import { Card, Metric, ProgressBar } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { LoadingCard, ErrorCard } from "./utils";

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

  const primaryLoan = activeLoans[0]!;

  return (
    <Card title="Mortgage" href="/liabilities">
      <Metric
        value={formatCurrency(primaryLoan.currentBalance)}
        label={primaryLoan.name}
      />
      <ProgressBar
        value={primaryLoan.payoffPercent}
        label="Payoff progress"
        color="bg-green-500"
        tooltip={`${formatPercent(primaryLoan.payoffPercent)} of original balance paid off — ${formatCurrency(primaryLoan.currentBalance)} remaining`}
      />
      <div className="mt-2 flex justify-between text-sm">
        <span className="text-muted">Remaining</span>
        <span className="text-primary">
          {Math.ceil(primaryLoan.remainingMonths / 12)} years
        </span>
      </div>
      {primaryLoan.monthsAheadOfSchedule > 0 && (
        <p className="text-xs text-green-600 mt-1">
          {primaryLoan.monthsAheadOfSchedule} months ahead of schedule
        </p>
      )}
    </Card>
  );
}

export const MortgageCard = memo(MortgageCardImpl);
