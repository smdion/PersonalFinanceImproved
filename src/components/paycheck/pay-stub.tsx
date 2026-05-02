"use client";

import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { SectionHeader } from "./section-header";
import { DeductionRow } from "./deduction-row";
import type {
  PaycheckResult,
  RawDeduction,
  DeductionRowData,
  CreateDeductionData,
} from "./types";

export function PayStub({
  paycheck,
  rawDeductions,
  onUpdateDeduction,
  alignedPreTax,
  alignedPostTax,
  onAddDeduction,
  onDeleteDeduction,
  onCreateDeduction,
}: {
  paycheck: PaycheckResult;
  rawDeductions: RawDeduction[];
  onUpdateDeduction: (id: number, field: string, value: string) => void;
  alignedPreTax?: DeductionRowData[];
  alignedPostTax?: DeductionRowData[];
  onAddDeduction?: (isPretax: boolean) => void;
  onDeleteDeduction?: (id: number) => void;
  onCreateDeduction?: (data: CreateDeductionData) => void;
}) {
  // Match calculator deductions to raw DB rows by name
  const findRaw = (name: string) =>
    rawDeductions.find((d) => d.deductionName === name);

  // Use aligned rows if provided, otherwise build from paycheck data
  const preTaxRows: DeductionRowData[] =
    alignedPreTax ??
    paycheck.preTaxDeductions.map((d) => ({
      type: "real" as const,
      name: d.name,
      amount: d.amount,
      raw: findRaw(d.name),
    }));

  const postTaxRows: DeductionRowData[] =
    alignedPostTax ??
    paycheck.postTaxDeductions.map((d) => ({
      type: "real" as const,
      name: d.name,
      amount: d.amount,
      raw: findRaw(d.name),
    }));

  return (
    <div className="space-y-2">
      <SectionHeader>Per-Period Pay Stub</SectionHeader>
      <div className="bg-surface-sunken rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between font-medium">
          <span>
            Gross Pay
            <HelpTip text="Your total pay before any deductions or taxes are taken out" />
          </span>
          <span>{formatCurrency(paycheck.gross)}</span>
        </div>

        {preTaxRows.length > 0 && (
          <div className="border-t pt-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-faint uppercase">
                Pre-Tax Deductions
                <HelpTip text="Taken from your pay before taxes, reducing your taxable income (e.g. health insurance, 401k)" />
              </p>
              <button
                onClick={() => onAddDeduction?.(true)}
                className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                title="Add pre-tax deduction"
              >
                + Add
              </button>
            </div>
            {preTaxRows.map((row) => (
              <div key={row.name} className="group relative">
                <DeductionRow
                  row={row}
                  onUpdateDeduction={onUpdateDeduction}
                  onCreateDeduction={onCreateDeduction}
                />
                {row.type === "real" && row.raw && (
                  <button
                    onClick={() => onDeleteDeduction?.(row.raw!.id)}
                    className="absolute -left-5 top-0.5 text-faint hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    title="Remove deduction"
                    aria-label="Remove deduction"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {preTaxRows.length === 0 && (
          <div className="border-t pt-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-faint uppercase">
                Pre-Tax Deductions
                <HelpTip text="Taken from your pay before taxes, reducing your taxable income (e.g. health insurance, 401k)" />
              </p>
              <button
                onClick={() => onAddDeduction?.(true)}
                className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                title="Add pre-tax deduction"
              >
                + Add
              </button>
            </div>
            <p className="text-xs text-faint italic">None</p>
          </div>
        )}

        <div className="border-t pt-2">
          <div className="flex justify-between text-muted">
            <span>
              Federal Taxable
              <HelpTip text="Gross pay minus pre-tax deductions — this is the amount federal income tax is calculated on" />
            </span>
            <span>{formatCurrency(paycheck.federalTaxableGross)}</span>
          </div>
        </div>

        <div className="border-t pt-2">
          <p className="text-xs text-faint uppercase mb-1">Taxes</p>
          <div className="flex justify-between text-muted">
            <span>
              Federal W/H
              <HelpTip text="Federal income tax withheld based on your W-4 filing status and salary. This is your per-job withholding election — retirement projections use a separate filing status setting." />
            </span>
            <span className="text-red-600">
              -{formatCurrency(paycheck.federalWithholding)}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>
              Social Security
              <HelpTip text="6.2% of wages up to the annual wage base limit — stops once you hit the cap" />
            </span>
            <span className="text-red-600">
              -{formatCurrency(paycheck.ficaSS)}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>
              Medicare
              <HelpTip text="1.45% of all wages with no cap — an additional 0.9% applies above $200k/person. Note: MFJ filers' actual liability threshold is $250k combined, so you may receive a credit if household income is below that." />
            </span>
            <span className="text-red-600">
              -{formatCurrency(paycheck.ficaMedicare)}
            </span>
          </div>
        </div>

        {postTaxRows.length > 0 && (
          <div className="border-t pt-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-faint uppercase">
                Post-Tax Deductions
                <HelpTip text="Taken from your pay after taxes — does not reduce your taxable income (e.g. Roth 401k, disability)" />
              </p>
              <button
                onClick={() => onAddDeduction?.(false)}
                className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                title="Add post-tax deduction"
              >
                + Add
              </button>
            </div>
            {postTaxRows.map((row) => (
              <div key={row.name} className="group relative">
                <DeductionRow
                  row={row}
                  onUpdateDeduction={onUpdateDeduction}
                  onCreateDeduction={onCreateDeduction}
                />
                {row.type === "real" && row.raw && (
                  <button
                    onClick={() => onDeleteDeduction?.(row.raw!.id)}
                    className="absolute -left-5 top-0.5 text-faint hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    title="Remove deduction"
                    aria-label="Remove deduction"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {postTaxRows.length === 0 && (
          <div className="border-t pt-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-faint uppercase">
                Post-Tax Deductions
                <HelpTip text="Taken from your pay after taxes — does not reduce your taxable income (e.g. Roth 401k, disability)" />
              </p>
              <button
                onClick={() => onAddDeduction?.(false)}
                className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                title="Add post-tax deduction"
              >
                + Add
              </button>
            </div>
            <p className="text-xs text-faint italic">None</p>
          </div>
        )}

        <div className="border-t-2 border-strong pt-2">
          <div className="flex justify-between font-semibold text-lg">
            <span>
              Net Pay
              <HelpTip text="Your actual take-home amount after all deductions and taxes" />
            </span>
            <span className="text-green-700">
              {formatCurrency(paycheck.netPay)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
