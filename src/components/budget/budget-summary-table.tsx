"use client";

import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge, StatusDot } from "@/components/ui/badge";
import type { PayrollBreakdown, ColumnResult, SinkingFundLine } from "./types";
import { computeTotalSinking, computeUnallocated } from "./helpers";

type BudgetSummaryTableProps = {
  cols: string[];
  activeColumn: number;
  onSetActiveColumn: (col: number) => void;
  allColumnResults: ColumnResult[];
  payrollBreakdowns: (PayrollBreakdown | null)[];
  columnMonths: number[] | null;
  apiLinkedColumnIndex?: number | null;
  apiService?: string | null;
  sinkingFunds?: SinkingFundLine[];
  nameColWidth?: number;
  /** Name of the budget profile whose savings allocations feed this row —
   *  shown once in the row header rather than repeated per line item. */
  savingsProfileName?: string;
};

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-2.5 h-2.5 text-faint transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Union line items across per-column breakdowns by name. */
function unionLines(
  breakdowns: (PayrollBreakdown | null)[],
  field: "preTaxLines" | "postTaxLines" | "takeHomeLines" | "grossLines",
): { name: string; amounts: (number | null)[] }[] {
  const nameOrder: string[] = [];
  const nameSet = new Set<string>();
  for (const bd of breakdowns) {
    if (!bd) continue;
    for (const line of bd[field]) {
      if (!nameSet.has(line.name)) {
        nameSet.add(line.name);
        nameOrder.push(line.name);
      }
    }
  }
  return nameOrder.map((name) => ({
    name,
    amounts: breakdowns.map((bd) => {
      if (!bd) return null;
      const line = bd[field].find((l) => l.name === name);
      return line?.monthly ?? 0;
    }),
  }));
}

