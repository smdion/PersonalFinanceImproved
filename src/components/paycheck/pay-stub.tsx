"use client";

import { formatCurrency } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";
import { FieldRow } from "@/components/ui/field-row";
import { SectionHeader } from "./section-header";
import {
  ActionSlot,
  DeductionRow,
  deductionDisplayName,
} from "./deduction-row";
import type {
  PaycheckResult,
  RawDeduction,
  DeductionRowData,
  CreateDeductionData,
} from "./types";

/** An amount in the stub's value column, with the same trailing slot the
 *  deduction rows use, so every figure lines up. */
function Amount({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <span className={className}>{children}</span>
      <ActionSlot />
    </>
  );
}

function GroupTitle({
  children,
  help,
  onAdd,
  addLabel,
}: {
  children: React.ReactNode;
  help: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-caption text-faint font-medium tracking-wide uppercase">
        {children}
        <HelpTip text={help} />
      </p>
      {onAdd && (
        <button
          onClick={onAdd}
          className="text-caption text-blue-600 hover:underline dark:text-blue-400"
          title={addLabel}
        >
          + Add
        </button>
      )}
    </div>
  );
}

export function PayStub({
  paycheck,
  rawDeductions,
  onUpdateDeduction,
  alignedPreTax,
  alignedPostTax,
  onAddDeduction,
  onDeleteDeduction,
  onCreateDeduction,
  readOnly,
  amountReadOnly,
  lineReadOnly,
  note,
}: {
  paycheck: PaycheckResult;
  rawDeductions: RawDeduction[];
  onUpdateDeduction: (id: number, field: string, value: string) => void;
  alignedPreTax?: DeductionRowData[];
  alignedPostTax?: DeductionRowData[];
  onAddDeduction?: (isPretax: boolean) => void;
  onDeleteDeduction?: (id: number) => void;
  onCreateDeduction?: (data: CreateDeductionData) => void;
  /** Locked padlock / sandbox — nothing editable, no add/remove. */
  readOnly?: boolean;
  /** Deduction amounts are profile fields (resolvePaycheckEditTarget). */
  amountReadOnly?: boolean;
  /** A line's tax treatment isn't editable. */
  lineReadOnly?: boolean;
  /** Where deduction amounts save. */
  note?: string;
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

  // The same name before and after tax (a 401(k) split between traditional
  // and Roth) is ambiguous — say which is which.
  const preNames = new Set(preTaxRows.map((r) => r.name.toLowerCase()));
  const postNames = new Set(postTaxRows.map((r) => r.name.toLowerCase()));
  const labelFor = (name: string, pretax: boolean) =>
    preNames.has(name.toLowerCase()) && postNames.has(name.toLowerCase())
      ? `${deductionDisplayName(name)} (${pretax ? "Traditional" : "Roth"})`
      : undefined;

  const rowsFor = (rows: DeductionRowData[], pretax: boolean) =>
    rows.length === 0 ? (
      <p className="text-caption text-faint">None</p>
    ) : (
      rows.map((row) => (
        <DeductionRow
          key={row.name}
          row={row}
          label={labelFor(row.name, pretax)}
          onUpdateDeduction={onUpdateDeduction}
          onCreateDeduction={onCreateDeduction}
          onDelete={
            row.type === "real" && row.raw && onDeleteDeduction
              ? () => onDeleteDeduction(row.raw!.id)
              : undefined
          }
          readOnly={readOnly}
          amountReadOnly={amountReadOnly}
          lineReadOnly={lineReadOnly}
        />
      ))
    );

  return (
    <div className="space-y-2">
      <SectionHeader note={note}>Pay stub (one check)</SectionHeader>
      <div className="bg-surface-sunken border-subtle space-y-2 rounded-lg border p-4 text-sm">
        <FieldRow
          label={
            <span className="font-medium">
              Gross pay
              <HelpTip text="Your total pay before any deductions or taxes are taken out" />
            </span>
          }
        >
          <Amount className="font-medium">
            {formatCurrency(paycheck.gross)}
          </Amount>
        </FieldRow>

        <div className="border-subtle space-y-1 border-t pt-2">
          <GroupTitle
            help="Taken from your pay before taxes, reducing your taxable income (e.g. health insurance, traditional 401k)"
            onAdd={onAddDeduction ? () => onAddDeduction(true) : undefined}
            addLabel="Add a before-tax deduction"
          >
            Before-tax deductions
          </GroupTitle>
          {rowsFor(preTaxRows, true)}
        </div>

        <div className="border-subtle border-t pt-2">
          <FieldRow
            label={
              <span className="text-muted">
                Federal taxable
                <HelpTip text="Gross pay minus before-tax deductions — what federal income tax is figured on" />
              </span>
            }
          >
            <Amount className="text-muted">
              {formatCurrency(paycheck.federalTaxableGross)}
            </Amount>
          </FieldRow>
        </div>

        <div className="border-subtle space-y-1 border-t pt-2">
          <GroupTitle help="Taxes withheld from this check">Taxes</GroupTitle>
          <FieldRow
            label={
              <span className="text-muted">
                Federal withholding
                <HelpTip text="Federal income tax withheld based on your W-4 filing status and salary. This is your per-job withholding election — retirement projections use a separate filing status setting." />
              </span>
            }
          >
            <Amount className="text-red-600 dark:text-red-400">
              -{formatCurrency(paycheck.federalWithholding)}
            </Amount>
          </FieldRow>
          <FieldRow
            label={
              <span className="text-muted">
                Social Security
                <HelpTip text="6.2% of wages up to the annual wage base limit — stops once you hit the cap" />
              </span>
            }
          >
            <Amount className="text-red-600 dark:text-red-400">
              -{formatCurrency(paycheck.ficaSS)}
            </Amount>
          </FieldRow>
          <FieldRow
            label={
              <span className="text-muted">
                Medicare
                <HelpTip text="1.45% of all wages with no cap — an additional 0.9% applies above $200k/person. Note: MFJ filers' actual liability threshold is $250k combined, so you may receive a credit if household income is below that." />
              </span>
            }
          >
            <Amount className="text-red-600 dark:text-red-400">
              -{formatCurrency(paycheck.ficaMedicare)}
            </Amount>
          </FieldRow>
        </div>

        <div className="border-subtle space-y-1 border-t pt-2">
          <GroupTitle
            help="Taken from your pay after taxes — does not reduce your taxable income (e.g. Roth 401k, disability)"
            onAdd={onAddDeduction ? () => onAddDeduction(false) : undefined}
            addLabel="Add an after-tax deduction"
          >
            After-tax deductions
          </GroupTitle>
          {rowsFor(postTaxRows, false)}
        </div>

        <div className="border-strong border-t-2 pt-2">
          <FieldRow
            label={
              <span className="text-base font-semibold">
                Net pay
                <HelpTip text="Your actual take-home amount after all deductions and taxes" />
              </span>
            }
          >
            <Amount className="text-base font-semibold text-green-700 dark:text-green-400">
              {formatCurrency(paycheck.netPay)}
            </Amount>
          </FieldRow>
        </div>
      </div>
    </div>
  );
}
