import { storedInteger } from "@/lib/utils/stored-integer";
import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";
import type { BudgetColumns } from "@/lib/pure/budget/item-amount";
import {
  SK_BUDGET_ACTIVE_COLUMN,
  SK_EFUND_BUDGET_COLUMN,
} from "@/lib/constants/settings-keys";

/** Sum essential budget items for a given tier/column, returning monthly. */
export function getEssentialExpenses(
  budgetItems: { profileId: number; isEssential: boolean; amounts: number[] }[],
  profile: BudgetColumns & { id: number },
  tierIndex: number,
): number {
  const essentials = budgetItems.filter(
    (i) => i.profileId === profile.id && i.isEssential,
  );
  const annualTotal = computeBudgetAnnualTotal(essentials, tierIndex, profile);
  return annualTotal / 12;
}

/**
 * Budget column the emergency fund's essential expenses are computed against, for display and
 * push alike: explicit override > the e-fund's saved column > the budget page's active column > 0,
 * clamped by `columnCount` (global settings can point past the current profile's columns).
 */
export function resolveEfundTierIndex(
  appSettings: { key: string; value: unknown }[],
  overrideTierIndex?: number,
  columnCount?: number,
): number {
  const settingsMap = new Map(appSettings.map((s) => [s.key, s.value]));
  const budgetActiveColumn = storedInteger(
    settingsMap.get(SK_BUDGET_ACTIVE_COLUMN),
    0,
  );
  // -1 (or less) stores "no e-fund column": the active column is used.
  const saved = storedInteger(settingsMap.get(SK_EFUND_BUDGET_COLUMN), null);
  const efundSavedColumn = saved !== null && saved >= 0 ? saved : null;
  const resolved = overrideTierIndex ?? efundSavedColumn ?? budgetActiveColumn;
  return columnCount && columnCount > 0
    ? Math.min(resolved, columnCount - 1)
    : resolved;
}
