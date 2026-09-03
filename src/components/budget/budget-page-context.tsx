"use client";

/**
 * BudgetPageContext — stable, server-derived values shared across the budget
 * page subtree. Collapses the large prop signatures of BudgetTable and
 * BudgetSummaryBar.
 *
 * Provider: BudgetContent
 * Consumers: BudgetTable, BudgetSummaryBar
 */

import { createContext, useContext } from "react";

export type BudgetPageContextValue = {
  // Server-derived, stable per profile switch
  profileId: number | null;
  cols: string[];
  activeColumn: number;
  // API link state, stable per apiService change
  apiService: string | null;
  apiLinkedProfileId: number | null;
  apiLinkedColumnIndex: number | null;
  showApiColumn: boolean;
  // Permission, stable per session
  canEdit: boolean;
  // UI mode, stable per user toggle
  editMode: boolean;
  setEditMode: (mode: boolean) => void;
  /** Sandbox mode (the What-If tab) — see BudgetItemRow's amountsOnly prop
   *  for exactly what this does and doesn't unlock. Defaults false; the
   *  real Budget tab's provider never sets it. */
  amountsOnly?: boolean;
};

const BudgetPageContext = createContext<BudgetPageContextValue | null>(null);

export { BudgetPageContext };

export function useBudgetPageContext(): BudgetPageContextValue {
  const ctx = useContext(BudgetPageContext);
  if (!ctx) {
    throw new Error("useBudgetPageContext must be used within BudgetContent");
  }
  return ctx;
}
