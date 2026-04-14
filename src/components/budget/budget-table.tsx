"use client";

/**
 * Full budget table — extracted from `src/app/(dashboard)/budget/page.tsx`
 * during the v0.5.2 file-split refactor. Pure relocation — no behavior
 * changes.
 *
 * Renders the sticky-left Category/Item column, per-mode columns (with
 * API-link badge on the linked column), an optional YNAB/API actuals
 * column, and a body of BudgetCategoryRow entries plus the
 * IntersectionObserver sentinel for lazy "load more" scrolling. The
 * parent still owns:
 *   - rawItems → categories grouping
 *   - edit-mode draft store
 *   - all tRPC mutations (passed in as plain callback props)
 *   - the sentinel ref + observer wiring
 */

import React from "react";
import { BudgetCategoryRow } from "./budget-category-row";
import type { RawItem } from "./types";

type ApiActualsMap = Map<
  number,
  { activity: number; balance: number; budgeted: number }
>;

type RowHandlers = {
  getDraft: (id: number, colIndex: number, original: number) => number;
  setDraft: (id: number, colIndex: number, amount: number) => void;
  onUpdateCell: (id: number, colIndex: number, amount: number) => void;
  onToggleItemEssential: (id: number, isEssential: boolean) => void;
  onToggleCategoryEssential: (category: string, isEssential: boolean) => void;
  onMoveItem: (id: number, newCategory: string) => void;
  onDeleteItem: (id: number) => void;
  onConvertToGoal: (id: number, name: string) => void;
  onAddItem: (
    category: string,
    subcategory: string,
    isEssential: boolean,
  ) => void;
  addItemPending: boolean;
  addItemError: { message: string } | null;
  matchContrib: (subcategory: string) => number | null;
};

type Props = {
  // Rows + grouping
  visibleCategories: [string, RawItem[]][];
  hasMoreCategories: boolean;
  numCols: number;
  cols: string[];
  categoryNames: string[];
  getCatTotals: (items: RawItem[]) => number[];

  // Layout
  effectiveNameColWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  sentinelRef: React.RefObject<HTMLTableRowElement | null>;

  // API integration badges / extra column
  apiService: string | null | undefined;
  apiLinkedProfileId: number | null;
  profileId: number | null | undefined;
  apiLinkedColumnIndex: number;
  showApiColumn: boolean;
  apiActualsService: string | null | undefined;
  apiActualsMap: ApiActualsMap;

  // Permissions + edit state
  canEdit: boolean;
  editMode: boolean;

  // Adding-item state (hoisted to parent so the standalone add-item form
  // outside the table can share it).
  addingItemToCategory: string | null;
  onSetAddingItemToCategory: (category: string | null) => void;

  // Per-row pass-through callbacks
  rowHandlers: RowHandlers;
};

export function BudgetTable({
  visibleCategories,
  hasMoreCategories,
  numCols,
  cols,
  categoryNames,
  getCatTotals,
  effectiveNameColWidth,
  onResizeStart,
  sentinelRef,
  apiService,
  apiLinkedProfileId,
  profileId,
  apiLinkedColumnIndex,
  showApiColumn,
  apiActualsService,
  apiActualsMap,
  canEdit,
  editMode,
  addingItemToCategory,
  onSetAddingItemToCategory,
  rowHandlers,
}: Props) {
  return (
    <div className="overflow-x-auto relative">
      <table
        className="w-full text-xs border-collapse"
        style={{ tableLayout: "fixed" }}
      >
        <thead>
          <tr className="border-b-2 border-strong">
            <th
              className="text-left py-2 pr-3 text-muted font-medium sticky left-0 bg-surface-sunken z-10 select-none"
              style={{
                width: effectiveNameColWidth,
                minWidth: 120,
                maxWidth: 400,
              }}
            >
              <span className="flex items-center justify-between">
                <span>Category / Item</span>
                <span
                  onMouseDown={onResizeStart}
                  className="cursor-col-resize px-1 text-faint hover:text-secondary select-none"
                  title="Drag to resize"
                >
                  ⋮
                </span>
              </span>
            </th>
            {cols.map((label, colIdx) => (
              <th
                key={label}
                className="text-right py-2 px-3 text-muted font-medium min-w-[90px]"
              >
                {label}
                {apiService &&
                  apiLinkedProfileId === profileId &&
                  apiLinkedColumnIndex === colIdx && (
                    <span className="ml-1 text-[8px] px-1 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold align-middle">
                      ⇄ {apiService.toUpperCase()}
                    </span>
                  )}
              </th>
            ))}
            {showApiColumn && (
              <th className="text-right py-2 px-2 text-muted font-medium min-w-[80px] text-xs">
                {apiActualsService?.toUpperCase()}
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
              onUpdateCell={rowHandlers.onUpdateCell}
              onToggleItemEssential={rowHandlers.onToggleItemEssential}
              onToggleCategoryEssential={rowHandlers.onToggleCategoryEssential}
              onMoveItem={rowHandlers.onMoveItem}
              onDeleteItem={rowHandlers.onDeleteItem}
              onConvertToGoal={rowHandlers.onConvertToGoal}
              onAddItem={rowHandlers.onAddItem}
              addItemPending={rowHandlers.addItemPending}
              addItemError={rowHandlers.addItemError}
              categoryNames={categoryNames}
              addingItemToCategory={addingItemToCategory}
              onSetAddingItemToCategory={onSetAddingItemToCategory}
              matchContrib={rowHandlers.matchContrib}
              canEdit={canEdit}
              apiActualsMap={apiActualsMap}
              showApiColumn={showApiColumn}
              nameColWidth={effectiveNameColWidth}
            />
          ))}
          {hasMoreCategories && (
            <tr ref={sentinelRef} aria-hidden="true">
              <td
                colSpan={numCols + (showApiColumn ? 2 : 1)}
                className="text-center py-3 text-xs text-muted"
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
