import { computeBudgetAnnualTotal } from "@/lib/pure/budget/annual-total";
import {
  SK_BUDGET_ACTIVE_COLUMN,
  SK_EFUND_BUDGET_COLUMN,
} from "@/lib/constants/settings-keys";

/** Sum essential budget items for a given tier/column, returning monthly. */
export function getEssentialExpenses(
  budgetItems: { profileId: number; isEssential: boolean; amounts: number[] }[],
  profileId: number,
  tierIndex: number,
  columnMonths: number[] | null,
): number {
  const essentials = budgetItems.filter(
    (i) => i.profileId === profileId && i.isEssential,
  );
  const annualTotal = computeBudgetAnnualTotal(
    essentials,
    tierIndex,
    columnMonths,
  );
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
  const budgetActiveColumn =
    typeof settingsMap.get(SK_BUDGET_ACTIVE_COLUMN) === "number"
      ? (settingsMap.get(SK_BUDGET_ACTIVE_COLUMN) as number)
      : 0;
  const efundSavedColumn =
    typeof settingsMap.get(SK_EFUND_BUDGET_COLUMN) === "number" &&
    (settingsMap.get(SK_EFUND_BUDGET_COLUMN) as number) >= 0
      ? (settingsMap.get(SK_EFUND_BUDGET_COLUMN) as number)
      : null;
  const resolved = overrideTierIndex ?? efundSavedColumn ?? budgetActiveColumn;
  return columnCount && columnCount > 0
    ? Math.min(resolved, columnCount - 1)
    : resolved;
}
