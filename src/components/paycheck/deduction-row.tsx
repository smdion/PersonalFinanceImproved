"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import type { DeductionRowData, CreateDeductionData } from "./types";

const ACRONYMS: Record<string, string> = { hsa: "HSA", ira: "IRA", fsa: "FSA" };
const displayName = (name: string) => ACRONYMS[name.toLowerCase()] ?? name;

export function DeductionRow({
  row,
  onUpdateDeduction,
  onCreateDeduction,
  readOnly,
}: {
  row: DeductionRowData;
  onUpdateDeduction: (id: number, field: string, value: string) => void;
  onCreateDeduction?: (data: CreateDeductionData) => void;
  /** Sandbox/preview mode — in-place editing is disabled. */
  readOnly?: boolean;
}) {
  if (row.type === "placeholder") {
    return (
      <div className="text-faint flex items-center justify-between">
        <span>{displayName(row.name)}</span>
        <InlineEdit
          value=""
          onSave={(v) => {
            const cleaned = v.replace(/[^0-9.]/g, "");
            if (!cleaned || Number(cleaned) === 0) return;
            onCreateDeduction?.({
              jobId: row.jobId,
              deductionName: row.name,
              amountPerPeriod: cleaned,
              isPretax: row.isPretax,
              ficaExempt: row.ficaExempt,
            });
          }}
          formatDisplay={(v) =>
            v && Number(v) > 0 ? `-${formatCurrency(Number(v))}` : "—"
          }
          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
          type="number"
          className="text-faint"
          isEditable={!readOnly}
        />
      </div>
    );
  }

  return (
    <div className="text-muted flex items-center justify-between">
      <span>{displayName(row.name)}</span>
      {row.raw ? (
        <InlineEdit
          value={row.raw.amountPerPeriod}
          onSave={(v) => onUpdateDeduction(row.raw!.id, "amountPerPeriod", v)}
          formatDisplay={(v) => `-${formatCurrency(Number(v))}`}
          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
          type="number"
          className="text-red-600"
          isEditable={!readOnly}
        />
      ) : (
        <span className="text-red-600">-{formatCurrency(row.amount)}</span>
      )}
    </div>
  );
}
