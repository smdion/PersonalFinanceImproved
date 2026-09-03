"use client";

import React from "react";
import { formatCurrency } from "@/lib/utils/format";
import { BudgetItemRow } from "./budget-item-row";
import { AddItemForm } from "./add-item-form";
import type { RawItem } from "./types";

type BudgetCategoryRowProps = {
  categoryName: string;
  items: RawItem[];
  numCols: number;
  catTotals: number[];
  editMode: boolean;
  getDraft: (id: number, colIndex: number, original: number) => number;
  onSetDraft: (id: number, colIndex: number, amount: number) => void;
  onToggleItemEssential: (id: number, isEssential: boolean) => void;
  onToggleCategoryEssential: (category: string, isEssential: boolean) => void;
  onMoveItem: (id: number, newCategory: string) => void;
  onDeleteItem: (id: number) => void;
  onConvertToGoal?: (id: number, name: string) => void;
  onReorderItem: (id: number, direction: "up" | "down") => void;
  onReorderCategory: (category: string, direction: "up" | "down") => void;
  isFirstCategory: boolean;
  isLastCategory: boolean;
  onAddItem: (
    category: string,
    subcategory: string,
    isEssential: boolean,
  ) => void;
  addItemPending: boolean;
  addItemError?: { message: string } | null;
  categoryNames: string[];
  addingItemToCategory: string | null;
  onSetAddingItemToCategory: (category: string | null) => void;
  matchContrib: (subcategory: string, colIdx?: number) => number | null;
  activeColumn: number;
  canEdit?: boolean;
  apiActualsMap?: Map<
    number,
    { activity: number; balance: number; budgeted: number }
  >;
  showApiColumn?: boolean;
  nameColWidth?: number;
  /** See BudgetItemRow's amountsOnly prop — same contract, threaded down
   *  to it plus this row's own category-level controls (essential toggle,
   *  reorder, + item), which are ALSO structurally omitted here. */
  amountsOnly?: boolean;
};

export function BudgetCategoryRow({
  categoryName,
  items,
  numCols,
  catTotals,
  editMode,
  getDraft,
  onSetDraft,
  onToggleItemEssential,
  onToggleCategoryEssential,
  onMoveItem,
  onDeleteItem,
  onConvertToGoal,
  onReorderItem,
  onReorderCategory,
  isFirstCategory,
  isLastCategory,
  onAddItem,
  addItemPending,
  addItemError,
  categoryNames,
  addingItemToCategory,
  onSetAddingItemToCategory,
  matchContrib,
  activeColumn,
  canEdit = true,
  apiActualsMap,
  showApiColumn,
  nameColWidth,
  amountsOnly = false,
}: BudgetCategoryRowProps) {
  const allEssential = items.every((i) => i.isEssential);
  const allDiscretionary = items.every((i) => !i.isEssential);

  return (
    <React.Fragment>
      {/* Category header row */}
      <tr className="bg-surface-elevated border-b">
        <td
          className="text-primary bg-surface-elevated sticky left-0 z-10 overflow-hidden py-1.5 pr-3 font-semibold"
          style={
            nameColWidth
              ? { width: nameColWidth, maxWidth: nameColWidth }
              : { maxWidth: "12rem" }
          }
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {canEdit && !amountsOnly ? (
              <button
                onClick={() =>
                  onToggleCategoryEssential(categoryName, !allEssential)
                }
                className="touch-target -m-3 flex flex-shrink-0 cursor-pointer items-center justify-center p-3"
                title={`${allEssential ? "Mark all discretionary" : "Mark all essential"} in ${categoryName}`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full border-2 transition-colors ${
                    allEssential
                      ? "border-blue-500 bg-blue-500"
                      : allDiscretionary
                        ? "border-purple-400 bg-purple-400"
                        : "border-strong bg-gradient-to-r from-blue-500 to-purple-400"
                  }`}
                />
              </button>
            ) : (
              <span
                className={`h-2.5 w-2.5 flex-shrink-0 rounded-full border-2 ${
                  allEssential
                    ? "border-blue-500 bg-blue-500"
                    : allDiscretionary
                      ? "border-purple-400 bg-purple-400"
                      : "border-strong bg-gradient-to-r from-blue-500 to-purple-400"
                }`}
              />
            )}
            <span
              className="max-w-[10rem] flex-shrink-0 truncate"
              title={categoryName}
            >
              {categoryName}
            </span>
            {canEdit && !amountsOnly && editMode && (
              <>
                <button
                  onClick={() => onReorderCategory(categoryName, "up")}
                  disabled={isFirstCategory}
                  className="text-faint hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
                  title="Move category up"
                >
                  ↑
                </button>
                <button
                  onClick={() => onReorderCategory(categoryName, "down")}
                  disabled={isLastCategory}
                  className="text-faint hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
                  title="Move category down"
                >
                  ↓
                </button>
                <button
                  onClick={() => {
                    onSetAddingItemToCategory(
                      addingItemToCategory === categoryName
                        ? null
                        : categoryName,
                    );
                  }}
                  className="text-caption font-medium text-blue-500 hover:text-blue-700"
                  title={`Add item to ${categoryName}`}
                >
                  + item
                </button>
              </>
            )}
          </span>
        </td>
        {catTotals.map((total, i) => (
          <td
            // eslint-disable-next-line react/no-array-index-key -- positional column totals have no stable identity
            key={i}
            className="text-primary px-3 py-1.5 text-right font-semibold tabular-nums"
          >
            {formatCurrency(total)}
          </td>
        ))}
        {showApiColumn && <td />}
      </tr>
      {/* Add item form */}
      {canEdit &&
        !amountsOnly &&
        editMode &&
        addingItemToCategory === categoryName && (
          <AddItemForm
            category={categoryName}
            onAdd={onAddItem}
            onCancel={() => onSetAddingItemToCategory(null)}
            isPending={addItemPending}
            numCols={numCols}
            error={addItemError}
          />
        )}
      {/* Item rows */}
      {items.map((item, idx) => (
        <BudgetItemRow
          key={item.id}
          item={item}
          index={idx}
          itemsInCategory={items.length}
          numCols={numCols}
          editMode={editMode}
          getDraft={getDraft}
          onSetDraft={onSetDraft}
          onToggleEssential={onToggleItemEssential}
          onMoveItem={onMoveItem}
          onDeleteItem={onDeleteItem}
          onConvertToGoal={onConvertToGoal}
          onReorderItem={onReorderItem}
          categoryNames={categoryNames}
          currentCategory={categoryName}
          contribMonthly={
            // A linked item's own resolved amount is the real number
            // (matches what getCatTotals uses) — the fuzzy name match is
            // only ever a display estimate for items with NO real link,
            // so a linked item must never show the fuzzy figure instead
            // of its own (e.g. two accounts sharing a keyword like
            // "brokerage", one linked, one not).
            item.contributionAccountId != null
              ? (item.contribAmounts?.[activeColumn] ??
                item.contribAmount ??
                null)
              : matchContrib(item.subcategory, activeColumn)
          }
          contribStatus={item.contribStatus?.[activeColumn] ?? "ok"}
          canEdit={canEdit}
          apiActual={apiActualsMap?.get(item.id) ?? null}
          showApiColumn={showApiColumn}
          nameColWidth={nameColWidth}
          amountsOnly={amountsOnly}
        />
      ))}
    </React.Fragment>
  );
}
