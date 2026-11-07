"use client";

/**
 * The mortgage's payoff progress, under Net Worth's mortgage line: how much
 * of the original balance is paid, when it's paid off, and how far ahead of
 * the original timeline.
 */
import { trpc } from "@/lib/trpc";
import { formatDate, formatPercent } from "@/lib/utils/format";

/** "7 yr 8 mo", "8 mo", "2 yr". */
function formatMonths(months: number): string {
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} mo`;
  if (rem === 0) return `${years} yr`;
  return `${years} yr ${rem} mo`;
}

export function MortgagePayoff() {
  const { data } = trpc.mortgage.computeActiveSummary.useQuery();
  const allLoans = data?.result.loans ?? [];
  const activeLoans = allLoans.filter((l) => l.remainingMonths > 0);
  if (activeLoans.length === 0) return null;
  // Prefer the server-resolved active loan (single computation path — see
  // getActiveMortgageLoan) over just picking the first still-owed loan;
  // fall back to that only when the active loan itself is already paid off.
  const activeLoan =
    data?.activeLoanId != null
      ? allLoans.find((l) => l.loanId === data.activeLoanId)
      : undefined;
  const loan =
    activeLoan && activeLoan.remainingMonths > 0 ? activeLoan : activeLoans[0]!;
  const { totalMonthsSaved: saved = 0, monthsSavedByRefi = 0 } =
    data?.result ?? {};
  const split =
    monthsSavedByRefi > 0
      ? ` — ${formatMonths(monthsSavedByRefi)} by refinancing, ${formatMonths(saved - monthsSavedByRefi)} by extra payments`
      : "";
  return (
    <div
      className="mt-0.5 mb-1"
      title={`${loan.name}${saved > 0 ? `: ${formatMonths(saved)} ahead of the original loan${split}` : ""}`}
    >
      <div className="bg-surface-strong h-1 rounded">
        <div
          className="h-1 rounded bg-green-500"
          style={{ width: `${Math.min(100, loan.payoffPercent * 100)}%` }}
        />
      </div>
      <p className="text-caption text-faint mt-0.5">
        {formatPercent(loan.payoffPercent, 0)} paid · payoff{" "}
        {formatDate(loan.payoffDate, "short")}
        {saved > 0 && (
          <span className="text-green-600"> · {formatMonths(saved)} ahead</span>
        )}
      </p>
    </div>
  );
}
