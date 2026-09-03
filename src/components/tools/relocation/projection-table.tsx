"use client";

/** Year-by-year portfolio projection comparison table for the Relocation
 *  calculator. Stateless — all state flows via props.
 *
 *  Two display modes:
 *  - Two-column comparison (no moveYear): current path vs. full relocation path.
 *  - Blended (moveYear set): single balance column, current→relocation path.
 */

import { useState } from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { Toggle } from "@/components/ui/toggle";
import { formatCurrency } from "@/lib/utils/format";
import type {
  EngineProjectionRow,
  LargePurchaseRow,
  RelocationEngineResult,
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
  /** Engine-backed projection result. undefined = loading; null = no settings. */
  engineResult?: RelocationEngineResult | null;
  moveYear: number | null;
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
  engineResult,
  moveYear,
}: Props) {
  const [dollarMode, setDollarMode] = useState<"nominal" | "real">("real");

  const inflationRate = engineResult?.inflationRate ?? 0;
  const baseYear = engineResult?.baseYear ?? new Date().getFullYear();
  const deflate = (value: number, year: number) => {
    if (dollarMode === "nominal") return value;
    const years = year - baseYear;
    if (years <= 0) return value;
    return value / Math.pow(1 + inflationRate, years);
  };

  return (
    <div className="border-t pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <h4 className="text-secondary text-sm font-medium">
            Portfolio Projection Comparison
          </h4>
          <HelpTip
            lines={
              moveYear !== null
                ? [
                    "Blended year-by-year portfolio balance: uses your current budget and contributions through the move year, then switches to the relocation budget and contribution profile from that point forward.",
                    '"Today\'s $" deflates future balances by inflation so they\'re comparable to today\'s dollars. "All years" shows every projected year instead of just the highlighted ones.',
                  ]
                : [
                    "Two side-by-side year-by-year portfolio balances: staying on your current budget vs. fully switching to the relocation budget and contribution profile from year one.",
                    '"Today\'s $" deflates future balances by inflation so they\'re comparable to today\'s dollars. "All years" shows every projected year instead of just the highlighted ones.',
                  ]
            }
          />
        </span>
        <div className="flex items-center gap-3">
          <Toggle
            label="Today's $"
            isChecked={dollarMode === "real"}
            onChange={(v) => setDollarMode(v ? "real" : "nominal")}
          />
          <Toggle
            label="All years"
            isChecked={showRelocAllYears}
            onChange={setShowRelocAllYears}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <ComparisonTable
          rows={engineResult?.projectionRows ?? []}
          showAllYears={showRelocAllYears}
          result={r}
          relocYearAdjustments={relocYearAdjustments}
          relocLargePurchases={relocLargePurchases}
          peopleLookup={peopleLookup}
          displayAge={displayAge}
          ageTooltip={ageTooltip}
          engineResult={engineResult}
          deflate={deflate}
          dollarMode={dollarMode}
          moveYear={moveYear}
        />
      </div>

      <Legend isBlended={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

function ComparisonTable({
  rows,
  showAllYears,
  result: r,
  relocYearAdjustments,
  relocLargePurchases,
  peopleLookup,
  displayAge,
  ageTooltip,
  engineResult,
  deflate,
  dollarMode,
  moveYear,
}: {
  rows: EngineProjectionRow[];
  showAllYears: boolean;
  result: RelocationResult;
  relocYearAdjustments: YearAdjustmentRow[];
  relocLargePurchases: LargePurchaseRow[];
  peopleLookup: PersonLookup[] | undefined;
  displayAge: (year: number) => number | null;
  ageTooltip: (year: number) => string | undefined;
  engineResult?: RelocationEngineResult | null;
  deflate: (value: number, year: number) => number;
  dollarMode: "nominal" | "real";
  moveYear?: number | null;
}) {
  // When moveYear is set, replace the "Move Path" column with blended data so
  // the gap is $0 until the move year (both paths are identical before then).
  const blendedByYear = new Map(
    (engineResult?.blendedRows ?? []).map((r) => [r.year, r]),
  );
  if (rows.length === 0) {
    return (
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted border-b">
            <th className="py-1 pr-3 text-left">Year</th>
            <th className="py-1 pr-3 text-left">
              Age{peopleLookup && peopleLookup.length > 1 ? " (avg)" : ""}
            </th>
            <th className="py-1 pr-3 text-right">
              Contributions{dollarMode === "real" ? " (today's $)" : ""}
            </th>
            <th className="py-1 pr-3 text-right">
              Current Balance{dollarMode === "real" ? " (today's $)" : ""}
            </th>
            <th className="py-1 pr-3 text-right">
              {moveYear != null ? `Move ${moveYear}` : "Move Path"}{" "}
              Contributions
              {dollarMode === "real" ? " (today's $)" : ""}
            </th>
            <th className="py-1 pr-3 text-right">
              {moveYear != null ? `Move ${moveYear}` : "Move Path"} Balance
              {dollarMode === "real" ? " (today's $)" : ""}
            </th>
            <th className="py-1 pr-3 text-right">Gap</th>
            <th className="py-1 text-right">Reloc Expenses</th>
          </tr>
        </thead>
        <tbody />
      </table>
    );
  }

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
  if (engineResult?.earliestRelocateYear != null) {
    milestoneYears.add(engineResult.earliestRelocateYear);
  }
  for (const adj of relocYearAdjustments) milestoneYears.add(adj.year);
  for (const p of relocLargePurchases) milestoneYears.add(p.purchaseYear);

  const purchaseYears = new Set(relocLargePurchases.map((p) => p.purchaseYear));
  const lastProjectedYear = rows[rows.length - 1]?.year;

  const displayRows = showAllYears
    ? rows
    : rows.filter((row) => milestoneYears.has(row.year));

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted border-b">
          <th className="py-1 pr-3 text-left">Year</th>
          <th className="py-1 pr-3 text-left">
            Age{peopleLookup && peopleLookup.length > 1 ? " (avg)" : ""}
          </th>
          <th className="py-1 pr-3 text-right">
            Contributions{dollarMode === "real" ? " (today's $)" : ""}
          </th>
          <th className="py-1 pr-3 text-right">
            Current Balance{dollarMode === "real" ? " (today's $)" : ""}
          </th>
          <th className="py-1 pr-3 text-right">
            {moveYear != null ? `Move ${moveYear}` : "Move Path"} Contributions
            {dollarMode === "real" ? " (today's $)" : ""}
          </th>
          <th className="py-1 pr-3 text-right">
            {moveYear != null ? `Move ${moveYear}` : "Move Path"} Balance
            {dollarMode === "real" ? " (today's $)" : ""}
          </th>
          <th className="py-1 pr-3 text-right">Gap</th>
          <th className="py-1 text-right">Reloc Expenses</th>
        </tr>
      </thead>
      <tbody>
        {displayRows.map((row) => {
          const isLastRow = row.year === lastProjectedYear;
          const isPlannedMoveYear = moveYear != null && row.year === moveYear;
          // Only show earliest-viable badge when no explicit move year is set;
          // when moveYear is set, that hint already appears below the banner.
          const isEarliestMoveYear =
            moveYear == null &&
            engineResult?.earliestRelocateYear != null &&
            row.year === engineResult.earliestRelocateYear;

          // When a move year is set, use blended data for the move-path column
          // so the gap is $0 before the move and only opens up after.
          const blended = moveYear != null ? blendedByYear.get(row.year) : null;
          const moveContrib = blended
            ? blended.contribution
            : row.relocationContribution;
          const moveBalance = blended ? blended.balance : row.relocationBalance;
          const moveExpenses = blended
            ? blended.expenses
            : row.relocationExpenses;
          const gap = moveBalance - row.currentBalance;

          return (
            <tr
              key={row.year}
              className={`border-subtle border-b ${
                row.hasAdjustment ? "bg-blue-50 dark:bg-blue-900/20" : ""
              } ${row.age === r.currentFiAge ? "bg-green-50 dark:bg-green-900/20" : ""} ${
                row.age === r.relocationFiAge
                  ? "bg-purple-50 dark:bg-purple-900/20"
                  : ""
              } ${isPlannedMoveYear || isEarliestMoveYear ? "bg-cyan-50 dark:bg-cyan-900/20" : ""} ${
                purchaseYears.has(row.year)
                  ? "bg-orange-50 dark:bg-orange-900/20"
                  : ""
              }`}
            >
              <td className="py-1 pr-3">{row.year}</td>
              <td className="py-1 pr-3" title={ageTooltip(row.year)}>
                {displayAge(row.year) ?? row.age}
                {row.age === r.currentFiAge && (
                  <span className="text-caption ml-1 text-green-600">
                    Retire
                  </span>
                )}
                {row.age === r.relocationFiAge && (
                  <span className="text-caption ml-1 text-purple-600">
                    Retire (reloc)
                  </span>
                )}
                {(isPlannedMoveYear || isEarliestMoveYear) && (
                  <span className="text-caption ml-1 text-cyan-600">MOVE</span>
                )}
                {isLastRow && r.currentFiAge === null && (
                  <span className="text-caption ml-1 text-red-500">
                    No retire date
                  </span>
                )}
              </td>
              <td className="py-1 pr-3 text-right font-mono">
                {formatCurrency(deflate(row.currentContribution, row.year))}
              </td>
              <td className="py-1 pr-3 text-right font-mono">
                {formatCurrency(deflate(row.currentBalance, row.year))}
              </td>
              <td className="py-1 pr-3 text-right font-mono">
                {formatCurrency(deflate(moveContrib, row.year))}
              </td>
              <td className="py-1 pr-3 text-right font-mono">
                {formatCurrency(deflate(moveBalance, row.year))}
              </td>
              <td
                className={`py-1 pr-3 text-right font-mono ${gap < 0 ? "text-red-600" : gap > 0 ? "text-green-600" : "text-muted"}`}
              >
                {gap > 0 ? "+" : gap === 0 ? "" : ""}
                {formatCurrency(deflate(gap, row.year))}
              </td>
              <td className="py-1 text-right font-mono">
                {formatCurrency(moveExpenses / 12)}/mo
                {row.hasAdjustment && blended?.phase === "relocation" && (
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
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend({ isBlended }: { isBlended: boolean }) {
  return (
    <div className="text-caption text-faint mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
      {!isBlended && (
        <>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 shrink-0 rounded bg-green-200 dark:bg-green-800/60" />
            <span className="font-medium text-green-600">Retire</span>
            <span>Portfolio meets current expense target</span>
            <HelpTip
              lines={[
                "First year the portfolio balance meets or exceeds annual expenses ÷ withdrawal rate (inflated each year).",
                "This is a simple threshold — it does not simulate full retirement sustainability. Use the banner recommendation for the engine-backed answer.",
              ]}
            />
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 shrink-0 rounded bg-purple-200 dark:bg-purple-800/60" />
            <span className="font-medium text-purple-600">Retire (reloc)</span>
            <span>Portfolio meets relocation expense target</span>
            <HelpTip
              lines={[
                "Same threshold calculation using relocation expenses. A cheaper move lowers the target; a more expensive one raises it.",
                "This is a simple threshold — it does not simulate full retirement sustainability. Use the banner recommendation for the engine-backed answer.",
              ]}
            />
          </span>
        </>
      )}
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 shrink-0 rounded bg-cyan-200 dark:bg-cyan-800/60" />
        <span className="font-medium text-cyan-600">
          {isBlended ? "MOVE" : "MOVE"}
        </span>
        <span>
          {isBlended
            ? "Year the path switches to the relocation budget"
            : "Earliest year to relocate and still retire on budget"}
        </span>
        <HelpTip
          lines={
            isBlended
              ? [
                  "From this year forward the blended projection uses the relocation budget and contribution profile.",
                  "Years before this row use the current budget and contributions.",
                ]
              : [
                  "Engine-calculated: the earliest year where relocating (switching to the relocation budget and contribution profile) still leaves the portfolio sustainable through your configured retirement age.",
                  "Uses the full retirement projection engine — more accurate than a simple threshold check. The banner shows the same result with full details.",
                ]
          }
        />
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 shrink-0 rounded bg-blue-200 dark:bg-blue-800/60" />
        <span className="font-medium text-blue-500">*</span>
        <span>Custom expense amount applies this year</span>
        <HelpTip text="A Year Adjustment overrides the baseline relocation monthly expense for this year only. Use it to model a phased move, a cost-cut year, or a temporary spike." />
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 shrink-0 rounded bg-orange-200 dark:bg-orange-800/60" />
        <span className="font-medium text-orange-500">$</span>
        <span>A large purchase hits this year</span>
        <HelpTip
          lines={[
            "The down payment (cash outlay) is subtracted from the Move Path Balance in the purchase year.",
            "Loan payments are modeled in the Move Path Balance only through the loan term. Ongoing costs (maintenance, HOA, etc.) continue permanently from the purchase year forward via the relocation expense budget.",
          ]}
        />
      </span>
    </div>
  );
}
