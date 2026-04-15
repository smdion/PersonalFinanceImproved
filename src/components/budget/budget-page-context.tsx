"use client";

/**
 * BudgetPageContext — stable, server-derived values shared across the budget
 * page subtree. Introduced in F1 (v0.5.3) to collapse the large prop
 * signatures of BudgetTable and BudgetSummaryBar.
 *
 * Provider: BudgetContent
 * Consumers: BudgetTable (F2), BudgetSummaryBar (F3)
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
