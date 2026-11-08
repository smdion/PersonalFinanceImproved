/** The budget summary's header row: one column per budget mode, each a
 *  switch that makes its mode the active one. */

import { Badge } from "@/components/ui/badge";
import { CellButton } from "@/components/ui/cell-button";

type BudgetSummaryHeaderProps = {
  nameColWidth: number | undefined;
  cols: string[];
  isWeighted: boolean;
  activeColumn: number;
  onSetActiveColumn: (col: number) => void;
  columnMonths: number[] | null;
  apiService: string | null | undefined;
  apiLinkedColumnIndex: number | null | undefined;
};

export function BudgetSummaryHeader({
  nameColWidth,
  cols,
  isWeighted,
  activeColumn,
  onSetActiveColumn,
  columnMonths,
  apiService,
  apiLinkedColumnIndex,
}: BudgetSummaryHeaderProps) {
  return (
    <thead>
      <tr className="border-strong border-b-2">
        <th
          className="text-muted py-1.5 pr-3 text-left font-medium"
          style={{
            width: nameColWidth ?? 192,
            minWidth: 120,
            maxWidth: 400,
          }}
        />
        {cols.map((label, colIdx) => (
          <th
            key={label}
            className={`min-w-[90px] px-2 py-1.5 text-right font-semibold transition-colors ${
              isWeighted
                ? "text-primary"
                : colIdx === activeColumn
                  ? "cursor-pointer bg-blue-50 text-blue-700"
                  : "text-primary cursor-pointer hover:text-blue-600"
            }`}
            onClick={isWeighted ? undefined : () => onSetActiveColumn(colIdx)}
            title={
              isWeighted
                ? `${label} — ${columnMonths?.[colIdx] ?? 0} month${(columnMonths?.[colIdx] ?? 0) !== 1 ? "s" : ""}`
                : colIdx === activeColumn
                  ? `${label} is the active budget mode`
                  : `Set ${label} as active mode`
            }
          >
            <CellButton enabled={!isWeighted} pressed={colIdx === activeColumn}>
              {label}
              {!isWeighted && colIdx === activeColumn && (
                <span className="text-caption ml-1 align-super text-blue-500">
                  ●
                </span>
              )}
              {apiService && apiLinkedColumnIndex === colIdx && (
                <Badge color="blue" case="normal" className="ml-1 align-middle">
                  ⇄ {apiService.toUpperCase()}
                </Badge>
              )}
            </CellButton>
          </th>
        ))}
        {isWeighted && (
          <th
            className="text-primary bg-surface-sunken/60 min-w-[90px] px-2 py-1.5 text-right font-semibold"
            title="Weighted average across modes — what a typical month looks like"
          >
            Blended
          </th>
        )}
      </tr>
    </thead>
  );
}
