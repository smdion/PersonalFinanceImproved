/** The Budget page's push and pull preview items: each linked item's Ledgr
 *  amount against the budget app's goal target. */
import {
  readableBudgetItemAmount,
  storedAmountList,
} from "@/lib/pure/budget/item-amount";
import type { RawItem } from "@/components/budget";
import type { PushPreviewItem } from "@/components/ui/push-preview-modal";

/** The budget app's goal target per Ledgr item id (the page's API actuals). */
type GoalTargets = ReadonlyMap<number, { goalTarget: number }>;

/** Diff items for the "push to API" modal. Ledgr's amount maps to YNAB's goal
 *  target (not month "budgeted"), as syncBudgetToApi writes. */
export function pushPreviewItems(
  rawItems: readonly RawItem[],
  apiActualsMap: GoalTargets,
  numCols: number,
  activeColumn: number,
): PushPreviewItem[] {
  const items: PushPreviewItem[] = [];
  for (const item of rawItems) {
    if (!item.apiCategoryId) continue;
    if (item.apiSyncDirection !== "push" && item.apiSyncDirection !== "both")
      continue;
    // Contribution-linked items keep `amounts` stale (see
    // resolveLinkedBudgetItemAmounts); the pushed figure is `contribAmounts`.
    const amounts = item.contribAmounts ?? item.amounts;
    const colIndex = Math.min(activeColumn, numCols - 1);
    const newValue = readableBudgetItemAmount(amounts, colIndex, numCols);
    const actual = apiActualsMap.get(item.id);
    items.push({
      name: item.subcategory,
      field: "Goal Target",
      currentYnab: actual?.goalTarget ?? 0,
      newValue: newValue ?? 0,
      ...(newValue === null && { unreadable: true }),
    });
  }
  return items;
}

/** Diff items for the "pull from API" modal: current amount vs. YNAB's goal
 *  target, as syncBudgetFromApi reads. */
export function pullPreviewItems(
  rawItems: readonly RawItem[],
  apiActualsMap: GoalTargets,
  numCols: number,
  activeColumn: number,
): PushPreviewItem[] {
  const items: PushPreviewItem[] = [];
  for (const item of rawItems) {
    if (!item.apiCategoryId) continue;
    if (item.apiSyncDirection !== "pull" && item.apiSyncDirection !== "both")
      continue;
    const colIndex = Math.min(activeColumn, numCols - 1);
    // As the pull: saved amounts with no such column are skipped (named); a
    // value there that isn't a number is replaced (shown as such, not $0).
    const list = storedAmountList(item.amounts);
    const skipped = list === null || !(colIndex >= 0 && colIndex < list.length);
    const currentValue = skipped
      ? null
      : readableBudgetItemAmount(item.amounts, colIndex, numCols);
    const actual = apiActualsMap.get(item.id);
    items.push({
      name: item.subcategory,
      field: "Goal Target",
      currentYnab: currentValue ?? 0,
      newValue: actual?.goalTarget ?? 0,
      ...(skipped && { unreadable: true }),
      ...(!skipped && currentValue === null && { currentUnreadable: true }),
    });
  }
  return items;
}
