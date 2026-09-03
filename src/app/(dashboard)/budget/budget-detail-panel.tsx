"use client";

/**
 * BudgetDetailPanel — right side of the master-detail grid in BudgetContent.
 * Split out of budget-content.tsx to meet the ≤400 line target.
 *
 * The edit padlock lives once, in the tab bar above (budget-content.tsx) —
 * not here — so its position stays fixed across all four profile tabs.
 *
 * Consumes BudgetPageContext (cols, activeColumn, canEdit, editMode,
 * apiService, apiLinkedProfileId, apiLinkedColumnIndex) and receives the
 * remaining page-specific props from BudgetContent.
 */

import React from "react";
import {
  BudgetModeManager,
  BudgetSummaryTable,
  AddItemForm,
  AddCategoryForm,
} from "@/components/budget";
import { BudgetTable } from "@/components/budget/budget-table";
import type {
  RawItem,
  PayrollBreakdown,
  ColumnResult,
  SinkingFundLine,
} from "@/components/budget";
import type {
  TableLayout,
  RowHandlers,
} from "@/components/budget/budget-table";
import { useBudgetPageContext } from "@/components/budget/budget-page-context";

type ApiActualsMap = Map<
  number,
  { activity: number; balance: number; budgeted: number }
>;

type ColumnMutations = {
  renameColumn: { mutate: (args: { colIndex: number; label: string }) => void };
  removeColumn: { mutate: (args: { colIndex: number }) => void };
  addColumn: { mutate: (args: { label: string }) => void; isPending: boolean };
  updateColumnContribProfiles: {
    mutate: (args: { columnContributionProfileIds: (number | null)[] }) => void;
  };
  updateColumnSalaryProfiles: {
    mutate: (args: { columnSalaryProfileIds: (number | null)[] }) => void;
  };
  updateColumnMonths: {
    mutate: (args: { columnMonths: number[] | null }) => void;
  };
};

type CreateItemMutation = {
  mutate: (args: {
    category: string;
    subcategory: string;
    isEssential: boolean;
  }) => void;
  mutateAsync: (args: {
    category: string;
    subcategory: string;
    isEssential: boolean;
  }) => Promise<unknown>;
  isPending: boolean;
  error: { message: string } | null;
};

type Props = {
  showModeManager: boolean;
  isWeighted: boolean;
  allColumnResults: ColumnResult[] | null;
  setActiveColumn: (n: number) => void;
  payrollBreakdowns: (PayrollBreakdown | null)[];
  columnMonths: number[] | null;
  sinkingFunds: SinkingFundLine[];
  profile: {
    id?: number;
    name?: string;
    columnContributionProfileIds?: (number | null)[] | null;
    columnSalaryProfileIds?: (number | null)[] | null;
  } | null;
  contribProfiles: Array<{ id: number; name: string }>;
  salaryProfiles: Array<{ id: number; name: string }>;
  columnMutations: ColumnMutations;
  layout: TableLayout;
  visibleCategories: [string, RawItem[]][];
  hasMoreCategories: boolean;
  categoryNames: string[];
  getCatTotals: (items: RawItem[]) => number[];
  apiActualsMap: ApiActualsMap;
  rowHandlers: RowHandlers;
  categoryMap: Map<string, RawItem[]>;
  createItem: CreateItemMutation;
};

