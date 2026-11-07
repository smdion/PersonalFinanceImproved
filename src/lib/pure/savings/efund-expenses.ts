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
 * Resolve which budget tier/column the emergency fund's essential-expenses
 * total should be computed against. Shared by computeSavingsSummary (display) and
 * pushContributionsToApi (push) — they were independently re-deriving this
 * from app_settings with near-identical code, which risked the two drifting
 * apart (e.g. one honoring a future new override, or a fallback change, the
 * other not) — the E-fund target shown on screen must always match what
 * gets pushed to YNAB.
 *
 * Precedence: an explicit override (computeSavingsSummary's budgetTierOverride
 * input, e.g. "preview this tier without saving") > the e-fund's own saved
 * column setting > the shared budget-page active column > 0.
 *
 * `columnCount`, when given, clamps the result to a valid index for the
 * profile actually being read — the saved settings are global and can
 * point past the end of the current profile if it has fewer columns than
 * whichever profile was active when the settings were last saved (e.g. the
 * active profile switches from a 3-column to a 1-column layout).
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
