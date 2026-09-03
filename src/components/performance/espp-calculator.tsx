"use client";

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";
import { computeEsppSummary } from "@/lib/pure/performance";
import type { EsppPeriod, EsppSummary } from "@/lib/pure/performance";

type EsppCalculatorProps = {
  /** Called when the user clicks "Apply to form" with computed YTD values. */
  onApply: (summary: EsppSummary) => void;
  /** Allow the user to dismiss the calculator. */
  onDismiss: () => void;
};

type PeriodRow = EsppPeriod & { id: number };

let nextId = 1;

function emptyPeriod(): PeriodRow {
  return {
    id: nextId++,
    withheld: 0,
    marketValue: 0,
    grossProceeds: 0,
    commission: 0,
    dividendsKept: 0,
  };
}

export function EsppCalculator({ onApply, onDismiss }: EsppCalculatorProps) {
  const [periods, setPeriods] = useState<PeriodRow[]>([emptyPeriod()]);

  const updatePeriod = (id: number, field: keyof EsppPeriod, raw: string) => {
    const value = parseFloat(raw) || 0;
    setPeriods((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    );
  };

  const addPeriod = () => setPeriods((prev) => [...prev, emptyPeriod()]);
  const removePeriod = (id: number) =>
    setPeriods((prev) => prev.filter((p) => p.id !== id));

  const summary = computeEsppSummary(periods);
  const hasSales = periods.some((p) => p.grossProceeds > 0);

  return (
    <div className="mb-3 space-y-3 rounded-md border border-teal-500/40 bg-teal-50/30 p-3 dark:bg-teal-950/20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-4 w-1.5 flex-shrink-0 rounded-full bg-teal-500" />
          <span className="text-xs font-semibold tracking-wide text-teal-700 uppercase dark:text-teal-400">
            ESPP Calculator
          </span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-caption text-faint hover:text-muted"
        >
          dismiss
        </button>
      </div>

      {/* Field source guide */}
      <div className="text-caption text-faint grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-teal-500/20 pt-2">
        <span>
          <span className="text-muted font-medium">Amount Withheld</span> —
          purchase confirmation
        </span>
        <span>
          <span className="text-muted font-medium">Market Value</span> —
          purchase confirmation
        </span>
        <span>
          <span className="text-muted font-medium">Gross Proceeds</span> — sale
          trade confirmation
        </span>
        <span>
          <span className="text-muted font-medium">Commission</span> — sale
          trade confirmation
        </span>
      </div>

      {/* Period rows */}
      <div className="space-y-2">
        {periods.map((p, idx) => (
          <PeriodInputRow
            key={p.id}
            period={p}
            label={`Q${idx + 1}`}
            canRemove={periods.length > 1}
            onChange={(field, raw) => updatePeriod(p.id, field, raw)}
            onRemove={() => removePeriod(p.id)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addPeriod}
        className="text-xs font-medium text-teal-600 hover:text-teal-800"
      >
        + Add purchase period
      </button>

      {/* YTD Summary */}
      <div className="space-y-1 border-t border-teal-500/20 pt-2">
        <p className="text-caption text-muted font-semibold tracking-wide uppercase">
          YTD Summary
        </p>
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
          <SummaryLine
            label="Employee Contrib"
            value={summary.employeeContributions}
          />
          <SummaryLine
            label="Employer Match (disc.)"
            value={summary.employerMatch}
          />
          <SummaryLine
            label="Total Contributions"
            value={summary.totalContributions}
            bold
          />
          {hasSales && (
            <>
              <SummaryLine label="Rollovers (out)" value={summary.rollovers} />
              <SummaryLine label="Fees (commission)" value={summary.fees} />
            </>
          )}
          {summary.distributions > 0 && (
            <SummaryLine label="Distributions" value={summary.distributions} />
          )}
        </div>
      </div>

      {/* Apply button */}
      <div className="flex items-center justify-end gap-2 border-t border-teal-500/20 pt-2">
        <span className="text-caption text-faint flex-1">
          Ending balance comes from snapshot or manual entry above — not set by
          this calculator.
        </span>
        <button
          type="button"
          onClick={() => onApply(summary)}
          className="rounded bg-teal-600 px-3 py-1 text-xs font-medium text-white hover:bg-teal-700"
        >
          Apply to form
        </button>
      </div>
    </div>
  );
}

function PeriodInputRow({
  period,
  label,
  canRemove,
  onChange,
  onRemove,
}: {
  period: PeriodRow;
  label: string;
  canRemove: boolean;
  onChange: (field: keyof EsppPeriod, raw: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-caption text-muted font-semibold">{label}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-caption text-red-400 hover:text-red-600"
          >
            remove
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        <EsppField
          label="Withheld"
          value={period.withheld}
          onChange={(v) => onChange("withheld", v)}
        />
        <EsppField
          label="Mkt Value"
          value={period.marketValue}
          onChange={(v) => onChange("marketValue", v)}
          hint={
            period.marketValue > 0 && period.withheld > 0
              ? `disc. ${formatCurrency(period.marketValue - period.withheld)}`
              : undefined
          }
        />
        <EsppField
          label="Gross Proceeds"
          value={period.grossProceeds}
          onChange={(v) => onChange("grossProceeds", v)}
        />
        <EsppField
          label="Commission"
          value={period.commission}
          onChange={(v) => onChange("commission", v)}
        />
        <EsppField
          label="Divs Kept"
          value={period.dividendsKept}
          onChange={(v) => onChange("dividendsKept", v)}
        />
      </div>
    </div>
  );
}

function EsppField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (raw: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-caption text-muted mb-0.5 block">{label}</label>
      <div className="border-default flex items-center rounded border focus-within:ring-1 focus-within:ring-teal-500">
        <span className="text-caption text-muted pl-1.5 select-none">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          defaultValue={value === 0 ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          className="text-label text-primary focus-visible:ring-offset-surface-primary min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1"
        />
      </div>
      {hint && (
        <div className="text-micro mt-0.5 text-right text-teal-600">{hint}</div>
      )}
    </div>
  );
}

function SummaryLine({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-2 ${bold ? "font-semibold" : ""}`}
    >
      <span className="text-muted">{label}</span>
      <span
        className={`tabular-nums ${value < 0 ? "text-red-600" : "text-primary"}`}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}
