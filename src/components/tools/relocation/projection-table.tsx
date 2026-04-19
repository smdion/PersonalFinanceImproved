"use client";

/** Year-by-year portfolio projection comparison table for the Relocation
 *  calculator. Extracted from tools/page.tsx during the v0.5.2 file-split
 *  refactor. Stateless — all state flows via props.
 */

import { Toggle } from "@/components/ui/toggle";
import { formatCurrency } from "@/lib/utils/format";
import type {
  LargePurchaseRow,
  RelocationResult,
  YearAdjustmentRow,
} from "./types";

type PersonLookup = { name: string; birthYear: number };

type Props = {
  result: RelocationResult;
  showRelocAllYears: boolean;
  setShowRelocAllYears: (show: boolean) => void;
  relocYearAdjustments: YearAdjustmentRow[];
  relocLargePurchases: LargePurchaseRow[];
  peopleLookup: PersonLookup[] | undefined;
  displayAge: (year: number) => number | null;
  ageTooltip: (year: number) => string | undefined;
};

export function RelocationProjectionTable({
  result: r,
  showRelocAllYears,
  setShowRelocAllYears,
  relocYearAdjustments,
  relocLargePurchases,
  peopleLookup,
  displayAge,
  ageTooltip,
}: Props) {
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium text-secondary">
          Portfolio Projection Comparison
        </h4>
        <Toggle
          label="All years"
          checked={showRelocAllYears}
          onChange={setShowRelocAllYears}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-muted">
              <th className="text-left py-1 pr-3">Year</th>
              <th className="text-left py-1 pr-3">
                Age
                {peopleLookup && peopleLookup.length > 1 ? " (avg)" : ""}
              </th>
              <th className="text-right py-1 pr-3">Contributions</th>
              <th className="text-right py-1 pr-3">Current Balance</th>
              <th className="text-right py-1 pr-3">Reloc Contributions</th>
              <th className="text-right py-1 pr-3">Relocation Balance</th>
              <th className="text-right py-1 pr-3">Gap</th>
              <th className="text-right py-1">Reloc Expenses</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const rows = r.projectionByYear;
              if (rows.length === 0) return null;
              const milestoneYears = new Set<number>();
              milestoneYears.add(rows[0]!.year);
              milestoneYears.add(rows[rows.length - 1]!.year);
              for (const row of rows) {
                if (row.age % 5 === 0) milestoneYears.add(row.year);
              }
              if (r.currentFiAge !== null) {
                const fiRow = rows.find((row) => row.age === r.currentFiAge);
                if (fiRow) milestoneYears.add(fiRow.year);
              }
              if (r.relocationFiAge !== null) {
                const fiRow = rows.find((row) => row.age === r.relocationFiAge);
                if (fiRow) milestoneYears.add(fiRow.year);
              }
              if (r.earliestRelocateAge !== null) {
                const eRow = rows.find(
                  (row) => row.age === r.earliestRelocateAge,
                );
                if (eRow) milestoneYears.add(eRow.year);
              }
              for (const adj of relocYearAdjustments)
                milestoneYears.add(adj.year);
              for (const p of relocLargePurchases)
                milestoneYears.add(p.purchaseYear);

              const purchaseYears = new Set(
                relocLargePurchases.map((p) => p.purchaseYear),
              );

              const displayRows = showRelocAllYears
                ? rows
                : rows.filter((row) => milestoneYears.has(row.year));

              return displayRows.map((row) => (
                <tr
                  key={row.year}
                  className={`border-b border-subtle ${
                    row.hasAdjustment ? "bg-blue-50" : ""
                  } ${row.age === r.currentFiAge ? "bg-green-50" : ""} ${
                    row.age === r.relocationFiAge ? "bg-purple-50" : ""
                  } ${row.age === r.earliestRelocateAge ? "bg-cyan-50" : ""} ${
                    purchaseYears.has(row.year) ? "bg-orange-50" : ""
                  }`}
                >
                  <td className="py-1 pr-3">{row.year}</td>
                  <td className="py-1 pr-3" title={ageTooltip(row.year)}>
                    {displayAge(row.year) ?? row.age}
                    {row.age === r.currentFiAge && (
                      <span className="ml-1 text-green-600 text-[10px]">
                        FI
                      </span>
                    )}
                    {row.age === r.relocationFiAge && (
                      <span className="ml-1 text-purple-600 text-[10px]">
                        FI-R
                      </span>
                    )}
                    {row.age === r.earliestRelocateAge && (
                      <span className="ml-1 text-cyan-600 text-[10px]">
                        MOVE
                      </span>
                    )}
                  </td>
                  <td className="text-right py-1 pr-3 font-mono">
                    {formatCurrency(row.currentContribution)}
                  </td>
                  <td className="text-right py-1 pr-3 font-mono">
                    {formatCurrency(row.currentBalance)}
                  </td>
                  <td className="text-right py-1 pr-3 font-mono">
                    {formatCurrency(row.relocationContribution)}
                  </td>
                  <td className="text-right py-1 pr-3 font-mono">
                    {formatCurrency(row.relocationBalance)}
                  </td>
                  <td
                    className={`text-right py-1 pr-3 font-mono ${row.delta < 0 ? "text-red-600" : "text-green-600"}`}
                  >
                    {row.delta < 0 ? "" : "+"}
                    {formatCurrency(row.delta)}
                  </td>
                  <td className="text-right py-1 font-mono">
                    {formatCurrency(row.relocationExpenses / 12)}/mo
                    {row.hasAdjustment && (
                      <span className="ml-1 text-blue-500">*</span>
                    )}
                    {row.largePurchaseImpact !== 0 && (
                      <span
                        className="ml-1 text-orange-500"
                        title={`Portfolio: ${row.largePurchaseImpact > 0 ? "+" : ""}${formatCurrency(row.largePurchaseImpact)}`}
                      >
                        $
                      </span>
                    )}
                  </td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-faint">
        <span>
          <span className="inline-block w-2 h-2 bg-green-200 rounded mr-1" />
          FI = current FI age
        </span>
        <span>
          <span className="inline-block w-2 h-2 bg-purple-200 rounded mr-1" />
          FI-R = relocation FI age
        </span>
        <span>
          <span className="inline-block w-2 h-2 bg-cyan-200 rounded mr-1" />
          MOVE = earliest safe relocation
        </span>
        <span>
          <span className="inline-block w-2 h-2 bg-blue-200 rounded mr-1" />* =
          expense adjustment
        </span>
        <span>
          <span className="inline-block w-2 h-2 bg-orange-200 rounded mr-1" />$
          = large purchase
        </span>
      </div>
    </div>
  );
}
