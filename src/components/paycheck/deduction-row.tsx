"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import type { DeductionRowData, CreateDeductionData } from "./types";
import {
  DEDUCTION_PRESETS,
  deductionPresetFor,
} from "@/lib/config/paycheck-presets";

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
    <div className="text-muted flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{displayName(row.name)}</span>
        {row.raw && (
          // How the stub lists it — moving a deduction between the stub's
          // before-tax and after-tax sections changes which taxes it skips.
          <select
            aria-label={`How ${displayName(row.name)} is taxed`}
            value={deductionPresetFor(row.raw).key}
            onChange={(e) =>
              onUpdateDeduction(row.raw!.id, "taxTreatment", e.target.value)
            }
            disabled={readOnly}
            title={deductionPresetFor(row.raw).label}
            className="text-faint bg-transparent text-[10px] hover:underline disabled:opacity-60"
          >
            {DEDUCTION_PRESETS.map((p) => (
              <option key={p.key} value={p.key} title={p.label}>
                {p.short}
              </option>
            ))}
          </select>
        )}
      </span>
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
