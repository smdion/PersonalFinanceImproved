"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import type { DeductionRowData, CreateDeductionData } from "./types";

export function DeductionRow({
  row,
  onUpdateDeduction,
  onCreateDeduction,
}: {
  row: DeductionRowData;
  onUpdateDeduction: (id: number, field: string, value: string) => void;
  onCreateDeduction?: (data: CreateDeductionData) => void;
}) {
  if (row.type === "placeholder") {
    return (
      <div className="flex justify-between items-center text-faint">
        <span>{row.name}</span>
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
        />
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center text-muted">
      <span>{row.name}</span>
      {row.raw ? (
        <InlineEdit
          value={row.raw.amountPerPeriod}
          onSave={(v) => onUpdateDeduction(row.raw!.id, "amountPerPeriod", v)}
          formatDisplay={(v) => `-${formatCurrency(Number(v))}`}
          parseInput={(v) => v.replace(/[^0-9.]/g, "")}
          type="number"
          className="text-red-600"
        />
      ) : (
        <span className="text-red-600">-{formatCurrency(row.amount)}</span>
      )}
    </div>
  );
}
