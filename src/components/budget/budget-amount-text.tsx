/** A budget cell's amount as text: a saved value that isn't a number shows a
 *  marker naming it (it counts as $0), never a plain "—". */
import {
  storedAmountList,
  storedBudgetAmount,
} from "@/lib/pure/budget/item-amount";
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
  const list = storedAmountList(item.amounts);
  const linked = item.contribAmounts?.[col] ?? item.contribAmount;
  const stored = linked ?? (list ? list[col] : item.amounts);
  const notAList = linked == null && !list;
  if (notAList || storedBudgetAmount(stored) === null)
    return (
      <span
        className="text-amber-600"
        title={`Saved as ${JSON.stringify(stored)}, ${notAList ? "not a list of amounts" : "not a number"}; counts as $0`}
      >
        ?
      </span>
    );
  return <>{amount > 0 ? formatCurrency(amount) : "—"}</>;
}
