"use client";

/**
 * Full budget table: sticky Category/Item column, per-mode columns, optional API
 * actuals column, category rows and the lazy-load sentinel. Reads BudgetPageContext.
 */

import React from "react";
import { BudgetCategoryRow } from "./budget-category-row";
import { useBudgetPageContext } from "./budget-page-context";
import { Badge } from "@/components/ui/badge";
import type { RawItem } from "./types";

type ApiActualsMap = Map<
  number,
  { activity: number; balance: number; budgeted: number }
>;

export type TableLayout = {
  effectiveNameColWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  sentinelRef: React.RefObject<HTMLTableRowElement | null>;
};

export type RowHandlers = {
  getDraft: (id: number, colIndex: number, original: number) => number;
  setDraft: (id: number, colIndex: number, amount: number) => void;
  onToggleItemEssential: (id: number, isEssential: boolean) => void;
  onToggleCategoryEssential: (category: string, isEssential: boolean) => void;
  onMoveItem: (id: number, newCategory: string) => void;
  onDeleteItem: (id: number) => void;
  onConvertToGoal: (id: number, name: string) => void;
  onReorderItem: (id: number, direction: "up" | "down") => void;
  onReorderCategory: (category: string, direction: "up" | "down") => void;
  onAddItem: (
    category: string,
    subcategory: string,
    isEssential: boolean,
  ) => void;
  addItemPending: boolean;
  addItemError: { message: string } | null;
  matchContribution: (subcategory: string, colIndex?: number) => number | null;
  // Adding-item state bundled here so the standalone add-item form
  // outside the table can share the same handler via rowHandlers.
  addingItemToCategory: string | null;
  onSetAddingItemToCategory: (category: string | null) => void;
};

type Props = {
  // Row data
  visibleCategories: [string, RawItem[]][];
  hasMoreCategories: boolean;
  categoryNames: string[];
  getCatTotals: (items: RawItem[]) => number[];
  // Layout bundle (effectiveNameColWidth, onResizeStart, sentinelRef)
  layout: TableLayout;
  // API actuals data (changes per API refresh)
  apiActualsMap: ApiActualsMap;
  // Per-row callbacks (includes addingItemToCategory state)
  rowHandlers: RowHandlers;
};

export function BudgetTable({
  visibleCategories,
  hasMoreCategories,
  categoryNames,
  getCatTotals,
  layout,
  apiActualsMap,
  rowHandlers,
}: Props) {
  const {
    cols,
    activeColumn,
    apiService,
    apiLinkedProfileId,
    profileId,
    apiLinkedColumnIndex,
    showApiColumn,
    canEdit,
    editMode,
    amountsOnly,
  } = useBudgetPageContext();
  const numCols = cols.length;
  const { effectiveNameColWidth, onResizeStart, sentinelRef } = layout;
  const { addingItemToCategory, onSetAddingItemToCategory } = rowHandlers;
  return (
    <div className="relative overflow-x-auto">
      <table
        className="w-full border-collapse text-xs"
        style={{ tableLayout: "fixed" }}
      >
        <thead>
          <tr className="border-strong border-b-2">
            <th
              className="text-muted bg-surface-sunken sticky left-0 z-10 py-2 pr-3 text-left font-medium select-none"
              // No fixed `width`: every other column has a pixel width under
              // table-layout:fixed, so this one absorbs the leftover space at
              // any mode count.
              style={{ minWidth: effectiveNameColWidth, maxWidth: 400 }}
            >
              <span className="flex items-center justify-between">
                <span>Category / Item</span>
                <span
                  onMouseDown={onResizeStart}
                  className="text-faint hover:text-secondary cursor-col-resize px-1 select-none"
                  title="Drag to resize"
                >
                  ⋮
                </span>
              </span>
            </th>
            {cols.map((label, colIndex) => (
              <th
                key={label}
                className="text-muted px-3 py-2 text-right font-medium"
                style={{ width: 130 }}
              >
                {label}
                {apiService &&
                  apiLinkedProfileId === profileId &&
                  apiLinkedColumnIndex === colIndex && (
                    <Badge
                      color="blue"
                      case="normal"
                      className="ml-1 align-middle"
                    >
                      ⇄ {apiService.toUpperCase()}
                    </Badge>
                  )}
              </th>
            ))}
            {showApiColumn && (
              <th
                className="text-muted px-2 py-2 text-right text-xs font-medium"
                style={{ width: 110 }}
              >
                {apiService?.toUpperCase()}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {visibleCategories.map(([catName, items]) => (
            <BudgetCategoryRow
              key={catName}
              categoryName={catName}
              items={items}
              numCols={numCols}
              catTotals={getCatTotals(items)}
              editMode={editMode}
              getDraft={rowHandlers.getDraft}
              onSetDraft={rowHandlers.setDraft}
              onToggleItemEssential={rowHandlers.onToggleItemEssential}
              onToggleCategoryEssential={rowHandlers.onToggleCategoryEssential}
              onMoveItem={rowHandlers.onMoveItem}
              onDeleteItem={rowHandlers.onDeleteItem}
              onConvertToGoal={rowHandlers.onConvertToGoal}
              onReorderItem={rowHandlers.onReorderItem}
              onReorderCategory={rowHandlers.onReorderCategory}
              isFirstCategory={categoryNames[0] === catName}
              isLastCategory={
                categoryNames[categoryNames.length - 1] === catName
              }
              onAddItem={rowHandlers.onAddItem}
              addItemPending={rowHandlers.addItemPending}
              addItemError={rowHandlers.addItemError}
              categoryNames={categoryNames}
              addingItemToCategory={addingItemToCategory}
              onSetAddingItemToCategory={onSetAddingItemToCategory}
              matchContribution={rowHandlers.matchContribution}
              activeColumn={activeColumn}
              canEdit={canEdit}
              apiActualsMap={apiActualsMap}
              showApiColumn={showApiColumn}
              nameColWidth={effectiveNameColWidth}
              amountsOnly={amountsOnly}
            />
          ))}
          {hasMoreCategories && (
            <tr ref={sentinelRef} aria-hidden="true">
              <td
                colSpan={numCols + (showApiColumn ? 2 : 1)}
                className="text-muted py-3 text-center text-xs"
              >
                Loading more categories...
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
