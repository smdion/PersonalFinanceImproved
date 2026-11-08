/** The All Transactions table's row cells. */
import { formatCurrency } from "@/lib/utils/format";
import type { PlannedTransaction } from "../types";

export function balanceAfterCell(
  isTransfer: boolean,
  getBalanceAfter: (goalId: number, dateStr: string) => number | undefined,
  tx: PlannedTransaction,
) {
  // Transfer rows are collapsed to a single leg (deduped by
  // transferPairId), so a per-fund balance here would reflect
  // only whichever leg survived. Suppress it to avoid showing
  // an ambiguous balance for a two-fund movement.
  if (isTransfer)
    return (
      <td className="text-faint/40 px-3 py-2 text-right text-xs tabular-nums">
        —
      </td>
    );
  const bal = getBalanceAfter(tx.goalId, tx.transactionDate);
  if (bal === undefined)
    return (
      <td className="text-faint/40 px-3 py-2 text-right text-xs tabular-nums">
        —
      </td>
    );
  return (
    <td
      className={`px-3 py-2 text-right text-xs font-medium whitespace-nowrap tabular-nums ${
        bal < 0 ? "text-red-500" : "text-muted"
      }`}
    >
      {formatCurrency(bal)}
    </td>
  );
}
