"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { confirm } from "@/components/ui/confirm-dialog";
import { ApiCategoryPicker } from "./api-category-picker";
import type { RawItem } from "./types";
import type { ContribResolutionStatus } from "@/lib/pure/profiles";
import {
  CONTRIB_RESOLUTION_LABELS,
  CONTRIB_RESOLUTION_TOOLTIPS,
} from "@/lib/config/display-labels";

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
  /** Why a LINKED item's contribMonthly is what it is for the column being
   *  viewed — "ok" for a normal resolved value. Ignored for unlinked items
   *  (their contribMonthly is always the fuzzy match, never classified). */
  contribStatus?: ContribResolutionStatus;
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
  contribStatus = "ok",
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
      className={`group border-subtle border-b transition-colors hover:bg-blue-50/60 ${index % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"}`}
    >
      <td
        className="text-muted sticky left-0 z-10 bg-inherit py-1.5 pr-3 pl-4"
        style={
          nameColWidth
            ? { width: nameColWidth, maxWidth: nameColWidth }
            : { maxWidth: "12rem" }
        }
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {canEdit && !amountsOnly ? (
            <button
              onClick={() => onToggleEssential(item.id, !item.isEssential)}
              className="touch-target -m-3 flex flex-shrink-0 cursor-pointer items-center justify-center p-3"
              title={`${item.isEssential ? "Essential" : "Discretionary"} — click to toggle`}
            >
              <span
                className={`h-2 w-2 rounded-full border transition-colors ${
                  item.isEssential
                    ? "border-blue-500 bg-blue-500"
                    : "border-purple-400 bg-purple-400"
                }`}
              />
            </button>
          ) : (
            <span
              className={`h-2 w-2 flex-shrink-0 rounded-full border ${
                item.isEssential
                  ? "border-blue-500 bg-blue-500"
                  : "border-purple-400 bg-purple-400"
              }`}
            />
          )}
          <span
            className="max-w-[10rem] flex-shrink-0 truncate"
            title={item.subcategory}
          >
            {item.subcategory}
          </span>
          {contribMonthly !== null &&
            (item.contributionAccountId == null || contribStatus === "ok" ? (
              <span
                className="text-caption flex-shrink-0 rounded bg-indigo-50 px-0.5 leading-tight font-semibold text-indigo-600"
                title={
                  item.contributionAccountId
                    ? `Linked to paycheck contribution (${formatCurrency(contribMonthly)}/mo) — editing here updates it everywhere.`
                    : `Also tracked as paycheck contribution (${formatCurrency(contribMonthly)}/mo). Values are independent — editing here won't change the paycheck.`
                }
              >
                PC
              </span>
            ) : (
              // Linked, but this column's amount is $0 for a reason other
              // than a genuinely-configured zero — name the reason instead
              // of showing a bare "PC" the user would read as a real $0.
              <span
                className="text-caption flex-shrink-0 rounded bg-amber-50 px-0.5 leading-tight font-semibold text-amber-700"
                title={CONTRIB_RESOLUTION_TOOLTIPS[contribStatus]}
              >
                {CONTRIB_RESOLUTION_LABELS[contribStatus]}
              </span>
            ))}
          {isLinked && (
            <span
              className={`text-caption flex-shrink-0 rounded bg-blue-50 px-0.5 leading-tight font-semibold text-blue-600 ${amountsOnly ? "" : "cursor-pointer"}`}
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
              className="text-caption text-faint hidden flex-shrink-0 cursor-pointer group-hover:inline hover:text-blue-500"
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
            <span className="ml-1 inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
              <button
                onClick={() => onReorderItem(item.id, "up")}
                disabled={index === 0}
                className="text-faint hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
                title="Move up"
              >
                ↑
              </button>
              <button
                onClick={() => onReorderItem(item.id, "down")}
                disabled={index === itemsInCategory - 1}
                className="text-faint hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
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
                className="text-caption text-faint hover:text-secondary cursor-pointer border-none bg-transparent"
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
                  className="text-caption text-blue-400 hover:text-blue-600"
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
                className="text-caption text-red-400 hover:text-red-600"
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
              className="text-secondary px-3 py-1.5 text-right text-xs tabular-nums"
            >
              {n > 0 ? formatCurrency(n) : "\u2014"}
            </td>
          );
        }
        const draftVal = getDraft(item.id, col, amt);
        return (
          <td key={col} className="px-2 py-1 text-right">
            <input
              type="number"
              value={draftVal}
              onChange={(e) =>
                onSetDraft(item.id, col, parseFloat(e.target.value) || 0)
              }
              className="border-strong ml-auto block w-full max-w-[100px] rounded border px-1.5 py-0.5 text-right text-xs tabular-nums focus:ring-1 focus:ring-blue-400 focus:outline-none"
            />
          </td>
        );
      })}
      {showApiColumn && (
        <td className="px-2 py-1.5 text-right text-xs tabular-nums">
          {apiActual ? (
            <span>
              <span className="text-secondary">
                {formatCurrency(apiActual.budgeted)}
              </span>
              {apiActual.activity !== 0 && (
                <span
                  className={`text-caption ml-1.5 ${
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
