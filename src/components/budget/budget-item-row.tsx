"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { InlineEdit } from "@/components/ui/inline-edit";
import { confirm } from "@/components/ui/confirm-dialog";
import { ApiCategoryPicker } from "./api-category-picker";
import type { RawItem } from "./types";

type BudgetItemRowProps = {
  item: RawItem;
  index: number;
  numCols: number;
  editMode: boolean;
  getDraft: (id: number, colIndex: number, original: number) => number;
  onSetDraft: (id: number, colIndex: number, amount: number) => void;
  onUpdateCell: (id: number, colIndex: number, amount: number) => void;
  onToggleEssential: (id: number, isEssential: boolean) => void;
  onMoveItem: (id: number, newCategory: string) => void;
  onDeleteItem: (id: number) => void;
  onConvertToGoal?: (id: number, name: string) => void;
  categoryNames: string[];
  currentCategory: string;
  contribMonthly: number | null;
  canEdit?: boolean;
  apiActual?: { activity: number; balance: number; budgeted: number } | null;
  showApiColumn?: boolean;
  nameColWidth?: number;
};

export function BudgetItemRow({
  item,
  index,
  numCols,
  editMode,
  getDraft,
  onSetDraft,
  onUpdateCell,
  onToggleEssential,
  onMoveItem,
  onDeleteItem,
  onConvertToGoal,
  categoryNames,
  currentCategory,
  contribMonthly,
  canEdit = true,
  apiActual,
  showApiColumn,
  nameColWidth,
}: BudgetItemRowProps) {
  const [showPicker, setShowPicker] = useState(false);
  const isLinked = !!item.apiCategoryId;

  return (
    <tr
      className={`group border-b border-subtle hover:bg-blue-50/60 transition-colors ${index % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"}`}
    >
      <td
        className="py-1.5 pr-3 pl-4 text-muted sticky left-0 z-10 bg-inherit"
        style={
          nameColWidth
            ? { width: nameColWidth, maxWidth: nameColWidth }
            : { maxWidth: "12rem" }
        }
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {canEdit ? (
            <button
              onClick={() => onToggleEssential(item.id, !item.isEssential)}
              className="p-3 -m-3 flex-shrink-0 cursor-pointer touch-target flex items-center justify-center"
              title={`${item.isEssential ? "Essential" : "Discretionary"} — click to toggle`}
            >
              <span
                className={`w-2 h-2 rounded-full border transition-colors ${
                  item.isEssential
                    ? "bg-blue-500 border-blue-500"
                    : "bg-purple-400 border-purple-400"
                }`}
              />
            </button>
          ) : (
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 border ${
                item.isEssential
                  ? "bg-blue-500 border-blue-500"
                  : "bg-purple-400 border-purple-400"
              }`}
            />
          )}
          <span className="truncate" title={item.subcategory}>
            {item.subcategory}
          </span>
          {contribMonthly !== null && (
            <span
              className="flex-shrink-0 text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded px-0.5 leading-tight"
              title={`Also tracked as paycheck contribution (${formatCurrency(contribMonthly)}/mo). Values are independent — editing here won't change the paycheck.`}
            >
              PC
            </span>
          )}
          {isLinked && (
            <span
              className="flex-shrink-0 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded px-0.5 leading-tight cursor-pointer"
              title={`Linked to ${item.apiCategoryName} (${item.apiSyncDirection})`}
              onClick={(e) => {
                e.stopPropagation();
                if (canEdit) setShowPicker(!showPicker);
              }}
            >
              API
            </span>
          )}
          {canEdit && !isLinked && (
            <span
              className="flex-shrink-0 text-[10px] text-faint hover:text-blue-500 cursor-pointer hidden group-hover:inline"
              title="Link to budget API category"
              onClick={(e) => {
                e.stopPropagation();
                setShowPicker(!showPicker);
              }}
            >
              +API
            </span>
          )}
          {showPicker && (
            <ApiCategoryPicker
              budgetItemId={item.id}
              currentApiCategoryId={item.apiCategoryId}
              currentApiCategoryName={item.apiCategoryName}
              currentSyncDirection={item.apiSyncDirection}
              onClose={() => setShowPicker(false)}
            />
          )}
          {canEdit && (
            <span className="flex-shrink-0 hidden group-hover:inline-flex items-center gap-1 whitespace-nowrap ml-1">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onMoveItem(item.id, e.target.value);
                  }
                }}
                className="text-[10px] text-faint bg-transparent border-none cursor-pointer hover:text-secondary"
                title="Move to category"
              >
                <option value="">Move...</option>
                {categoryNames
                  .filter((cn) => cn !== currentCategory)
                  .map((cn) => (
                    <option key={cn} value={cn}>
                      {cn}
                    </option>
                  ))}
              </select>
              {onConvertToGoal && !item.contributionAccountId && (
                <button
                  onClick={async () => {
                    if (
                      await confirm(
                        `Convert "${item.subcategory}" to a sinking fund?`,
                      )
                    ) {
                      onConvertToGoal(item.id, item.subcategory);
                    }
                  }}
                  className="text-blue-400 hover:text-blue-600 text-[10px]"
                  title="Convert to sinking fund"
                >
                  → Fund
                </button>
              )}
              <button
                onClick={async () => {
                  if (await confirm(`Delete "${item.subcategory}"?`)) {
                    onDeleteItem(item.id);
                  }
                }}
                className="text-red-400 hover:text-red-600 text-[10px]"
                title="Delete item"
              >
                ×
              </button>
            </span>
          )}
        </span>
      </td>
      {Array.from({ length: numCols }, (_, col) => {
        const amt =
          item.contribAmount != null
            ? item.contribAmount
            : (item.amounts[col] ?? 0);
        const dbAmt = item.amounts[col] ?? 0;
        if (editMode && canEdit) {
          const draftVal = getDraft(item.id, col, dbAmt);
          return (
            <td key={col} className="text-right py-1 px-2">
              <input
                type="number"
                value={draftVal}
                onChange={(e) =>
                  onSetDraft(item.id, col, parseFloat(e.target.value) || 0)
                }
                className="w-full max-w-[100px] text-right text-xs border border-strong rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums ml-auto block"
              />
            </td>
          );
        }
        if (!canEdit) {
          const n = parseFloat(String(amt));
          return (
            <td
              key={col}
              className="text-right py-1.5 px-3 tabular-nums text-secondary text-xs"
            >
              {n > 0 ? formatCurrency(n) : "\u2014"}
            </td>
          );
        }
        return (
          <td
            key={col}
            className="text-right py-1.5 px-3 tabular-nums text-secondary"
          >
            <InlineEdit
              value={String(dbAmt)}
              type="number"
              formatDisplay={() => {
                const n = parseFloat(String(amt));
                return n > 0 ? formatCurrency(n) : "\u2014";
              }}
              parseInput={(v) => String(parseFloat(v) || 0)}
              onSave={(newVal) => {
                const newAmt = parseFloat(newVal);
                if (newAmt !== dbAmt) {
                  onUpdateCell(item.id, col, newAmt);
                }
              }}
              className="text-right justify-end text-xs"
            />
          </td>
        );
      })}
      {showApiColumn && (
        <td className="text-right py-1.5 px-2 tabular-nums text-xs">
          {apiActual ? (
            <span>
              <span className="text-secondary">
                {formatCurrency(apiActual.budgeted)}
              </span>
              {apiActual.activity !== 0 && (
                <span
                  className={`ml-1.5 text-[10px] ${
                    apiActual.activity < 0 ? "text-red-500" : "text-green-600"
                  }`}
                >
                  {apiActual.activity < 0 ? "−" : "+"}
                  {formatCurrency(Math.abs(apiActual.activity))}
                </span>
              )}
            </span>
          ) : (
            <span className="text-faint">&mdash;</span>
          )}
        </td>
      )}
    </tr>
  );
}
