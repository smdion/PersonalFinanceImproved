"use client";

import { useState, useMemo } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { StatusDot } from "@/components/ui/badge";
import type { PayrollBreakdown, ColumnResult, SinkingFundLine } from "./types";
import { BudgetSummaryHeader } from "./budget-summary-header";
import { renderSavingsRows } from "./budget-summary-savings";
import { RowToggle } from "./budget-summary-row-toggle";

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
    <div className="mb-3 overflow-x-auto">
      {isWeighted && (
        <p className="text-caption text-faint mb-1.5">
          Each mode&rsquo;s column shows{" "}
          <span className="text-secondary font-medium">
            that mode&rsquo;s own monthly amount
          </span>{" "}
          — e.g. what Traveling costs during its 1 month.{" "}
          <span className="text-secondary font-medium">Blended</span> is the
          weighted average across all 12 months — a typical month.
        </p>
      )}
      <table
        className="w-full border-collapse text-xs"
        style={{ tableLayout: "fixed" }}
      >
        <BudgetSummaryHeader
          nameColWidth={nameColWidth}
          cols={cols}
          isWeighted={isWeighted}
          activeColumn={activeColumn}
          onSetActiveColumn={onSetActiveColumn}
          columnMonths={columnMonths}
          apiService={apiService}
          apiLinkedColumnIndex={apiLinkedColumnIndex}
        />
        <tbody>
          {hasAnyPayroll && (
            <>
              {/* Gross income row */}
              <tr
                className={`border-t-2 border-strong${grossDetailLines.length > 1 ? "hover:bg-surface-sunken cursor-pointer" : ""}`}
                onClick={
                  grossDetailLines.length > 1
                    ? () => setShowGross(!showGross)
                    : undefined
                }
              >
                <td className="py-1 pr-3 font-medium text-green-800">
                  <span className="flex items-center gap-1.5">
                    {grossDetailLines.length > 1 ? (
                      <RowToggle open={showGross} row="gross" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-green-600" />
                    )}
                    Gross Income
                  </span>
                </td>
                {allColumnResults.map((_, i) => (
                  <td
                    key={cols[i]}
                    className="px-2 py-1 text-right font-medium text-green-800 tabular-nums"
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
                    className="border-subtle bg-surface-sunken/50 border-b"
                  >
                    <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                      {line.name}
                    </td>
                    {line.amounts.map((amt, i) => (
                      <td
                        key={cols[i]}
                        className="text-caption px-2 py-0.5 text-right text-green-700 tabular-nums"
                      >
                        {formatCurrency(amt ?? 0)}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-green-700 tabular-nums">
                        {formatCurrency(blended(line.amounts))}
                      </td>
                    )}
                  </tr>
                ))}

              {/* Taxes subtotal */}
              <tr
                className="border-subtle hover:bg-surface-sunken cursor-pointer border-b"
                onClick={() => setShowTaxes(!showTaxes)}
              >
                <td className="py-1 pr-3 font-medium text-red-600">
                  <span className="flex items-center gap-1.5">
                    <RowToggle open={showTaxes} row="taxes" />
                    Taxes
                  </span>
                </td>
                {allColumnResults.map((_, i) => (
                  <td
                    key={cols[i]}
                    className="px-2 py-1 text-right text-red-600 tabular-nums"
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
                  <tr className="border-subtle bg-surface-sunken/50 border-b">
                    <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                      Federal Withholding
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-caption px-2 py-0.5 text-right text-red-500 tabular-nums"
                      >
                        −
                        {formatCurrency(
                          payrollBreakdowns[i]?.federalWithholding ?? 0,
                        )}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-red-500 tabular-nums">
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
                  <tr className="border-subtle bg-surface-sunken/50 border-b">
                    <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                      Social Security
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-caption px-2 py-0.5 text-right text-red-500 tabular-nums"
                      >
                        −{formatCurrency(payrollBreakdowns[i]?.ficaSS ?? 0)}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-red-500 tabular-nums">
                        −
                        {formatCurrency(
                          blended(payrollBreakdowns.map((b) => b?.ficaSS ?? 0)),
                        )}
                      </td>
                    )}
                  </tr>
                  <tr className="border-subtle bg-surface-sunken/50 border-b">
                    <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                      Medicare
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="text-caption px-2 py-0.5 text-right text-red-500 tabular-nums"
                      >
                        −
                        {formatCurrency(
                          payrollBreakdowns[i]?.ficaMedicare ?? 0,
                        )}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-red-500 tabular-nums">
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
                    className="border-subtle hover:bg-surface-sunken cursor-pointer border-b"
                    onClick={() => setShowPreTax(!showPreTax)}
                  >
                    <td className="py-1 pr-3 font-medium text-red-600">
                      <span className="flex items-center gap-1.5">
                        <RowToggle open={showPreTax} row="preTax" />
                        Pre-Tax Deductions
                        <HelpTip text="Deducted from your paycheck before taxes, like 401(k), HSA, and health insurance premiums." />
                      </span>
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="px-2 py-1 text-right text-red-600 tabular-nums"
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
                        className="border-subtle bg-surface-sunken/50 border-b"
                      >
                        <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                          {line.name}
                        </td>
                        {line.amounts.map((amt, i) => (
                          <td
                            key={cols[i]}
                            className="text-caption px-2 py-0.5 text-right text-red-500 tabular-nums"
                          >
                            −{formatCurrency(amt ?? 0)}
                          </td>
                        ))}
                        {isWeighted && (
                          <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-red-500 tabular-nums">
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
                    className="border-subtle hover:bg-surface-sunken cursor-pointer border-b"
                    onClick={() => setShowPostTax(!showPostTax)}
                  >
                    <td className="py-1 pr-3 font-medium text-red-600">
                      <span className="flex items-center gap-1.5">
                        <RowToggle open={showPostTax} row="postTax" />
                        After-Tax Deductions
                        <HelpTip text="Deducted from your paycheck after taxes, like Roth 401(k) contributions." />
                      </span>
                    </td>
                    {allColumnResults.map((_, i) => (
                      <td
                        key={cols[i]}
                        className="px-2 py-1 text-right text-red-600 tabular-nums"
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
                        className="border-subtle bg-surface-sunken/50 border-b"
                      >
                        <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                          {line.name}
                        </td>
                        {line.amounts.map((amt, i) => (
                          <td
                            key={cols[i]}
                            className="text-caption px-2 py-0.5 text-right text-red-500 tabular-nums"
                          >
                            −{formatCurrency(amt ?? 0)}
                          </td>
                        ))}
                        {isWeighted && (
                          <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-red-500 tabular-nums">
                            −{formatCurrency(blended(line.amounts))}
                          </td>
                        )}
                      </tr>
                    ))}
                </>
              )}

              {/* Net take-home */}
              <tr
                className={`border-b ${takeHomeDetailLines.length > 1 ? "hover:bg-surface-sunken cursor-pointer" : ""}`}
                onClick={
                  takeHomeDetailLines.length > 1
                    ? () => setShowTakeHome(!showTakeHome)
                    : undefined
                }
              >
                <td className="py-1 pr-3 font-semibold text-green-700">
                  <span className="flex items-center gap-1.5">
                    {takeHomeDetailLines.length > 1 ? (
                      <RowToggle open={showTakeHome} row="takeHome" />
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
                    className="px-2 py-1 text-right font-semibold text-green-700 tabular-nums"
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
                    className="border-subtle bg-surface-sunken/50 border-b"
                  >
                    <td className="text-faint text-caption py-0.5 pr-3 pl-8">
                      {line.name}
                    </td>
                    {line.amounts.map((amt, i) => (
                      <td
                        key={cols[i]}
                        className="text-caption px-2 py-0.5 text-right text-green-600 tabular-nums"
                      >
                        {formatCurrency(amt ?? 0)}
                      </td>
                    ))}
                    {isWeighted && (
                      <td className="text-caption bg-surface-sunken/60 px-2 py-0.5 text-right text-green-600 tabular-nums">
                        {formatCurrency(blended(line.amounts))}
                      </td>
                    )}
                  </tr>
                ))}

              {/* Essential / Discretionary split */}
              <tr className="border-subtle border-b">
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
                    className="px-2 py-1 text-right text-blue-600 tabular-nums"
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
              <tr className="border-subtle border-b">
                <td className="py-1 pr-3 font-medium text-purple-500">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full bg-purple-400" />
                    Discretionary
                    <HelpTip text="Optional spending you could cut in a pinch — not counted toward your emergency fund." />
                  </span>
                </td>
                {allColumnResults.map((r, i) => (
                  <td
                    key={cols[i]}
                    className="px-2 py-1 text-right text-purple-500 tabular-nums"
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
              {renderSavingsRows(
                sinkingFunds,
                setShowSavings,
                showSavings,
                savingsProfileName,
                allColumnResults,
                payrollBreakdowns,
                isWeighted,
                cols,
                blended,
                blendedCellClass,
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
