import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import type { PlannedTransaction } from "./types";

export function upcomingExpensesNote(transactions: PlannedTransaction[]) {
  // Date-truncated cutoff — matches the shared
  // isFuturePlannedTx predicate's boundary semantics.
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcomingExpenses = sumBy(
    transactions.filter(
      (t) => t.amount < 0 && new Date(t.transactionDate + "T00:00:00") >= today,
    ),
    (t) => Math.abs(t.amount),
  );
  if (upcomingExpenses > 0) {
    return (
      <div>
        <div className="text-muted text-xs tabular-nums">
          {formatCurrency(upcomingExpenses)} planned
        </div>
        <div className="text-caption text-muted">in upcoming expenses</div>
      </div>
    );
  }
  return null;
}
