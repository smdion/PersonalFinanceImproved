/** A budget cell's amount as text: a saved value that isn't a number shows a
 *  marker naming it (it counts as $0), never a plain "—". */
import { storedBudgetAmount } from "@/lib/pure/budget/item-amount";
import { formatCurrency } from "@/lib/utils/format";
import type { RawItem } from "./types";

export function BudgetAmountText({
  item,
  col,
  amount,
}: {
  item: RawItem;
  col: number;
  amount: number;
}) {
  // A linked item shows its contribution's figure, never a stored value.
  const stored =
    item.contribAmounts?.[col] ?? item.contribAmount ?? item.amounts[col];
  if (storedBudgetAmount(stored) === null)
    return (
      <span
        className="text-amber-600"
        title={`Saved as ${JSON.stringify(stored)}, not a number; counts as $0`}
      >
        ?
      </span>
    );
  return <>{amount > 0 ? formatCurrency(amount) : "—"}</>;
}
