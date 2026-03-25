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
  onUpdateCell: (id: number, colIndex: number, amount: number) => void;
  onToggleItemEssential: (id: number, isEssential: boolean) => void;
  onToggleCategoryEssential: (category: string, isEssential: boolean) => void;
  onMoveItem: (id: number, newCategory: string) => void;
  onDeleteItem: (id: number) => void;
  onConvertToGoal?: (id: number, name: string) => void;
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
  matchContrib: (subcategory: string) => number | null;
  canEdit?: boolean;
  apiActualsMap?: Map<
    number,
    { activity: number; balance: number; budgeted: number }
  >;
  showApiColumn?: boolean;
  nameColWidth?: number;
};

export function BudgetCategoryRow({
  categoryName,
  items,
  numCols,
  catTotals,
  editMode,
  getDraft,
  onSetDraft,
  onUpdateCell,
  onToggleItemEssential,
  onToggleCategoryEssential,
  onMoveItem,
  onDeleteItem,
  onConvertToGoal,
  onAddItem,
  addItemPending,
  addItemError,
  categoryNames,
  addingItemToCategory,
  onSetAddingItemToCategory,
  matchContrib,
  canEdit = true,
  apiActualsMap,
  showApiColumn,
  nameColWidth,
}: BudgetCategoryRowProps) {
  const allEssential = items.every((i) => i.isEssential);
  const allDiscretionary = items.every((i) => !i.isEssential);

  return (
    <React.Fragment>
      {/* Category header row */}
      <tr className="bg-surface-elevated border-b">
        <td
          className="py-1.5 pr-3 font-semibold text-primary sticky left-0 bg-surface-elevated z-10 overflow-hidden"
          style={
            nameColWidth
              ? { width: nameColWidth, maxWidth: nameColWidth }
              : { maxWidth: "12rem" }
          }
        >
          <span className="flex items-center gap-2 min-w-0">
            {canEdit ? (
              <button
                onClick={() =>
                  onToggleCategoryEssential(categoryName, !allEssential)
                }
                className="p-3 -m-3 flex-shrink-0 cursor-pointer touch-target flex items-center justify-center"
                title={`${allEssential ? "Mark all discretionary" : "Mark all essential"} in ${categoryName}`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full border-2 transition-colors ${
                    allEssential
                      ? "bg-blue-500 border-blue-500"
                      : allDiscretionary
                        ? "bg-purple-400 border-purple-400"
                        : "bg-gradient-to-r from-blue-500 to-purple-400 border-strong"
                  }`}
                />
              </button>
            ) : (
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 border-2 ${
                  allEssential
                    ? "bg-blue-500 border-blue-500"
                    : allDiscretionary
                      ? "bg-purple-400 border-purple-400"
                      : "bg-gradient-to-r from-blue-500 to-purple-400 border-strong"
                }`}
              />
            )}
            <span className="truncate" title={categoryName}>
              {categoryName}
            </span>
            {canEdit && (
              <button
                onClick={() => {
                  onSetAddingItemToCategory(
                    addingItemToCategory === categoryName ? null : categoryName,
                  );
                }}
                className="text-blue-500 hover:text-blue-700 text-[10px] font-medium"
                title={`Add item to ${categoryName}`}
              >
                + item
              </button>
            )}
          </span>
        </td>
        {catTotals.map((total, i) => (
          <td
            // eslint-disable-next-line react/no-array-index-key -- positional column totals have no stable identity
            key={i}
            className="text-right py-1.5 px-3 font-semibold text-primary tabular-nums"
          >
            {formatCurrency(total)}
          </td>
        ))}
        {showApiColumn && <td />}
      </tr>
      {/* Add item form */}
      {canEdit && addingItemToCategory === categoryName && (
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
          numCols={numCols}
          editMode={editMode}
          getDraft={getDraft}
          onSetDraft={onSetDraft}
          onUpdateCell={onUpdateCell}
          onToggleEssential={onToggleItemEssential}
          onMoveItem={onMoveItem}
          onDeleteItem={onDeleteItem}
          onConvertToGoal={onConvertToGoal}
          categoryNames={categoryNames}
          currentCategory={categoryName}
          contribMonthly={matchContrib(item.subcategory)}
          canEdit={canEdit}
          apiActual={apiActualsMap?.get(item.id) ?? null}
          showApiColumn={showApiColumn}
          nameColWidth={nameColWidth}
        />
      ))}
    </React.Fragment>
  );
}
