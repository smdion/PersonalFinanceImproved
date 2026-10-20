"use client";

import { InlineEdit } from "@/components/ui/inline-edit";
import { FieldRow } from "@/components/ui/field-row";
import { formatCurrency } from "@/lib/utils/format";
import type { DeductionRowData, CreateDeductionData } from "./types";
import {
  DEDUCTION_PRESETS,
  deductionPresetFor,
} from "@/lib/config/paycheck-presets";

const ACRONYMS: Record<string, string> = { hsa: "HSA", ira: "IRA", fsa: "FSA" };
export const deductionDisplayName = (name: string) =>
  ACRONYMS[name.toLowerCase()] ?? name;

const numeric = (v: string) => v.replace(/[^0-9.]/g, "");

/** Fixed-width slot after every amount — holds the remove button where
 *  there is one, and keeps every amount in the same column where not. */
export function ActionSlot({ children }: { children?: React.ReactNode }) {
  return (
    <span className="ml-1 inline-flex w-4 justify-center">{children}</span>
  );
}

export function DeductionRow({
  row,
  label,
  onUpdateDeduction,
  onCreateDeduction,
  onDelete,
  readOnly,
  amountReadOnly,
}: {
  row: DeductionRowData;
  /** Display name, when it needs more than the stored name (e.g. "401k
   *  (Roth)" when the same name appears before and after tax). */
  label?: string;
  onUpdateDeduction: (id: number, field: string, value: string) => void;
  onCreateDeduction?: (data: CreateDeductionData) => void;
  onDelete?: () => void;
  /** Nothing editable here (locked padlock, sandbox). */
  readOnly?: boolean;
  /** The amount is a profile field — read-only when profile edits aren't
   *  in play, while the tax treatment (setup) may still be editable. */
  amountReadOnly?: boolean;
}) {
  const name = label ?? deductionDisplayName(row.name);

  if (row.type === "placeholder") {
    // Another person has this line; shown here so the two stubs line up.
    return (
      <FieldRow label={<span className="text-faint">{name}</span>}>
        <InlineEdit
          value=""
          onSave={(v) => {
            const cleaned = numeric(v);
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
          parseInput={numeric}
          type="number"
          className="text-faint"
          isEditable={!readOnly && !amountReadOnly}
          hideEditIcon
        />
        <ActionSlot />
      </FieldRow>
    );
  }

  const preset = row.raw ? deductionPresetFor(row.raw) : null;
  return (
    <FieldRow
      className="group"
      label={<span className="text-muted truncate">{name}</span>}
      hint={
        // Only while editing: locked, the section it sits in (before/after
        // tax) already says how it's taxed, and the extra line would make
        // this row taller than the other person's matching row.
        row.raw && preset && !readOnly ? (
          // How the stub lists it — moving a deduction between the stub's
          // before-tax and after-tax sections changes which taxes it skips.
          <select
            aria-label={`How ${name} is taxed`}
            value={preset.key}
            onChange={(e) =>
              onUpdateDeduction(row.raw!.id, "taxTreatment", e.target.value)
            }
            disabled={readOnly}
            title={preset.label}
            className="text-faint -ml-0.5 cursor-pointer appearance-none bg-transparent hover:underline dark:bg-transparent"
          >
            {DEDUCTION_PRESETS.map((p) => (
              <option key={p.key} value={p.key} title={p.label}>
                {p.short}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {row.raw ? (
        <InlineEdit
          value={row.raw.amountPerPeriod}
          onSave={(v) => onUpdateDeduction(row.raw!.id, "amountPerPeriod", v)}
          formatDisplay={(v) => `-${formatCurrency(Number(v))}`}
          parseInput={numeric}
          type="number"
          className="text-red-600 dark:text-red-400"
          isEditable={!readOnly && !amountReadOnly}
          hideEditIcon
        />
      ) : (
        <span className="text-red-600 dark:text-red-400">
          -{formatCurrency(row.amount)}
        </span>
      )}
      <ActionSlot>
        {!readOnly && onDelete && (
          <button
            onClick={onDelete}
            className="text-faint transition-opacity hover:text-red-500 md:opacity-0 md:group-hover:opacity-100"
            title="Remove deduction"
            aria-label={`Remove ${name}`}
          >
            ✕
          </button>
        )}
      </ActionSlot>
    </FieldRow>
  );
}
