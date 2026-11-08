import type { useSandboxState } from "./use-what-if-sandbox";
import { formatCurrency } from "@/lib/utils/format";
import {
  BudgetTable,
  type RawItem,
  type ColumnResult,
} from "@/components/budget";
import { BudgetPageContext } from "@/components/budget/budget-page-context";
import { Skeleton } from "@/components/ui/skeleton";
import { WhatIfStep } from "./what-if-step";
import type { RefObject, Dispatch, SetStateAction } from "react";

export type WhatIfBudgetStepProps = {
  activeColumn: number;
  allColumnResults: ColumnResult[] | null;
  apiActualsMap: Map<
    number,
    { activity: number; balance: number; budgeted: number; goalTarget: number }
  >;
  budgetIncomeAdjustmentThisMonth: number | null;
  budgetPageContextValue: {
    profileId: number | null;
    cols: string[];
    activeColumn: number;
    apiService: null;
    apiLinkedProfileId: null;
    apiLinkedColumnIndex: null;
    showApiColumn: boolean;
    canEdit: boolean;
    editMode: boolean;
    setEditMode: () => void;
    amountsOnly: boolean;
  };
  budgetProfileName: string;
  budgetTotal: number | null;
  categoryNames: string[];
  cols: string[];
  getCatTotals: (items: RawItem[]) => number[];
  hasMoreCategories: boolean;
  leftover: number | null;
  matchContrib: (subcategory: string, colIdx?: number) => number | null;
  nameColWidth: number;
  netMonthlyIncome: number | null;
  noop: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
  sandbox: ReturnType<typeof useSandboxState>;
  sentinelRef: RefObject<HTMLTableRowElement | null>;
  setActiveColumn: Dispatch<SetStateAction<number>>;
  visibleCategories: [string, RawItem[]][];
};

export function WhatIfBudgetStep({
  activeColumn,
  allColumnResults,
  apiActualsMap,
  budgetIncomeAdjustmentThisMonth,
  budgetPageContextValue,
  budgetProfileName,
  budgetTotal,
  categoryNames,
  cols,
  getCatTotals,
  hasMoreCategories,
  leftover,
  matchContrib,
  nameColWidth,
  netMonthlyIncome,
  noop,
  onResizeStart,
  sandbox,
  sentinelRef,
  setActiveColumn,
  visibleCategories,
}: WhatIfBudgetStepProps) {
  return (
    <WhatIfStep
      number={3}
      title={`Budget${budgetProfileName ? ` — ${budgetProfileName}` : ""}`}
      description="Edit any amount to see whether take-home pay covers it."
      headerExtra={
        <div className="flex flex-wrap items-center gap-3">
          {cols.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs">Mode:</span>
              <div className="flex gap-1">
                {cols.map((label, idx) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setActiveColumn(idx)}
                    className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                      activeColumn === idx
                        ? "bg-blue-600 text-white"
                        : "bg-surface-elevated text-muted hover:bg-surface-strong"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      }
    >
      {leftover != null && (
        <div
          className={`mb-3 flex items-center justify-between rounded-md px-3 py-2 text-xs font-semibold ${
            leftover >= 0
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          <span>
            Net {formatCurrency(netMonthlyIncome ?? 0)}/mo − Budget{" "}
            {formatCurrency(budgetTotal ?? 0)}/mo
          </span>
          <span>
            {leftover >= 0 ? "" : "−"}
            {formatCurrency(Math.abs(leftover))}/mo left over
          </span>
        </div>
      )}
      {budgetIncomeAdjustmentThisMonth != null &&
        budgetIncomeAdjustmentThisMonth !== 0 && (
          <p className="text-muted -mt-2 mb-3 text-xs">
            +{formatCurrency(budgetIncomeAdjustmentThisMonth)} extra paycheck
            already included in this month&rsquo;s income (not part of Net
            above).
          </p>
        )}
      {allColumnResults && allColumnResults.length > 0 ? (
        <div className="border-subtle max-h-[520px] w-full overflow-y-auto rounded-md border">
          <BudgetPageContext.Provider value={budgetPageContextValue}>
            <BudgetTable
              visibleCategories={visibleCategories}
              hasMoreCategories={hasMoreCategories}
              categoryNames={categoryNames}
              getCatTotals={getCatTotals}
              layout={{
                effectiveNameColWidth: nameColWidth,
                onResizeStart,
                sentinelRef,
              }}
              apiActualsMap={apiActualsMap}
              rowHandlers={{
                getDraft: sandbox.getDraft,
                setDraft: sandbox.setDraft,
                onToggleItemEssential: noop,
                onToggleCategoryEssential: noop,
                onMoveItem: noop,
                onDeleteItem: noop,
                onConvertToGoal: noop,
                onReorderItem: noop,
                onReorderCategory: noop,
                onAddItem: noop,
                addItemPending: false,
                addItemError: null,
                matchContrib,
                addingItemToCategory: null,
                onSetAddingItemToCategory: noop,
              }}
            />
          </BudgetPageContext.Provider>
        </div>
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </WhatIfStep>
  );
}
