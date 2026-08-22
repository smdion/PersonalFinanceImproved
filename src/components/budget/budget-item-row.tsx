"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { confirm } from "@/components/ui/confirm-dialog";
import { ApiCategoryPicker } from "./api-category-picker";
import type { RawItem } from "./types";

type BudgetItemRowProps = {
  item: RawItem;
  index: number;
  itemsInCategory: number;
  numCols: number;
  editMode: boolean;
  getDraft: (id: number, colIndex: number, original: number) => number;
  onSetDraft: (id: number, colIndex: number, amount: number) => void;
  onToggleEssential: (id: number, isEssential: boolean) => void;
  onMoveItem: (id: number, newCategory: string) => void;
  onDeleteItem: (id: number) => void;
  onConvertToGoal?: (id: number, name: string) => void;
  onReorderItem: (id: number, direction: "up" | "down") => void;
  categoryNames: string[];
  currentCategory: string;
  contribMonthly: number | null;
  canEdit?: boolean;
  apiActual?: { activity: number; balance: number; budgeted: number } | null;
  showApiColumn?: boolean;
  nameColWidth?: number;
  /**
   * Sandbox mode: amounts are editable via `editMode` alone (not `editMode
   * && canEdit`), and every OTHER control that reaches a live mutation —
   * the essential toggle, the API-category link/unlink picker, and the
   * move/reorder/delete/convert-to-goal action cluster — renders in its
   * fully inert/hidden form regardless of `editMode`/`canEdit`. This is the
   * structural-omission pattern used elsewhere in the What-If tab: not
   * disabled-but-present, actually absent, so nothing here can reach
   * `budget.linkToApi`/`unlinkFromApi`/`updateCategoryEssential`/etc. even
   * if a caller passes `canEdit: true` to unlock amount editing.
   */
  amountsOnly?: boolean;
};

export function BudgetItemRow({
  item,
  index,
  itemsInCategory,
  numCols,
  editMode,
  getDraft,
  onSetDraft,
  onToggleEssential,
  onMoveItem,
  onDeleteItem,
  onConvertToGoal,
  onReorderItem,
  categoryNames,
  currentCategory,
  contribMonthly,
  canEdit = true,
  apiActual,
  showApiColumn,
  nameColWidth,
  amountsOnly = false,
}: BudgetItemRowProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
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
        <span className="flex flex-wrap items-center gap-1.5 min-w-0">
          {canEdit && !amountsOnly ? (
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
          <span
            className="truncate max-w-[10rem] flex-shrink-0"
            title={item.subcategory}
          >
            {item.subcategory}
          </span>
          {contribMonthly !== null && (
            <span
              className="flex-shrink-0 text-caption font-semibold text-indigo-600 bg-indigo-50 rounded px-0.5 leading-tight"
              title={
                item.contributionAccountId
                  ? `Linked to paycheck contribution (${formatCurrency(contribMonthly)}/mo) — editing here updates it everywhere.`
                  : `Also tracked as paycheck contribution (${formatCurrency(contribMonthly)}/mo). Values are independent — editing here won't change the paycheck.`
              }
            >
              PC
            </span>
          )}
          {item.incomplete && (
            <span
              className="flex-shrink-0 text-caption font-semibold text-amber-700 bg-amber-50 rounded px-0.5 leading-tight"
              title="Linked contribution account has no resolvable pay period (missing/ended job) — excluded from this total, not defaulted."
            >
              Incomplete
            </span>
          )}
          {isLinked && (
            <span
              className={`flex-shrink-0 text-caption font-semibold text-blue-600 bg-blue-50 rounded px-0.5 leading-tight ${amountsOnly ? "" : "cursor-pointer"}`}
              title={`Linked to ${item.apiCategoryName} (${item.apiSyncDirection})`}
              onClick={(e) => {
                e.stopPropagation();
                if (canEdit && !amountsOnly) {
                  setPickerAnchor(e.currentTarget.getBoundingClientRect());
                  setShowPicker(!showPicker);
                }
              }}
            >
              API
            </span>
          )}
          {canEdit && !amountsOnly && !isLinked && (
            <span
              className="flex-shrink-0 text-caption text-faint hover:text-blue-500 cursor-pointer hidden group-hover:inline"
              title="Link to budget API category"
              onClick={(e) => {
                e.stopPropagation();
                setPickerAnchor(e.currentTarget.getBoundingClientRect());
                setShowPicker(!showPicker);
              }}
            >
              +API
            </span>
          )}
          {!amountsOnly && showPicker && pickerAnchor && (
            <ApiCategoryPicker
              budgetItemId={item.id}
              currentApiCategoryId={item.apiCategoryId}
              currentApiCategoryName={item.apiCategoryName}
              currentSyncDirection={item.apiSyncDirection}
              anchorRect={pickerAnchor}
              onClose={() => setShowPicker(false)}
            />
          )}
          {canEdit && !amountsOnly && editMode && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 whitespace-nowrap ml-1">
              <button
                onClick={() => onReorderItem(item.id, "up")}
                disabled={index === 0}
                className="text-faint hover:text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move up"
              >
                ↑
              </button>
              <button
                onClick={() => onReorderItem(item.id, "down")}
                disabled={index === itemsInCategory - 1}
                className="text-faint hover:text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                title="Move down"
              >
                ↓
              </button>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    onMoveItem(item.id, e.target.value);
                  }
                }}
                className="text-caption text-faint bg-transparent border-none cursor-pointer hover:text-secondary"
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
                  className="text-blue-400 hover:text-blue-600 text-caption"
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
                className="text-red-400 hover:text-red-600 text-caption"
                title="Delete item"
              >
                ×
              </button>
            </span>
          )}
        </span>
      </td>
      {Array.from({ length: numCols }, (_, col) => {
        // Per-column first: a linked item's monthly $ depends on the
        // Contribution/Salary Profile THIS column resolves to, which can
        // differ column to column. contribAmount is only the selected
        // column's figure and is the back-compat fallback.
        const amt =
          item.contribAmounts?.[col] ??
          (item.contribAmount != null
            ? item.contribAmount
            : (item.amounts[col] ?? 0));
        // The padlock is the ONE thing that gates amount editing here: an
        // amount is only editable when the tab is unlocked (editMode) AND the
        // user has write permission. Every other case renders static text.
        // (Previously the locked-but-editable case rendered an InlineEdit,
        // which had its own click-to-edit affordance that saved immediately
        // and so bypassed the padlock entirely.)
        // In amountsOnly (sandbox) mode, `canEdit` doesn't gate the amount —
        // every OTHER control on this row is already structurally omitted
        // above regardless of canEdit, so editMode alone is the right gate:
        // someone without the `budget` permission can still play in a
        // sandbox that writes nothing.
        const amountEditable = amountsOnly ? editMode : editMode && canEdit;
        if (!amountEditable) {
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
        const draftVal = getDraft(item.id, col, amt);
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
                  className={`ml-1.5 text-caption ${
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