export function BudgetSummaryTable({
  cols,
  activeColumn,
  onSetActiveColumn,
  allColumnResults,
  payrollBreakdowns,
  columnMonths,
  apiLinkedColumnIndex,
  apiService,
  sinkingFunds,
  nameColWidth,
  savingsProfileName,
}: BudgetSummaryTableProps) {
  const [showTaxes, setShowTaxes] = useState(false);
  const [showPreTax, setShowPreTax] = useState(false);
  const [showPostTax, setShowPostTax] = useState(false);
  const [showTakeHome, setShowTakeHome] = useState(false);
  const [showGross, setShowGross] = useState(false);
  const [showSavings, setShowSavings] = useState(false);
  const isWeighted = columnMonths !== null && columnMonths.length > 0;

  // Weighted average across modes (Σ value_i × months_i / 12) — "what does
  // a typical month look like" when spending is split across modes by
  // months/year. Only meaningful when isWeighted; callers gate on that.
  const blended = (values: (number | null)[]) => {
    const months = columnMonths;
    if (!months) return 0;
    return (
      values.reduce<number>((s, v, i) => s + (v ?? 0) * (months[i] ?? 0), 0) /
      12
    );
  };
  const blendedCellClass =
    "text-right py-1 px-2 tabular-nums font-semibold bg-surface-sunken/60";

  // Check if any column has payroll data
  const hasAnyPayroll = payrollBreakdowns.some((b) => b !== null);

  // Union detail lines across columns
  const grossDetailLines = useMemo(
    () => unionLines(payrollBreakdowns, "grossLines"),
    [payrollBreakdowns],
  );
  const preTaxDetailLines = useMemo(
    () => unionLines(payrollBreakdowns, "preTaxLines"),
    [payrollBreakdowns],
  );
  const postTaxDetailLines = useMemo(
    () => unionLines(payrollBreakdowns, "postTaxLines"),
    [payrollBreakdowns],
  );
  const takeHomeDetailLines = useMemo(
    () => unionLines(payrollBreakdowns, "takeHomeLines"),
    [payrollBreakdowns],
  );

  return (
    <div className="overflow-x-auto mb-3">
      {isWeighted && (
        <p className="text-caption text-faint mb-1.5">
          Each mode&rsquo;s column shows{" "}
          <span className="font-medium text-secondary">
            that mode&rsquo;s own monthly amount
          </span>{" "}
          — e.g. what Traveling costs during its 1 month.{" "}
          <span className="font-medium text-secondary">Blended</span> is the
          weighted average across all 12 months — a typical month.
        </p>
      )}
      <table
        className="w-full text-xs border-collapse"
        style={{ tableLayout: "fixed" }}
      >
        <thead>
          <tr className="border-b-2 border-strong">
            <th
              className="text-left py-1.5 pr-3 text-muted font-medium"
              style={{
                width: nameColWidth ?? 192,
                minWidth: 120,
                maxWidth: 400,
              }}
            />
            {cols.map((label, colIdx) => (
              <th
                key={label}
                className={`text-right py-1.5 px-2 font-semibold min-w-[90px] transition-colors ${
                  isWeighted
                    ? "text-primary"
                    : colIdx === activeColumn
                      ? "text-blue-700 bg-blue-50 cursor-pointer"
                      : "text-primary hover:text-blue-600 cursor-pointer"
                }`}
                onClick={
                  isWeighted ? undefined : () => onSetActiveColumn(colIdx)
                }
                title={
                  isWeighted
                    ? `${label} — ${columnMonths[colIdx] ?? 0} month${(columnMonths[colIdx] ?? 0) !== 1 ? "s" : ""}`
                    : colIdx === activeColumn
                      ? `${label} is the active budget mode`
                      : `Set ${label} as active mode`
                }
              >
                {label}
                {!isWeighted && colIdx === activeColumn && (
                  <span className="ml-1 text-caption align-super text-blue-500">
                    ●
                  </span>
                )}
                {apiService && apiLinkedColumnIndex === colIdx && (
                  <Badge
                    color="blue"
                    case="normal"
                    className="ml-1 align-middle"
                  >
                    ⇄ {apiService.toUpperCase()}
                  </Badge>
                )}
              </th>
            ))}
            {isWeighted && (
              <th
                className="text-right py-1.5 px-2 font-semibold min-w-[90px] text-primary bg-surface-sunken/60"
                title="Weighted average across modes — what a typical month looks like"
              >
                Blended
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {hasAnyPayroll && (
            <>
              {/* Gross income row */}
              <tr
                className={`border-t-2 border-strong${grossDetailLines.length > 1 ? "cursor-pointer hover:bg-surface-sunken" : ""}`}
                onClick={
                  grossDetailLines.length > 1
                    ? () => setShowGross(!showGross)
                    : undefined
                }
              >
                <td className="py-1 pr-3 font-medium text-green-800">
                  <span className="flex items-center gap-1.5">
                    {grossDetailLines.length > 1 ? (
                      <ChevronIcon expanded={showGross} />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-green-600" />
                    )}
                    Gross Income
                  </span>
                </td>
                {allColumnResults.map((_, i) => (
                  <td
                    key={cols[i]}
                    className="text-right py-1 px-2 tabular-nums text-green-800 font-medium"
                  >
                    {formatCurrency(payrollBreakdowns[i]?.grossMonthly ?? 0)}
                  </td>
                ))}
                {isWeighted && (
                  <td className={`${blendedCellClass} text-green-800`}>
                    {formatCurrency(
                      blended(
                        payrollBreakdowns.map((b) => b?.grossMonthly ?? 0),
                      ),
                    )}
                  </td>
                )}
              </tr>
              {showGross &&
                grossDetailLines.map((line) => (
                  <tr
                    key={line.name}
                    className="border-b border-subtle bg-surface-sunken/50"
                  >
                    <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                      {line.name}
                    </td>
                    {line.amounts.map((amt, i) => (
                      <td
                        key={cols[i]}
                        className="text-right py-0.5 px-2 tabular-nums text-green-700 text-caption"
                      >
                        {formatCurrency(amt ?? 0)}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-right py-0.5 px-2 tabular-nums text-green-700 text-caption bg-surface-sunken/60">
                        {formatCurrency(blended(line.amounts))}
                      </td>
                    )}
                  </tr>
                ))}

              {/* Taxes subtotal */}
              <tr
                className="border-b border-subtle cursor-pointer hover:bg-surface-sunken"
                onClick={() => setShowTaxes(!showTaxes)}
              >
                <td className="py-1 pr-3 text-red-600 font-medium">
                  <span className="flex items-center gap-1.5">
                    <ChevronIcon expanded={showTaxes} />
                    Taxes
                  </span>
                </td>
                {allColumnResults.map((_, i) => (
                  <td
                    key={cols[i]}
                    className="text-right py-1 px-2 tabular-nums text-red-600"
                  >
                    −{formatCurrency(payrollBreakdowns[i]?.totalTaxes ?? 0)}
                  </td>
                ))}
                {isWeighted && (
                  <td className={`${blendedCellClass} text-red-600`}>
                    −
                    {formatCurrency(
                      blended(payrollBreakdowns.map((b) => b?.totalTaxes ?? 0)),
                    )}
                  </td>
                )}
              </tr>
              {showTaxes && (
                <>
                  <tr className="border-b border-subtle bg-surface-sunken/50">
                    <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                      Federal Withholding
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption"
                      >
                        −
                        {formatCurrency(
                          payrollBreakdowns[i]?.federalWithholding ?? 0,
                        )}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption bg-surface-sunken/60">
                        −
                        {formatCurrency(
                          blended(
                            payrollBreakdowns.map(
                              (b) => b?.federalWithholding ?? 0,
                            ),
                          ),
                        )}
                      </td>
                    )}
                  </tr>
                  <tr className="border-b border-subtle bg-surface-sunken/50">
                    <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                      Social Security
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption"
                      >
                        −{formatCurrency(payrollBreakdowns[i]?.ficaSS ?? 0)}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption bg-surface-sunken/60">
                        −
                        {formatCurrency(
                          blended(payrollBreakdowns.map((b) => b?.ficaSS ?? 0)),
                        )}
                      </td>
                    )}
                  </tr>
                  <tr className="border-b border-subtle bg-surface-sunken/50">
                    <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                      Medicare
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption"
                      >
                        −
                        {formatCurrency(
                          payrollBreakdowns[i]?.ficaMedicare ?? 0,
                        )}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption bg-surface-sunken/60">
                        −
                        {formatCurrency(
                          blended(
                            payrollBreakdowns.map((b) => b?.ficaMedicare ?? 0),
                          ),
                        )}
                      </td>
                    )}
                  </tr>
                </>
              )}

              {/* Pre-tax deductions subtotal */}
              {preTaxDetailLines.length > 0 && (
                <>
                  <tr
                    className="border-b border-subtle cursor-pointer hover:bg-surface-sunken"
                    onClick={() => setShowPreTax(!showPreTax)}
                  >
                    <td className="py-1 pr-3 text-red-600 font-medium">
                      <span className="flex items-center gap-1.5">
                        <ChevronIcon expanded={showPreTax} />
                        Pre-Tax Deductions
                        <HelpTip text="Deducted from your paycheck before taxes, like 401(k), HSA, and health insurance premiums." />
                      </span>
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-right py-1 px-2 tabular-nums text-red-600"
                      >
                        −
                        {formatCurrency(payrollBreakdowns[i]?.totalPreTax ?? 0)}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className={`${blendedCellClass} text-red-600`}>
                        −
                        {formatCurrency(
                          blended(
                            payrollBreakdowns.map((b) => b?.totalPreTax ?? 0),
                          ),
                        )}
                      </td>
                    )}
                  </tr>
                  {showPreTax &&
                    preTaxDetailLines.map((line) => (
                      <tr
                        key={`pre-${line.name}`}
                        className="border-b border-subtle bg-surface-sunken/50"
                      >
                        <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                          {line.name}
                        </td>
                        {line.amounts.map((amt, i) => (
                          <td
                            key={cols[i]}
                            className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption"
                          >
                            −{formatCurrency(amt ?? 0)}
                          </td>
                        ))}
                        {isWeighted && (
                          <td className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption bg-surface-sunken/60">
                            −{formatCurrency(blended(line.amounts))}
                          </td>
                        )}
                      </tr>
                    ))}
                </>
              )}

              {/* Post-tax deductions subtotal */}
              {postTaxDetailLines.length > 0 && (
                <>
                  <tr
                    className="border-b border-subtle cursor-pointer hover:bg-surface-sunken"
                    onClick={() => setShowPostTax(!showPostTax)}
                  >
                    <td className="py-1 pr-3 text-red-600 font-medium">
                      <span className="flex items-center gap-1.5">
                        <ChevronIcon expanded={showPostTax} />
                        After-Tax Deductions
                        <HelpTip text="Deducted from your paycheck after taxes, like Roth 401(k) contributions." />
                      </span>
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-right py-1 px-2 tabular-nums text-red-600"
                      >
                        −
                        {formatCurrency(
                          payrollBreakdowns[i]?.totalPostTax ?? 0,
                        )}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className={`${blendedCellClass} text-red-600`}>
                        −
                        {formatCurrency(
                          blended(
                            payrollBreakdowns.map((b) => b?.totalPostTax ?? 0),
                          ),
                        )}
                      </td>
                    )}
                  </tr>
                  {showPostTax &&
                    postTaxDetailLines.map((line) => (
                      <tr
                        key={`post-${line.name}`}
                        className="border-b border-subtle bg-surface-sunken/50"
                      >
                        <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                          {line.name}
                        </td>
                        {line.amounts.map((amt, i) => (
                          <td
                            key={cols[i]}
                            className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption"
                          >
                            −{formatCurrency(amt ?? 0)}
                          </td>
                        ))}
                        {isWeighted && (
                          <td className="text-right py-0.5 px-2 tabular-nums text-red-500 text-caption bg-surface-sunken/60">
                            −{formatCurrency(blended(line.amounts))}
                          </td>
                        )}
                      </tr>
                    ))}
                </>
              )}

              {/* Net take-home */}
              <tr
                className={`border-b ${takeHomeDetailLines.length > 1 ? "cursor-pointer hover:bg-surface-sunken" : ""}`}
                onClick={
                  takeHomeDetailLines.length > 1
                    ? () => setShowTakeHome(!showTakeHome)
                    : undefined
                }
              >
                <td className="py-1 pr-3 font-semibold text-green-700">
                  <span className="flex items-center gap-1.5">
                    {takeHomeDetailLines.length > 1 ? (
                      <ChevronIcon expanded={showTakeHome} />
                    ) : (
                      <StatusDot color="green" />
                    )}
                    Take-Home Pay
                    <HelpTip
                      text={`${payrollBreakdowns.find((b) => b?.budgetNote)?.budgetNote ?? "Regular monthly pay"}. Extra paycheck months are not included — that income is available outside the budget.`}
                    />
                  </span>
                </td>
                {allColumnResults.map((_, i) => (
                  <td
                    key={cols[i]}
                    className="text-right py-1 px-2 tabular-nums text-green-700 font-semibold"
                  >
                    {formatCurrency(payrollBreakdowns[i]?.netMonthly ?? 0)}
                  </td>
                ))}
                {isWeighted && (
                  <td className={`${blendedCellClass} text-green-700`}>
                    {formatCurrency(
                      blended(payrollBreakdowns.map((b) => b?.netMonthly ?? 0)),
                    )}
                  </td>
                )}
              </tr>
              {showTakeHome &&
                takeHomeDetailLines.map((line) => (
                  <tr
                    key={line.name}
                    className="border-b border-subtle bg-surface-sunken/50"
                  >
                    <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                      {line.name}
                    </td>
                    {line.amounts.map((amt, i) => (
                      <td
                        key={cols[i]}
                        className="text-right py-0.5 px-2 tabular-nums text-green-600 text-caption"
                      >
                        {formatCurrency(amt ?? 0)}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-right py-0.5 px-2 tabular-nums text-green-600 text-caption bg-surface-sunken/60">
                        {formatCurrency(blended(line.amounts))}
                      </td>
                    )}
                  </tr>
                ))}

              {/* Essential / Discretionary split */}
              <tr className="border-b border-subtle">
                <td className="py-1 pr-3 font-medium text-blue-700">
                  <span className="flex items-center gap-1.5">
                    <StatusDot color="blue" className="flex-shrink-0" />
                    Essential
                    <HelpTip text="Bills and expenses you must pay regardless — these are included when calculating your emergency fund target." />
                  </span>
                </td>
                {allColumnResults.map((r, i) => (
                  <td
                    key={cols[i]}
                    className="text-right py-1 px-2 tabular-nums text-blue-600"
                  >
                    −{formatCurrency(r.essentialTotal)}
                  </td>
                ))}
                {isWeighted && (
                  <td className={`${blendedCellClass} text-blue-600`}>
                    −
                    {formatCurrency(
                      blended(allColumnResults.map((r) => r.essentialTotal)),
                    )}
                  </td>
                )}
              </tr>
              <tr className="border-b border-subtle">
                <td className="py-1 pr-3 font-medium text-purple-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
                    Discretionary
                    <HelpTip text="Optional spending you could cut in a pinch — not counted toward your emergency fund." />
                  </span>
                </td>
                {allColumnResults.map((r, i) => (
                  <td
                    key={cols[i]}
                    className="text-right py-1 px-2 tabular-nums text-purple-500"
                  >
                    −{formatCurrency(r.discretionaryTotal)}
                  </td>
                ))}
                {isWeighted && (
                  <td className={`${blendedCellClass} text-purple-500`}>
                    −
                    {formatCurrency(
                      blended(
                        allColumnResults.map((r) => r.discretionaryTotal),
                      ),
                    )}
                  </td>
                )}
              </tr>

              {/* Savings — combines sinking funds + unallocated remainder */}
              {(() => {
                const totalSinking = computeTotalSinking(sinkingFunds);
                const hasSinkingFunds = sinkingFunds && sinkingFunds.length > 0;
                return (
                  <>
                    <tr
                      className={`font-bold${hasSinkingFunds ? "cursor-pointer hover:bg-surface-sunken" : ""}`}
                      onClick={
                        hasSinkingFunds
                          ? () => setShowSavings(!showSavings)
                          : undefined
                      }
                    >
                      <td className="py-1.5 pr-3 text-emerald-700">
                        <span className="flex items-center gap-1.5">
                          {hasSinkingFunds ? (
                            <ChevronIcon expanded={showSavings} />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          )}
                          Savings
                          {savingsProfileName && (
                            <span className="text-micro font-normal text-faint">
                              ({savingsProfileName})
                            </span>
                          )}
                          <HelpTip text="Take-home pay minus all budgeted expenses. Sinking fund commitments and allocations below reflect the budget profile named above. Expanding shows sinking fund commitments and the unallocated remainder." />
                        </span>
                      </td>
                      {allColumnResults.map((r, i) => {
                        const netMonthly =
                          payrollBreakdowns[i]?.netMonthly ?? 0;
                        const totalSavings = netMonthly - r.totalMonthly;
                        const overage =
                          payrollBreakdowns[i] !== null
                            ? totalSinking - totalSavings
                            : 0;
                        // In weighted profiles, a single mode running "over"
                        // (e.g. a one-month travel splurge) doesn't mean
                        // savings capacity is actually blown for the year —
                        // only the blended column's warning reflects that.
                        const isOverCapacity = !isWeighted && overage > 0.01;
                        return (
                          <td
                            key={cols[i]}
                            className={`text-right py-1.5 px-2 tabular-nums ${totalSavings >= 0 ? "text-emerald-700" : "text-red-600"}`}
                          >
                            {formatCurrency(totalSavings)}
                            {isOverCapacity && (
                              <div className="text-micro text-red-500 leading-tight mt-0.5">
                                ⚠ {formatCurrency(overage)} over → fix in
                                Savings
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {isWeighted &&
                        (() => {
                          const blendedSavings = blended(
                            allColumnResults.map(
                              (r, i) =>
                                (payrollBreakdowns[i]?.netMonthly ?? 0) -
                                r.totalMonthly,
                            ),
                          );
                          const blendedOverage = totalSinking - blendedSavings;
                          const isOverCapacity = blendedOverage > 0.01;
                          return (
                            <td
                              className={`${blendedCellClass} ${blendedSavings >= 0 ? "text-emerald-700" : "text-red-600"}`}
                            >
                              {formatCurrency(blendedSavings)}
                              {isOverCapacity && (
                                <div className="text-micro text-red-500 leading-tight mt-0.5 font-normal">
                                  ⚠ {formatCurrency(blendedOverage)} over
                                </div>
                              )}
                            </td>
                          );
                        })()}
                    </tr>
                    {showSavings && hasSinkingFunds && (
                      <>
                        {sinkingFunds.map((fund) => (
                          <tr
                            key={fund.id}
                            className="border-b border-subtle bg-surface-sunken/50"
                          >
                            <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                              {fund.name}
                            </td>
                            {allColumnResults.map((_, i) => (
                              <td
                                key={cols[i]}
                                className="text-right py-0.5 px-2 tabular-nums text-amber-500 text-caption"
                              >
                                {formatCurrency(fund.monthlyContribution)}
                              </td>
                            ))}
                            {isWeighted && (
                              <td className="text-right py-0.5 px-2 tabular-nums text-amber-500 text-caption bg-surface-sunken/60">
                                {formatCurrency(fund.monthlyContribution)}
                              </td>
                            )}
                          </tr>
                        ))}
                        <tr className="border-b border-subtle bg-surface-sunken/50">
                          <td className="py-0.5 pr-3 pl-8 text-faint text-caption">
                            Unallocated
                          </td>
                          {allColumnResults.map((r, i) => {
                            const unallocated = computeUnallocated(
                              payrollBreakdowns[i]?.netMonthly ?? 0,
                              r.totalMonthly,
                              totalSinking,
                            );
                            return (
                              <td
                                key={cols[i]}
                                className={`text-right py-0.5 px-2 tabular-nums text-caption ${unallocated >= 0 ? "text-emerald-600" : "text-red-500"}`}
                              >
                                {formatCurrency(unallocated)}
                              </td>
                            );
                          })}
                          {isWeighted &&
                            (() => {
                              const blendedUnallocated = computeUnallocated(
                                blended(
                                  payrollBreakdowns.map(
                                    (b) => b?.netMonthly ?? 0,
                                  ),
                                ),
                                blended(
                                  allColumnResults.map((r) => r.totalMonthly),
                                ),
                                totalSinking,
                              );
                              return (
                                <td
                                  className={`text-right py-0.5 px-2 tabular-nums text-caption bg-surface-sunken/60 ${blendedUnallocated >= 0 ? "text-emerald-600" : "text-red-500"}`}
                                >
                                  {formatCurrency(blendedUnallocated)}
                                </td>
                              );
                            })()}
                        </tr>
                      </>
                    )}
                  </>
                );
              })()}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
