"use client";

/** Consolidated liabilities page showing mortgage details, amortization schedule, and other outstanding debts. */

import { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MortgageSettings } from "@/components/mortgage/mortgage-settings";
import { formatCurrency } from "@/lib/utils/format";
import {
  ActiveLoanCard,
  HistoricalLoans,
  RefinanceCalculator,
  RefinanceHistory,
  RefinanceImpact,
  WhatIfSection,
} from "@/components/mortgage";

function SyncBadge({ source }: { source: string }) {
  return (
    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
      Synced from {source.toUpperCase()}
    </span>
  );
}

export default function LiabilitiesPage() {
  const [showSchedule, setShowSchedule] = useState<number | null>(null);
  const [showHistSchedule, setShowHistSchedule] = useState<number | null>(null);
  const [showManageLoans, setShowManageLoans] = useState(false);
  const { data, isLoading, error } =
    trpc.mortgage.computeActiveSummary.useQuery();
  const utils = trpc.useUtils();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <SkeletonChart key={i} height={112} />
          ))}
        </div>
        <SkeletonChart height={256} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load liability data: {error.message}
      </p>
    );
  }

  const result = data?.result;
  const hasLoans = (result?.loans.length ?? 0) > 0;
  const totalMortgage =
    result?.loans.reduce((s, l) => s + l.currentBalance, 0) ?? 0;
  const hasApiBalance =
    result?.loans.some((l) => l.apiBalance != null) ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Liabilities"
        subtitle="Mortgage detail, amortization, and other debts"
      >
        {result && (
          <button
            onClick={() => setShowManageLoans(!showManageLoans)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              showManageLoans
                ? "bg-surface-primary text-white hover:bg-surface-primary"
                : "bg-surface-elevated text-secondary hover:bg-surface-strong"
            }`}
          >
            {showManageLoans ? "Hide Loan Setup" : "Manage Loans"}
          </button>
        )}
      </PageHeader>

      {/* Summary Cards — only show when there are loans */}
      {hasLoans && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card
            title={
              <>
                Total Liabilities {hasApiBalance && <SyncBadge source="ynab" />}
              </>
            }
          >
            <Metric value={formatCurrency(totalMortgage)} />
          </Card>
          <Card title="Mortgage Balance">
            <Metric
              value={formatCurrency(totalMortgage)}
              label={
                result?.loans.length === 1
                  ? result.loans[0]!.name
                  : `${result?.loans.length ?? 0} loans`
              }
            />
          </Card>
          <Card title="Other Liabilities">
            <Metric value={formatCurrency(0)} label="No other debts tracked" />
          </Card>
        </div>
      )}

      {/* API balance comparison */}
      {result?.loans
        .filter((l) => l.apiBalance != null && l.calculatedBalance != null)
        .map((loan) => (
          <div
            key={loan.name}
            className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800"
          >
            <strong>{loan.name}</strong>: YNAB balance{" "}
            {formatCurrency(loan.apiBalance!)} vs. Calculated{" "}
            {formatCurrency(loan.calculatedBalance!)} — Difference:{" "}
            {formatCurrency(
              Math.abs(loan.apiBalance! - loan.calculatedBalance!),
            )}
          </div>
        ))}

      {/* Loan management (collapsible) */}
      {showManageLoans && (
        <div>
          <MortgageSettings />
        </div>
      )}

      {!result || !hasLoans ? (
        <Card title="Mortgage">
          <p className="text-sm text-faint">
            No mortgage loans configured. Add one below to track amortization,
            equity, and payoff scenarios.
          </p>
          <MortgageSettings />
        </Card>
      ) : (
        <>
          {/* Active loan cards */}
          {result.loans.map((loan, idx) => (
            <ActiveLoanCard
              key={loan.name}
              loan={loan}
              showSchedule={showSchedule === idx}
              onToggleSchedule={() =>
                setShowSchedule(showSchedule === idx ? null : idx)
              }
            />
          ))}

          {/* What-if scenarios */}
          <WhatIfSection
            whatIfResults={result.whatIfResults}
            whatIfScenarios={data!.whatIfScenarios}
            utils={utils}
          />

          {/* Refinance Impact Comparison */}
          {result.historicalLoans.length > 0 && result.loans.length > 0 && (
            <RefinanceImpact
              historicalLoans={result.historicalLoans}
              activeLoans={result.loans}
              loanHistory={result.loanHistory}
            />
          )}

          {/* Refinance Calculator */}
          {result.loans.length > 0 && (
            <RefinanceCalculator currentLoan={result.loans[0]!} />
          )}

          {/* Historical loans */}
          {result.historicalLoans.length > 0 && (
            <HistoricalLoans
              historicalLoans={result.historicalLoans}
              loanHistory={result.loanHistory}
              showHistSchedule={showHistSchedule}
              onToggleHistSchedule={setShowHistSchedule}
            />
          )}

          {/* Loan refinance chain */}
          {result.loanHistory.length > 1 && (
            <RefinanceHistory loanHistory={result.loanHistory} />
          )}

          {result.warnings.length > 0 && (
            <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              {result.warnings.map((w) => (
                <p key={w} className="text-sm text-yellow-800">
                  {w}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