export function BudgetDetailPanel({
  showModeManager,
  isWeighted,
  allColumnResults,
  setActiveColumn,
  payrollBreakdowns,
  columnMonths,
  sinkingFunds,
  profile,
  contribProfiles,
  salaryProfiles,
  columnMutations,
  layout,
  visibleCategories,
  hasMoreCategories,
  categoryNames,
  getCatTotals,
  apiActualsMap,
  rowHandlers,
  categoryMap,
  createItem,
}: Props) {
  const {
    cols,
    activeColumn,
    canEdit,
    editMode,
    apiService,
    apiLinkedProfileId,
    apiLinkedColumnIndex,
  } = useBudgetPageContext();

  const { addingItemToCategory, onSetAddingItemToCategory } = rowHandlers;

  return (
    <div className="border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-4">
      {canEdit && showModeManager && (
        <BudgetModeManager
          cols={cols}
          onRenameColumn={(idx, label) =>
            columnMutations.renameColumn.mutate({
              colIndex: idx,
              label,
              ...(profile?.id != null ? { profileId: profile.id } : {}),
            })
          }
          onRemoveColumn={(idx) =>
            columnMutations.removeColumn.mutate({
              colIndex: idx,
              ...(profile?.id != null ? { profileId: profile.id } : {}),
            })
          }
          onAddColumn={(label) =>
            columnMutations.addColumn.mutate({
              label,
              ...(profile?.id != null ? { profileId: profile.id } : {}),
            })
          }
          addColumnPending={columnMutations.addColumn.isPending}
          contributionProfiles={contribProfiles}
          columnContributionProfileIds={
            (profile?.columnContributionProfileIds as
              (number | null)[] | null) ?? null
          }
          onUpdateContributionProfiles={(ids) =>
            columnMutations.updateColumnContribProfiles.mutate({
              columnContributionProfileIds: ids,
              ...(profile?.id != null ? { profileId: profile.id } : {}),
            })
          }
          salaryProfiles={salaryProfiles}
          columnSalaryProfileIds={
            (profile?.columnSalaryProfileIds as (number | null)[] | null) ??
            null
          }
          onUpdateSalaryProfiles={(ids) =>
            columnMutations.updateColumnSalaryProfiles.mutate({
              columnSalaryProfileIds: ids,
              ...(profile?.id != null ? { profileId: profile.id } : {}),
            })
          }
          columnMonths={columnMonths}
          onUpdateColumnMonths={(months) =>
            columnMutations.updateColumnMonths.mutate({
              columnMonths: months,
              ...(profile?.id != null ? { profileId: profile.id } : {}),
            })
          }
        />
      )}

      {allColumnResults && (
        <BudgetSummaryTable
          cols={cols}
          activeColumn={activeColumn}
          onSetActiveColumn={setActiveColumn}
          allColumnResults={allColumnResults}
          payrollBreakdowns={payrollBreakdowns}
          columnMonths={columnMonths}
          apiLinkedColumnIndex={
            apiLinkedProfileId === profile?.id
              ? (apiLinkedColumnIndex ?? null)
              : null
          }
          apiService={apiService}
          sinkingFunds={sinkingFunds}
          nameColWidth={layout.effectiveNameColWidth}
          savingsProfileName={profile?.name}
        />
      )}

      {cols.length > 1 && !isWeighted && (
        <p className="text-caption text-faint mb-2">
          Click a column header to set the active budget mode used across all
          pages
        </p>
      )}

      <BudgetTable
        visibleCategories={visibleCategories}
        hasMoreCategories={hasMoreCategories}
        categoryNames={categoryNames}
        getCatTotals={getCatTotals}
        layout={layout}
        apiActualsMap={apiActualsMap}
        rowHandlers={rowHandlers}
      />

      {canEdit &&
        editMode &&
        addingItemToCategory &&
        !categoryMap.has(addingItemToCategory) && (
          <AddItemForm
            category={addingItemToCategory}
            onAdd={(category, subcategory, isEssential) =>
              void createItem
                .mutateAsync({
                  category,
                  subcategory,
                  isEssential,
                  ...(profile?.id != null ? { profileId: profile.id } : {}),
                })
                .then(() => onSetAddingItemToCategory(null))
            }
            onCancel={() => onSetAddingItemToCategory(null)}
            isPending={createItem.isPending}
            error={createItem.error}
            standalone
          />
        )}

      {canEdit && editMode && (
        <AddCategoryForm
          onCreateCategory={(name) => onSetAddingItemToCategory(name)}
        />
      )}
    </div>
  );
}
