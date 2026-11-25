/** The What-If tab's hand-edited budget amounts over items' amounts: the one
 *  overlay the budget summary and its "keep this" profile copy apply. */
import { toItemAmountActiveMap } from "@/lib/pure/household/what-if.schema";
import { storedAmountList } from "@/lib/pure/budget/item-amount";

/** Each item's amounts with its edited columns replaced; amounts that aren't
 *  a list come back as they are (read as missing, copied as stored). */
export function itemAmountOverlay(
  activeFields: Parameters<typeof toItemAmountActiveMap>[0],
): (itemId: number, amounts: number[]) => number[] {
  const itemActiveMap = toItemAmountActiveMap(activeFields);
  return (itemId, amounts) =>
    itemActiveMap.size === 0
      ? amounts
      : (storedAmountList(amounts)?.map(
          (amount, col) => itemActiveMap.get(`${itemId}:${col}`) ?? amount,
        ) ?? amounts);
}
